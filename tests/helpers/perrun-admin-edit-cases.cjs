'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const f=require('./perrun-manual-fixture.cjs');
const migration='20261002203402_perrun_admin_registration_edits.sql';
const sql='select public.admin_update_perrun_registration($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7) as result';
const actor='00000000-0000-4000-8000-000000000001';
async function install(db){await f.install(db);await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration),'utf8'));}
async function fixture(db,{manual=false,weights=[10]}={}){
 const created=manual?await f.manual(db,f.args({dogs:weights.map(w=>f.dog(w))})):await f.stripe(db,{dogs:weights.map(w=>f.dog(w))});
 const orderId=created[0].order_session_id;
 const dogs=(await db.query('select * from public.registration_dogs where order_session_id=$1 order by dog_index',[orderId])).rows;
 return {orderId,dogs,participant:{...f.human,email:'owner@example.invalid'},values:[orderId,0,JSON.stringify({...f.human,email:'owner@example.invalid'}),JSON.stringify(dogs.map(d=>({id:d.id,name:d.dog_name,weightKg:Number(d.weight_kg)}))),'Corrección solicitada',actor,'admin@example.invalid']};
}
const edit=(db,x,{participant={},dogs,revision=0,reason='Corrección solicitada'}={})=>db.query(sql,[x.orderId,revision,JSON.stringify({...x.participant,...participant}),JSON.stringify(dogs||x.dogs.map(d=>({id:d.id,name:d.dog_name,weightKg:Number(d.weight_kg)}))),reason,actor,'admin@example.invalid']);
async function state(db,x){return (await db.query("select jsonb_build_object('order',(select to_jsonb(o) from public.perrun_checkout_orders o where order_session_id=$1),'human',(select to_jsonb(h) from public.inscripciones h where order_session_id=$1),'dogs',(select jsonb_agg(to_jsonb(d) order by dog_index) from public.registration_dogs d where order_session_id=$1),'counter',(select last_sequence from public.perrun_paid_dog_counter),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by revision),'[]'::jsonb) from public.perrun_registration_edits a where order_session_id=$1)) as data",[x.orderId])).rows[0].data;}
const cases=[];const add=(name,run)=>cases.push({name:'Admin edit: '+name,run});
add('real privileges deny browser RPC and all audit access, service cannot rewrite history',async db=>{
 const sig='public.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text)';
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') as ok",[role,sig])).rows[0].ok,false);
  for(const op of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) as ok',[role,'public.perrun_registration_edits',op])).rows[0].ok,false);
 }
 for(const op of ['INSERT','UPDATE','DELETE'])assert.equal((await db.query("select has_table_privilege('service_role','public.perrun_registration_edits',$1) as ok",[op])).rows[0].ok,false);
 assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') as ok",[sig])).rows[0].ok,true);
 assert.equal((await db.query("select prosecdef from pg_proc where oid=$1::regprocedure",[sig])).rows[0].prosecdef,false);
 assert.equal((await db.query("select prosecdef from pg_proc where oid='kinetic_perrun_private.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text)'::regprocedure")).rows[0].prosecdef,true);
});
add('browser roles cannot actually invoke the transactional RPC',async db=>{const x=await fixture(db);for(const role of ['anon','authenticated']){await db.query('set role '+role);try{await assert.rejects(db.query(sql,x.values),/permission denied/);}finally{await db.query('reset role');}}assert.equal((await state(db,x)).audit.length,0);});
for(const manual of [false,true])add((manual?'manual':'Stripe')+' corrections preserve original order, BIB, payment, dog ledger and counter',async db=>{
 const x=await fixture(db,{manual}),before=await state(db,x);
 await edit(db,x,{participant:{fullName:'Nombre Corregido',email:'corrected@example.invalid',shirtSize:'XL',birthDate:'1995-02-28',whatsapp:'+525587654321',state:'Ciudad de México',borough:'Coyoacán'},dogs:x.dogs.map(d=>({id:d.id,name:'Nombre Nuevo',weightKg:20}))});
 const after=await state(db,x);
 for(const k of Object.keys(before.order).filter(k=>!['admin_revision','ownership_revision'].includes(k)))assert.deepEqual(after.order[k],before.order[k],k);
 for(const k of Object.keys(before.human).filter(k=>!['full_name','email','buyer_email','shirt_size','birth_date','whatsapp','state','borough'].includes(k)))assert.deepEqual(after.human[k],before.human[k],k);
 for(const k of Object.keys(before.dogs[0]).filter(k=>!['registration_email','dog_name','weight_kg','category'].includes(k)))assert.deepEqual(after.dogs[0][k],before.dogs[0][k],k);
 assert.equal(after.human.full_name,'Nombre Corregido');assert.equal(after.human.email,'corrected@example.invalid');assert.equal(after.human.buyer_email,after.human.email);
 assert.equal(after.human.shirt_size,'XL');assert.equal(after.human.birth_date,'1995-02-28');assert.equal(after.human.whatsapp,'+525587654321');assert.equal(after.human.state,'Ciudad de México');assert.equal(after.human.borough,'Coyoacán');
 assert.equal(after.dogs[0].registration_email,after.human.email);assert.equal(after.dogs[0].dog_name,'Nombre Nuevo');assert.equal(after.dogs[0].category,'M');assert.equal(after.counter,before.counter);
 assert.equal(after.audit.length,1);assert.equal(after.audit[0].admin_user_id,actor);assert.equal(after.audit[0].old_values.participant.email,'owner@example.invalid');assert.equal(after.audit[0].new_values.participant.email,after.human.email);assert.equal(after.audit[0].reason,'Corrección solicitada');
 assert.equal(after.order.admin_revision,1);assert.equal(after.order.ownership_revision,1);
 if(manual){const args=f.args({id:before.order.manual_payment_id});args[8]=before.order.transfer_reference;args[6]=before.order.quoted_at;args[5]=before.order.price_stage;args[7]=before.order.amount_cents;await f.manual(db,args);}else await db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[x.orderId,before.order.payment_intent_id,'evt_retry_edit',before.order.amount_cents,'mxn']);
 assert.deepEqual(await state(db,x),after);
});
for(const w of [3,10,10.1,25,25.1,50,50.1,80])add('weight '+w+' derives category',async db=>{const x=await fixture(db);await edit(db,x,{dogs:x.dogs.map(d=>({id:d.id,name:d.dog_name,weightKg:w}))});assert.equal((await state(db,x)).dogs[0].category,w<=10?'S':w<=25?'M':w<=50?'L':'XL');});
for(const weightKg of [2.99,80.01])add('reject out-of-range single dog '+weightKg,async db=>{const x=await fixture(db),before=await state(db,x);await assert.rejects(edit(db,x,{dogs:x.dogs.map(d=>({id:d.id,name:d.dog_name,weightKg}))}),/Invalid dog/);assert.deepEqual(await state(db,x),before);});
add('two dogs remain S/M; invalid 26kg rolls back entire human correction and audit',async db=>{
 const x=await fixture(db,{weights:[8,20]});await edit(db,x,{dogs:x.dogs.map((d,i)=>({id:d.id,name:d.dog_name,weightKg:i?25:3}))});
 const before=await state(db,x);await assert.rejects(edit(db,x,{revision:1,participant:{fullName:'Must Rollback'},dogs:x.dogs.map((d,i)=>({id:d.id,name:d.dog_name,weightKg:i?26:8}))}),/Invalid dog/);assert.deepEqual(await state(db,x),before);
});
for(const plate of ['preparing','engraved','skipped'])add('dog name locks for '+plate+' and snapshots stay frozen while contact/weight change',async db=>{
 const x=await fixture(db);if(plate==='skipped')await db.query("update public.registration_dogs set plate_status='skipped' where id=$1",[x.dogs[0].id]);
 else{await db.query("update public.registration_dogs set plate_status='preparing' where id=$1",[x.dogs[0].id]);if(plate==='engraved')await db.query("update public.registration_dogs set plate_status='engraved' where id=$1",[x.dogs[0].id]);}
 const before=await state(db,x);await assert.rejects(edit(db,x,{dogs:x.dogs.map(d=>({id:d.id,name:'Forbidden',weightKg:10}))}),/Plate dog name is locked/);
 assert.deepEqual(await state(db,x),before);
 await edit(db,x,{participant:{whatsapp:'+525587654321'},dogs:x.dogs.map(d=>({id:d.id,name:d.dog_name,weightKg:20}))});const after=await state(db,x);
 for(const k of ['dog_name_for_plate','owner_phone_for_plate','plate_started_at'])assert.deepEqual(after.dogs[0][k],before.dogs[0][k]);assert.equal(after.human.whatsapp,'+525587654321');
});
add('future plate captures corrected contact and dog name without replacing original checkout',async db=>{const x=await fixture(db);await edit(db,x,{participant:{whatsapp:'+525587654321'},dogs:x.dogs.map(d=>({id:d.id,name:'Corrected Plate',weightKg:10}))});await db.query("update public.registration_dogs set plate_status='preparing' where id=$1",[x.dogs[0].id]);const after=await state(db,x);assert.equal(after.dogs[0].owner_phone_for_plate,'+525587654321');assert.equal(after.dogs[0].dog_name_for_plate,'Corrected Plate');assert.equal(after.order.owner_phone,f.human.whatsapp);});
for(const k of ['distance','bib_number','amount_paid','payment_status','payment_source'])add('reject participant injection '+k,async db=>{const x=await fixture(db),before=await state(db,x);await assert.rejects(edit(db,x,{participant:{[k]:'forbidden'}}),/not editable/);assert.deepEqual(await state(db,x),before);});
for(const k of ['engraving_sequence','engraving_free','plate_status','dog_name_for_plate','owner_phone_for_plate','plate_started_at','category','engraving_requested','engraving_payment_required'])add('reject dog injection '+k,async db=>{const x=await fixture(db),before=await state(db,x);await assert.rejects(edit(db,x,{dogs:x.dogs.map(d=>({id:d.id,name:d.dog_name,weightKg:10,[k]:'forbidden'}))}),/not editable/);assert.deepEqual(await state(db,x),before);});
for(const kind of ['missing','duplicate','foreign'])add('dog identity/count '+kind+' rolls back',async db=>{const x=await fixture(db),before=await state(db,x);const d={id:x.dogs[0].id,name:'Dog',weightKg:10};const dogs=kind==='missing'?[]:kind==='duplicate'?[d,d]:[{...d,id:'00000000-0000-4000-8000-000000000099'}];await assert.rejects(edit(db,x,{dogs}));assert.deepEqual(await state(db,x),before);});
add('revision conflict rejects stale request without second audit entry',async db=>{const x=await fixture(db);await edit(db,x);const before=await state(db,x);await assert.rejects(edit(db,x),/PERRUN_REVISION_CONFLICT/);assert.deepEqual(await state(db,x),before);});
for(const participant of [{birthDate:'2025-02-30'},{birthDate:'2999-01-01'},{shirtSize:'XX'},{state:'Unknown'},{state:'Ciudad de México',borough:null},{email:'bad'},{whatsapp:'555'},{fullName:null}])add('invalid participant '+JSON.stringify(participant)+' rolls back',async db=>{const x=await fixture(db),before=await state(db,x);await assert.rejects(edit(db,x,{participant}));assert.deepEqual(await state(db,x),before);});
add('mandatory reason rejects empty correction',async db=>{const x=await fixture(db);await assert.rejects(edit(db,x,{reason:''}),/reason required/);assert.equal((await state(db,x)).audit.length,0);});
add('paid engraving after current email correction uses current composite FK without touching BIB/counter',async db=>{
 await db.query('update public.perrun_paid_dog_counter set last_sequence=greatest(last_sequence,30000)');const x=await fixture(db);await edit(db,x,{participant:{email:'corrected@example.invalid'}});const before=await state(db,x),paymentId=require('node:crypto').randomUUID();
 await db.query('select public.reserve_perrun_engraving_payment($1,$2,$3)',[x.dogs[0].id,x.orderId,paymentId]);
 const sessionId='cs_test_admin_engraving_'+paymentId.replaceAll('-','');
 await db.query('select public.record_perrun_engraving_state($1,$2,$3,$4,$5)',[paymentId,sessionId,'pending',null,null]);
 await db.query('select public.finalize_perrun_engraving_payment($1,$2,$3,$4,$5,$6)',[paymentId,sessionId,'pi_'+paymentId.replaceAll('-',''),'evt_'+paymentId.replaceAll('-',''),3500,'mxn']);
 const after=await state(db,x);assert.deepEqual(after,before);assert.equal((await db.query('select status from public.perrun_engraving_payments where id=$1',[paymentId])).rows[0].status,'paid');
});
add('deliberate audit failure rolls back identity, cascading dogs and revision',async db=>{const x=await fixture(db),before=await state(db,x);await db.query("create function public.fail_admin_audit() returns trigger language plpgsql as $$ begin raise exception 'deliberate audit failure'; end $$");await db.query("create trigger fail_admin_audit before insert on public.perrun_registration_edits for each row execute function public.fail_admin_audit()");try{await assert.rejects(edit(db,x,{participant:{email:'rollback@example.invalid'}}),/deliberate audit failure/);assert.deepEqual(await state(db,x),before);}finally{await db.query('drop trigger fail_admin_audit on public.perrun_registration_edits');await db.query('drop function public.fail_admin_audit()');}});
module.exports={install,migration,cases,fixture,edit,state,sql,actor};
