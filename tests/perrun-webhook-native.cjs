'use strict';
// Two independent native PostgreSQL connections; no remote URLs, Stripe API or payments.
const assert=require('node:assert/strict');
const {sqlAdapter}=require('./helpers/perrun-payment-sql-adapter.cjs');
const {handlePerrunPayment,handlePerrunRefund}=require('../lib/_perrun-payment');
module.exports=async ctx=>{
  const {admin,a,b,check,blockedBy,evidence,prepare,reset,verifyPositions}=ctx;
  const initial=evidence.checks.length;
  process.env.STRIPE_SECRET_KEY='sk_test_native_fixture';delete process.env.VERCEL_ENV;
  // Mirror the deployed service_role privileges verified by catalog SELECT only.
  await admin.query('grant select on public.inscripciones to service_role; grant update(payment_status,registration_status,cancellation_type,cancelled_at) on public.inscripciones to service_role');
  const session=(id,n)=>({id,mode:'payment',livemode:false,payment_status:'paid',amount_total:n===2?63000:45000,currency:'mxn',payment_intent:'pi_'+id,metadata:{event_slug:'perrun-2027',flow_version:'perrun_v1',ticket_count:'1',order_ref:'11111111-2222-4333-8444-555555555555'}});
  const stripe=s=>({checkout:{sessions:{retrieve:async()=>s}}});
  const event=(s,type='checkout.session.completed')=>({id:'evt_'+s.id+'_'+type.replaceAll('.', '_'),type,livemode:false,data:{object:s}});
  const run=(client,s,type)=>handlePerrunPayment({stripe:stripe(s),supabase:sqlAdapter(client),event:event(s,type)});
  const rows=async id=>(await admin.query('select * from public.registration_dogs where order_session_id=$1 order by dog_index',[id])).rows;
  const human=async id=>(await admin.query('select * from public.inscripciones where order_session_id=$1',[id])).rows;
  async function race(sa,sb,ta='checkout.session.completed',tb='checkout.session.async_payment_succeeded'){
    for(const c of [a,b])await c.query("begin;set local lock_timeout='8s';set local statement_timeout='15s';set local role service_role");
    await a.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");
    const pending=run(b,sb,tb);
    const blocked=await blockedBy(evidence.connections.B,evidence.connections.A);assert.equal(blocked.wait_event,'advisory');
    const first=await run(a,sa,ta);await a.query('commit');const second=await pending;await b.query('commit');
    assert.equal(first.status,200);assert.equal(second.status,200);
    evidence.concurrency.push({scenario:'Phase4 JS '+ta+' / '+tb,result:'PASS',connections:[evidence.connections.A,evidence.connections.B],positions:(await admin.query('select order_session_id,dog_index,engraving_sequence,engraving_free from public.registration_dogs order by engraving_sequence')).rows});
  }
  for(const n of [2,1])await check('Phase4 A: two independent JS handlers; '+n+' dogs wins lock at 298',async()=>{
    await reset(298);await prepare('cs_handler_A',n);await prepare('cs_handler_B',3-n);await race(session('cs_handler_A',n),session('cs_handler_B',3-n));await verifyPositions(298,3);
    assert.equal((await human('cs_handler_A')).length,1);assert.equal((await human('cs_handler_B')).length,1);
  });
  for(const first of ['checkout.session.completed','checkout.session.async_payment_succeeded'])await check('Phase4 B: concurrent duplicate same order; '+first+' first',async()=>{
    await reset(298);await prepare('cs_handler_same',2);const s=session('cs_handler_same',2),other=first==='checkout.session.completed'?'checkout.session.async_payment_succeeded':'checkout.session.completed';await race(s,s,first,other);await verifyPositions(298,2);assert.equal((await human(s.id)).length,1);assert.equal((await rows(s.id)).length,2);
    const before=await rows(s.id);await run(a,s,other);assert.deepEqual(await rows(s.id),before);
  });
  for(const first of ['left','right'])await check('Phase4 C: concurrent different two-dog orders at 297; '+first+' first',async()=>{
    await reset(297);await prepare('cs_handler_left',2);await prepare('cs_handler_right',2);const one=session('cs_handler_'+first,2),two=session('cs_handler_'+(first==='left'?'right':'left'),2);await race(one,two);await verifyPositions(297,4);assert.deepEqual((await rows(one.id)).map(x=>[x.dog_index,Number(x.engraving_sequence)]),[[1,298],[2,299]]);assert.deepEqual((await rows(two.id)).map(x=>[x.dog_index,Number(x.engraving_sequence)]),[[1,300],[2,301]]);
  });
  await check('Phase4 D: failure inside real transaction rolls everything back; handler retries safely',async()=>{
    await reset(298);await prepare('cs_handler_rollback',2);const s=session('cs_handler_rollback',2);
    await admin.query("create function public.phase4_injected_failure() returns trigger language plpgsql as $$ begin raise exception 'injected Phase4 failure'; end $$;create trigger phase4_injected_failure before update on public.perrun_checkout_orders for each row when(new.finalized_at is not null) execute function public.phase4_injected_failure()");
    const r=await run(a,s);assert.equal(r.status,503);assert.equal((await human(s.id)).length,0);assert.equal((await rows(s.id)).length,0);assert.equal(Number((await admin.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),298);assert.equal((await admin.query('select finalized_at from public.perrun_checkout_orders where order_session_id=$1',[s.id])).rows[0].finalized_at,null);
    await admin.query('drop trigger phase4_injected_failure on public.perrun_checkout_orders;drop function public.phase4_injected_failure()');assert.equal((await run(b,s)).status,200);await verifyPositions(298,2);
  });
  for(const first of ['checkout.session.async_payment_failed','checkout.session.async_payment_succeeded'])await check('Phase4 failed vs paid concurrent handlers; '+first+' wins lock',async()=>{
    await reset(298);await prepare('cs_handler_state_race',2);const s=session('cs_handler_state_race',2),other=first.endsWith('failed')?'checkout.session.async_payment_succeeded':'checkout.session.async_payment_failed';await race(s,s,first,other);await verifyPositions(298,2);assert.equal((await admin.query('select payment_status from public.perrun_checkout_orders where order_session_id=$1',[s.id])).rows[0].payment_status,'paid');assert.equal((await human(s.id)).length,1);
  });
  await check('Phase4 refund and paid retry concurrency retains historic ledger and cancels human',async()=>{
    await reset(298);await prepare('cs_handler_refund',2);const s=session('cs_handler_refund',2);await run(a,s);const before=await rows(s.id);
    await Promise.all([run(a,s),handlePerrunRefund({stripe:stripe(s),supabase:sqlAdapter(b),sessionId:s.id,paymentIntentId:s.payment_intent,eventId:'evt_native_refund'})]);
    assert.deepEqual(await rows(s.id),before);assert.equal((await human(s.id))[0].payment_status,'refunded');assert.equal((await human(s.id))[0].registration_status,'cancelled');await verifyPositions(298,2);
    await prepare('cs_handler_after_refund',1);assert.equal((await run(b,session('cs_handler_after_refund',1))).status,200);await verifyPositions(298,3);
  });
  evidence.webhookChecks=evidence.checks.length-initial;console.log('NATIVE_WEBHOOK_PASS='+evidence.webhookChecks);
};
