'use strict';
// Persistent local PostgreSQL + PostgREST fallback. No Docker or cloud database access.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),http=require('node:http'),{parseEnv}=require('node:util');
const root=path.resolve(__dirname,'..');process.chdir(root);
const qa=path.join(root,'.qa'),native=path.join(qa,'native'),logs=path.join(qa,'logs');
fs.mkdirSync(native,{recursive:true});fs.mkdirSync(logs,{recursive:true});
const runtime=JSON.parse(fs.readFileSync(path.join(qa,'runtimes.json'),'utf8'));
const bin=path.join(runtime.postgres,'node_modules/@embedded-postgres/windows-x64/native/bin');
const {Client}=require(path.join(runtime.postgres,'node_modules/pg'));
const data=path.join(native,'pgdata-real-schema');if(!data.startsWith(qa+path.sep))throw Error('Invalid QA data directory');
const credentialFile=path.join(native,'credentials.json');
const credentials=fs.existsSync(credentialFile)?JSON.parse(fs.readFileSync(credentialFile,'utf8')):{admin:crypto.randomBytes(32).toString('hex'),authenticator:crypto.randomBytes(32).toString('hex'),jwt:crypto.randomBytes(48).toString('hex')};
fs.writeFileSync(credentialFile,JSON.stringify(credentials));
const env={};for(const k of ['PATH','SystemRoot','windir','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ComSpec','PATHEXT'])if(process.env[k])env[k]=process.env[k];
env.PATH=bin+';'+(env.PATH||'');env.PGPASSWORD=credentials.admin;
const client=database=>new Client({host:'127.0.0.1',port:55322,user:'qa_admin',password:credentials.admin,database,connectionTimeoutMillis:1500});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function run(exe,args,label){const file=path.join(logs,label+'.log');const fd=fs.openSync(file,'a');const r=cp.spawnSync(exe,args,{env,windowsHide:true,timeout:30000,stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.error||r.status!==0)throw Error(label+' failed; local log retained');return fs.readFileSync(file,'utf8');}
const children=[];let gateway;
async function shutdown(){if(gateway)gateway.close();for(const child of children)child.kill();try{run(path.join(bin,'pg_ctl.exe'),['-D',data,'stop','-m','fast','-w'],'native-stop');}catch{} }
async function start(){
  if(fs.existsSync('.env.qa.local')){const current=parseEnv(fs.readFileSync('.env.qa.local','utf8'));if(current.PERRUN_QA_LOCAL==='1'&&current.SUPABASE_URL==='http://127.0.0.1:55321'){try{const response=await fetch(current.SUPABASE_URL+'/rest/v1/',{headers:{apikey:current.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+current.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(1500)});if(response.status===200){console.log('LOCAL_QA_ALREADY_RUNNING=true; use node scripts/perrun-qa.cjs check');return;}}catch{}}}
  const remoteHash=crypto.createHash('sha256').update(fs.readFileSync('.env.local')).digest('hex');fs.writeFileSync(path.join(qa,'remote-env-sha256'),remoteHash);
  if(!fs.existsSync(path.join(data,'PG_VERSION'))){
    const passFile=path.join(native,'admin-password');fs.writeFileSync(passFile,credentials.admin+'\n');
    run(path.join(bin,'initdb.exe'),['-D',data,'-U','qa_admin','--encoding=UTF8','--locale=C','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',passFile],'native-initdb');
  }
  let running=false;const probe=client('postgres');try{await probe.connect();running=true;}catch{}finally{await probe.end();}
  if(!running)run(path.join(bin,'pg_ctl.exe'),['-D',data,'-l',path.join(logs,'native-postgres.log'),'-o','-h 127.0.0.1 -p 55322 -c max_connections=20 -c shared_buffers=64MB','start','-w'],'native-postgres-start');
  let db=client('postgres');await db.connect();
  if(!(await db.query("select 1 from pg_database where datname='perrun_qa_real'")).rows.length)await db.query('create database perrun_qa_real');await db.end();db=client('perrun_qa_real');await db.connect();
  if(!(await db.query("select 1 from pg_roles where rolname='qa_authenticator'")).rows.length){
    await db.query('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role qa_authenticator noinherit login password '+"'"+credentials.authenticator+"'"+';grant anon,authenticated,service_role to qa_authenticator;create schema extensions;');
  }
  if(!(await db.query("select to_regclass('public.inscripciones') as name")).rows[0].name){
    const snapshot=JSON.parse(fs.readFileSync('.qa/remote-structure.json','utf8'));const snap=snapshot.tables.find(t=>t.name==='inscripciones');
    const legacy=JSON.parse(fs.readFileSync('tests/fixtures/kinetic-inscripciones-schema.json','utf8'));
    snap.constraints.find(c=>c.name==='inscripciones_distance_chk').definition=legacy.constraints.find(c=>c.name==='inscripciones_distance_chk').definition;
    for(const c of snap.columns){c.udt=c.type;c.nullable=c.nullable?'YES':'NO';}
    const ident=n=>{if(!/^[a-z_][a-z0-9_]*$/.test(n))throw Error('Invalid identifier');return '"'+n+'"';};
    const columns=snap.columns.map(c=>ident(c.name)+' '+c.udt+(c.default!==null?' default '+c.default:'')+(c.nullable==='NO'?' not null':''));
    let sql='create table public.inscripciones ('+[...columns,...snap.constraints.map(c=>'constraint '+ident(c.name)+' '+c.definition)].join(',')+');';
    const owned=new Set(snap.constraints.filter(c=>/^(?:PRIMARY KEY|UNIQUE)/.test(c.definition)).map(c=>c.name));
    for(const i of snap.indexes)if(!owned.has(i.name))sql+=i.definition+';';
    sql+='alter table public.inscripciones enable row level security;revoke all on public.inscripciones from anon,authenticated;grant all on public.inscripciones to service_role;';
    await db.query(sql);console.log('EMPTY_LOCAL_SCHEMA_BOOTSTRAP=APPLIED');
  }
  await db.query('create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  const names=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort();
  for(const name of names){
    const version=name.split('_')[0];if((await db.query('select 1 from supabase_migrations.schema_migrations where version=$1',[version])).rows.length)continue;
    const sql=fs.readFileSync(path.join('supabase/migrations',name),'utf8');
    await db.query('begin');try{await db.query(sql);await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[version,name,[sql]]);await db.query('commit');}catch(e){await db.query('rollback');throw e;}
    console.log('LOCAL_MIGRATION='+name);
  }
  await db.query(fs.readFileSync('desc/sql-finalize-paid-order-pr4.sql','utf8')+';\nrevoke all on function public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb) from public,anon,authenticated;grant execute on function public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb) to service_role;');
  await db.query(fs.readFileSync('desc/sql-batch7-rate-limits.sql','utf8'));
  const snapshot=JSON.parse(fs.readFileSync('.qa/remote-structure.json','utf8'));
  for(const f of snapshot.functions.filter(f=>['get_next_event_bib_number','consume_api_rate_limit','finalize_paid_order'].includes(f.name)))await db.query(f.definition);
  // Grants taken from the catalog for the server role only. Browser grants stay denied.
  for(const g of snapshot.grants.filter(g=>g.grantee==='service_role'))await db.query('grant '+g.privilege_type+' on public.'+g.table_name+' to service_role');

  const publicFunctions=(await db.query("select oid::regprocedure::text as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('get_next_event_bib_number','get_available_event_bibs','finalize_paid_order')")).rows;
  for(const f of publicFunctions)await db.query('revoke all on function '+f.signature+' from public,anon,authenticated,service_role');
  await db.query("alter database perrun_qa_real set timezone='UTC';set timezone='UTC'");
  const version=(await db.query('show server_version')).rows[0].server_version;await db.end();
  function jwt(role){const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const body=Buffer.from(JSON.stringify({role,iss:'perrun-local-qa',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+365*86400})).toString('base64url');return header+'.'+body+'.'+crypto.createHmac('sha256',credentials.jwt).update(header+'.'+body).digest('base64url');}
  const remote=parseEnv(fs.readFileSync('.env.local','utf8'));if(!/^sk_test_/.test(remote.STRIPE_SECRET_KEY||'')||!/^pk_test_/.test(remote.STRIPE_PUBLISHABLE_KEY||''))throw Error('Stripe TEST keys required');
  const old=fs.existsSync('.env.qa.local')?parseEnv(fs.readFileSync('.env.qa.local','utf8')):{};
  const values={PERRUN_QA_LOCAL:'1',SUPABASE_URL:'http://127.0.0.1:55321',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),SUPABASE_ANON_KEY:jwt('anon'),STRIPE_SECRET_KEY:remote.STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY:remote.STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET:old.STRIPE_WEBHOOK_SECRET||'',RATE_LIMIT_SECRET:old.RATE_LIMIT_SECRET||crypto.randomBytes(32).toString('hex'),CHECKOUT_SUMMARY_SECRET:old.CHECKOUT_SUMMARY_SECRET||crypto.randomBytes(32).toString('hex'),RESEND_API_KEY:'re_local_qa_disabled',META_CAPI_ACCESS_TOKEN:'',VERCEL_ENV:'development'};
  fs.writeFileSync('.env.qa.local','# LOCAL QA ONLY. PostgreSQL/PostgREST fallback, cloud credentials untouched.\n'+Object.entries(values).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n');
  const conf=path.join(native,'postgrest.conf');
  fs.writeFileSync(conf,'db-uri = "postgresql://qa_authenticator:'+credentials.authenticator+'@127.0.0.1:55322/perrun_qa_real"\ndb-schemas = "public"\ndb-anon-role = "anon"\ndb-extra-search-path = "public,extensions"\njwt-secret = "'+credentials.jwt+'"\nserver-host = "127.0.0.1"\nserver-port = 55325\ndb-pool = 5\n');
  const fd=fs.openSync(path.join(logs,'postgrest.log'),'a');
  const rest=cp.spawn(runtime.postgrest,[conf],{env,windowsHide:true,stdio:['ignore',fd,fd]});children.push(rest);rest.on('error',()=>console.error('Native PostgREST launch failed'));rest.on('exit',code=>{if(code)console.error('Native PostgREST stopped with code '+code);});
  let ready=false;for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:55325/',{headers:{Authorization:'Bearer '+values.SUPABASE_SERVICE_ROLE_KEY}});if(r.status===200){ready=true;break;}}catch{}await pause(200);}if(!ready)throw Error('PostgREST API did not become ready');
  gateway=http.createServer((req,res)=>{
    if(!req.url.startsWith('/rest/v1')){res.writeHead(501,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Local QA fallback exposes database REST only; Auth/Storage not installed'}));}
    if(![values.SUPABASE_SERVICE_ROLE_KEY,values.SUPABASE_ANON_KEY].includes(req.headers.apikey)){res.writeHead(401);return res.end('Local API key required');}
    const upstream=http.request({hostname:'127.0.0.1',port:55325,path:req.url.slice('/rest/v1'.length)||'/',method:req.method,headers:{...req.headers,host:'127.0.0.1:55325'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Local REST unavailable');});req.pipe(upstream);
  });
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(55321,'127.0.0.1',resolve);});
  fs.writeFileSync(path.join(qa,'runtime-state.json'),JSON.stringify({mode:'native',postgresVersion:version,postgrestVersion:'16.4',adminPsql:path.join(bin,'psql.exe'),credentialFile,data,database:'perrun_qa_real',pid:process.pid,postgrestPid:rest.pid,dbPort:55322,restPort:55325,apiPort:55321,migrations:names.length},null,2));
  console.log('LOCAL_DB_READY=true\nMODE=LOCAL_POSTGRES_POSTGREST\nPOSTGRES='+version+'\nLOCAL_URL=http://127.0.0.1:55321\nMIGRATIONS='+names.length+'\nREMOTE_WRITES=0');
}
process.on('SIGINT',()=>shutdown().then(()=>process.exit(0)));process.on('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
start().catch(async e=>{console.error('Local QA database start failed:',e.message);await shutdown();process.exitCode=1;});
