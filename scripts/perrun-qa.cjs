'use strict';
// Local QA tooling only: never imports .env.local into the application process.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{parseEnv}=require('node:util');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.qa'),app=path.join(qa,'app');
process.chdir(root);
function load(){
  const env=parseEnv(fs.readFileSync('.env.qa.local','utf8'));
  assert.equal(env.PERRUN_QA_LOCAL,'1','Missing explicit local QA marker');
  const url=new URL(env.SUPABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55321');
  assert.ok(env.SUPABASE_SERVICE_ROLE_KEY,'Local service credential missing');
  assert.match(env.STRIPE_SECRET_KEY,/^sk_test_/);assert.match(env.STRIPE_PUBLISHABLE_KEY,/^pk_test_/);
  assert.ok(env.RATE_LIMIT_SECRET.length>=32&&env.CHECKOUT_SUMMARY_SECRET.length>=32);
  const remote=parseEnv(fs.readFileSync('.env.local','utf8'));
  assert.notEqual(env.SUPABASE_SERVICE_ROLE_KEY,remote.SUPABASE_SERVICE_ROLE_KEY,'Remote DB credential forbidden');
  return env;
}
function psql(sql){
  const state=fs.existsSync(path.join(qa,'runtime-state.json'))?JSON.parse(fs.readFileSync(path.join(qa,'runtime-state.json'),'utf8')):null;
  if(state?.mode==='native'){
    const runtime=JSON.parse(fs.readFileSync(path.join(qa,'runtimes.json'),'utf8'));
    const program="const fs=require('fs'),path=require('path');const s=JSON.parse(fs.readFileSync('.qa/runtime-state.json')),r=JSON.parse(fs.readFileSync('.qa/runtimes.json')),c=JSON.parse(fs.readFileSync(s.credentialFile));const {Client}=require(path.join(r.postgres,'node_modules/pg'));const db=new Client({host:'127.0.0.1',port:55322,user:'qa_admin',password:c.admin,database:s.database});(async()=>{await db.connect();const row=(await db.query(process.argv[1])).rows[0];console.log(JSON.stringify(Object.values(row)[0]));await db.end();})().catch(()=>process.exit(1));";
    const r=cp.spawnSync(process.execPath,['-e',program,sql],{encoding:'utf8',windowsHide:true,timeout:10000});
    if(r.error||r.status!==0)throw Error('Native local database query failed');return r.stdout.trim();
  }
  throw Error('Native QA database required; run node scripts/perrun-qa-db.cjs');

}
async function check(){
  const env=load();
  const migrations=JSON.parse(psql("select coalesce(json_agg(version order by version),'[]') from supabase_migrations.schema_migrations"));
  const expected=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).map(n=>n.split('_')[0]).sort();assert.deepEqual(migrations,expected);
  const funcs=JSON.parse(psql("select json_agg(proname order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('prepare_perrun_order','finalize_perrun_paid_order','record_perrun_payment_state','consume_api_rate_limit')"));
  assert.deepEqual(funcs,['consume_api_rate_limit','finalize_perrun_paid_order','prepare_perrun_order','record_perrun_payment_state']);
  const counts=JSON.parse(psql("select json_build_object('counter',(select last_sequence from public.perrun_paid_dog_counter where event_slug='perrun-2027'),'humans',(select count(*) from public.inscripciones),'dogs',(select count(*) from public.registration_dogs),'drafts',(select count(*) from public.perrun_checkout_orders))"));
  for(const table of ['inscripciones','registration_dogs','perrun_checkout_orders','perrun_paid_dog_counter']){
    const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+table+'?select=*&limit=1',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
    assert.equal(r.status,200,'Local REST read failed: '+table);await r.json();
  }
  const openapi=await fetch(env.SUPABASE_URL+'/rest/v1/',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,Accept:'application/openapi+json'}});
  assert.equal(openapi.status,200);const schema=await openapi.json();
  for(const name of ['prepare_perrun_order','finalize_perrun_paid_order','record_perrun_payment_state'])assert.ok(schema.paths['/rpc/'+name],'RPC missing from local REST schema: '+name);
  const remoteUnchanged=crypto.createHash('sha256').update(fs.readFileSync('.env.local')).digest('hex')===fs.readFileSync(path.join(qa,'remote-env-sha256'),'utf8');assert.equal(remoteUnchanged,true);
  const state=JSON.parse(fs.readFileSync(path.join(qa,'runtime-state.json'),'utf8'));
  const result={supabaseMode:state.mode==='native'?'LOCAL_POSTGRES_POSTGREST':'SUPABASE_LOCAL',localUrl:env.SUPABASE_URL,migrations:migrations.length,phase1:migrations.includes('20261001055227'),phase4A:migrations.includes('20261001113351'),rpcs:funcs,counts,restRead:'PASS',rpcOpenAPI:'PASS',remoteEnvUnchanged:remoteUnchanged,remoteWrites:0,stripeMode:'TEST'};
  fs.writeFileSync(path.join(qa,'readiness.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
function copyApp(env){
  fs.mkdirSync(app,{recursive:true});
  assert.equal(fs.existsSync(path.join(app,'.env.local')),false,'Remote dotenv file forbidden in QA app');
  assert.equal(fs.existsSync(path.join(app,'.vercel/project.json')),false,'Linked Vercel project forbidden in QA app');
  const remoteUrl='https://uycwzhlcnfijjyzkgkem.supabase.co';
  function copy(from,to){
    const stat=fs.statSync(from);if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const n of fs.readdirSync(from))copy(path.join(from,n),path.join(to,n));return;}
    if(/\.(js|html)$/.test(from)&&!from.includes(path.sep+'api'+path.sep)&&!from.includes(path.sep+'lib'+path.sep)){
      let text=fs.readFileSync(from,'utf8');
      if(text.includes(remoteUrl)){text=text.replaceAll(remoteUrl,env.SUPABASE_URL).replace(/sb_publishable_[A-Za-z0-9_-]+/g,env.SUPABASE_ANON_KEY);}
      fs.writeFileSync(to,text);
    }else fs.copyFileSync(from,to);
  }
  for(const entry of fs.readdirSync(root)){
    if(['api','lib','assets','videos'].includes(entry)||/\.(html|css|js|pdf|xml|ico|png|jpg|svg|webp)$/.test(entry))copy(path.join(root,entry),path.join(app,entry));
  }
  const deps=path.join(app,'node_modules');if(!fs.existsSync(deps))fs.symlinkSync(path.join(root,'node_modules'),deps,'junction');
  assert.equal(fs.realpathSync(deps).toLowerCase(),fs.realpathSync(path.join(root,'node_modules')).toLowerCase());
  fs.copyFileSync(path.join(root,'package.json'),path.join(app,'package.json'));
  const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
  config.env={...env};
  const csp="default-src 'self'; connect-src 'self' "+env.SUPABASE_URL+"; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://images.unsplash.com; frame-src https://js.stripe.com https://hooks.stripe.com; form-action 'self' https://checkout.stripe.com; base-uri 'self'; object-src 'none'";
  config.headers=config.headers.filter(h=>h.source!=='/(.*)');config.headers.push({source:'/(.*)',headers:[{key:'Content-Security-Policy',value:csp},{key:'Cache-Control',value:'no-store'}]});
  fs.writeFileSync(path.join(app,'vercel.json'),JSON.stringify(config,null,2));
  const r=cp.spawnSync(process.execPath,['build.js'],{cwd:app,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,VERCEL_GIT_COMMIT_SHA:'LOCAL_QA'},encoding:'utf8',windowsHide:true});
  if(r.status)throw Error('Isolated QA asset build failed');fs.writeFileSync(path.join(qa,'logs/qa-build.log'),r.stdout+r.stderr);
}
function server(){
  const values=load();copyApp(values);
  const env={};for(const k of ['PATH','SystemRoot','windir','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ComSpec','PATHEXT','HOMEDRIVE','HOMEPATH'])if(process.env[k])env[k]=process.env[k];
  Object.assign(env,values,{DO_NOT_TRACK:'1',VERCEL_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require '+JSON.stringify(path.join(__dirname,'qa-network-guard.cjs'))});
  console.log('QA server: localhost:3000 → Supabase 127.0.0.1:55321; remote Supabase blocked.');
  const child=cp.spawn(process.execPath,[path.join(__dirname,'qa-http-server.cjs')],{cwd:app,env,stdio:'inherit',windowsHide:true});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
  child.on('exit',code=>process.exitCode=code||0);
}
if(process.argv[2]==='server')server();else if(process.argv[2]==='check')check().catch(e=>{console.error('QA check failed:',e.message);process.exitCode=1;});else if(process.argv[2]==='env'){const env=load();console.log('QA_ENV=.env.qa.local\nSUPABASE_MODE=LOCAL\nLOCAL_URL='+env.SUPABASE_URL+'\nSTRIPE_MODE=TEST\nREMOTE_ENV_UNCHANGED=true');}else throw Error('Use: node scripts/perrun-qa.cjs env|check|server');
