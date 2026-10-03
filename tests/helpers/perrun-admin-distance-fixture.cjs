'use strict';
const fs=require('node:fs'),path=require('node:path');
const production=require('./perrun-production-fixture.cjs');
const migration='20261003041809_perrun_admin_operational_distance.sql';
const sql='select public.admin_update_perrun_registration($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) as result';
const rpcKeys=['p_order_session_id','p_expected_revision','p_distance','p_participant','p_dogs','p_reason','p_admin_user_id','p_admin_email'];
async function apply(db){const source=fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration),'utf8');if(db.exec)await db.exec(source);else await db.query(source);}
async function install(db){await production.install(db);await apply(db);}
async function edit(db,x,{distance,participant={},dogs,revision=0,reason='Corrección solicitada'}={}){
 const current=(await db.query('select distance from public.inscripciones where order_session_id=$1',[x.orderId])).rows[0];
 return db.query(sql,[x.orderId,revision,distance===undefined?current.distance:distance,JSON.stringify({...x.participant,...participant}),JSON.stringify(dogs||x.dogs.map(d=>({id:d.id,name:d.dog_name,weightKg:Number(d.weight_kg)}))),reason,production.actor,production.email]);
}
async function paid(db,{distance='3K',manual=false,v2=false}={}){
 let orderId;
 if(v2){const payload=production.v2.payload();payload.distance=distance;payload.email='owner@example.invalid';const reserved=await production.v2.reserve(db,{data:payload});const attached=await production.v2.attach(db,reserved);await production.v2.finalize(db,attached);orderId=attached.stripe_session_id;}
 else{const manualFixture=require('./perrun-manual-fixture.cjs'),args=manualFixture.args({distance});if(manual){orderId=(await manualFixture.manual(db,args))[0].order_session_id;}else{orderId='cs_distance_'+require('node:crypto').randomUUID().replaceAll('-','');await db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',[orderId,...args.slice(1,7)]);await db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[orderId,'pi_'+orderId,'evt_'+orderId,args[7],'mxn']);}}
 const human=(await db.query('select * from public.inscripciones where order_session_id=$1',[orderId])).rows[0],dogs=(await db.query('select * from public.registration_dogs where order_session_id=$1 order by dog_index',[orderId])).rows;
 return {orderId,human,dogs,participant:{...require('./perrun-manual-fixture.cjs').human,email:human.email}};
}
function legacyCaseAdapter(db){const legacy=require('./perrun-admin-edit-cases.cjs');return {query:async(statement,params)=>{if(statement!==legacy.sql)return db.query(statement,params);const current=(await db.query('select distance from public.inscripciones where order_session_id=$1',[params[0]])).rows[0];return db.query(sql,[...params.slice(0,2),current.distance,...params.slice(2)]);}};}
module.exports={migration,sql,rpcKeys,apply,install,edit,paid,production,legacyCaseAdapter};
