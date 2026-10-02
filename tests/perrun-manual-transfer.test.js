'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');
const f=require('./helpers/perrun-manual-fixture.cjs');
const {sqlAdapter}=require('./helpers/perrun-payment-sql-adapter.cjs');
const {handlePerrunManualTransfer}=require('../lib/_perrun-manual-transfer');
const {sendPerrunConfirmation}=require('../lib/_perrun-confirmation');
const {enrichRegistrations,perrunCsv}=require('../lib/_perrun-operations');
const event=require('../perrun-event-data');
let db;
test.before(async()=>{db=new PGlite();await f.install(db);});
test.after(async()=>db.close());
test.beforeEach(async()=>db.exec('truncate public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones; update public.perrun_paid_dog_counter set last_sequence=300'));
const auth={email:'admin@example.invalid',user:{id:'00000000-0000-4000-8000-000000000001'}};
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
function body(weights=[10]) { return {eventSlug:event.slug,distance:'3K',buyerEmail:'owner@example.invalid',manualPaymentId:crypto.randomUUID(),tickets:[f.human],dogs:weights.map(weight=>({dog_name:'Dog',dog_weight_kg:weight,engraving_requested:true}))}; }
function fixture(){
  const calls=[],delivered=new Map();let fail=false;
  const supabase=sqlAdapter(db,calls);
  const provider={emails:{async send(payload,{idempotencyKey}){if(fail)return {error:{message:'unavailable'}};delivered.set(idempotencyKey,payload);return {data:{id:'mock_manual_email'}};}}};
  const sendConfirmation=args=>sendPerrunConfirmation({...args,mockProvider:provider,qa:false});
  return {calls,supabase,delivered,setFail:value=>{fail=value;},async run(payload,extra={}){const res=response();await handlePerrunManualTransfer({req:{body:payload},res,supabase,auth,sendConfirmation,...extra});return res;}};
}
for(const distance of ['1K','3K','5K'])for(const weights of [[3],[10,25]])test('Admin Perrun '+distance+' '+weights.length+' dogs: one atomic RPC and correct email',async()=>{
  const x=fixture(),b={...body(weights),distance};const r=await x.run(b);
  assert.equal(r.statusCode,200);assert.equal(r.body.registrationSaved,true);assert.equal(r.body.emailSent,true);
  assert.equal(x.calls.length,1);assert.equal(x.calls[0].name,'register_perrun_manual_paid_order');
  const price=event.pricing.getCurrentStage().amount+(weights.length===2?180:0);assert.equal(r.body.totalAmount,price);
  const email=[...x.delivered.values()][0];assert.match(email.subject,/Perrun 2027/);assert.match(email.text,/no fue cobrado/);
  assert.match(email.text,new RegExp('Total principal pagado: \\$'+price+'\\.00'));
  const human=(await db.query('select * from public.inscripciones')).rows;
  const enriched=await enrichRegistrations(x.supabase,human);assert.equal(enriched[0].dogs.length,weights.length);
  assert.equal(perrunCsv(enriched).trim().split('\r\n').length,weights.length+1);
});
test('Email failure returns saved + pending; retry reuses BIB/dogs and sends one confirmation',async()=>{
  const x=fixture(),b=body([10,25]);x.setFail(true);const first=await x.run(b);
  assert.equal(first.statusCode,200);assert.equal(first.body.registrationSaved,true);assert.equal(first.body.emailPending,true);
  x.setFail(false);const next=await x.run(b);await x.run(b);
  assert.equal(next.body.tickets[0].bib_number,first.body.tickets[0].bib_number);assert.equal(x.delivered.size,1);
  assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,1);
  assert.equal((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence,302);
});
test('Same manual ID with different payload is a conflict',async()=>{
  const x=fixture(),b=body();await x.run(b);const changed={...b,distance:'5K'};
  assert.equal((await x.run(changed)).statusCode,409);
});
for(const mutate of [b=>b.tickets.push(f.human),b=>b.dogs=[],b=>b.dogs.push(b.dogs[0],b.dogs[0]),b=>b.dogs[0].dog_weight_kg='10',b=>b.dogs[0].engraving_requested='true',b=>b.paidAt='2026-01-01',b=>b.tickets=[{...f.human,bibMode:'released',releasedBib:'001'}]])test('Reject invalid manual contract before RPC '+mutate.toString(),async()=>{
  const x=fixture(),b=body();mutate(b);assert.equal((await x.run(b)).statusCode,400);assert.equal(x.calls.length,0);
});
for(const weights of [[25.001,3],[3,80]])test('Manual API rejects second L/XL '+weights,async()=>{
  const x=fixture();assert.equal((await x.run(body(weights))).statusCode,400);assert.equal(x.calls.length,0);
});
for(const [weight,category] of [[3,'S'],[10,'S'],[10.001,'M'],[25,'M'],[25.001,'L'],[50,'L'],[50.001,'XL'],[80,'XL']])test('Manual derives category '+weight,async()=>{
  const x=fixture(),b=body([weight]);b.dogs[0].category='forged';assert.equal((await x.run(b)).statusCode,200);assert.equal(x.calls[0].args.p_dogs[0].category,category);
});
test('Reject forged principal amount including a $35 engraving surcharge',async()=>{
  for(const amount of [1,event.pricing.getCurrentStage().amount+35,'450']){
    const x=fixture(),b={...body(),totalAmount:amount};assert.equal((await x.run(b)).statusCode,409);assert.equal(x.calls.length,0);
  }
});
for(const [at,base,stage] of [['2026-10-31T23:59:59-06:00',450,'presale'],['2026-11-01T00:00:00-06:00',500,'general'],['2027-01-01T00:00:00-06:00',550,'late']])test('Server tariff '+stage+' ignores claimed base/fee/engraving fields',async()=>{
  let captured;
  const supabase={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:null};}};return q;},async rpc(name,args){captured=args;return {data:[{order_session_id:'manual_perrun_'+args.p_manual_payment_id,amount_paid:args.p_confirmed_amount_cents/100}]};}};
  const b={...body([10,25]),baseAmount:1,secondDogFee:1,engravingFee:35};
  const res=response();await handlePerrunManualTransfer({req:{body:b},res,supabase,auth,now:new Date(at),sendConfirmation:async()=>({ok:true})});
  assert.equal(res.statusCode,200);assert.equal(captured.p_confirmed_amount_cents,(base+180)*100);assert.equal(captured.p_price_stage,stage);
});
test('Actual endpoint rejects unauthenticated/non-admin requests before Perrun processing',async()=>{
  const filename=require.resolve('../api/admin-manual-transfer'),real=createRequire(filename);
  for(const allowed of [false,true]){
    let calls=0;const module={exports:{}};
    const requireMock=name=>name==='@supabase/supabase-js'?{createClient:()=>({})}:name==='./stripe-webhook'?{sendConfirmationEmail:()=>{throw Error('Legacy email forbidden');}}:name.includes('_auth')?{getAdminUser:async()=>allowed?auth:{error:'denied',status:403}}:name.includes('_perrun-manual-transfer')?{handlePerrunManualTransfer:async({res})=>{calls++;return res.status(200).json({ok:true});}}:real(name);
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:requireMock,module,exports:module.exports,process,console},{filename});
    const res=response();await module.exports({method:'POST',body:body()},res);assert.equal(res.statusCode,allowed?200:403);assert.equal(calls,allowed?1:0);
  }
});
test('Manual owner can pay optional $35 later from profile; foreign owner denied; main ledger unchanged',async()=>{
  const beforeKey=process.env.STRIPE_SECRET_KEY,beforeEnv=process.env.VERCEL_ENV,beforeQA=process.env.PERRUN_QA_LOCAL;
  process.env.STRIPE_SECRET_KEY='sk_test_manual_engraving_fixture';delete process.env.VERCEL_ENV;delete process.env.PERRUN_QA_LOCAL;
  try{
    const x=fixture(),b=body();const registration=await x.run(b);assert.equal(registration.statusCode,200);
    const mainBefore=(await db.query('select * from public.inscripciones')).rows;
    let owner='foreign@example.invalid',created=0,session,params;
    x.supabase.auth={getUser:async()=>({data:{user:{email:owner}}})};
    const stripe={checkout:{sessions:{async create(p){params=p;created++;session={id:'cs_test_manual_addon',metadata:p.metadata,livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'mxn',amount_total:3500,payment_intent:'pi_manual_addon',url:'https://checkout.stripe.com/c/pay/manual-addon'};return session;},async retrieve(){return session;}}}};
    const engraving=require('../lib/_perrun-engraving');
    const req={headers:{origin:'http://localhost:3000',authorization:'Bearer profile-token'},body:{flow:'perrun-engraving-v1',orderSessionId:registration.body.orderSessionId,dogIndex:1}};
    let res=response();await engraving.handleCheckout({req,res,supabase:x.supabase,stripe,origin:'http://localhost:3000'});assert.equal(res.statusCode,403);assert.equal(created,0);
    owner=b.buyerEmail;res=response();await engraving.handleCheckout({req,res,supabase:x.supabase,stripe,origin:'http://localhost:3000'});assert.equal(res.statusCode,200);assert.equal(created,1);assert.equal(params.line_items[0].price_data.unit_amount,3500);assert.match(params.success_url,/perfil\.html/);
    session={...session,payment_status:'paid',status:'complete'};
    const provider={emails:{send:async()=>({data:{id:'mock_optional_engraving'}})}};
    const result=await engraving.routeEvent({supabase:x.supabase,stripe,event:{id:'evt_manual_addon',type:'checkout.session.completed',livemode:false,data:{object:session}},mockProvider:provider});
    assert.equal(result.status,200);assert.equal(result.body.paymentStatus,'paid');
    assert.deepEqual((await db.query('select * from public.inscripciones')).rows,mainBefore);
    assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),301);
  }finally{for(const [key,value] of [['STRIPE_SECRET_KEY',beforeKey],['VERCEL_ENV',beforeEnv],['PERRUN_QA_LOCAL',beforeQA]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('Actual Stripe webhook after manual migration still finalizes and confirms once',async()=>{
  const original={key:process.env.STRIPE_SECRET_KEY,env:process.env.VERCEL_ENV,qa:process.env.PERRUN_QA_LOCAL};
  process.env.STRIPE_SECRET_KEY='sk_test_manual_migration_webhook';delete process.env.VERCEL_ENV;delete process.env.PERRUN_QA_LOCAL;
  try{
    const x=fixture(),a=f.args(),id='cs_test_after_manual_migration';
    await db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',[id,...a.slice(1,7)]);
    const session={id,mode:'payment',livemode:false,payment_status:'paid',amount_total:a[7],currency:'mxn',payment_intent:'pi_after_manual_migration',metadata:{event_slug:'perrun-2027',flow_version:'perrun_v1',ticket_count:'1',order_ref:crypto.randomUUID()}};
    const e={id:'evt_after_manual_migration',type:'checkout.session.completed',livemode:false,data:{object:session}};
    const stripe={webhooks:{constructEvent:()=>e},checkout:{sessions:{retrieve:async()=>session}}};
    let sends=0;const filename=require.resolve('../api/stripe-webhook'),real=createRequire(filename),module={exports:{}};
    const mocked=name=>name==='stripe'?()=>stripe:name==='@supabase/supabase-js'?{createClient:()=>x.supabase}:name==='resend'?{Resend:class{constructor(){this.emails={send:async()=>{sends++;return {data:{id:'mock_stripe_after_manual'}};}}}}}:name.includes('_meta-capi')?{trackMetaEvent:()=>{throw Error('Perrun must not call legacy CAPI');}}:real(name);
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:mocked,module,exports:module.exports,process,Buffer,console},{filename});
    for(let i=0;i<2;i++){const req=require('node:stream').Readable.from([Buffer.from(JSON.stringify(e))]);req.method='POST';req.headers={'stripe-signature':'fixture'};const res=response();await module.exports(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.finalized,true);}
    assert.equal(sends,1);assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,1);
    assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),301);
  }finally{for(const [key,value] of [['STRIPE_SECRET_KEY',original.key],['VERCEL_ENV',original.env],['PERRUN_QA_LOCAL',original.qa]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
