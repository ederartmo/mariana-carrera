'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const f=require('./helpers/perrun-payment-v2-fixture.cjs'),v2=require('../lib/_perrun-payment-v2'),payment=require('../lib/_perrun-payment');
process.env.STRIPE_SECRET_KEY='sk_test_v2_fixture';process.env.CHECKOUT_SUMMARY_SECRET='v2-fixture-secret-with-at-least-thirty-two-characters';delete process.env.VERCEL_ENV;
let db;
test.afterEach(()=>{delete process.env.PERRUN_PAYMENT_V2;});
test.before(async()=>{db=new PGlite();await f.install(db);});test.after(async()=>db?.close());
test.beforeEach(async()=>db.exec('truncate public.perrun_registration_edits,public.perrun_promo_slots,public.perrun_checkout_reservation_dogs,public.perrun_checkout_reservations,public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones; update public.perrun_paid_dog_counter set last_sequence=0; insert into public.perrun_promo_slots(slot) select generate_series(1,300);'));
function body(weights=[10]){return {eventSlug:'perrun-2027',distance:'3K',buyerEmail:'qa@example.invalid',tickets:[{...f.payload().participant,whatsapp:'5512345678'}],dogs:weights.map((w,i)=>({dog_name:'Dog '+i,dog_weight_kg:w,engraving_requested:true})),attemptId:crypto.randomUUID()};}
const response=()=>({headers:{},status(n){this.code=n;return this;},json(x){this.body=x;return this;},setHeader(k,v){this.headers[k]=v;}});
function fixture(){
 const calls=[],supabase=f.adapter(db,calls),sessions=new Map(),creates=[],keys=new Map();let next=0;
 const stripe={checkout:{sessions:{async create(p,options){if(keys.has(options.idempotencyKey))return structuredClone(keys.get(options.idempotencyKey));creates.push({p,options});const s={id:'cs_test_v2_'+(++next),livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'mxn',amount_total:p.line_items.reduce((a,x)=>a+x.price_data.unit_amount,0),metadata:p.metadata,payment_intent:'pi_v2_'+next,expires_at:p.expires_at,url:'https://checkout.stripe.com/c/test_v2'};sessions.set(s.id,s);keys.set(options.idempotencyKey,s);return structuredClone(s);},async retrieve(id){assert.ok(sessions.has(id));return structuredClone(sessions.get(id));}}},paymentIntents:{async retrieve(id){return {id,status:stripe.piStatus||'requires_action',next_action:{oxxo_display_details:{expires_after:Math.floor(Date.now()/1000)+86400}}};}}};
 async function run(input){const res=response();await v2.checkout({req:{body:input,headers:{host:'localhost:3000'}},res,supabase,stripe,origin:'http://localhost:3000'});return res;}
 async function prepare(input=body()){const quoted=await run({...input,action:'quote'});assert.equal(quoted.code,200);const create={...input,action:'create',reservationId:quoted.body.reservationId,quoteToken:quoted.body.quoteToken};const result=await run(create);assert.equal(result.code,200);return {input,quoted,create,result,s:sessions.get(result.body.sessionId)};}
 const event=(s,type='checkout.session.completed')=>({id:'evt_v2_'+(++next),type,livemode:false,data:{object:structuredClone(s)}});
 return {calls,supabase,stripe,sessions,creates,run,prepare,event};
}
test('V2 quote fixes 700 pesos before Stripe; one Session with dynamic price_data and safe metadata',async()=>{
 await f.seed(db,300);const x=fixture(),q=await x.prepare(body([8,20]));assert.equal(q.quoted.body.total,700);assert.equal(x.creates.length,1);
 const p=x.creates[0].p;assert.deepEqual(p.payment_method_types,['card','oxxo']);assert.equal(p.allowed_payment_method_types,undefined);assert.match(p.integration_identifier,/^perrun_v2_[a-z]{8}$/);assert.equal(p.payment_method_options.oxxo.expires_after_days,1);assert.equal(p.line_items.length,3);assert.equal(q.s.amount_total,70000);assert.ok(p.expires_at>Math.floor(Date.now()/1000)+1800);
 assert.deepEqual(Object.keys(p.metadata).sort(),['event_slug','flow_version','reservation_ref','ticket_count']);assert.equal(JSON.stringify(p.metadata).includes('qa@example'),false);
 assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,0);
});
test('Real routing uses V2 finalizer exactly; paid duplicate and delayed events never allocate twice',async()=>{
 const x=fixture(),q=await x.prepare();q.s.status='complete';q.s.payment_status='paid';const e=x.event(q.s);
 assert.equal((await payment.handlePerrunPayment({stripe:x.stripe,supabase:x.supabase,event:e})).body.finalized,true);
 assert.equal((await payment.handlePerrunPayment({stripe:x.stripe,supabase:x.supabase,event:e})).body.finalized,true);
 assert.equal((await payment.handlePerrunPayment({stripe:x.stripe,supabase:x.supabase,event:x.event(q.s,'checkout.session.expired')})).body.finalized,true);
 assert.ok(x.calls.filter(c=>c.name.startsWith('finalize')).every(c=>c.name==='finalize_perrun_reservation_v2'));
 assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),1);
});
test('Failure after reserve before provider does not release; retry recovers same reservation',async()=>{
 const x=fixture(),input=body(),q=await x.run({...input,action:'quote'}),create={...input,...q.body,action:'create'};const real=x.stripe.checkout.sessions.create;
 x.stripe.checkout.sessions.create=async()=>{throw Error('Provider timeout');};assert.equal((await x.run(create)).code,503);
 assert.equal((await db.query("select count(*)::int n from public.perrun_promo_slots where status='reserved'")).rows[0].n,1);
 x.stripe.checkout.sessions.create=real;assert.equal((await x.run(create)).code,200);assert.equal(x.creates.length,1);
});
test('Provider created but DB attach failed: identical Stripe key and original parameters, only one Session',async()=>{
 const x=fixture(),input=body(),q=await x.run({...input,action:'quote'}),create={...input,...q.body,action:'create'};const real=x.supabase.rpc;let fail=true;
 x.supabase.rpc=async(name,args)=>name==='attach_perrun_checkout_v2'&&fail?(fail=false,{data:null,error:{code:'08006'}}):real(name,args);
 assert.equal((await x.run(create)).code,503);assert.equal(x.sessions.size,1);assert.equal((await x.run(create)).code,200);assert.equal(x.sessions.size,1);assert.equal(x.creates.length,1);
});
test('Webhook can recover unlinked Session after crash, then fulfill',async()=>{
 const x=fixture(),input=body(),q=await x.run({...input,action:'quote'}),create={...input,...q.body,action:'create'},real=x.supabase.rpc;let fail=true;
 x.supabase.rpc=async(name,args)=>name==='attach_perrun_checkout_v2'&&fail?(fail=false,{data:null,error:{code:'08006'}}):real(name,args);
 await x.run(create);const s=[...x.sessions.values()][0];s.status='complete';s.payment_status='paid';assert.equal((await v2.sessionEvent({...x,event:x.event(s)})).body.finalized,true);
});
test('Read-only provider reconciliation recovers existing Session beyond minimum creation window without creating again',async()=>{
 const x=fixture(),input=body(),q=await x.run({...input,action:'quote'}),create={...input,...q.body,action:'create'},real=x.supabase.rpc;let fail=true;
 x.supabase.rpc=async(name,args)=>name==='attach_perrun_checkout_v2'&&fail?(fail=false,{data:null,error:{code:'08006'}}):real(name,args);await x.run(create);
 let lists=0;x.stripe.checkout.sessions.list=async()=>{lists++;return {data:[...x.sessions.values()],has_more:false};};const now=Date.now;
 try{Date.now=()=>now()+10*60000;const result=await x.run(create);assert.equal(result.code,200);assert.equal(result.body.sessionId,[...x.sessions.keys()][0]);assert.equal(lists,1);assert.equal(x.creates.length,1);}finally{Date.now=now;}
});
test('Uncertain creation without unique provider proof cannot release slot or create replacement',async()=>{
 const x=fixture(),input=body(),q=await x.run({...input,action:'quote'}),create={...input,...q.body,action:'create'};
 x.stripe.checkout.sessions.create=async()=>{throw Error('Timeout');};await x.run(create);x.stripe.checkout.sessions.list=async()=>({data:[],has_more:false});const now=Date.now;
 try{Date.now=()=>now()+24*3600000;const result=await x.run(create);assert.equal(result.code,409);assert.equal(result.body.newAttemptRequired,undefined);assert.equal((await db.query('select status from public.perrun_checkout_reservations')).rows[0].status,'creating');assert.equal((await db.query("select count(*)::int n from public.perrun_promo_slots where status='reserved'")).rows[0].n,1);}finally{Date.now=now;}
});
test('Retry for completed Session returns authenticated summary instead of another Checkout',async()=>{
 const x=fixture(),q=await x.prepare();q.s.status='complete';q.s.payment_status='paid';await v2.sessionEvent({...x,event:x.event(q.s)});
 const result=await x.run(q.create);assert.equal(result.code,202);assert.equal(result.body.sessionId,q.s.id);assert.ok(result.headers['Set-Cookie']);assert.equal(x.creates.length,1);
});
test('OXXO pending holds benefit despite Checkout expiry; late succeeded consumes at original amount',async()=>{
 await f.seed(db,299);const x=fixture(),q=await x.prepare();q.s.status='complete';x.stripe.piStatus='requires_action';
 assert.equal((await v2.sessionEvent({...x,event:x.event(q.s)})).body.pending,true);
 assert.equal((await v2.sessionEvent({...x,event:x.event(q.s,'checkout.session.expired')})).body.pending,true);
 const r=await f.reserve(db);assert.equal(r.amount_cents,48500);q.s.payment_status='paid';x.stripe.piStatus='succeeded';
 assert.equal((await v2.sessionEvent({...x,event:x.event(q.s,'checkout.session.async_payment_succeeded')})).body.finalized,true);
 assert.equal((await db.query('select engraving_state from public.registration_dogs')).rows[0].engraving_state,'free');
});
test('OXXO confirmed terminal failed releases only attached benefit; duplicate terminal does nothing',async()=>{
 await f.seed(db,299);const x=fixture(),q=await x.prepare();q.s.status='complete';x.stripe.piStatus='requires_payment_method';
 const e=x.event(q.s,'checkout.session.async_payment_failed');assert.equal((await v2.sessionEvent({...x,event:e})).body.released,true);assert.equal((await v2.sessionEvent({...x,event:e})).body.released,true);
 const r=await f.reserve(db);assert.equal(r.dogs[0].promo_slot,300);assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,0);
});
test('Unpaid expired card releases; processing or ambiguous open failure never releases',async()=>{
 const x=fixture(),q=await x.prepare();x.stripe.piStatus='requires_payment_method';assert.equal((await v2.sessionEvent({...x,event:x.event(q.s,'checkout.session.async_payment_failed')})).body.ignored,true);
 q.s.status='expired';x.stripe.piStatus='processing';assert.equal((await v2.sessionEvent({...x,event:x.event(q.s,'checkout.session.expired')})).body.pending,true);
 x.stripe.piStatus='canceled';assert.equal((await v2.sessionEvent({...x,event:x.event(q.s,'checkout.session.expired')})).body.released,true);
});
for(const field of ['amount_total','currency','metadata','payment_intent','livemode'])test('V2 rejects forged event '+field+' without fulfillment',async()=>{
 const x=fixture(),q=await x.prepare();q.s.payment_status='paid';q.s.status='complete';const e=x.event(q.s);e.data.object[field]={amount_total:1,currency:'usd',metadata:{...q.s.metadata,ticket_count:'2'},payment_intent:'pi_other',livemode:true}[field];
 if(field==='livemode')e.livemode=true;const result=await v2.sessionEvent({...x,event:e});assert.equal(result.status,503);assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,0);
});
test('Signed quote rejects payload modifications or arbitrary reservation ID; browser price not authoritative',async()=>{
 const x=fixture(),input=body(),q=await x.run({...input,action:'quote'});assert.equal((await x.run({...input,...q.body,action:'create',distance:'5K'})).code,403);
 assert.equal((await x.run({...input,...q.body,action:'create',reservationId:crypto.randomUUID()})).code,403);
 assert.equal((await x.run({...input,...q.body,action:'create',total:1,engravingAmount:0})).body.total,450);
});
test('Manual quote requires exact received amount; retry never repeats human; no Stripe call',async()=>{
 await f.seed(db,300);const x=fixture(),input={...body(),manualPaymentId:crypto.randomUUID(),totalAmount:450,transferReference:'QA'},auth={user:{id:'00000000-0000-4000-8000-000000000001'},email:'admin@example.invalid'};
 const run=async body=>{const res=response();await v2.manual({req:{body},res,supabase:x.supabase,auth,sendConfirmation:async()=>({ok:true,skipped:true})});return res;};
 const q=await run({...input,action:'quote'});assert.equal(q.body.total,485);const create={...input,...q.body,action:'record'};assert.equal((await run(create)).code,409);create.totalAmount=485;
 assert.equal((await run(create)).code,200);assert.equal((await run(create)).code,200);assert.equal(x.creates.length,0);assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,1);
});
test('V2 refund keeps consumed slot, BIB history, counter and engraving; no secondary payment',async()=>{
 const x=fixture(),q=await x.prepare();q.s.payment_status='paid';q.s.status='complete';await v2.sessionEvent({...x,event:x.event(q.s)});
 const before=(await db.query('select * from public.registration_dogs')).rows;
 const result=await payment.handlePerrunRefund({stripe:x.stripe,supabase:x.supabase,sessionId:q.s.id,paymentIntentId:q.s.payment_intent});assert.equal(result.body.refunded,true);
 assert.deepEqual((await db.query('select * from public.registration_dogs')).rows,before);assert.equal((await db.query("select count(*)::int n from public.perrun_promo_slots where status='consumed'")).rows[0].n,1);
});
test('V2 summary, admin/profile/CSV and mock email show included paid surcharge; no addon CTA',async()=>{
 await f.seed(db,300);const x=fixture(),q=await x.prepare(body([8,20]));q.s.payment_status='paid';q.s.status='complete';await v2.sessionEvent({...x,event:x.event(q.s)});
 const summary=await require('../lib/_perrun-checkout').getPerrunSummary(x.supabase,q.s.id);assert.equal(summary.total,700);assert.equal(summary.baseAmount,450);assert.equal(summary.secondDogFee,180);assert.equal(summary.engravingAmount,70);assert.ok(summary.dogs.every(d=>!d.canPayEngraving&&d.engravingStatus.includes('Incluido')));
 const human=(await db.query('select * from public.inscripciones')).rows[0],ops=require('../lib/_perrun-operations');
 const [admin]=await ops.enrichRegistrations(x.supabase,[human]);assert.ok(admin.dogs.every(d=>d.engraving_paid&&!d.can_pay_engraving));assert.ok(ops.perrunCsv([admin]).includes('Incluido en la inscripción'));
 const [profile]=await ops.enrichRegistrations(x.supabase,[human],{profile:true});assert.ok(profile.dogs.every(d=>!d.can_pay_engraving));
 const sent=new Map();let attempts=0;const mockProvider={emails:{send:async(payload,options)=>{attempts++;assert.ok(payload.text.includes('700.00'));assert.ok(payload.text.includes('Incluido en la inscripción'));assert.equal(payload.text.includes('se paga posteriormente'),false);sent.set(options.idempotencyKey,payload);return {data:{id:'mock_email_v2'}};}}};
 const send=()=>require('../lib/_perrun-confirmation').sendPerrunConfirmation({supabase:x.supabase,mockProvider,sessionId:q.s.id});
 assert.equal((await send()).ok,true);assert.equal((await send()).skipped,true);assert.equal(attempts,1);assert.equal(sent.size,1);
});

for(const flag of [undefined,'0','false','true','1'])test('Rollout new orders opt in only for flag=1: '+String(flag),async()=>{
 if(flag===undefined)delete process.env.PERRUN_PAYMENT_V2;else process.env.PERRUN_PAYMENT_V2=flag;
 const x=fixture(),input={...body(),action:'quote'};
 const res=response();await require('../lib/_perrun-checkout').handlePerrunCheckout({req:{body:input},res,...x,origin:'http://localhost:3000'});
 assert.equal(res.code,200);assert.equal(res.body.pricingModelVersion===2,flag==='1');
 assert.equal((await db.query('select count(*)::int n from public.perrun_checkout_reservations')).rows[0].n,flag==='1'?1:0);
 assert.equal(x.creates.length,0);
});
test('Rollout V2 reservation quote/create/webhook retain persisted version after disabling flag',async()=>{
 process.env.PERRUN_PAYMENT_V2='1';const x=fixture(),input=body();
 const run=async body=>{const res=response();await require('../lib/_perrun-checkout').handlePerrunCheckout({req:{body},res,...x,origin:'http://localhost:3000'});return res;};
 const q=await run({...input,action:'quote'});assert.equal(q.body.pricingModelVersion,2);
 process.env.PERRUN_PAYMENT_V2='0';const retry=await run({...input,action:'quote'});assert.equal(retry.body.reservationId,q.body.reservationId);
 const result=await run({...input,...q.body,action:'create'});assert.equal(result.code,200);
 const s=x.sessions.get(result.body.sessionId);s.payment_status='paid';s.status='complete';
 assert.equal((await payment.handlePerrunPayment({...x,event:x.event(s)})).body.finalized,true);
 assert.ok(x.calls.filter(c=>c.name.startsWith('finalize')).every(c=>c.name==='finalize_perrun_reservation_v2'));
});
test('Rollout signed V1 quote and webhook remain V1 after enabling flag',async()=>{
 const x=fixture(),input=body(),legacy=require('../lib/_perrun-checkout');
 const quote=legacy.issueQuote(legacy.normalizePerrunPayload(input));process.env.PERRUN_PAYMENT_V2='1';
 const res=response();await legacy.handlePerrunCheckout({req:{body:{...input,...quote,action:'create'}},res,...x,origin:'http://localhost:3000'});
 assert.equal(res.code,200);const s=x.sessions.get(res.body.sessionId);assert.equal(s.metadata.flow_version,'perrun_v1');
 assert.equal((await db.query('select pricing_model_version from public.perrun_checkout_orders')).rows[0].pricing_model_version,1);
 s.status='complete';s.payment_status='paid';assert.equal((await payment.handlePerrunPayment({...x,event:x.event(s)})).body.finalized,true);
 assert.ok(x.calls.filter(c=>c.name.startsWith('finalize')).every(c=>c.name==='finalize_perrun_paid_order'));
 assert.equal((await db.query('select count(*)::int n from public.perrun_checkout_reservations')).rows[0].n,0);
});
test('Rollout manual V1 retry stays V1 with flag enabled',async()=>{
 const x=fixture(),input={...body(),manualPaymentId:crypto.randomUUID(),totalAmount:450},manual=require('../lib/_perrun-manual-transfer');
 const run=async()=>{const res=response();await manual.handlePerrunManualTransfer({req:{body:input},res,...x,auth:{user:{id:'00000000-0000-4000-8000-000000000001'},email:'admin@example.invalid'},sendConfirmation:async()=>({ok:true,skipped:true})});return res;};
 const first=await run();assert.equal(first.code,200);process.env.PERRUN_PAYMENT_V2='1';const retry=await run();assert.equal(retry.code,200);
 assert.equal(retry.body.tickets[0].bib_number,first.body.tickets[0].bib_number);
 assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from public.perrun_checkout_reservations')).rows[0].n,0);
});
test('Rollout manual reserved V2 quote persists when flag disabled',async()=>{
 const x=fixture(),input=body(),id=crypto.randomUUID();const r=await f.reserve(db,{attempt:id,data:require('../lib/_perrun-checkout').normalizePerrunPayload(input),source:'manual_transfer'});
 process.env.PERRUN_PAYMENT_V2='0';const res=response();await require('../lib/_perrun-manual-transfer').handlePerrunManualTransfer({req:{body:{...input,manualPaymentId:id,action:'quote'}},res,...x,auth:{}});
 assert.equal(res.code,200);assert.equal(res.body.reservationId,r.id);assert.equal(res.body.pricingModelVersion,2);
});
test('Rollout rejects unknown reservation instead of falling back to V1',async()=>{
 const x=fixture(),res=response();await require('../lib/_perrun-checkout').handlePerrunCheckout({req:{body:{...body(),action:'create',reservationId:crypto.randomUUID()}},res,...x,origin:'http://localhost:3000'});
 assert.equal(res.code,503);assert.equal(x.creates.length,0);assert.equal(x.calls.length,0);
});
test('Rollout database lookup failure never creates a Session or falls back to V1',async()=>{
 const x=fixture(),res=response();x.supabase.from=()=>{const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({error:{code:'08006'}})};return q;};
 await require('../lib/_perrun-checkout').handlePerrunCheckout({req:{body:{...body(),action:'quote'}},res,...x,origin:'http://localhost:3000'});
 assert.equal(res.code,503);assert.equal(x.creates.length,0);assert.equal(x.calls.length,0);
});
test('Rollout QA rejects remote database before any version lookup',async()=>{
 const old={qa:process.env.PERRUN_QA_LOCAL,url:process.env.SUPABASE_URL};
 try{
  process.env.PERRUN_QA_LOCAL='1';process.env.SUPABASE_URL='https://blocked.example.invalid';
  const x=fixture();let reads=0;x.supabase.from=()=>{reads++;throw Error('Remote access forbidden');};
  const res=response();await require('../lib/_perrun-checkout').handlePerrunCheckout({req:{body:{...body(),action:'quote'}},res,...x,origin:'http://localhost:3000'});
  assert.equal(res.code,503);assert.equal(reads,0);assert.equal(x.creates.length,0);
  const manual=response();await require('../lib/_perrun-manual-transfer').handlePerrunManualTransfer({req:{body:{...body(),manualPaymentId:crypto.randomUUID(),action:'quote'}},res:manual,...x,auth:{}});
  assert.equal(manual.code,503);assert.equal(reads,0);
 }finally{if(old.qa===undefined)delete process.env.PERRUN_QA_LOCAL;else process.env.PERRUN_QA_LOCAL=old.qa;if(old.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=old.url;}
});
