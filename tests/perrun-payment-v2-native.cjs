'use strict';
// Only the isolated PostgreSQL cluster supplied by perrun-concurrency.pg.cjs.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const f=require('./helpers/perrun-payment-v2-fixture.cjs');
module.exports=async({admin,a,b,check,blockedBy,evidence})=>{
 const initialChecks=evidence.checks.length;
 await admin.query(fs.readFileSync(path.join(__dirname,'../supabase/migrations',f.migration),'utf8'));
 const reset=async n=>{await admin.query('truncate public.perrun_registration_edits,public.perrun_promo_slots,public.perrun_checkout_reservation_dogs,public.perrun_checkout_reservations,public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones');await admin.query('update public.perrun_paid_dog_counter set last_sequence=0');await admin.query('insert into public.perrun_promo_slots(slot) select generate_series(1,300)');await f.seed(admin,n);};
 async function race(left,right,{rollback=false}={}){
  await a.query('begin');await b.query('begin');
  try {
   await a.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");
   const waiting=right(b).then(value=>({value}),error=>({error}));
   await blockedBy(evidence.connections.B,evidence.connections.A);
   const result=await left(a);await a.query(rollback?'rollback':'commit');
   const other=await waiting;if(other.error)throw other.error;await b.query('commit');return [result,other.value];
  }finally{await a.query('rollback');await b.query('rollback');}
 }
 for(const [initial,weights,total,slots] of [[298,[8,20],63000,[299,300]],[299,[8,20],66500,[300,null]],[300,[10],48500,[null]],[300,[8,20],70000,[null,null]]])await check('V2 native boundary '+initial+' -> '+total,async()=>{
  await reset(initial);const r=await f.reserve(admin,{data:f.payload(weights)});assert.equal(r.amount_cents,total);assert.deepEqual(r.dogs.map(d=>d.promo_slot),slots);
  const attached=await f.attach(admin,r),dogs=await f.finalize(admin,attached);assert.deepEqual(dogs.map(d=>Number(d.engraving_sequence)),weights.map((_,i)=>initial+i+1));assert.deepEqual(await f.finalize(admin,attached),dogs);
 });
 await check('V2 native two buyers actually contend for slot 300',async()=>{
  await reset(299);const attemptA=crypto.randomUUID(),attemptB=crypto.randomUUID();
  const [one,two]=await race(c=>f.reserve(c,{attempt:attemptA}),c=>f.reserve(c,{attempt:attemptB}));assert.equal(one.dogs[0].promo_slot,300);assert.equal(two.dogs[0].promo_slot,null);assert.equal(two.amount_cents-one.amount_cents,3500);
  const [dogsA,dogsB]=await Promise.all([f.finalize(a,await f.attach(admin,one)),f.finalize(b,await f.attach(admin,two))]);assert.equal(new Set([...dogsA,...dogsB].map(d=>Number(d.engraving_sequence))).size,2);
  evidence.concurrency.push({scenario:'V2 two buyers slot 300',result:'PASS',slots:[300,null]});
 });
 await check('V2 native two tabs same attempt yield one reservation and one benefit',async()=>{
  await reset(299);const attempt=crypto.randomUUID();const [one,two]=await race(c=>f.reserve(c,{attempt}),c=>f.reserve(c,{attempt}));assert.deepEqual(one,two);assert.equal((await admin.query('select * from public.perrun_checkout_reservations')).rowCount,1);
  evidence.concurrency.push({scenario:'V2 identical attempt tabs',result:'PASS'});
 });
 await check('V2 native simultaneous duplicate webhooks finalize once',async()=>{
  await reset(299);const r=await f.attach(admin,await f.reserve(admin,{data:f.payload([8,20])}));
  const [one,two]=await race(c=>f.finalize(c,r),c=>f.finalize(c,r));assert.deepEqual(one,two);assert.equal((await admin.query('select * from public.inscripciones')).rowCount,1);assert.equal(Number((await admin.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),301);
  evidence.concurrency.push({scenario:'V2 duplicate paid webhooks',result:'PASS'});
 });
 await check('V2 native rollback competing reservation loses no capacity',async()=>{
  await reset(299);const [one,two]=await race(c=>f.reserve(c),c=>f.reserve(c),{rollback:true});assert.notEqual(one.id,two.id);assert.equal(two.dogs[0].promo_slot,300);assert.equal((await admin.query('select * from public.perrun_checkout_reservations')).rowCount,1);
  evidence.concurrency.push({scenario:'V2 reservation rollback versus buyer',result:'PASS'});
 });
 await check('V2 native OXXO pending versus another buyer keeps original benefit, late settles',async()=>{
  await reset(299);const r=await f.attach(admin,await f.reserve(admin));await admin.query("select public.record_perrun_reservation_v2($1,'pending',$2,now()-interval '1 day')",[r.id,r.stripe_session_id]);
  const [one,two]=await race(c=>f.finalize(c,r),c=>f.reserve(c));assert.equal(one[0].promo_slot,300);assert.equal(two.dogs[0].promo_slot,null);
  evidence.concurrency.push({scenario:'V2 OXXO late paid versus quote',result:'PASS'});
 });
 await check('V2 native manual duplicate concurrency produces one real manual registration',async()=>{
  await reset(300);const r=await f.reserve(admin,{source:'manual_transfer',data:f.payload([8,20])});const [one,two]=await race(c=>f.finalize(c,r),c=>f.finalize(c,r));assert.deepEqual(one,two);assert.equal(one[0].order_session_id,'manual_perrun_'+r.attempt_id);assert.equal((await admin.query('select * from public.inscripciones')).rowCount,1);
  evidence.concurrency.push({scenario:'V2 duplicate manual capture',result:'PASS'});
 });
 await check('V2 native actual anon/authenticated calls denied, service_role succeeds',async()=>{
  await reset(0);for(const role of ['anon','authenticated']){await admin.query('set role '+role);try{await assert.rejects(f.reserve(admin),/permission denied/);}finally{await admin.query('reset role');}}
  await admin.query('set role service_role');try{assert.equal((await f.reserve(admin)).amount_cents,45000);}finally{await admin.query('reset role');}
 });
 await check('V2 native Admin Edit preserves benefit/price, included-paid plate snapshot accepted',async()=>{
  await reset(300);const r=await f.attach(admin,await f.reserve(admin)),dogs=await f.finalize(admin,r);
  const human=(await admin.query('select * from public.inscripciones')).rows[0];
  await admin.query('select public.admin_update_perrun_registration($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)',[r.stripe_session_id,0,JSON.stringify({...f.payload().participant,email:human.email}),JSON.stringify(dogs.map(d=>({id:d.id,name:'Corrected Dog',weightKg:20}))),'Corrección QA','00000000-0000-4000-8000-000000000001','admin@example.invalid']);
  await admin.query("update public.registration_dogs set plate_status='preparing' where id=$1",[dogs[0].id]);const changed=(await admin.query('select * from public.registration_dogs')).rows[0];assert.equal(changed.engraving_state,'included_paid');assert.equal(changed.dog_name_for_plate,'Corrected Dog');assert.equal(Number(changed.engraving_sequence),301);
  await assert.rejects(admin.query('select public.reserve_perrun_engraving_payment($1,$2,$3)',[dogs[0].id,r.stripe_session_id,crypto.randomUUID()]),/eligible|pending|engraving|free/i);
 });
 await check('V2 native two simultaneous two-dog buyers get atomic benefits and four unique positions',async()=>{
  await reset(297);const [one,two]=await race(c=>f.reserve(c,{data:f.payload([8,20])}),c=>f.reserve(c,{data:f.payload([8,20])}));assert.deepEqual(one.dogs.map(d=>d.promo_slot),[298,299]);assert.deepEqual(two.dogs.map(d=>d.promo_slot),[300,null]);
  const first=await f.attach(admin,one),second=await f.attach(admin,two);await race(c=>f.finalize(c,first),c=>f.finalize(c,second));
  assert.deepEqual((await admin.query('select engraving_sequence from public.registration_dogs order by engraving_sequence')).rows.map(d=>Number(d.engraving_sequence)),[298,299,300,301]);assert.equal((await admin.query('select * from public.inscripciones')).rowCount,2);
  evidence.concurrency.push({scenario:'V2 two orders two dogs each: reserve and fulfill',result:'PASS'});
 });
 await check('V2 native out-of-order paid uses reserved slot, not sequence <=300',async()=>{
  await reset(299);const free=await f.attach(admin,await f.reserve(admin)),paid=await f.attach(admin,await f.reserve(admin));const out=await f.finalize(admin,paid),inside=await f.finalize(admin,free);
  assert.equal(Number(out[0].engraving_sequence),300);assert.equal(out[0].engraving_state,'included_paid');assert.equal(Number(inside[0].engraving_sequence),301);assert.equal(inside[0].engraving_state,'free');
 });
 await check('V2 native finalization failure rolls back under contention and retry preserves quote',async()=>{
  await reset(299);const r=await f.attach(admin,await f.reserve(admin));
  await admin.query("create function public.v2_injected_failure() returns trigger language plpgsql as $$ begin raise exception 'V2 injected rollback'; end $$; create trigger v2_injected_failure before update on public.perrun_paid_dog_counter for each row execute function public.v2_injected_failure();");
  await a.query('begin');await b.query('begin');
  try {
   await a.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");const pending=f.reserve(b).then(value=>({value}),error=>({error}));await blockedBy(evidence.connections.B,evidence.connections.A);
   await assert.rejects(f.finalize(a,r),/V2 injected rollback/);await a.query('rollback');const next=await pending;if(next.error)throw next.error;await b.query('commit');assert.equal(next.value.dogs[0].promo_slot,null);
   assert.equal((await admin.query('select * from public.inscripciones')).rowCount,0);assert.equal(Number((await admin.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),299);
  }finally{await a.query('rollback');await b.query('rollback');await admin.query('drop trigger v2_injected_failure on public.perrun_paid_dog_counter; drop function public.v2_injected_failure()');}
  assert.equal((await f.finalize(admin,r))[0].promo_slot,300);evidence.concurrency.push({scenario:'V2 fulfillment rollback while buyer waits',result:'PASS'});
 });
 evidence.paymentV2Checks=evidence.checks.length-initialChecks;
 evidence.paymentV2MigrationSHA256=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../supabase/migrations',f.migration))).digest('hex');
};
