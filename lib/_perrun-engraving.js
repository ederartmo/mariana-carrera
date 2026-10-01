'use strict';
// Separate addon flow. Only 6A RPCs may mutate payments; never registration finalizers.
const crypto = require('node:crypto');
const { requireTestMode } = require('./_perrun-checkout');
const { verifyCheckoutSummaryClaim, createCheckoutSummaryClaim, buildCheckoutSummaryCookie, shouldSecureCheckoutCookie } = require('./_checkout-summary-claim');
const { getAuthenticatedUser } = require('./_auth');
const FLOW = 'perrun-engraving-v1';
const SESSION_TYPES = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired']);
const idOf = value => typeof value === 'string' ? value : value?.id;
const first = data => Array.isArray(data) ? data[0] : data;
class EngravingError extends Error { constructor(reason,status=400){super(reason);this.status=status;} }
async function readOne(supabase,table,filters){
 let query=supabase.from(table).select('*');for(const [key,value] of Object.entries(filters))query=query.eq(key,value);
 const result=await query.maybeSingle();if(result.error)throw new EngravingError('engraving_read_failed',503);return result.data;
}
async function rpc(supabase,name,args){
 const result=await supabase.rpc(name,args);
 if(result.error?.message==='Only attached pending engraving can settle')throw new EngravingError('engraving_needs_manual_reconciliation',503);
 if(result.error)throw new EngravingError('engraving_rpc_rejected',result.error.code==='P0001'||['23505','23514'].includes(result.error.code)?409:503);
 const row=first(result.data);if(!row?.id)throw new EngravingError('engraving_rpc_result_invalid',503);return row;
}
function metadataFor(payment,order){return {flow:FLOW,event_slug:'perrun-2027',payment_ref:payment.id,order_session_id:order};}
function isMetadata(meta){return meta?.flow===FLOW||meta?.flow_version===FLOW;}
function validateSession(session,payment,dog){
 const expected=metadataFor(payment,dog.order_session_id);
 if(session?.livemode!==false||session.mode!=='payment'||!/^cs_test_[A-Za-z0-9_]+$/.test(session.id||'')
 ||session.amount_total!==payment.amount_cents||payment.amount_cents!==3500||session.currency!==payment.currency||payment.currency!=='mxn'
 ||Object.entries(expected).some(([key,value])=>session.metadata?.[key]!==value)
 ||(payment.stripe_session_id&&session.id!==payment.stripe_session_id))throw new EngravingError('engraving_session_identity_amount_mismatch',409);
}
async function authorizedDog({req,supabase,order,index}){
 // Verify cookie/session before any ownership query. A raw order/dog ID never proves ownership.
 const claim=verifyCheckoutSummaryClaim(req.headers?.cookie,order);
 let auth;if(!claim.ok){auth=await getAuthenticatedUser(req,{supabase});if(auth.error)throw new EngravingError('engraving_not_authorized',403);}
 const human=await readOne(supabase,'inscripciones',{order_session_id:order,event_slug:'perrun-2027'});
 if(!human||(!claim.ok&&human.email?.toLowerCase()!==auth.email))throw new EngravingError('engraving_not_authorized',403);
 const dog=await readOne(supabase,'registration_dogs',{order_session_id:order,dog_index:index,registration_id:human.id,registration_email:human.email});
 if(!dog)throw new EngravingError('engraving_not_authorized',403);
 return {dog,human};
}
async function handleCheckout({req,res,stripe,supabase,origin}){
 try{
  res.setHeader('Cache-Control','no-store');requireTestMode();
  const body=req.body||{};
  if(req.headers?.origin!==origin)throw new EngravingError('engraving_origin_rejected',403);
  if(Object.keys(body).some(key=>!['flow','orderSessionId','dogIndex'].includes(key))||body.flow!==FLOW
   ||!/^cs_test_[A-Za-z0-9_]{1,180}$/.test(body.orderSessionId||'')||!Number.isInteger(body.dogIndex)||![1,2].includes(body.dogIndex))throw new EngravingError('engraving_invalid_request');
  const {dog}=await authorizedDog({req,supabase,order:body.orderSessionId,index:body.dogIndex});
  const signed=createCheckoutSummaryClaim(dog.order_session_id);if(!signed.claim)throw new EngravingError('engraving_claim_unavailable',503);
  // DB alone decides eligibility and returns the existing active reference under locks.
  let payment=await rpc(supabase,'reserve_perrun_engraving_payment',{p_dog_id:dog.id,p_order_session_id:dog.order_session_id,p_payment_id:crypto.randomUUID()});
  if(!['reserved','pending'].includes(payment.status))throw new EngravingError('engraving_attempt_terminal',409);
  let session;
  if(payment.stripe_session_id)session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
  else{
   // Never retry an uncertain external creation beyond Stripe's idempotency retention.
   const age=Date.now()-Date.parse(payment.created_at);
   if(!Number.isFinite(age)||age>=23*3600*1000)throw new EngravingError('engraving_reservation_needs_reconciliation',409);
   const returnUrl=origin+'/succes.html?event=perrun-2027&session_id='+encodeURIComponent(dog.order_session_id);
   session=await stripe.checkout.sessions.create({mode:'payment',allowed_payment_method_types:['card','oxxo'],locale:'es',
    integration_identifier:'perrun_engraving_'+crypto.createHash('sha256').update(payment.id).digest('hex').slice(0,8).replace(/[0-9]/g,n=>String.fromCharCode(97+Number(n))),
    line_items:[{quantity:1,price_data:{currency:payment.currency,unit_amount:payment.amount_cents,product_data:{name:'Perrun 2027 · Grabado individual'}}}],
    metadata:metadataFor(payment,dog.order_session_id),payment_intent_data:{metadata:metadataFor(payment,dog.order_session_id)},success_url:returnUrl+'&engraving=returned',cancel_url:returnUrl+'&engraving=cancelled'},
    {idempotencyKey:FLOW+'/'+payment.id});
  }
  validateSession(session,payment,dog);
  // A crash/timeout before this write leaves the SAME reservation/key recoverable, never releases it blindly.
  if(!payment.stripe_session_id)payment=await rpc(supabase,'record_perrun_engraving_state',{p_payment_id:payment.id,p_stripe_session_id:session.id,p_status:'pending',p_stripe_event_id:null,p_payment_intent_id:null});
  res.setHeader('Set-Cookie',buildCheckoutSummaryCookie(signed.claim,{secure:shouldSecureCheckoutCookie(req)}));
  if(payment.status==='paid'||payment.status==='refunded'||session.status==='complete')return res.status(202).json({paymentStatus:payment.status,refresh:true});
  if(session.status!=='open'||!session.url)throw new EngravingError('engraving_waiting_for_expiration_webhook',409);
  const target=new URL(session.url);if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')throw new EngravingError('engraving_invalid_redirect',503);
  return res.status(200).json({url:session.url,amount:payment.amount_cents,currency:payment.currency});
 }catch(error){return res.status(error.status||503).json({error:error instanceof EngravingError?error.message:'engraving_checkout_unavailable'});}
}
async function identity(supabase,session){
 let payment=await readOne(supabase,'perrun_engraving_payments',{stripe_session_id:session.id});
 if(!payment&&isMetadata(session.metadata)&&/^[a-f0-9-]{36}$/i.test(session.metadata.payment_ref||''))payment=await readOne(supabase,'perrun_engraving_payments',{id:session.metadata.payment_ref});
 return payment;
}
function result(error){return {status:error instanceof EngravingError&&error.status<500?200:503,body:{flow:FLOW,received:true,...(error instanceof EngravingError&&error.status<500?{rejected:true}:{retry:true}),reason:error instanceof EngravingError?error.message:'engraving_processing_failed'}};}
function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderEmail(dog){const text='Perrun 2027\nPerro: '+dog.dog_name+'\nPago de grabado: $35 MXN\nGrabado pagado. Tu inscripción y dorsal permanecen iguales.';return {subject:'Grabado pagado — Perrun 2027',text,html:'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Grabado pagado</title></head><body><h1>Perrun 2027</h1><p>Perro: '+escape(dog.dog_name)+'</p><p>Pago de grabado: $35 MXN</p><p>Grabado pagado.</p></body></html>'};}
async function confirmEmail({supabase,payment,dog,mockProvider}){
 // This phase has no real Resend path, even outside local QA.
 if(payment.status!=='paid'||payment.confirmation_email_sent_at)return;
 const human=await readOne(supabase,'inscripciones',{id:dog.registration_id,email:dog.registration_email});if(!human)throw new EngravingError('engraving_email_owner_missing',503);
 const payload={to:human.buyer_email||human.email,...renderEmail(dog)};
 const key=FLOW+'/email/'+payment.id;
 const sent=mockProvider?await mockProvider.emails.send(payload,{idempotencyKey:key}):{data:{id:'mock_engraving_'+payment.id}};
 if(sent.error||!sent.data?.id)throw new EngravingError('engraving_mock_email_failed',503);
 await rpc(supabase,'mark_perrun_engraving_email_sent',{p_payment_id:payment.id,p_provider_id:sent.data.id});
}
async function handleSession({stripe,supabase,event,payment,mockProvider}){
 try{
  requireTestMode();if(event.livemode===true||event.data.object.livemode===true)throw new EngravingError('engraving_live_rejected');
  if(!/^evt_[A-Za-z0-9_]{1,200}$/.test(event.id||''))throw new EngravingError('engraving_event_invalid');
  const snapshot=event.data.object,session=await stripe.checkout.sessions.retrieve(snapshot.id);
  payment=payment||await identity(supabase,session);if(!payment)throw new EngravingError('engraving_payment_not_ready',503);
  const dog=await readOne(supabase,'registration_dogs',{id:payment.dog_id});if(!dog)throw new EngravingError('engraving_dog_missing',503);
  validateSession(session,payment,dog);
  if(snapshot.id!==session.id||Object.keys(metadataFor(payment,dog.order_session_id)).some(key=>snapshot.metadata?.[key]!==session.metadata[key])
   ||(snapshot.amount_total!==undefined&&snapshot.amount_total!==session.amount_total)||(snapshot.currency!==undefined&&snapshot.currency!==session.currency)
   ||(idOf(snapshot.payment_intent)&&idOf(snapshot.payment_intent)!==idOf(session.payment_intent)))throw new EngravingError('engraving_snapshot_mismatch');
  if(payment.status==='reserved')payment=await rpc(supabase,'record_perrun_engraving_state',{p_payment_id:payment.id,p_stripe_session_id:session.id,p_status:'pending',p_stripe_event_id:null,p_payment_intent_id:null});
  if(session.payment_status==='paid'){
   const pi=idOf(session.payment_intent);if(!/^pi_[A-Za-z0-9_]+$/.test(pi||''))throw new EngravingError('engraving_payment_intent_missing',503);
   payment=await rpc(supabase,'finalize_perrun_engraving_payment',{p_payment_id:payment.id,p_stripe_session_id:session.id,p_payment_intent_id:pi,p_stripe_event_id:event.id,p_confirmed_amount_cents:session.amount_total,p_confirmed_currency:session.currency});
   await confirmEmail({supabase,payment,dog,mockProvider});
  }else{
   if(event.type==='checkout.session.async_payment_succeeded')throw new EngravingError('engraving_payment_unconfirmed',503);
   // Card declines can be retried INSIDE the same open Checkout: never terminalize that attempt.
   if(event.type==='payment_intent.payment_failed'&&session.status!=='expired')return {status:200,body:{received:true,flow:FLOW,paymentStatus:payment.status,ignored:true}};
   const status=event.type==='checkout.session.expired'?'expired':event.type==='checkout.session.async_payment_failed'||event.type==='payment_intent.payment_failed'?'failed':'pending';
   if(status==='expired'&&session.status!=='expired')throw new EngravingError('engraving_expiration_unconfirmed',503);
   payment=await rpc(supabase,'record_perrun_engraving_state',{p_payment_id:payment.id,p_stripe_session_id:session.id,p_status:status,p_stripe_event_id:event.id,p_payment_intent_id:null});
  }
  return {status:200,body:{received:true,flow:FLOW,paymentStatus:payment.status}};
 }catch(error){return result(error);}
}
async function routeEvent({stripe,supabase,event,mockProvider}){
 try{
  const object=event.data.object;
  if(SESSION_TYPES.has(event.type)){
   const payment=await identity(supabase,object);
   return payment||isMetadata(object.metadata)?handleSession({stripe,supabase,event,payment,mockProvider}):null;
  }
  if(!['refund.created','refund.updated','charge.refunded','payment_intent.payment_failed'].includes(event.type))return isMetadata(object.metadata)?{status:200,body:{received:true,flow:FLOW,ignored:true}}:null;
  let charge=event.type==='charge.refunded'?object:null,pi=event.type==='payment_intent.payment_failed'?object.id:idOf(object.payment_intent);
  if(!pi&&object.charge){charge=typeof object.charge==='object'?object.charge:await stripe.charges.retrieve(object.charge);pi=idOf(charge.payment_intent);}
  let payment=pi?await readOne(supabase,'perrun_engraving_payments',{stripe_payment_intent_id:pi}):null;
  let session;
  // Pending OXXO has no stored PI. Session identity/metadata prevents falling into legacy even before paid.
  if(!payment&&pi){
   const active=await supabase.from('perrun_engraving_payments').select('id').in('status',['reserved','pending']).limit(1);
   if(active.error)throw new EngravingError('engraving_read_failed',503);
   if(!active.data?.length&&!isMetadata(object.metadata))return null;
   const found=await stripe.checkout.sessions.list({payment_intent:pi,limit:1});session=found.data?.[0];if(session)payment=await identity(supabase,session);}
  if(!payment&&!isMetadata(session?.metadata)&&!isMetadata(object.metadata))return null;
  if(event.type==='payment_intent.payment_failed'){
   if(!session&&payment?.stripe_session_id)session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
   if(!session)throw new EngravingError('engraving_session_not_ready',503);
   return handleSession({stripe,supabase,event:{...event,data:{object:session}},payment,mockProvider});
  }
  if(event.type!=='charge.refunded'&&object.status!=='succeeded')return {status:200,body:{received:true,flow:FLOW,ignored:true}};
  if(!charge){charge=typeof object.charge==='object'?object.charge:await stripe.charges.retrieve(object.charge);}
  // Retrieve the authoritative charge; only a cumulative FULL refund changes addon state.
  charge=await stripe.charges.retrieve(charge.id);
  requireTestMode();if(event.livemode===true||charge.livemode!==false)throw new EngravingError('engraving_live_refund_rejected');
  if(idOf(charge.payment_intent)!==pi||charge.amount!==3500||charge.currency!=='mxn')throw new EngravingError('engraving_refund_identity_amount_mismatch');
  if(charge.amount_refunded<charge.amount)return {status:200,body:{received:true,flow:FLOW,partialRefund:true}};
  if(!Number.isSafeInteger(charge.amount_refunded)||!payment)throw new EngravingError('engraving_refund_not_ready',503);
  session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id||session.id);
  const dog=await readOne(supabase,'registration_dogs',{id:payment.dog_id});validateSession(session,payment,dog);
  if(idOf(session.payment_intent)!==pi)throw new EngravingError('engraving_refund_pi_mismatch');
  const refunded=await rpc(supabase,'record_perrun_engraving_state',{p_payment_id:payment.id,p_stripe_session_id:session.id,p_status:'refunded',p_stripe_event_id:event.id,p_payment_intent_id:pi});
  return {status:200,body:{received:true,flow:FLOW,paymentStatus:refunded.status}};
 }catch(error){return result(error);}
}
module.exports={FLOW,SESSION_TYPES,isMetadata,metadataFor,validateSession,authorizedDog,handleCheckout,handleSession,routeEvent,confirmEmail,renderEmail,readOne};
