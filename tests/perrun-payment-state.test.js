'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {installFixture}=require('./helpers/perrun-schema-fixture.cjs');
const root=path.resolve(__dirname,'..');
const phase1=fs.readFileSync(path.join(root,'supabase/migrations/20261001055227_perrun_phase1_model.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001113351_perrun_payment_state.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'desc/perrun-phase4a-payment-state-rollback.sql'),'utf8');
const contractSql=fs.readFileSync(path.join(__dirname,'helpers/perrun-phase4a-contract.sql'),'utf8');
const deployed=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/perrun-phase4a-deployed-contract.json'),'utf8')).contract;
const human={fullName:'Payment State Owner',shirtSize:'M',birthDate:'1990-01-01',whatsapp:'+525500000000',state:'Ciudad de México',borough:'Gustavo A. Madero'};
const dog={name:'Luna',weightKg:10,engravingRequested:true};
let db,previousContract;
async function prepare(client,id){return client.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)',[id,'3K','owner@example.invalid',JSON.stringify(human),JSON.stringify([dog]),'presale','2026-10-01T12:00:00-06:00']);}
async function state(client,id,event,status){return (await client.query('select (public.record_perrun_payment_state($1,$2,$3)).*',[id,event,status])).rows[0];}
async function finalize(client,id){return client.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[id,'pi_'+id,'evt_paid_'+id,45000,'mxn']);}
async function row(client,id){return (await client.query('select * from public.perrun_checkout_orders where order_session_id=$1',[id])).rows[0];}
function normalized(c){return {...c,constraints:c.constraints.filter(x=>!x.definition.startsWith('NOT NULL ')),functions:c.functions.map(f=>({...f,source:f.source.replace(/\r\n/g,'\n')}))};}
async function install(client){await client.exec("set timezone='UTC'");await installFixture(client);await client.exec(phase1);}
async function legacyFingerprint(client){return (await client.query("select jsonb_agg(pg_get_functiondef(oid) order by proname) as functions from pg_proc where oid in ('public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)'::regprocedure, 'public.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz)'::regprocedure, 'public.finalize_perrun_paid_order(text,text,text,integer,text)'::regprocedure, 'kinetic_perrun_private.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz)'::regprocedure,'kinetic_perrun_private.finalize_perrun_paid_order(text,text,text,integer,text)'::regprocedure)")).rows[0].functions;}
test.before(async()=>{
  db=new PGlite();await install(db);previousContract=(await db.query(contractSql)).rows[0].contract;
  // Verify source of truth BEFORE applying any proposed SQL even to this isolated DB.
  assert.deepEqual(normalized(previousContract),normalized(deployed));
  await prepare(db,'cs_preexisting_prepared');await prepare(db,'cs_preexisting_paid');await finalize(db,'cs_preexisting_paid');await db.exec(migration);
});
test.after(async()=>{if(db)await db.close();});
test('4A deployed schema matches Phase 1 columns/checks/FKs/indexes/RLS/grants/RPC definitions',()=>assert.deepEqual(normalized(previousContract),normalized(deployed)));
test('4A existing prepared draft keeps safe prepared default',async()=>{const r=await row(db,'cs_preexisting_prepared');assert.equal(r.payment_status,'prepared');assert.equal(r.payment_failed_at,null);assert.equal(r.payment_state_event_id,null);});
test('4A backfill marks existing finalized order paid without modifying payment identity',async()=>{const r=await row(db,'cs_preexisting_paid');assert.equal(r.payment_status,'paid');assert.ok(r.finalized_at);assert.equal(r.payment_intent_id,'pi_cs_preexisting_paid');});
test('4A new draft is prepared; prepare retry does not reset accepted pending state',async()=>{
  await prepare(db,'cs_new');assert.equal((await row(db,'cs_new')).payment_status,'prepared');await state(db,'cs_new','evt_pending_new','pending');await prepare(db,'cs_new');assert.equal((await row(db,'cs_new')).payment_status,'pending');
});
test('4A pending checkout records only event id; never a failed PaymentIntent',async()=>{
  await prepare(db,'cs_pending');const r=await state(db,'cs_pending','evt_pending','pending');assert.equal(r.payment_status,'pending');assert.equal(r.payment_state_event_id,'evt_pending');assert.equal(r.payment_intent_id,null);assert.equal(r.finalized_at,null);assert.equal(r.payment_failed_at,null);
});
test('4A failure marks pending order failed with receipt time and no payment identity reuse',async()=>{
  const r=await state(db,'cs_pending','evt_failed','failed');assert.equal(r.payment_status,'failed');assert.ok(r.payment_failed_at);assert.equal(r.payment_state_event_id,'evt_failed');assert.equal(r.payment_intent_id,null);assert.equal(r.finalized_at,null);
});
test('4A direct prepared to failed is valid',async()=>{await prepare(db,'cs_direct_failure');assert.equal((await state(db,'cs_direct_failure','evt_direct_failure','failed')).payment_status,'failed');});
test('4A repeated failed event and other failed event cause zero additional row versions',async()=>{
  const before=(await db.query("select *,xmin::text as version from public.perrun_checkout_orders where order_session_id='cs_direct_failure'")).rows[0];
  await state(db,'cs_direct_failure','evt_direct_failure','failed');await state(db,'cs_direct_failure','evt_other_failure','failed');await state(db,'cs_direct_failure','evt_direct_failure','failed');
  assert.deepEqual((await db.query("select *,xmin::text as version from public.perrun_checkout_orders where order_session_id='cs_direct_failure'")).rows[0],before);
});
test('4A repeated pending event is idempotent and cannot overwrite failed via late pending',async()=>{
  await prepare(db,'cs_pending_repeat');const first=await state(db,'cs_pending_repeat','evt_first_pending','pending');assert.deepEqual(await state(db,'cs_pending_repeat','evt_second_pending','pending'),first);
  const failed=await state(db,'cs_pending_repeat','evt_failed_repeat','failed');assert.deepEqual(await state(db,'cs_pending_repeat','evt_late_pending','pending'),failed);
});
test('4A same event reused for conflicting transition does not mutate accepted state',async()=>{
  await prepare(db,'cs_event_repeat');const first=await state(db,'cs_event_repeat','evt_one','pending');assert.deepEqual(await state(db,'cs_event_repeat','evt_one','failed'),first);
});
test('4A failure creates no inscription, dog, BIB or engraving payment and consumes no positions',async()=>{
  await prepare(db,'cs_zero_effect');const counter=(await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence;
  await state(db,'cs_zero_effect','evt_zero_effect','failed');
  for(const table of ['inscripciones','registration_dogs'])assert.equal((await db.query('select count(*)::int n from public.'+table+' where order_session_id=$1',['cs_zero_effect'])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.perrun_engraving_payments')).rows[0].n,0);
  assert.equal((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence,counter);
});
for(const initial of ['prepared','pending','failed'])test('4A existing finalizer accepts '+initial+' and derives paid automatically',async()=>{
  const id='cs_finalize_'+initial;await prepare(db,id);if(initial!=='prepared')await state(db,id,'evt_'+initial,initial);
  const previous=await row(db,id);await finalize(db,id);const paid=await row(db,id);assert.equal(paid.payment_status,'paid');assert.ok(paid.finalized_at);assert.equal(paid.payment_intent_id,'pi_'+id);
  assert.equal(paid.owner_phone,human.whatsapp);assert.equal(paid.payment_state_event_id,previous.payment_state_event_id);assert.deepEqual(paid.payment_failed_at,previous.payment_failed_at);
});
test('4A paid cannot regress from late pending/failed; event/time/row version unchanged',async()=>{
  const before=(await db.query("select *,xmin::text as version from public.perrun_checkout_orders where order_session_id='cs_finalize_failed'")).rows[0];
  await state(db,'cs_finalize_failed','evt_late_failed','failed');await state(db,'cs_finalize_failed','evt_late_pending_after_paid','pending');
  assert.deepEqual((await db.query("select *,xmin::text as version from public.perrun_checkout_orders where order_session_id='cs_finalize_failed'")).rows[0],before);
});
test('4A finalized identity and timestamp cannot be reversed',async()=>{
  await assert.rejects(db.exec("update public.perrun_checkout_orders set finalized_at=null,payment_intent_id=null,payment_status='prepared' where order_session_id='cs_finalize_failed'"),/cannot be reversed/);
});
test('4A direct invalid state and fabricated paid are rejected by checks',async()=>{
  await prepare(db,'cs_bad_state');for(const value of ['refunded','paid'])await assert.rejects(db.query('update public.perrun_checkout_orders set payment_status=$1 where order_session_id=$2',[value,'cs_bad_state']),/check constraint/);
});
test('4A unknown order and invalid IDs/status rejected without writes',async()=>{
  await assert.rejects(state(db,'cs_missing','evt_missing','failed'),/no rows/);
  for(const args of [['cs_bad_state','not_an_event','failed'],['cs_bad_state','evt_valid','paid'],['cs_bad_state','evt_valid','prepared'],['','evt_valid','failed'],['cs_bad_state',null,'failed']])await assert.rejects(state(db,...args),/Invalid Perrun/);
});
test('4A RLS retained; browser roles have no table writes or RPC EXECUTE',async()=>{
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.perrun_checkout_orders'::regclass")).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated']){
    for(const priv of ['INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'public.perrun_checkout_orders',priv])).rows[0].ok,false);
    for(const schema of ['public','kinetic_perrun_private'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',[role,schema+'.record_perrun_payment_state(text,text,text)','EXECUTE'])).rows[0].ok,false);
    await db.exec('set role '+role);await assert.rejects(state(db,'cs_bad_state','evt_denied','failed'),/permission denied/);await db.exec('reset role');
  }
});
test('4A service role may use RPC but cannot directly UPDATE/INSERT/DELETE',async()=>{
  await prepare(db,'cs_service');await db.exec('set role service_role');
  try{
    assert.equal((await state(db,'cs_service','evt_service','pending')).payment_status,'pending');
    for(const sql of ["update public.perrun_checkout_orders set payment_status='failed'",'delete from public.perrun_checkout_orders',"insert into public.perrun_checkout_orders(order_session_id) values('cs_direct')"])await assert.rejects(db.exec(sql),/permission denied/);
  }finally{await db.exec('reset role');}
});
test('4A new function security matches Phase 1 definer-private/invoker-public pattern',async()=>{
  const rows=(await db.query("select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where proname='record_perrun_payment_state' order by n.nspname")).rows;
  assert.deepEqual(rows.map(r=>[r.nspname,r.prosecdef]),[['kinetic_perrun_private',true],['public',false]]);for(const r of rows)assert.deepEqual(r.proconfig,['search_path=""']);
});
test('4A old RPC sources/security/ACL and legacy finalizer are unchanged',async()=>{
  const current=(await db.query(contractSql)).rows[0].contract;assert.deepEqual(normalized(current).functions,normalized(previousContract).functions);
  const oldFile=fs.readFileSync(path.join(root,'desc/sql-finalize-paid-order-pr4.sql'),'utf8');assert.ok(oldFile.includes('finalize_paid_order'));
});
test('4A pre-launch rollback preserves paid Phase 1 records and restores exact prior contract',async()=>{
  const isolated=new PGlite();try{
    await install(isolated);await prepare(isolated,'cs_rollback_prepared');await prepare(isolated,'cs_rollback_paid');await finalize(isolated,'cs_rollback_paid');
    const before=(await isolated.query(contractSql)).rows[0].contract,functions=await legacyFingerprint(isolated),orders=(await isolated.query('select * from public.perrun_checkout_orders order by order_session_id')).rows;
    const dogs=(await isolated.query('select * from public.registration_dogs')).rows,humans=(await isolated.query('select * from public.inscripciones')).rows;
    await isolated.exec(migration);await isolated.exec(rollback);
    assert.deepEqual((await isolated.query(contractSql)).rows[0].contract,before);assert.deepEqual(await legacyFingerprint(isolated),functions);
    assert.deepEqual((await isolated.query('select * from public.perrun_checkout_orders order by order_session_id')).rows,orders);assert.deepEqual((await isolated.query('select * from public.registration_dogs')).rows,dogs);assert.deepEqual((await isolated.query('select * from public.inscripciones')).rows,humans);
    await finalize(isolated,'cs_rollback_prepared');await prepare(isolated,'cs_after_rollback');await finalize(isolated,'cs_after_rollback');
  }finally{await isolated.close();}
});
test('4A rollback refuses to erase pending/failed or recovered-paid state history',async()=>{
  const before=await row(db,'cs_finalize_failed');await assert.rejects(db.exec(rollback),/Rollback refused/);await db.exec('rollback');assert.deepEqual(await row(db,'cs_finalize_failed'),before);
});
