'use strict';const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{parseEnv}=require('util');
const state=JSON.parse(fs.readFileSync('.qa/runtime-state.json'));const runtime=JSON.parse(fs.readFileSync('.qa/runtimes.json'));const secret=JSON.parse(fs.readFileSync(state.credentialFile));const {Client}=require(path.join(runtime.postgres,'node_modules/pg'));
assert.equal(state.mode,'native');assert.equal(state.database,'perrun_qa_real');
const db=new Client({host:'127.0.0.1',port:55322,user:'qa_admin',password:secret.admin,database:state.database});
const env=parseEnv(fs.readFileSync('.env.qa.local','utf8'));assert.equal(env.PERRUN_QA_LOCAL,'1');assert.equal(env.SUPABASE_URL,'http://127.0.0.1:55321');assert.match(env.STRIPE_SECRET_KEY,/^sk_test_/);const snapshot=JSON.parse(fs.readFileSync('.qa/remote-structure.json'));
const norm=s=>s.replace(/\r/g,'').replace(/\s+/g,' ').trim();
async function rpc(name,payload){const r=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return Array.isArray(data)?data:[data];}
(async()=>{await db.connect();await db.query("alter database perrun_qa_real set timezone='UTC';set timezone='UTC'");
for(const t of snapshot.tables){
 const cols=(await db.query(`select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,not a.attnotnull as nullable,pg_get_expr(d.adbin,d.adrelid) as default from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`,['public.'+t.name])).rows;assert.deepEqual(cols,t.columns,'columns '+t.name);
 const cons=(await db.query('select conname as name,pg_get_constraintdef(oid) as definition,convalidated as validated from pg_constraint where conrelid=$1::regclass',['public.'+t.name])).rows;
 const sort=x=>x.sort((a,b)=>a.name.localeCompare(b.name));assert.deepEqual(sort(cons),sort(t.constraints),'constraints '+t.name);
 const indexes=(await db.query('select indexname as name,indexdef as definition from pg_indexes where schemaname=\'public\' and tablename=$1',[t.name])).rows;assert.deepEqual(sort(indexes),sort(t.indexes),'indexes '+t.name);
 const triggers=(await db.query('select tgname as name,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid=$1::regclass and not tgisinternal',['public.'+t.name])).rows;assert.deepEqual(sort(triggers),sort(t.triggers),'triggers '+t.name);
 assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+t.name])).rows[0].relrowsecurity,t.rls);
}
for(const f of snapshot.functions){const row=(await db.query('select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[f.schema,f.name])).rows;assert.equal(row.length,1);assert.equal(norm(row[0].definition),norm(f.definition),'function '+f.schema+'.'+f.name);}
console.log('SCHEMA_REAL_MATCH=PASS (7 tables, columns, constraints, indexes, triggers, RLS; 13 function definitions)');
assert.equal(Number((await db.query('select count(*) from public.inscripciones')).rows[0].count),0);assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),0);
for(const t of ['registration_dogs','perrun_checkout_orders','perrun_engraving_payments'])assert.equal(Number((await db.query('select count(*) from public.'+t)).rows[0].count),0,'Validation requires empty QA tables');
const id='cs_local_qa_rpc_validation';const prep={p_order_session_id:id,p_distance:'5K',p_buyer_email:'qa@example.invalid',p_participant:{email:'qa@example.invalid',fullName:'LOCAL QA SYNTHETIC',whatsapp:'+525500000000',shirtSize:'M',birthDate:'1990-01-01',state:'Ciudad de México',borough:'Cuauhtémoc'},p_dogs:[{name:'QA Dog A',weightKg:10,engravingRequested:true},{name:'QA Dog B',weightKg:20,engravingRequested:false}],p_price_stage:'presale',p_quoted_at:'2026-10-01T12:00:00Z'};
await rpc('prepare_perrun_order',prep);await rpc('prepare_perrun_order',prep);
let rows=await rpc('record_perrun_payment_state',{p_order_session_id:id,p_stripe_event_id:'evt_local_qa_pending',p_payment_status:'pending'});assert.equal(rows[0].payment_status,'pending');
rows=await rpc('record_perrun_payment_state',{p_order_session_id:id,p_stripe_event_id:'evt_local_qa_failed',p_payment_status:'failed'});assert.equal(rows[0].payment_status,'failed');
const paid={p_order_session_id:id,p_payment_intent_id:'pi_local_synthetic_not_stripe',p_stripe_event_id:'evt_local_qa_synthetic',p_confirmed_amount_cents:63000,p_confirmed_currency:'mxn'};
rows=await rpc('finalize_perrun_paid_order',paid);assert.deepEqual(rows.map(x=>Number(x.engraving_sequence)),[1,2]);assert.deepEqual(await rpc('finalize_perrun_paid_order',paid),rows);assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),2);
console.log('RPC_HTTP_TESTS=PASS (prepare idempotency; pending/failed; finalization; duplicate no increment)');
await db.query('begin');try{await db.query('delete from public.registration_dogs where order_session_id=$1',[id]);await db.query('delete from public.inscripciones where order_session_id=$1',[id]);await db.query('delete from public.perrun_checkout_orders where order_session_id=$1',[id]);await db.query("update public.perrun_paid_dog_counter set last_sequence=0 where event_slug='perrun-2027' and last_sequence=2");await db.query('commit');}catch(e){await db.query('rollback');throw e;}
console.log('LOCAL_SYNTHETIC_FIXTURES_REMOVED=YES;COUNTER=0;STRIPE_CALLS=0;REMOTE_QA_READS=0;REMOTE_WRITES=0');
await db.end();})().catch(async e=>{console.error(e.message);await db.end();process.exitCode=1;});
