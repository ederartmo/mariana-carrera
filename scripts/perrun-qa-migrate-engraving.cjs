'use strict';
// Apply ONLY the already approved/versioned 6A migration to native loopback QA.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');process.chdir(root);
assert.equal(process.env.PERRUN_QA_LOCAL,'1');assert.equal(new URL(process.env.SUPABASE_URL).origin,'http://127.0.0.1:55321');
const runtime=JSON.parse(fs.readFileSync('.qa/runtimes.json')),credentials=JSON.parse(fs.readFileSync('.qa/native/credentials.json'));
const {Client}=require(path.join(runtime.postgres,'node_modules/pg'));const db=new Client({host:'127.0.0.1',port:55322,user:'qa_admin',password:credentials.admin,database:'perrun_qa_real'});
const file='20261001162118_perrun_engraving_payment_persistence.sql',sql=fs.readFileSync('supabase/migrations/'+file,'utf8');
assert.equal(crypto.createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex'),'3639b006dccb6b3909d295021ca3b72874ac7e9d7c49abd4cdfd02204d8f5e79');
const fingerprint=async()=>JSON.stringify((await db.query("select json_build_object('humans',(select json_agg(s order by id,email) from public.inscripciones s),'dogs',(select json_agg(s order by id) from public.registration_dogs s),'orders',(select json_agg(s order by order_session_id) from public.perrun_checkout_orders s),'counter',(select json_agg(s) from public.perrun_paid_dog_counter s)) value")).rows[0].value);
(async()=>{await db.connect();await db.query('begin');await db.query('select pg_advisory_xact_lock(600100162118)');const before=await fingerprint();const applied=(await db.query('select 1 from supabase_migrations.schema_migrations where version=$1',['20261001162118'])).rows.length;
if(!applied){await db.query(sql.replace(/^begin;\r?$/m,'').replace(/^commit;\r?$/m,''));await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',['20261001162118','perrun_engraving_payment_persistence',[sql]]);}
assert.equal(await fingerprint(),before);await db.query("notify pgrst, 'reload schema'");await db.query('commit');console.log('LOCAL_6A='+ (applied?'ALREADY_APPLIED':'APPLIED')+'; MAIN_DATA=UNCHANGED; REMOTE_WRITES=0');})().catch(async e=>{await db.query('rollback').catch(()=>{});console.error(e.message);process.exitCode=1}).finally(()=>db.end());
