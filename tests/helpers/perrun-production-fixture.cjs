'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const v2=require('./perrun-payment-v2-fixture.cjs'),edit=require('./perrun-admin-edit-cases.cjs'),manual=require('./perrun-manual-fixture.cjs');
const migration='20261003031429_perrun_production_batches.sql',actor=edit.actor,email='admin@example.invalid';
const readSQL='select public.admin_read_perrun_production($1) as result';
const saveSQL='select public.admin_save_perrun_production_batch($1,$2,$3,$4,$5) as result';
const closeSQL='select public.admin_close_perrun_production_batch($1,$2,$3,$4) as result';
async function install(db){await v2.install(db);await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration),'utf8'));}
const read=async(db,id=null)=>(await db.query(readSQL,[id])).rows[0].result;
const save=async(db,ids,{id=crypto.randomUUID(),revision=null}={})=>(await db.query(saveSQL,[id,revision,ids,actor,email])).rows[0].result;
const close=async(db,id,revision=0)=>(await db.query(closeSQL,[id,revision,actor,email])).rows[0].result;
async function paid(db,options={}){const x=await edit.fixture(db,options);const human=(await db.query('select * from public.inscripciones where order_session_id=$1',[x.orderId])).rows[0];return {...x,human};}
async function prepared(db){const id='cs_test_prepared_'+crypto.randomUUID().replaceAll('-','');const a=manual.args();await db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',[id,...a.slice(1,7)]);return id;}
async function reset(db){await db.query('truncate public.perrun_production_items,public.perrun_production_batches,public.perrun_registration_edits,public.perrun_promo_slots,public.perrun_checkout_reservation_dogs,public.perrun_checkout_reservations,public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones');await db.query('update public.perrun_paid_dog_counter set last_sequence=0');await db.query('insert into public.perrun_promo_slots(slot) select generate_series(1,300)');}
async function history(db){return (await db.query("select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(o) order by order_session_id) from public.perrun_checkout_orders o),'humans',(select jsonb_agg(to_jsonb(h) order by id) from public.inscripciones h),'dogs',(select jsonb_agg(to_jsonb(d) order by id) from public.registration_dogs d),'counter',(select to_jsonb(c) from public.perrun_paid_dog_counter c),'slots',(select jsonb_agg(to_jsonb(s) order by slot) from public.perrun_promo_slots s),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.perrun_engraving_payments p)) data")).rows[0].data;}
module.exports={install,migration,actor,email,read,save,close,paid,prepared,reset,history,edit,v2,readSQL,saveSQL,closeSQL};
