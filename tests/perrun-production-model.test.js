'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const f=require('./helpers/perrun-production-fixture.cjs'),{productionCsv}=require('../lib/_perrun-production');
let db;test.before(async()=>{db=new PGlite();await f.install(db);});test.after(()=>db?.close());test.beforeEach(()=>f.reset(db));
test('Additive install never creates a real batch or item',async()=>{const s=await f.read(db);assert.equal(s.batches.length,0);assert.equal(s.summary.closed_batches,0);});
test('Create draft and review selection: no number, no frozen snapshot, no historical writes',async()=>{const x=await f.paid(db),y=await f.paid(db),before=await f.history(db);let b=await f.save(db,[x.human.id,y.human.id]);assert.equal(b.batch.status,'draft');assert.ok(b.items.every(i=>i.production_number===null&&i.snapshot===null));assert.equal(b.items.length,2);b=await f.save(db,[y.human.id],{id:b.batch.id,revision:0});assert.equal(b.batch.revision,1);assert.equal(b.items.length,1);assert.deepEqual(await f.history(db),before);});
test('Prepared/pending/failed/refunded/cancelled/non-finalized and other events excluded',async()=>{
 await f.prepared(db);const active=await f.paid(db);
 for(const status of ['pending','payment_failed','failed','refunded']){const x=await f.paid(db);await db.query('update public.inscripciones set payment_status=$1 where id=$2',[status,x.human.id]);}
 const cancelled=await f.paid(db);await db.query("update public.inscripciones set registration_status='cancelled' where id=$1",[cancelled.human.id]);
 const other=await f.paid(db);await db.query("update public.inscripciones set event_slug='axolote-night-run',distance='5K' where id=$1",[other.human.id]);
 const s=await f.read(db);assert.deepEqual(s.candidates.map(x=>x.registration_id),[active.human.id]);assert.equal(s.summary.pending,1);
});
test('Unpaid order cannot qualify through a forged paid human',async()=>{const x=await f.paid(db);await db.query('begin');try{await db.query('alter table public.perrun_checkout_orders disable trigger perrun_payment_state_guard');await db.query('alter table public.perrun_checkout_orders drop constraint perrun_manual_identity');await db.query("update public.perrun_checkout_orders set finalized_at=null,payment_status='pending',payment_state_event_id='evt_synthetic_pending' where order_session_id=$1",[x.orderId]);assert.equal((await f.read(db)).candidates.length,0);}finally{await db.query('rollback');}});
test('Close assigns deterministic numeric BIB order, retains gaps, and preserves all payments/ledgers',async()=>{
 const xs=[];for(let i=0;i<5;i++)xs.push(await f.paid(db));const before=await f.history(db);
 const b=await f.save(db,[xs[4].human.id,xs[0].human.id,xs[2].human.id]);const closed=await f.close(db,b.batch.id);
 assert.deepEqual(closed.items.map(i=>[i.bib_number,i.production_number]),[['001',1],['003',2],['005',3]]);
 assert.deepEqual(await f.history(db),before);assert.equal(closed.summary.produced,3);assert.equal(closed.summary.pending,2);
});
test('Second batch continues from persisted max; repeated close cannot advance or renumber',async()=>{
 const a=await f.paid(db),b=await f.paid(db);const first=await f.save(db,[a.human.id]);const closed=await f.close(db,first.batch.id);assert.deepEqual(await f.close(db,first.batch.id,999),closed);
 const second=await f.save(db,[b.human.id]);assert.equal((await f.close(db,second.batch.id)).items[0].production_number,2);
});
test('Closed membership excluded; overlapping drafts fail at close, without consuming number',async()=>{const x=await f.paid(db),a=await f.save(db,[x.human.id]),b=await f.save(db,[x.human.id]);await f.close(db,a.batch.id);await assert.rejects(f.close(db,b.batch.id),/PRODUCTION_CANDIDATE_CHANGED/);const s=await f.read(db,b.batch.id);assert.equal(s.batch.status,'draft');assert.equal(s.items[0].production_number,null);await assert.rejects(f.save(db,[x.human.id]),/PRODUCTION_CANDIDATE_CHANGED/);});
test('Create retries same UUID are idempotent; changed selection and stale revision rejected',async()=>{const x=await f.paid(db),b=await f.save(db,[x.human.id]);assert.deepEqual(await f.save(db,[x.human.id],{id:b.batch.id}),b);await assert.rejects(f.save(db,[],{id:b.batch.id}),/PRODUCTION_REVISION_CONFLICT/);await f.save(db,[x.human.id],{id:b.batch.id,revision:0});await assert.rejects(f.close(db,b.batch.id,0),/PRODUCTION_REVISION_CONFLICT/);});
test('Empty draft cannot close; duplicate candidate and arbitrary UUID denied',async()=>{const b=await f.save(db,[]);await assert.rejects(f.close(db,b.batch.id),/PRODUCTION_EMPTY_BATCH/);const x=await f.paid(db);await assert.rejects(f.save(db,[x.human.id,x.human.id]),/Duplicate/);await assert.rejects(f.save(db,[crypto.randomUUID()]),/PRODUCTION_CANDIDATE_CHANGED/);});
test('Closed snapshots and batch immutable, including numbers/deletes/new membership',async()=>{
 const x=await f.paid(db),b=await f.save(db,[x.human.id]),s=await f.close(db,b.batch.id),id=s.items[0].id;
 for(const sql of ['update public.perrun_production_items set production_number=20 where id=$1',"update public.perrun_production_items set snapshot='{}' where id=$1",'delete from public.perrun_production_items where id=$1'])await assert.rejects(db.query(sql,[id]),/immutable/);
 await assert.rejects(db.query("update public.perrun_production_batches set status='draft' where id=$1",[b.batch.id]),/immutable/);
 await assert.rejects(db.query('delete from public.perrun_production_batches where id=$1',[b.batch.id]),/cannot be deleted/);
 assert.deepEqual((await f.read(db,b.batch.id)).items,s.items);
});
test('Snapshot and repeat CSV stay byte-identical after Admin Edit; live contact can still change',async()=>{
 const x=await f.paid(db,{weights:[8,20]}),b=await f.save(db,[x.human.id]),s=await f.close(db,b.batch.id),csv=productionCsv(s.items);
 await f.edit.edit(db,x,{participant:{fullName:'New Name',email:'new@example.invalid',whatsapp:'+525587654321'}});
 const after=await f.read(db,b.batch.id);assert.deepEqual(after.items,s.items);assert.equal(productionCsv(after.items),csv);assert.equal(after.items[0].snapshot.dogs.length,2);
 assert.equal((await db.query('select full_name from public.inscripciones where id=$1',[x.human.id])).rows[0].full_name,'New Name');
});
test('Close snapshots current corrected data and already-started plate content',async()=>{const x=await f.paid(db),b=await f.save(db,[x.human.id]);await f.edit.edit(db,x,{participant:{fullName:'Current Name'}});await db.query("update public.registration_dogs set plate_status='preparing' where id=$1",[x.dogs[0].id]);const s=await f.close(db,b.batch.id);assert.equal(s.items[0].snapshot.participant.name,'Current Name');assert.equal(s.items[0].snapshot.dogs[0].dog_name_for_plate,x.dogs[0].dog_name);assert.equal(s.items[0].snapshot.dogs[0].plate_status,'preparing');});
test('Cancellation after draft creation prevents close without silently removing participant',async()=>{const x=await f.paid(db),b=await f.save(db,[x.human.id]);await db.query("update public.inscripciones set registration_status='cancelled' where id=$1",[x.human.id]);await assert.rejects(f.close(db,b.batch.id),/PRODUCTION_CANDIDATE_CHANGED/);const s=await f.read(db,b.batch.id);assert.equal(s.items[0].eligible,false);assert.equal(s.batch.status,'draft');});
test('Browser roles cannot SELECT/write/execute; service reads and uses only wrappers',async()=>{
 for(const role of ['anon','authenticated'])for(const sig of ['public.admin_read_perrun_production(uuid)','public.admin_save_perrun_production_batch(uuid,bigint,uuid[],uuid,text)','public.admin_close_perrun_production_batch(uuid,bigint,uuid,text)'])assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,sig])).rows[0].ok,false);
 for(const table of ['perrun_production_batches','perrun_production_items'])for(const role of ['anon','authenticated','service_role'])for(const op of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'public.'+table,op])).rows[0].ok,role==='service_role'&&op==='SELECT');
 for(const role of ['anon','authenticated']){await db.query('set role '+role);try{await assert.rejects(f.read(db),/permission denied/);}finally{await db.query('reset role');}}
});
test('V2 single-payment registration can enter production without changing pricing or promo slots',async()=>{const r=await f.v2.reserve(db),attached=await f.v2.attach(db,r);await f.v2.finalize(db,attached);const s=await f.read(db);assert.equal(s.candidates.length,1);const before=await f.history(db),b=await f.save(db,[s.candidates[0].registration_id]);await f.close(db,b.batch.id);assert.deepEqual(await f.history(db),before);});
test('CSV escapes quoting, newlines, formula cells and refuses draft snapshots',()=>{
 const s={schema_version:1,production_number:2,bib_number:'003',participant:{name:'=DANGER',shirt_size:'M',distance:'3K',phone:'+525512345678'},dog_count:1,dogs:[{name:'"Dog\nName"',weight_kg:8,category:'S',engraving_sequence:4,plate_status:'not_started'}]};
 const csv=productionCsv([{production_number:2,snapshot:s}]);assert.ok(csv.includes("'="));assert.ok(csv.includes('""Dog'));assert.equal(csv,productionCsv([{production_number:2,snapshot:s}]));assert.throws(()=>productionCsv([{production_number:null,snapshot:null}]),/Closed snapshot/);
});
