'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const f=require('./helpers/perrun-payment-v2-fixture.cjs');
let db;
test.before(async()=>{db=new PGlite();await f.install(db);});
test.after(async()=>db?.close());
test.beforeEach(async()=>{await db.exec('truncate public.perrun_registration_edits,public.perrun_promo_slots,public.perrun_checkout_reservation_dogs,public.perrun_checkout_reservations,public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones; update public.perrun_paid_dog_counter set last_sequence=0; insert into public.perrun_promo_slots(slot) select generate_series(1,300);');});
for(const [initial,weights,expected,slots] of [[297,[10],45000,[298]],[298,[8,20],63000,[299,300]],[299,[8,20],66500,[300,null]],[300,[10],48500,[null]],[300,[8,20],70000,[null,null]]])test(`V2 boundary ${initial}: total ${expected}, slots ${slots}`,async()=>{
 await f.seed(db,initial);const r=await f.reserve(db,{data:f.payload(weights)});assert.equal(r.amount_cents,expected);assert.deepEqual(r.dogs.map(d=>d.promo_slot),slots);
 assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,0);
 assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),initial);
 const attached=await f.attach(db,r);const dogs=await f.finalize(db,attached);
 assert.deepEqual(dogs.map(d=>Number(d.engraving_sequence)),weights.map((_,i)=>initial+i+1));
 assert.deepEqual(dogs.map(d=>d.engraving_free),slots.map(s=>s!==null));assert.ok(dogs.every(d=>!d.engraving_payment_required));
 assert.deepEqual(dogs.map(d=>d.engraving_state),slots.map(s=>s!==null?'free':'included_paid'));
 assert.equal((await db.query('select count(*)::int n from public.perrun_engraving_payments')).rows[0].n,0);
 const human=(await db.query('select * from public.inscripciones')).rows[0];assert.equal(Number(human.amount_paid)*100,expected);assert.equal(human.bib_number,'001');
 assert.deepEqual(await f.finalize(db,attached),dogs);
});
test('Unrequested dogs consume benefits; sequence beyond 300 may still be free by slot',async()=>{
 await db.query('update public.perrun_paid_dog_counter set last_sequence=500');
 const r=await f.reserve(db,{data:f.payload([8,20],[false,true])});assert.equal(r.amount_cents,63000);assert.deepEqual(r.dogs.map(d=>d.promo_slot),[1,2]);
 const dogs=await f.finalize(db,await f.attach(db,r));assert.deepEqual(dogs.map(d=>d.engraving_state),['not_requested','free']);assert.deepEqual(dogs.map(d=>Number(d.engraving_sequence)),[501,502]);
 assert.equal((await db.query("select count(*)::int n from public.perrun_promo_slots where status='consumed'")).rows[0].n,2);
});
test('Same attempt is idempotent; a changed payload conflicts; same email new intents remain independent',async()=>{
 const attempt=crypto.randomUUID(),r=await f.reserve(db,{attempt});assert.deepEqual(await f.reserve(db,{attempt}),r);
 const data=f.payload();data.distance='5K';await assert.rejects(f.reserve(db,{attempt,data}),/payload conflict/);
 const second=await f.reserve(db);assert.notEqual(second.id,r.id);assert.equal(second.dogs[0].promo_slot,2);
});
test('Pending OXXO holds slot, late paid consumes same quote; consumed can never release',async()=>{
 await f.seed(db,299);const r=await f.attach(db,await f.reserve(db));
 await db.query("select public.record_perrun_reservation_v2($1,'pending',$2,now()-interval '2 days')",[r.id,r.stripe_session_id]);
 const next=await f.reserve(db);assert.equal(next.amount_cents,48500);
 const dogs=await f.finalize(db,r);assert.equal(dogs[0].promo_slot,300);assert.equal(dogs[0].engraving_state,'free');
 await db.query("select public.record_perrun_reservation_v2($1,'released',$2,null)",[r.id,r.stripe_session_id]);
 assert.equal((await db.query('select status from public.perrun_checkout_reservations where id=$1',[r.id])).rows[0].status,'consumed');
 await assert.rejects(db.query("update public.perrun_promo_slots set status='available',reservation_id=null,dog_index=null where slot=300"),/cannot be recycled/);
});
test('V1 drafts retain capacity and original finalizer; no reprice or duplicate allocation',async()=>{
 await f.seed(db,299);const prior=require('./helpers/perrun-manual-fixture.cjs'),a=prior.args();
 await db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',['cs_test_legacy',...a.slice(1,7)]);
 const r=await f.reserve(db);assert.equal(r.amount_cents,48500);
 const legacy=(await db.query("select * from public.finalize_perrun_paid_order('cs_test_legacy','pi_legacy','evt_legacy',45000,'mxn')")).rows[0];assert.equal(legacy.engraving_free,true);assert.equal(legacy.pricing_model_version,1);
 const v2=await f.attach(db,r);await assert.rejects(db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[v2.stripe_session_id,'pi_wrong','evt_wrong',48500,'mxn']),/requires its reservation/);
});
test('Manual uses real manual identity, exact total and one atomic finalization',async()=>{
 await f.seed(db,300);const r=await f.reserve(db,{source:'manual_transfer',data:f.payload([8,20])});
 await assert.rejects(f.finalize(db,r,{amount:63000}),/amount\/currency/);
 const dogs=await f.finalize(db,r);assert.equal(dogs.length,2);assert.equal(dogs[0].order_session_id,'manual_perrun_'+r.attempt_id);assert.deepEqual(await f.finalize(db,r),dogs);
 const o=(await db.query('select * from public.perrun_checkout_orders')).rows[0];assert.equal(o.payment_source,'manual_transfer');assert.equal(o.payment_intent_id,null);assert.equal(o.amount_cents,70000);
 await assert.rejects(f.finalize(db,r,{reference:'DIFFERENT'}),/retry identity/);
});
test('Money, currency, wrong session, duplicate session, direct ledger manipulation rejected',async()=>{
 const r=await f.attach(db,await f.reserve(db));
 for(const args of [{amount:1},{currency:'usd'}])await assert.rejects(f.finalize(db,r,args),/amount\/currency/);
 const other=await f.reserve(db);await db.query('select public.begin_perrun_checkout_v2($1,$2::jsonb)',[other.id,JSON.stringify(other.payload)]);
 await assert.rejects(db.query('select public.attach_perrun_checkout_v2($1,$2,$3)',[other.id,r.stripe_session_id,r.stripe_expires_at]),/unique|attachment/);
 await assert.rejects(db.query('update public.perrun_checkout_reservations set amount_cents=1 where id=$1',[r.id]),/immutable/);
 const dogs=await f.finalize(db,r);await assert.rejects(db.query('update public.registration_dogs set promo_slot=null where id=$1',[dogs[0].id]),/immutable/);
});
test('Reservations and promo inventory RLS; no browser EXECUTE or mutation; service RPC only',async()=>{
 for(const role of ['anon','authenticated'])for(const [name,keys] of Object.entries(f.args)){
  const sig=(await db.query("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name])).rows[0].signature;
  assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,sig])).rows[0].ok,false);
 }
 for(const table of ['perrun_checkout_reservations','perrun_checkout_reservation_dogs','perrun_promo_slots']){
  assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table])).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated','service_role'])for(const op of ['INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'public.'+table,op])).rows[0].ok,false);
 }
});
test('Failure inside finalization rolls back human, dogs, counter and reserved benefit',async()=>{
 const r=await f.attach(db,await f.reserve(db));
 await db.exec("create function public.fail_v2() returns trigger language plpgsql as $$begin raise exception 'deliberate failure'; end$$; create trigger fail_v2 before update on public.perrun_paid_dog_counter for each row execute function public.fail_v2();");
 try{await assert.rejects(f.finalize(db,r),/deliberate failure/);assert.equal((await db.query('select count(*)::int n from public.inscripciones')).rows[0].n,0);assert.equal((await db.query('select status from public.perrun_checkout_reservations where id=$1',[r.id])).rows[0].status,'open');}finally{await db.exec('drop trigger fail_v2 on public.perrun_paid_dog_counter; drop function public.fail_v2();');}
 await f.finalize(db,r);
});
for(const [date,stage,base] of [['2026-10-31T23:59:59-06:00','presale',45000],['2026-11-01T00:00:00-06:00','general',50000],['2027-01-01T00:00:00-06:00','late',55000]])test('V2 authoritative tariff '+stage,async()=>{
 const price=(await db.query('select * from kinetic_perrun_private.perrun_v2_tariff($1)',[date])).rows[0];assert.equal(price.stage,stage);assert.equal(price.amount_cents,base);
 for(const surcharge of [0,3500,7000])assert.equal(price.amount_cents+18000+surcharge,base+18000+surcharge);
});
test('Sales cutoff rejected at exact close; reserved tariff is immutable',async()=>{
 await assert.rejects(db.query("select * from kinetic_perrun_private.perrun_v2_tariff('2027-01-25T16:00:00-06:00')"),/sales closed/);
 const r=await f.reserve(db);await assert.rejects(db.query("update public.perrun_checkout_reservations set price_stage='general',base_amount_cents=50000,amount_cents=50000 where id=$1",[r.id]),/immutable/);
});
test('Unrequested engraving after all slots consumed costs zero',async()=>{
 await f.seed(db,300);const r=await f.reserve(db,{data:f.payload([8,20],[false,false])});assert.equal(r.amount_cents,63000);const dogs=await f.finalize(db,await f.attach(db,r));assert.deepEqual(dogs.map(d=>d.engraving_state),['not_requested','not_requested']);
});
test('Expired unstarted quote reclaimed by next quote; creating uncertainty remains reserved',async()=>{
 const r=await f.reserve(db),creating=await f.reserve(db);await db.query('select public.begin_perrun_checkout_v2($1,$2::jsonb)',[creating.id,JSON.stringify(creating.payload)]);
 // Simulate elapsed time ONLY in this disposable fixture. Application cannot alter quote timestamps.
 await db.exec('alter table public.perrun_checkout_reservations disable trigger perrun_v2_reservation_guard');
 try { await db.exec("update public.perrun_checkout_reservations set created_at=created_at-interval '10 minutes',preparation_expires_at=preparation_expires_at-interval '10 minutes'"); }
 finally { await db.exec('alter table public.perrun_checkout_reservations enable trigger perrun_v2_reservation_guard'); }
 const next=await f.reserve(db);assert.equal(next.dogs[0].promo_slot,1);assert.equal((await db.query('select status from public.perrun_checkout_reservations where id=$1',[r.id])).rows[0].status,'released');
 assert.equal((await db.query('select status from public.perrun_checkout_reservations where id=$1',[creating.id])).rows[0].status,'creating');await assert.rejects(db.query("select public.record_perrun_reservation_v2($1,'released',null,null)",[creating.id]),/Uncertain creation/);
});
test('Deferred constraints reject broken slot ownership and reservation dog payload',async()=>{
 const r=await f.reserve(db);await assert.rejects(db.query('update public.perrun_checkout_reservation_dogs set promo_slot=2 where reservation_id=$1',[r.id]),/ownership mismatch|payload mismatch/);
 await assert.rejects(db.query("update public.perrun_checkout_reservation_dogs set dog=jsonb_set(dog,'{name}','\"Changed\"') where reservation_id=$1",[r.id]),/payload mismatch/);
});
test('V2 paid Admin Edit keeps financial fields, current ownership and snapshots',async()=>{
 await f.seed(db,300);const r=await f.attach(db,await f.reserve(db)),dogs=await f.finalize(db,r);const human=(await db.query('select * from public.inscripciones')).rows[0];
 await db.query('select public.admin_update_perrun_registration($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)',[r.stripe_session_id,0,JSON.stringify({...f.payload().participant,email:'corrected@example.invalid',whatsapp:'+525587654321'}),JSON.stringify(dogs.map(d=>({id:d.id,name:'Corrected',weightKg:20}))),'Corrección QA','00000000-0000-4000-8000-000000000001','admin@example.invalid']);
 await db.query("update public.registration_dogs set plate_status='preparing' where id=$1",[dogs[0].id]);const d=(await db.query('select * from public.registration_dogs')).rows[0];assert.equal(d.engraving_state,'included_paid');assert.equal(d.promo_slot,null);assert.equal(d.owner_phone_for_plate,'+525587654321');assert.equal(d.dog_name_for_plate,'Corrected');
 assert.equal((await db.query('select bib_number from public.inscripciones')).rows[0].bib_number,human.bib_number);
});
test('Migration does not rewrite five paid V1 orders, humans, historical BIB/sequences or snapshots',async()=>{
 const other=new PGlite();
 try {
  await require('./helpers/perrun-admin-edit-cases.cjs').install(other);
  const prior=require('./helpers/perrun-manual-fixture.cjs');for(let i=0;i<5;i++)await prior.stripe(other);
  await other.query("update public.registration_dogs set plate_status='preparing' where dog_index=1");
  const before={orders:(await other.query('select * from public.perrun_checkout_orders order by order_session_id')).rows,humans:(await other.query('select * from public.inscripciones order by bib_number')).rows,dogs:(await other.query('select * from public.registration_dogs order by engraving_sequence')).rows};
  await other.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'../supabase/migrations',f.migration),'utf8'));
  const after={orders:(await other.query('select * from public.perrun_checkout_orders order by order_session_id')).rows,humans:(await other.query('select * from public.inscripciones order by bib_number')).rows,dogs:(await other.query('select * from public.registration_dogs order by engraving_sequence')).rows};
  for(const table of ['orders','humans','dogs'])for(let i=0;i<5;i++)for(const field of Object.keys(before[table][i]))assert.deepEqual(after[table][i][field],before[table][i][field],table+'.'+field);
  assert.equal((await other.query("select count(*)::int n from public.perrun_promo_slots where status='consumed'")).rows[0].n,5);
 }finally{await other.close();}
});
