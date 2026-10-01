'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {installFixture}=require('./helpers/perrun-schema-fixture.cjs');
let db;
const phone='+525500000000';
const human={fullName:'Perrun Owner',shirtSize:'M',birthDate:'1990-01-01',whatsapp:phone,state:'Ciudad de México',borough:'Gustavo A. Madero'};
const dog={name:'Luna',weightKg:10,engravingRequested:true};
async function prepare(id,participant=human,dogs=[dog]){return db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)',[id,'3K','owner@example.invalid',JSON.stringify(participant),JSON.stringify(dogs),'presale','2026-10-31T23:59:59-06:00']);}
async function finalize(id){return (await db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[id,'pi_'+id,'evt_'+id,45000,'mxn'])).rows;}
async function legacyPending(id){await db.query(`insert into public.inscripciones(stripe_session_id,email,full_name,event_slug,amount_paid,payment_status,shirt_size,buyer_email,order_session_id,ticket_index,ticket_count,distance)
  values($1,'owner@example.invalid','Perrun Legacy','perrun-2027',450,'pending','M','owner@example.invalid',$1,1,1,'3K')`,[id]);}
test.before(async()=>{db=new PGlite();await installFixture(db);await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001055227_perrun_phase1_model.sql'),'utf8'));});
test.after(async()=>{if(db)await db.close();});
test('Perrun captures owner phone before payment without duplicating it in participant JSON',async()=>{
  await prepare('cs_phone_draft');const [order]=(await db.query("select * from public.perrun_checkout_orders where order_session_id='cs_phone_draft'")).rows;
  assert.equal(order.owner_phone,phone);assert.equal(Object.hasOwn(order.participant,'whatsapp'),false);
  assert.equal(order.finalized_at,null);assert.equal((await db.query('select * from public.registration_dogs')).rows.length,0);
});
test('Perrun rejects missing/invalid owner phone before creating a draft',async()=>{
  for(const value of [null,'','5500000000','+52550000000','not-a-phone'])await assert.rejects(prepare('cs_bad_phone',{...human,whatsapp:value}),/owner phone/);
  assert.equal((await db.query("select * from public.perrun_checkout_orders where order_session_id='cs_bad_phone'")).rows.length,0);
});
test('Perrun repeated draft cannot silently replace its captured phone',async()=>{
  await prepare('cs_phone_draft');await assert.rejects(prepare('cs_phone_draft',{...human,whatsapp:'+525511111111'}),/payload conflict/);
});
test('Perrun order phone survives the exact deployed legacy NULL hotfix',async()=>{
  await prepare('cs_phone_legacy');await legacyPending('cs_phone_legacy');await finalize('cs_phone_legacy');
  const [parent]=(await db.query("select birth_date,whatsapp,state,borough from public.inscripciones where order_session_id='cs_phone_legacy'")).rows;
  assert.deepEqual(parent,{birth_date:null,whatsapp:null,state:null,borough:null});
  assert.equal((await db.query("select owner_phone from public.perrun_checkout_orders where order_session_id='cs_phone_legacy'")).rows[0].owner_phone,phone);
  const [record]=(await db.query("select * from public.registration_dogs where order_session_id='cs_phone_legacy'")).rows;
  assert.equal(record.dog_name_for_plate,null);assert.equal(record.owner_phone_for_plate,null);assert.equal(record.plate_started_at,null);
});
test('Perrun preparation freezes current dog name and order phone, independent of late parent whatsapp',async()=>{
  await db.exec("update public.inscripciones set whatsapp='+525522222222' where order_session_id='cs_phone_legacy'; update public.registration_dogs set dog_name='Luna Updated' where order_session_id='cs_phone_legacy'; update public.registration_dogs set plate_status='preparing' where order_session_id='cs_phone_legacy';");
  const [record]=(await db.query("select * from public.registration_dogs where order_session_id='cs_phone_legacy'")).rows;
  assert.equal(record.dog_name_for_plate,'Luna Updated');assert.equal(record.owner_phone_for_plate,phone);assert.ok(record.plate_started_at);
});
test('Perrun profile edits and later dog name changes do not modify frozen snapshot',async()=>{
  const [before]=(await db.query("select * from public.registration_dogs where order_session_id='cs_phone_legacy'")).rows;
  await db.exec("update public.inscripciones set whatsapp='+525533333333',email='edited@example.invalid' where order_session_id='cs_phone_legacy'; update public.registration_dogs set dog_name='Changed after preparation',plate_status='engraved' where order_session_id='cs_phone_legacy';");
  const [after]=(await db.query("select * from public.registration_dogs where order_session_id='cs_phone_legacy'")).rows;
  assert.equal(after.registration_email,'edited@example.invalid');assert.equal(after.owner_phone_for_plate,before.owner_phone_for_plate);assert.equal(after.dog_name_for_plate,before.dog_name_for_plate);assert.deepEqual(after.plate_started_at,before.plate_started_at);
  await assert.rejects(db.exec("update public.registration_dogs set owner_phone_for_plate='+525544444444' where order_session_id='cs_phone_legacy'"),/immutable/);
});
test('Perrun unpaid/cancelled or unrequested engraving cannot start preparation',async()=>{
  await prepare('cs_phone_cancelled');await finalize('cs_phone_cancelled');
  await db.exec("update public.inscripciones set registration_status='cancelled' where order_session_id='cs_phone_cancelled'");
  await assert.rejects(db.exec("update public.registration_dogs set plate_status='preparing' where order_session_id='cs_phone_cancelled'"),/not eligible/);
  await prepare('cs_phone_declined',human,[{...dog,engravingRequested:false}]);await finalize('cs_phone_declined');
  await assert.rejects(db.exec("update public.registration_dogs set plate_status='preparing' where order_session_id='cs_phone_declined'"),/not eligible/);
});
test('Perrun paid engraving beyond position 300 is required before preparation',async()=>{
  await db.exec('update public.perrun_paid_dog_counter set last_sequence=300');await prepare('cs_phone_addon');const [record]=await finalize('cs_phone_addon');
  assert.equal(Number(record.engraving_sequence),301);await assert.rejects(db.exec("update public.registration_dogs set plate_status='preparing' where order_session_id='cs_phone_addon'"),/Separate engraving payment/);
  await db.query("insert into public.perrun_engraving_payments(dog_id,stripe_session_id,stripe_payment_intent_id,status,paid_at) values($1,'cs_fake_addon','pi_fake_addon','paid',now())",[record.id]);
  await db.exec("update public.registration_dogs set plate_status='preparing' where order_session_id='cs_phone_addon'");
  assert.equal((await db.query('select owner_phone_for_plate from public.registration_dogs where id=$1',[record.id])).rows[0].owner_phone_for_plate,phone);
});
