'use strict';
// Optional extension of the native Phase 1 runner. Localhost/synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function run(ctx){
  const {admin,a,b,check,blockedBy,evidence,prepare,finalize,reset,simultaneous,verifyPositions}=ctx;
  const root=path.resolve(__dirname,'..');
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001113351_perrun_payment_state.sql'),'utf8');
  const rollback=fs.readFileSync(path.join(root,'desc/perrun-phase4a-payment-state-rollback.sql'),'utf8');
  const sql=fs.readFileSync(path.join(__dirname,'helpers/perrun-phase4a-contract.sql'),'utf8');
  const oldContract=(await admin.query(sql)).rows[0].contract;
  const oldRows=(await admin.query('select * from public.perrun_checkout_orders order by order_session_id')).rows;
  const initialChecks=evidence.checks.length;
  const record=(client,id,event,status)=>client.query('select (public.record_perrun_payment_state($1,$2,$3)).*',[id,event,status]);
  const row=async id=>(await admin.query('select *,xmin::text as version from public.perrun_checkout_orders where order_session_id=$1',[id])).rows[0];
  const counter=async()=>Number((await admin.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence);
  const zero=async()=>{
    assert.equal(await counter(),0);
    for(const table of ['inscripciones','registration_dogs','perrun_engraving_payments'])assert.equal((await admin.query('select count(*)::int n from public.'+table)).rows[0].n,0);
  };
  async function race(first,second,firstAction,secondAction){
    for(const client of [first,second])await client.query("begin;set local lock_timeout='8s';set local statement_timeout='15s'");
    await first.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");
    const pending=secondAction(second).then(value=>({value}),error=>({error}));
    const firstPid=first===a?evidence.connections.A:evidence.connections.B,secondPid=second===a?evidence.connections.A:evidence.connections.B;
    await blockedBy(secondPid,firstPid);
    try{
      const result=await firstAction(first);await first.query('commit');const waited=await pending;if(waited.error)throw waited.error;await second.query('commit');return [result,waited.value];
    }catch(error){await first.query('rollback');await second.query('rollback');throw error;}
  }
  await check('4A migration lock is confined to drafts; timeout leaves exact Phase 1 schema',async()=>{
    await a.query('begin');await a.query('select * from public.perrun_checkout_orders');
    const pending=b.query(migration).then(value=>({value}),error=>({error}));
    const block=await blockedBy(evidence.connections.B,evidence.connections.A);assert.equal(block.wait_event,'relation');
    const locks=(await admin.query("select relation::regclass::text as relation,mode,granted from pg_locks where pid=$1 and locktype='relation'",[evidence.connections.B])).rows;
    assert.ok(locks.some(lock=>lock.relation==='perrun_checkout_orders'&&lock.mode==='AccessExclusiveLock'&&!lock.granted));
    assert.equal(locks.some(lock=>lock.relation==='inscripciones'&&lock.mode==='AccessExclusiveLock'),false);
    const result=await pending;assert.equal(result.error?.code,'55P03');await b.query('rollback');await a.query('rollback');
    assert.deepEqual((await admin.query(sql)).rows[0].contract,oldContract);
  });
  await check('4A native migration backfills paid; PRE-LAUNCH rollback preserves Phase 1 rows and exact contract',async()=>{
    const started=Date.now();await admin.query(migration);evidence.paymentStateMigrationMs=Date.now()-started;
    assert.deepEqual((await admin.query(sql)).rows[0].contract.functions,oldContract.functions);
    assert.equal((await admin.query("select count(*)::int n from public.perrun_checkout_orders where finalized_at is not null and payment_status <> 'paid'")).rows[0].n,0);
    await admin.query(rollback);
    assert.deepEqual((await admin.query(sql)).rows[0].contract,oldContract);assert.deepEqual((await admin.query('select * from public.perrun_checkout_orders order by order_session_id')).rows,oldRows);
    await admin.query(migration);
  });
  for(const same of [true,false])await check('4A concurrent failed events '+(same?'same event':'different events')+' write one state transition',async()=>{
    await reset(0);await prepare('cs_failed_concurrent',1);
    const [one,two]=await race(a,b,c=>record(c,'cs_failed_concurrent','evt_failure_A','failed'),c=>record(c,'cs_failed_concurrent',same?'evt_failure_A':'evt_failure_B','failed'));
    assert.deepEqual(one.rows,two.rows);assert.equal(one.rows[0].payment_state_event_id,'evt_failure_A');assert.equal(one.rows[0].payment_status,'failed');
    const before=await row('cs_failed_concurrent');await record(a,'cs_failed_concurrent','evt_failure_A','failed');await record(b,'cs_failed_concurrent','evt_failure_B','failed');assert.deepEqual(await row('cs_failed_concurrent'),before);await zero();
  });
  for(const firstStatus of ['pending','failed'])await check('4A concurrent pending/failed: '+firstStatus+' wins lock; no downgrade or allocations',async()=>{
    await reset(0);await prepare('cs_pending_failed',1);const secondStatus=firstStatus==='pending'?'failed':'pending';
    await race(a,b,c=>record(c,'cs_pending_failed','evt_'+firstStatus,firstStatus),c=>record(c,'cs_pending_failed','evt_'+secondStatus,secondStatus));
    const result=await row('cs_pending_failed');assert.equal(result.payment_status,'failed');assert.equal(result.payment_state_event_id,'evt_failed');assert.ok(result.payment_failed_at);assert.equal(result.payment_intent_id,null);await zero();
  });
  for(const firstStatus of ['failed','paid'])await check('4A failed vs finalize: '+firstStatus+' wins lock; paid is final and only one allocation',async()=>{
    await reset(298);await prepare('cs_failure_success',1);
    const failed=c=>record(c,'cs_failure_success','evt_failure_race','failed'),paid=c=>finalize(c,'cs_failure_success',1);
    await race(a,b,firstStatus==='failed'?failed:paid,firstStatus==='failed'?paid:failed);
    const result=await row('cs_failure_success');assert.equal(result.payment_status,'paid');assert.ok(result.finalized_at);assert.equal(result.payment_intent_id,'pi_cs_failure_success');
    assert.equal(result.payment_failed_at===null,firstStatus==='paid');await verifyPositions(298,1);
    const before=await row('cs_failure_success');await record(b,'cs_failure_success','evt_tardy_failure','failed');assert.deepEqual(await row('cs_failure_success'),before);
  });
  await check('4A failed order finalized concurrently twice keeps one human/BIB and two dogs',async()=>{
    await reset(298);await prepare('cs_failed_then_paid',2);await record(a,'cs_failed_then_paid','evt_failed_before_paid','failed');
    const [one,two]=await race(a,b,c=>finalize(c,'cs_failed_then_paid',2),c=>finalize(c,'cs_failed_then_paid',2));assert.deepEqual(one.rows,two.rows);await verifyPositions(298,2);
    const humans=(await admin.query('select * from public.inscripciones')).rows;assert.equal(humans.length,1);assert.ok(humans[0].bib_number);assert.equal(humans[0].ticket_count,1);assert.equal((await row('cs_failed_then_paid')).payment_status,'paid');
  });
  for(const [initial,firstCount,secondCount] of [[298,2,1],[297,2,2]]){
    for(const first of [a,b])await check('4A existing multi-order concurrency '+initial+' '+firstCount+'/'+secondCount+' '+(first===a?'A':'B')+' first',async()=>{
      await reset(initial);await prepare('cs_boundary_A',firstCount);await prepare('cs_boundary_B',secondCount);
      await simultaneous('cs_boundary_A',firstCount,'cs_boundary_B',secondCount,initial,first,first===a?b:a);await verifyPositions(initial,firstCount+secondCount);
      assert.ok((await admin.query('select payment_status from public.perrun_checkout_orders')).rows.every(r=>r.payment_status==='paid'));
    });
  }
  await check('4A failed finalization transaction restores failed state, human/dogs/counter; valid retry succeeds',async()=>{
    await reset(298);await prepare('cs_state_rollback',2);await record(a,'cs_state_rollback','evt_failed_before_rollback','failed');const before=await row('cs_state_rollback');
    await admin.query("create function public.phase4a_injected_failure() returns trigger language plpgsql as $$ begin raise exception 'injected 4A rollback'; end $$;create trigger phase4a_injected_failure before update on public.perrun_checkout_orders for each row when(new.finalized_at is not null) execute function public.phase4a_injected_failure();");
    await assert.rejects(finalize(a,'cs_state_rollback',2),/injected 4A rollback/);assert.deepEqual(await row('cs_state_rollback'),before);assert.equal(await counter(),298);assert.equal((await admin.query('select count(*)::int n from public.inscripciones')).rows[0].n,0);assert.equal((await admin.query('select count(*)::int n from public.registration_dogs')).rows[0].n,0);
    await admin.query('drop trigger phase4a_injected_failure on public.perrun_checkout_orders;drop function public.phase4a_injected_failure()');await finalize(b,'cs_state_rollback',2);assert.equal((await row('cs_state_rollback')).payment_status,'paid');await verifyPositions(298,2);
  });
  await check('4A native permissions deny browser calls/direct service update; service RPC succeeds',async()=>{
    await reset(0);await prepare('cs_native_acl',1);
    for(const role of ['anon','authenticated','service_role']){
      await a.query('set role '+role);
      try{
        await assert.rejects(a.query("update public.perrun_checkout_orders set payment_status='failed'"),/permission denied/);
        if(role==='service_role')assert.equal((await record(a,'cs_native_acl','evt_native_acl','pending')).rows[0].payment_status,'pending');else await assert.rejects(record(a,'cs_native_acl','evt_native_acl','pending'),/permission denied/);
      }finally{await a.query('reset role');}
    }
    await zero();
  });
  await check('4A old finalizer functions unchanged; Axolote/Cascanueces remain functional with added state model',async()=>{
    assert.deepEqual((await admin.query(sql)).rows[0].contract.functions,oldContract.functions);
    const human={fullName:'Native Legacy Regression',shirtSize:'M',birthDate:'1990-01-01',whatsapp:'+525500000000',state:'Ciudad de México',borough:'Gustavo A. Madero'};
    for(const [event,distance] of [['axolote-night-run','5K'],['cascanueces-run','5K'],['cascanueces-run','10K']]){
      const id='cs_4a_legacy_'+event+'_'+distance;const result=await admin.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,event,distance,450,'test@example.invalid','pi_'+id,'evt_'+id,JSON.stringify([human])]);assert.equal(result.rows.length,1);
    }
  });
  await check('4A post-use rollback refuses without touching finalized history',async()=>{
    await finalize(a,'cs_native_acl',1);const before=await row('cs_native_acl'),functions=(await admin.query(sql)).rows[0].contract.functions;
    await assert.rejects(admin.query(rollback),/Rollback refused/);await admin.query('rollback');assert.deepEqual(await row('cs_native_acl'),before);assert.deepEqual((await admin.query(sql)).rows[0].contract.functions,functions);
  });
  evidence.paymentStateChecks=evidence.checks.length-initialChecks;
  evidence.phase1Checks=initialChecks;
  console.log('NATIVE_PHASE1_REGRESSION_PASS='+initialChecks);console.log('NATIVE_PAYMENT_STATE_PASS='+evidence.paymentStateChecks);
};
