'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const f=require('./helpers/perrun-admin-edit-cases.cjs');
module.exports=async({admin,a,b,check,blockedBy,evidence})=>{
 await admin.query(fs.readFileSync(path.join(__dirname,'../supabase/migrations',f.migration),'utf8'));
 for(const c of f.cases)await check('Native '+c.name,()=>c.run(admin));
 async function race(label,first,second,verify){
  const x=await f.fixture(admin);await a.query('begin');await b.query('begin');
  try{await first(a,x);const pending=second(b,x).then(value=>({value}),error=>({error}));
   await blockedBy(evidence.connections.B,evidence.connections.A);await a.query('commit');const result=await pending;
   if(result.error)await b.query('rollback');else await b.query('commit');await verify(result,x);
   evidence.concurrency.push({scenario:label,result:'PASS',connections:evidence.connections});
  }finally{await a.query('rollback');await b.query('rollback');}
 }
 await check('Admin native: concurrent stale admins serialize and one receives revision conflict',()=>race('Admin versus admin',(c,x)=>f.edit(c,x,{participant:{fullName:'Winner'}}),(c,x)=>f.edit(c,x,{participant:{fullName:'Loser'}}),async(r,x)=>{assert.match(r.error.message,/PERRUN_REVISION_CONFLICT/);const s=await f.state(admin,x);assert.equal(s.human.full_name,'Winner');assert.equal(s.audit.length,1);}));
 await check('Admin native: Stripe duplicate after edit preserves current corrected identity',()=>race('Admin versus Stripe retry',(c,x)=>f.edit(c,x,{participant:{email:'concurrent@example.invalid'}}),async(c,x)=>{const o=(await c.query('select * from public.perrun_checkout_orders where order_session_id=$1',[x.orderId])).rows[0];return c.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[x.orderId,o.payment_intent_id,'evt_concurrent_retry',o.amount_cents,'mxn']);},async(r,x)=>{if(r.error)throw r.error;const s=await f.state(admin,x);assert.equal(s.human.email,'concurrent@example.invalid');assert.equal(s.audit.length,1);}));
 async function makePlateEligible(x){
  if(x.dogs[0].engraving_free)return;
  const id=require('node:crypto').randomUUID(),suffix=id.replaceAll('-',''),session='cs_test_plate_'+suffix;
  await admin.query('select public.reserve_perrun_engraving_payment($1,$2,$3)',[x.dogs[0].id,x.orderId,id]);
  await admin.query('select public.record_perrun_engraving_state($1,$2,$3,$4,$5)',[id,session,'pending',null,null]);
  await admin.query('select public.finalize_perrun_engraving_payment($1,$2,$3,$4,$5,$6)',[id,session,'pi_'+suffix,'evt_'+suffix,3500,'mxn']);
 }
 await check('Admin native: plate first blocks name correction atomically',async()=>{
  const x=await f.fixture(admin);await makePlateEligible(x);await a.query('begin');await b.query('begin');
  try{await a.query("update public.registration_dogs set plate_status='preparing' where id=$1",[x.dogs[0].id]);
   const pending=f.edit(b,x,{dogs:x.dogs.map(d=>({id:d.id,name:'Too Late',weightKg:10}))}).then(value=>({value}),error=>({error}));
   await blockedBy(evidence.connections.B,evidence.connections.A);await a.query('commit');const r=await pending;assert.match(r.error.message,/Plate dog name is locked/);await b.query('rollback');
   const s=await f.state(admin,x);assert.equal(s.audit.length,0);assert.equal(s.dogs[0].dog_name,'Dog');assert.equal(s.dogs[0].dog_name_for_plate,'Dog');
   evidence.concurrency.push({scenario:'Plate versus admin',result:'PASS'});
  }finally{await a.query('rollback');await b.query('rollback');}
 });
 await check('Admin native: admin first makes plate lock inversion fail fast without deadlock',async()=>{
  const x=await f.fixture(admin);await makePlateEligible(x);await a.query('begin');await b.query('begin');
  try{
   // Pause the admin hierarchy after order/human but before dogs: this is the potential inversion window.
   await a.query('select order_session_id from public.perrun_checkout_orders where order_session_id=$1 for update',[x.orderId]);
   await a.query('select id from public.inscripciones where order_session_id=$1 for update',[x.orderId]);
   await assert.rejects(b.query("update public.registration_dogs set plate_status='preparing' where id=$1",[x.dogs[0].id]),e=>e.code==='55P03');await b.query('rollback');await f.edit(a,x,{participant:{whatsapp:'+525587654321'}});await a.query('commit');
   await b.query("update public.registration_dogs set plate_status='preparing' where id=$1",[x.dogs[0].id]);
   assert.equal((await f.state(admin,x)).dogs[0].owner_phone_for_plate,'+525587654321');
   evidence.concurrency.push({scenario:'Admin versus plate NOWAIT/retry',result:'PASS'});
  }finally{await a.query('rollback');await b.query('rollback');}
 });

 await check('Admin native: engraving reservation waiting on email edit rereads cascading owner',async()=>{
  await admin.query('update public.perrun_paid_dog_counter set last_sequence=greatest(last_sequence,30000)');
  const x=await f.fixture(admin);await a.query('begin');await b.query('begin');
  try{await f.edit(a,x,{participant:{email:'corrected@example.invalid'}});
   const pending=b.query('select * from public.reserve_perrun_engraving_payment($1,$2,$3)',[x.dogs[0].id,x.orderId,require('node:crypto').randomUUID()]).then(value=>({value}),error=>({error}));
   await blockedBy(evidence.connections.B,evidence.connections.A);await a.query('commit');const r=await pending;if(r.error)throw r.error;await b.query('commit');
   assert.equal(r.value.rows.length,1);assert.equal(r.value.rows[0].status,'reserved');const s=await f.state(admin,x);assert.equal(s.dogs[0].registration_email,'corrected@example.invalid');assert.equal(s.human.email,'corrected@example.invalid');assert.equal(s.audit.length,1);
   evidence.concurrency.push({scenario:'Admin email versus engraving reservation',result:'PASS'});
  }finally{await a.query('rollback');await b.query('rollback');}
 });

};
