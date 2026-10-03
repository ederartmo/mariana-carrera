'use strict';
const fs=require('node:fs'),path=require('node:path'),distance=require('./perrun-admin-distance-fixture.cjs');
const migration='20261003113402_perrun_annul_participation.sql';
async function apply(db){for(const name of ['20261003042548_perrun_admin_operational_distance_remove_legacy_rpc.sql',migration]){const sql=fs.readFileSync(path.join(__dirname,'../../supabase/migrations',name),'utf8');if(db.exec)await db.exec(sql);else await db.query(sql);}}
async function install(db){await distance.install(db);await apply(db);}
const sql='select public.admin_annul_perrun_participation($1,$2,$3,$4,$5) result';
async function annul(db,x,{revision=0,reason='Anulación solicitada por participante',actor=distance.production.actor,email=distance.production.email}={}){return (await db.query(sql,[x.orderId,revision,reason,actor,email])).rows[0].result;}
module.exports={...distance,migration,apply,install,annul,annulSQL:sql};
