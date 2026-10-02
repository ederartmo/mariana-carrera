'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const f = require('./helpers/perrun-manual-fixture.cjs');
let db;
test.before(async () => { db = new PGlite(); await f.install(db); });
test.after(async () => { await db.close(); });
test.beforeEach(async () => {
  await db.exec('truncate public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones; update public.perrun_paid_dog_counter set last_sequence=0');
});
const rows = async table => (await db.query('select * from public.' + table)).rows;
for (const distance of ['1K','3K','5K']) test('Manual SQL persists '+distance+' with real manual identity and audit', async () => {
  const a = f.args({ distance }); const [h] = await f.manual(db,a); const [o] = await rows('perrun_checkout_orders');
  assert.equal(h.distance,distance); assert.equal(h.payment_intent_id,null); assert.equal(h.stripe_event_id,null);
  assert.equal(h.stripe_session_id,'manual_perrun_'+a[0]); assert.equal(h.ticket_count,1); assert.equal(h.bib_number,'001');
  assert.equal(o.payment_source,'manual_transfer'); assert.equal(o.manual_payment_id,a[0]); assert.equal(o.manual_admin_user_id,a[9]);
  assert.equal(o.manual_admin_email,a[10]); assert.equal(o.transfer_reference,a[8]); assert.ok(o.manual_paid_at); assert.ok(o.finalized_at);
  assert.equal(o.payment_status,'paid'); assert.equal(o.payment_intent_id,null); assert.equal((await rows('perrun_engraving_payments')).length,0);
});
test('Manual same identity returns existing ledger; different payload conflicts', async () => {
  const a=f.args({dogs:[f.dog(3),f.dog(25)]}); const first=await f.manual(db,a);
  const retry=[...a]; retry[6]='2028-01-01T00:00:00Z'; retry[5]='late'; retry[7]=73000;
  assert.deepEqual(await f.manual(db,retry),first);
  for (const index of [1,2,3,4,8]) { const changed=[...a]; changed[index]=index===1?'5K':index===2?'other@example.invalid':index===3?JSON.stringify({...f.human,fullName:'Different'}):index===4?JSON.stringify([f.dog(3)]):'other'; await assert.rejects(f.manual(db,changed),/payload conflict/); }
  assert.equal((await rows('registration_dogs')).length,2); assert.equal(Number((await rows('perrun_paid_dog_counter'))[0].last_sequence),2);
});
test('Positions 299/300/301 count all paid dogs and exclude engraving payment', async () => {
  await db.exec('update public.perrun_paid_dog_counter set last_sequence=298');
  await f.manual(db,f.args({dogs:[f.dog(3,false),f.dog(25,true)]})); await f.manual(db);
  const d=(await db.query('select * from public.registration_dogs order by engraving_sequence')).rows;
  assert.deepEqual(d.map(x=>[Number(x.engraving_sequence),x.engraving_free,x.engraving_payment_required,x.engraving_payment_amount_cents]),[[299,true,false,0],[300,true,false,0],[301,false,true,3500]]);
  assert.equal((await rows('perrun_engraving_payments')).length,0);
});
for (const weights of [[25.001,3],[3,80]]) test('SQL blocks L/XL second dog '+weights, async()=> {
  await assert.rejects(f.manual(db,f.args({dogs:weights.map(w=>f.dog(w))})),/Invalid manual Perrun/);
  assert.equal((await rows('inscripciones')).length,0);
});
test('Dog 2 failure rolls back draft, human, BIB, dog 1 and counter', async () => {
  await db.exec("create function public.fail_second_manual_dog() returns trigger language plpgsql as $$ begin if new.dog_index=2 then raise exception 'injected second dog failure'; end if; return new; end $$; create trigger fail_second before insert on public.registration_dogs for each row execute function public.fail_second_manual_dog()");
  try { await assert.rejects(f.manual(db,f.args({dogs:[f.dog(),f.dog()]})),/second dog failure/);
    for(const table of ['inscripciones','registration_dogs','perrun_checkout_orders']) assert.equal((await rows(table)).length,0);
    assert.equal(Number((await rows('perrun_paid_dog_counter'))[0].last_sequence),0);
  } finally { await db.exec('drop trigger fail_second on public.registration_dogs; drop function public.fail_second_manual_dog()'); }
  assert.equal((await f.manual(db))[0].bib_number,'001');
});
test('Historical highest refund BIB is never reused by Stripe or manual', async () => {
  const [first]=await f.manual(db);
  await db.query("update public.inscripciones set payment_status='refunded',registration_status='cancelled' where id=$1",[first.id]);
  const stripeDogs=await f.stripe(db); const [stripeHuman]=(await db.query('select * from public.inscripciones where id=$1',[stripeDogs[0].registration_id])).rows;
  assert.equal(stripeHuman.bib_number,'002');
  await db.query("update public.inscripciones set payment_status='refunded',registration_status='cancelled' where id=$1",[stripeHuman.id]);
  assert.equal((await f.manual(db))[0].bib_number,'003');
  assert.deepEqual((await db.query('select engraving_sequence from public.registration_dogs order by engraving_sequence')).rows.map(d=>Number(d.engraving_sequence)),[1,2,3]);
});
test('Manual rejects Stripe finalizer, source mutation and browser RPC access',async()=>{
  const [h]=await f.manual(db);
  await assert.rejects(db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[h.order_session_id,'pi_real','evt_real',45000,'mxn']),/requires Stripe order/);
  await assert.rejects(db.query("update public.perrun_checkout_orders set manual_admin_email='other' where order_session_id=$1",[h.order_session_id]),/immutable/);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role); try { await assert.rejects(f.manual(db),/permission denied/); } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role'); try { assert.equal((await f.manual(db)).length,1); await assert.rejects(db.exec('delete from public.registration_dogs'),/permission denied/); } finally { await db.exec('reset role'); }
});
test('SQL rejects wrong amount and old timestamp without partial writes',async()=>{
  for (const changed of [{index:7,value:1},{index:6,value:'2026-01-01T00:00:00Z'}]) {
    const a=f.args(); a[changed.index]=changed.value; await assert.rejects(f.manual(db,a),/mismatch|expired/);
  }
  assert.equal((await rows('perrun_checkout_orders')).length,0);
});
test('New migration leaves Axolote/Cascanueces SQL rules unchanged and usable',async()=>{
  const original=require('node:fs').readFileSync(require('node:path').join(__dirname,'../desc/sql-finalize-paid-order-pr4.sql'),'utf8');
  const oldBody=original.split('AS $function$')[1].split('$function$')[0].replaceAll('\r\n','\n');
  const definition=(await db.query("select prosrc from pg_proc where oid='public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)'::regprocedure")).rows[0].prosrc.replaceAll('\r\n','\n');
  const expected=oldBody.replace("where existing.payment_status = 'paid'","where (existing.payment_status = 'paid' or p_event_slug = 'perrun-2027')");
  assert.equal(definition,expected);
  for(const [event,distance] of [['axolote-night-run','5K'],['cascanueces-run','10K']]){
    const id='cs_after_manual_'+event;
    const r=await db.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,event,distance,500,'owner@example.invalid','pi_'+id,'evt_'+id,JSON.stringify([f.human])]);
    assert.equal(r.rows[0].distance,distance);assert.equal(r.rows[0].bib_number,'001');
  }
});
test('Final order update failure rolls back already allocated dogs and counter',async()=>{
  await db.exec("create function public.fail_manual_finish() returns trigger language plpgsql as $$ begin if new.payment_source='manual_transfer' and new.finalized_at is not null then raise exception 'injected finish failure'; end if; return new; end $$; create trigger fail_manual_finish before update on public.perrun_checkout_orders for each row execute function public.fail_manual_finish()");
  try{
    await assert.rejects(f.manual(db,f.args({dogs:[f.dog(),f.dog()]})),/finish failure/);
    for(const table of ['inscripciones','registration_dogs','perrun_checkout_orders'])assert.equal((await rows(table)).length,0);
    assert.equal(Number((await rows('perrun_paid_dog_counter'))[0].last_sequence),0);
  }finally{await db.exec('drop trigger fail_manual_finish on public.perrun_checkout_orders; drop function public.fail_manual_finish()');}
});
