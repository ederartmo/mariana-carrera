'use strict';
const crypto=require('node:crypto');
const {normalizePerrunPayload,requireStripeMode}=require('./_perrun-checkout');
const {createCheckoutSummaryClaim,buildCheckoutSummaryCookie,shouldSecureCheckoutCookie}=require('./_checkout-summary-claim');
const FLOW='perrun_v2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function canonical(value){return JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);}
function signed(id,payload){const secret=process.env.CHECKOUT_SUMMARY_SECRET||'';if(secret.length<32)throw Error('Checkout secret unavailable');return crypto.createHmac('sha256',secret).update(FLOW+id+canonical(payload)).digest('hex');}
async function rpc(client,name,args){const r=await client.rpc(name,args);if(r.error){const expired=['Quote expired','Reservation released; use a new attempt','Manual quote expired'].includes(r.error.message);throw Object.assign(Error(expired?'La cotización venció. Confirma una cotización nueva.':'No se pudo confirmar la operación V2.'),{status:['P0001','23505','23514'].includes(r.error.code)?409:503,newAttemptRequired:expired});}const x=Array.isArray(r.data)?r.data[0]:r.data;return x;}
async function read(client,id){const r=await client.from('perrun_checkout_reservations').select('*').eq('id',id).maybeSingle();if(r.error||!r.data)throw Error('Reservation unavailable');return r.data;}
function quote(r,payload){return {pricingModelVersion:2,reservationId:r.id,quoteToken:signed(r.id,payload),expiresAt:r.preparation_expires_at,stage:r.price_stage,baseAmount:r.base_amount_cents/100,secondDogFee:r.second_dog_amount_cents/100,engravingAmount:r.engraving_amount_cents/100,total:r.amount_cents/100,currency:'MXN',ticketCount:1,dogCount:payload.dogs.length,benefits:(r.dogs||[]).map(d=>({dogIndex:d.dog_index,free:d.promo_slot!=null,engravingRequested:d.engraving_requested,surcharge:d.surcharge_cents/100}))};}
function verify(body,payload){if(!UUID.test(body.reservationId||'')||typeof body.quoteToken!=='string'||!/^[a-f0-9]{64}$/.test(body.quoteToken)||!crypto.timingSafeEqual(Buffer.from(body.quoteToken),Buffer.from(signed(body.reservationId,payload))))throw Object.assign(Error('Cotización inválida.'),{status:403});}
function metadata(r){return {flow_version:FLOW,event_slug:'perrun-2027',reservation_ref:r.id,ticket_count:'1'};}
function validateSession(s,r){if(r.pricing_model_version!==2||s.livemode!==requireStripeMode()||s.mode!=='payment'||s.currency!==r.currency||s.amount_total!==r.amount_cents||Object.entries(metadata(r)).some(([k,v])=>s.metadata?.[k]!==v)||!/^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(s.id||'')||(r.stripe_session_id&&s.id!==r.stripe_session_id))throw Object.assign(Error('V2 provider identity mismatch'),{status:409});}
async function ensureAttached(client,r,s){validateSession(s,r);return rpc(client,'attach_perrun_checkout_v2',{p_reservation_id:r.id,p_session_id:s.id,p_expires_at:new Date(s.expires_at*1000).toISOString()});}
async function recoverCreatedSession(stripe,r){
 // Read provider objects; never invent a second Session/expiry after an uncertain creation.
 let cursor,found=null;
 for(let page=0;page<10;page++){
  const result=await stripe.checkout.sessions.list({limit:100,created:{gte:Math.floor(Date.parse(r.created_at)/1000)-5},...(cursor?{starting_after:cursor}:{})});
  for(const item of result.data){
   if(item.metadata?.reservation_ref!==r.id)continue;
   const session=await stripe.checkout.sessions.retrieve(item.id);validateSession(session,r);
   if(found&&found.id!==session.id)throw Error('Duplicate provider Sessions require reconciliation');found=session;
  }
  if(!result.has_more)return found;
  cursor=result.data.at(-1)?.id;if(!cursor)throw Error('Provider pagination unavailable');
 }
 throw Error('Provider reconciliation requires a complete search');
}
async function checkout({req,res,stripe,supabase,origin}){
 try{
  res.setHeader('Cache-Control','no-store');requireStripeMode();const body=req.body||{},payload=normalizePerrunPayload(body);
  if(body.action==='quote'){
   if(!UUID.test(body.attemptId||''))throw Object.assign(Error('Identidad de intento inválida.'),{status:400});
   const r=await rpc(supabase,'reserve_perrun_checkout_v2',{p_attempt_id:body.attemptId,p_payload:payload,p_source:'stripe'});return res.status(200).json(quote(r,payload));
  }
  if(body.action!=='create')throw Object.assign(Error('Acción inválida.'),{status:400});
  verify(body,payload);let r=await rpc(supabase,'begin_perrun_checkout_v2',{p_reservation_id:body.reservationId,p_payload:payload});
  let s;
  if(r.stripe_session_id)s=await stripe.checkout.sessions.retrieve(r.stripe_session_id);
  else{
   const canCreate=Date.now()-Date.parse(r.created_at)<23*3600*1000&&Date.parse(r.checkout_expires_at)>Date.now()+30*60*1000;
   if(!canCreate){s=await recoverCreatedSession(stripe,r);if(!s)throw Object.assign(Error('La creación necesita conciliación antes de generar otra sesión.'),{status:409});}
   else{
   const item=(name,cents)=>({quantity:1,price_data:{currency:'mxn',unit_amount:cents,product_data:{name}}});
   const items=[item('Perrun 2027 · '+payload.distance+' · '+r.price_stage,r.base_amount_cents)];
   if(r.second_dog_amount_cents)items.push(item('Segundo perro',r.second_dog_amount_cents));
   if(r.engraving_amount_cents)items.push(item('Grabado solicitado',r.engraving_amount_cents));
   // Keep existing card/OXXO using the installed Checkout SDK contract.
   // allowed_payment_method_types belongs to PaymentIntent/SetupIntent, not Checkout.
   s=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card','oxxo'],locale:'es',customer_email:payload.email,line_items:items,
    integration_identifier:'perrun_v2_'+crypto.createHash('sha256').update(r.id).digest('hex').slice(0,8).replace(/[0-9]/g,n=>String.fromCharCode(97+Number(n))),
    expires_at:Math.floor(Date.parse(r.checkout_expires_at)/1000),payment_method_options:{oxxo:{expires_after_days:1}},metadata:metadata(r),payment_intent_data:{metadata:metadata(r)},
    success_url:origin+'/succes.html?event=perrun-2027&session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/checkout.html?event=perrun-2027&distance='+payload.distance},{idempotencyKey:'perrun-v2/'+r.id});
   }
  }
  r=await ensureAttached(supabase,r,s);
  const claim=createCheckoutSummaryClaim(s.id);if(!claim.claim)throw Error('Checkout claim unavailable');
  res.setHeader('Set-Cookie',buildCheckoutSummaryCookie(claim.claim,{secure:shouldSecureCheckoutCookie(req)}));
  if(s.status!=='open'||!s.url)return res.status(202).json({refresh:true,sessionId:s.id});
  const target=new URL(s.url);if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')throw Error('Invalid checkout redirect');
  return res.status(200).json({url:s.url,sessionId:s.id,total:r.amount_cents/100});
 }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Checkout pendiente de recuperación. Reintenta la misma operación.',...(e.newAttemptRequired?{newAttemptRequired:true}:{})});}
}
async function final(client,r,{session=null,event=null,amount,reference=null,actor=null}){
 const result=await client.rpc('finalize_perrun_reservation_v2',{p_reservation_id:r.id,p_session_id:session?.id||null,p_payment_intent_id:typeof session?.payment_intent==='string'?session.payment_intent:session?.payment_intent?.id||null,p_stripe_event_id:event?.id||null,p_amount_cents:amount,p_currency:'mxn',p_transfer_reference:reference,p_admin_user_id:actor?.user.id||null,p_admin_email:actor?.email||null});
 if(result.error)throw Error('V2 finalization failed');return result.data;
}
async function sessionEvent({stripe,supabase,event}){
 try{
  const snapshot=event.data.object;
  if(!/^evt_[A-Za-z0-9_]+$/.test(event.id||'')||event.livemode!==requireStripeMode()||!UUID.test(snapshot.metadata?.reservation_ref||''))throw Error('Invalid V2 event');
  let r=await read(supabase,snapshot.metadata.reservation_ref);
  const s=await stripe.checkout.sessions.retrieve(snapshot.id);validateSession(s,r);validateSession({...snapshot,mode:s.mode,livemode:event.livemode},r);
  const idOf=x=>typeof x==='string'?x:x?.id;
  if(idOf(snapshot.payment_intent)&&idOf(snapshot.payment_intent)!==idOf(s.payment_intent))throw Error('V2 event PaymentIntent mismatch');
  r=await ensureAttached(supabase,r,s);
  if(s.payment_status==='paid'){
   const dogs=await final(supabase,r,{session:s,event,amount:s.amount_total});
   if(!Array.isArray(dogs)||dogs.length!==r.payload.dogs.length||dogs.some(d=>d.order_session_id!==s.id))throw Error('V2 finalization result invalid');
   return {status:200,body:{received:true,flow:'perrun',finalized:true}};
  }
  const pi=typeof s.payment_intent==='object'?s.payment_intent:s.payment_intent?await stripe.paymentIntents.retrieve(s.payment_intent):null;
  if(pi&&pi.id!==(typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent.id))throw Error('PaymentIntent mismatch');
  const voucher=pi?.next_action?.oxxo_display_details?.expires_after;
  if(pi?.status==='processing'||pi?.status==='requires_action'||s.status==='complete'&&!['requires_payment_method','canceled'].includes(pi?.status)){
   await rpc(supabase,'record_perrun_reservation_v2',{p_reservation_id:r.id,p_state:'pending',p_session_id:s.id,p_voucher_expires_at:voucher?new Date(voucher*1000).toISOString():null});
   await rpc(supabase,'record_perrun_payment_state',{p_order_session_id:s.id,p_stripe_event_id:event.id,p_payment_status:'pending'});
   return {status:200,body:{received:true,flow:'perrun',pending:true}};
  }
  if((s.status==='expired'||s.status==='complete'&&event.type==='checkout.session.async_payment_failed')&&(!pi||['canceled','requires_payment_method'].includes(pi.status))){
   await rpc(supabase,'record_perrun_reservation_v2',{p_reservation_id:r.id,p_state:'released',p_session_id:s.id,p_voucher_expires_at:null});
   await rpc(supabase,'record_perrun_payment_state',{p_order_session_id:s.id,p_stripe_event_id:event.id,p_payment_status:'failed'});
   return {status:200,body:{received:true,flow:'perrun',released:true}};
  }
  return {status:200,body:{received:true,flow:'perrun',ignored:true}};
 }catch{return {status:503,body:{flow:'perrun',retry:true,reason:'v2_reconciliation_required'}};}
}
async function manual({req,res,supabase,auth,sendConfirmation,resend}){
 try{
  res.setHeader?.('Cache-Control','no-store');
  if(process.env.PERRUN_QA_LOCAL==='1')requireStripeMode();
  const body=req.body||{},payload=normalizePerrunPayload(body);
  if(body.paidAt!==undefined||body.tickets.some(t=>t.releasedBib||t.bibMode&&t.bibMode!=='auto'))throw Object.assign(Error('Identidad/fecha manual inválida.'),{status:400});
  if(body.action==='quote'){
   if(!UUID.test(body.manualPaymentId||''))throw Object.assign(Error('Identidad manual inválida.'),{status:400});
   const r=await rpc(supabase,'reserve_perrun_checkout_v2',{p_attempt_id:body.manualPaymentId,p_payload:payload,p_source:'manual_transfer'});return res.status(200).json(quote(r,payload));
  }
  verify(body,payload);const r=await read(supabase,body.reservationId);
  if(r.source!=='manual_transfer'||r.attempt_id!==body.manualPaymentId||canonical(r.payload)!==canonical(payload))throw Object.assign(Error('Reserva manual inválida.'),{status:403});
  if(!Number.isFinite(body.totalAmount)||body.totalAmount*100!==r.amount_cents)throw Object.assign(Error('Monto recibido distinto de la reserva.'),{status:409});
  const dogs=await final(supabase,r,{amount:r.amount_cents,reference:body.transferReference||null,actor:auth});
  const orderId='manual_perrun_'+r.attempt_id;let email={ok:false};try{if(!resend&&sendConfirmation===require('./_perrun-confirmation').sendPerrunConfirmation){const {Resend}=require('resend');resend=new Resend(process.env.RESEND_API_KEY);}email=await sendConfirmation({supabase,resend,sessionId:orderId});}catch{}
  const human=await supabase.from('inscripciones').select('*').eq('order_session_id',orderId).maybeSingle();if(human.error||!human.data)throw Error('Manual registration unavailable');
  return res.status(200).json({ok:true,registrationSaved:true,orderSessionId:orderId,eventSlug:'perrun-2027',totalAmount:r.amount_cents/100,ticketsCreated:1,tickets:[human.data],dogCount:dogs.length,emailSent:!!email.ok&&!email.skipped,emailPending:!email.ok});
 }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Transferencia pendiente de recuperación.',...(e.newAttemptRequired?{newAttemptRequired:true}:{})});}
}
module.exports={FLOW,quote,checkout,sessionEvent,manual,validateSession};
