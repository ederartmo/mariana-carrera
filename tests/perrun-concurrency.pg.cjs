'use strict';
// Real PostgreSQL native process on 127.0.0.1 only. No .env files, remote URLs or Stripe.
// node tests/perrun-concurrency.pg.cjs <temporary runtime prefix> <absolute test work directory> [evidence.json]
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const net=require('node:net');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {installFixture}=require('./helpers/perrun-schema-fixture.cjs');
const runtime=path.resolve(process.argv[2]);
const work=path.resolve(process.argv[3]);
const {Client}=require(path.join(runtime,'node_modules','pg'));
const bin=path.join(runtime,'node_modules','@embedded-postgres','windows-x64','native','bin');
const root=path.resolve(__dirname,'..');
const data=path.join(work,'perrun-isolated-'+Date.now());
if(!path.isAbsolute(process.argv[3])||data===root||!data.startsWith(work+path.sep))throw new Error('Invalid isolated database directory');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence={engine:'native PostgreSQL',scope:'127.0.0.1 isolated cluster; synthetic data only',checks:[],concurrency:[],blocking:[]};
const childEnv={};
for(const key of ['SystemRoot','windir','TEMP','TMP','PATH','ComSpec','SystemDrive','USERPROFILE','USERNAME','USERDOMAIN','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[key])childEnv[key]=process.env[key];
childEnv.PATH=bin+';'+(childEnv.PATH||'');
let server,logFd,admin,a,b,port;
const human={fullName:'Concurrent Owner',shirtSize:'M',birthDate:'1990-01-01',whatsapp:'+525500000000',state:'Ciudad de México',borough:'Gustavo A. Madero'};
const dog={name:'Luna',weightKg:10,engravingRequested:true};
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20261001055227_perrun_phase1_model.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'desc','perrun-phase1-rollback.sql'),'utf8');
const options=database=>({host:'127.0.0.1',port,user:'perrun_test',database,password:'',connectionTimeoutMillis:500,query_timeout:18000});
const execAdapter=client=>({exec:sql=>client.query(sql)});
async function scalar(sql,params=[]){return (await admin.query(sql,params)).rows[0];}
async function check(name,run){await run();evidence.checks.push({name,result:'PASS'});console.log('PASS '+name);}
async function fingerprint(){return (await admin.query(`select json_build_object(
  'columns',(select json_agg(row_to_json(s)) from (select attname,format_type(atttypid,atttypmod) as type,attnotnull,pg_get_expr(d.adbin,d.adrelid) as def from pg_attribute x left join pg_attrdef d on d.adrelid=x.attrelid and d.adnum=x.attnum where x.attrelid='public.inscripciones'::regclass and x.attnum>0 and not x.attisdropped order by x.attnum) s),
  'constraints',(select json_agg(row_to_json(s)) from (select conname,pg_get_constraintdef(oid) as definition,convalidated from pg_constraint where conrelid='public.inscripciones'::regclass order by conname) s),
  'indexes',(select json_agg(row_to_json(s)) from (select indexname,indexdef from pg_indexes where schemaname='public' and tablename='inscripciones' order by indexname) s),
  'finalizer',pg_get_functiondef('public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)'::regprocedure)
) as fingerprint`)).rows[0].fingerprint;}
async function prepare(id,count=1){await admin.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)',[id,'3K','test@example.invalid',JSON.stringify(human),JSON.stringify(Array.from({length:count},(_,i)=>({...dog,name:'Dog '+(i+1)}))),'presale','2026-10-31T23:59:59-06:00']);}
function finalize(client,id,count){return client.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[id,'pi_'+id,'evt_'+id,count===2?63000:45000,'mxn']);}
async function reset(counter){await admin.query('truncate public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones');await admin.query('update public.perrun_paid_dog_counter set last_sequence=$1',[counter]);}
async function begin(client){await client.query("begin; set local lock_timeout='8s'; set local statement_timeout='15s';");}
async function blockedBy(waiter,blocker){
  for(let i=0;i<100;i++){
    const row=await scalar('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=$1',[waiter]);
    if(row.blockers.includes(blocker)){evidence.blocking.push(row);return row;}
    await sleep(20);
  }
  throw new Error('No real lock contention observed');
}
async function simultaneous(firstId,firstCount,secondId,secondCount,initial,first=a,second=b){
  await begin(first);await begin(second);
  await first.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");
  // B enters the real RPC and is observed blocked before A completes/commits it.
  const pending=finalize(second,secondId,secondCount).then(value=>({value}),error=>({error}));
  const [firstPID,secondPID]=await Promise.all([first.query('select pg_backend_pid() as pid'),admin.query('select $1::integer as pid',[second===b?evidence.connections.B:evidence.connections.A])]);
  const blocking=await blockedBy(secondPID.rows[0].pid,firstPID.rows[0].pid);
  assert.equal(blocking.wait_event_type,'Lock');assert.equal(blocking.wait_event,'advisory');
  const resultA=await finalize(first,firstId,firstCount);
  assert.equal(Number((await scalar('select last_sequence from public.perrun_paid_dog_counter')).last_sequence),initial,'uncommitted positions invisible to observer');
  await first.query('commit');const resultB=await pending;if(resultB.error)throw resultB.error;await second.query('commit');
  return [resultA.rows,resultB.value.rows];
}
async function verifyPositions(initial,total){
  const rows=(await admin.query('select dog_index,order_session_id,engraving_sequence,engraving_free from public.registration_dogs order by engraving_sequence')).rows;
  assert.deepEqual(rows.map(r=>Number(r.engraving_sequence)),Array.from({length:total},(_,i)=>initial+i+1));
  assert.equal(new Set(rows.map(r=>Number(r.engraving_sequence))).size,total);
  for(const row of rows)assert.equal(row.engraving_free,Number(row.engraving_sequence)<=300);
  assert.equal(Number((await scalar('select last_sequence from public.perrun_paid_dog_counter')).last_sequence),initial+total);
  return rows.map(r=>({order:r.order_session_id,dogIndex:r.dog_index,position:Number(r.engraving_sequence),free:r.engraving_free}));
}
async function legacyModernTests(){
  const call=(id,people=[human],event='cascanueces-run')=>admin.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,event,'5K',450,'test@example.invalid','pi_'+id,'evt_'+id,JSON.stringify(people)]);
  await check('native modern order preserves all four PR4 fields',async()=>{await call('cs_native_modern');const r=await scalar("select birth_date::text,whatsapp,state,borough from public.inscripciones where order_session_id='cs_native_modern'");assert.deepEqual(r,{birth_date:human.birthDate,whatsapp:human.whatsapp,state:human.state,borough:human.borough});});
  await check('native legacy hotfix intentionally clears valid incoming PR4 data',async()=>{await admin.query("insert into public.inscripciones(stripe_session_id,email,full_name,event_slug,payment_status,order_session_id,ticket_index,ticket_count,distance) values('cs_native_legacy','test@example.invalid','Legacy Owner','cascanueces-run','pending','cs_native_legacy',1,1,'5K')");await call('cs_native_legacy');assert.deepEqual(await scalar("select birth_date,whatsapp,state,borough from public.inscripciones where order_session_id='cs_native_legacy'"),{birth_date:null,whatsapp:null,state:null,borough:null});});
  await check('native modern and legacy retries preserve all persisted fields',async()=>{for(const id of ['cs_native_modern','cs_native_legacy']){const before=(await admin.query('select * from public.inscripciones where order_session_id=$1',[id])).rows;await call(id,[{...human,fullName:'Changed incoming',whatsapp:'+525511111111'}]);assert.deepEqual((await admin.query('select * from public.inscripciones where order_session_id=$1',[id])).rows,before);}});
  await check('native Axolote and Cascanueces finalization remains functional',async()=>{for(const event of ['axolote-night-run','cascanueces-run'])assert.equal((await call('cs_native_'+event,[human],event)).rows.length,1);});
}
(async()=>{
  fs.mkdirSync(work,{recursive:true});
  const finder=net.createServer();await new Promise(resolve=>finder.listen(0,'127.0.0.1',resolve));port=finder.address().port;await new Promise(resolve=>finder.close(resolve));
  const init=cp.spawnSync(path.join(bin,'initdb.exe'),['-D',data,'-U','perrun_test','--auth=trust','--encoding=UTF8','--locale=C'],{windowsHide:true,encoding:'utf8',env:childEnv});
  if(init.status!==0)throw new Error('Local initdb failed: '+init.stderr.slice(-1600));
  logFd=fs.openSync(path.join(data,'server.log'),'a');
  server=cp.spawn(path.join(bin,'postgres.exe'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','max_connections=12','-c','log_min_messages=warning'],{windowsHide:true,env:childEnv,stdio:['ignore',logFd,logFd]});
  server.on('error',error=>{evidence.serverError=error.message;});
  for(let i=0;i<100;i++){
    const probe=new Client(options('postgres'));try{await probe.connect();admin=probe;break;}catch{await probe.end().catch(()=>{});await sleep(100);}
  }
  if(!admin)throw new Error('Isolated PostgreSQL did not start; see local server.log');
  assert.equal(path.resolve((await scalar("select current_setting('data_directory') as directory")).directory).toLowerCase(),path.resolve(data).toLowerCase());
  await admin.query('create database perrun_1b');await admin.end();admin=new Client(options('perrun_1b'));await admin.connect();
  a=new Client(options('perrun_1b'));b=new Client(options('perrun_1b'));await Promise.all([a.connect(),b.connect()]);
  evidence.version=(await scalar('show server_version')).server_version;
  evidence.connections={A:(await a.query('select pg_backend_pid() as pid')).rows[0].pid,B:(await b.query('select pg_backend_pid() as pid')).rows[0].pid};
  assert.notEqual(evidence.connections.A,evidence.connections.B);evidence.dataDirectory=data;evidence.port=port;
  console.log('POSTGRES_NATIVE_VERSION='+evidence.version);console.log('INDEPENDENT_BACKENDS='+evidence.connections.A+','+evidence.connections.B);
  await installFixture(execAdapter(admin),root);
  await check('local reference with Windows CRLF preserves behavior and passes normalized drift guard',async()=>{
    const sql=fs.readFileSync(path.join(root,'desc','sql-finalize-paid-order-pr4.sql'),'utf8').replace(/\r?\n/g,'\r\n');
    await admin.query(sql);
    assert.ok(Number((await scalar("select strpos(prosrc,chr(13)) as position from pg_proc where oid='public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)'::regprocedure")).position)>0);
  });
  const original=await fingerprint();
  await legacyModernTests();
  await check('migration lock timeout rolls back DDL when existing registrations are busy',async()=>{
    await b.query("begin; update public.inscripciones set full_name=full_name where order_session_id='cs_native_modern'");
    const started=performance.now();await assert.rejects(a.query(migration),/lock timeout/);evidence.lockTimeoutDurationMs=Number((performance.now()-started).toFixed(2));
    await a.query('rollback');await b.query('rollback');assert.deepEqual(await fingerprint(),original);
    assert.equal((await scalar("select to_regclass('public.registration_dogs') as object")).object,null);
  });
  await check('migration relation locks observed; rollback releases waiting existing-race finalizer',async()=>{
    await a.query(migration.replace(/commit;\s*$/i,''));
    const locks=(await admin.query("select l.mode,l.granted from pg_locks l where l.pid=$1 and l.relation='public.inscripciones'::regclass order by mode",[evidence.connections.A])).rows;
    evidence.migrationLocks=locks;assert.ok(locks.some(x=>x.mode==='AccessExclusiveLock'&&x.granted));
    await begin(b);
    const pending=b.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',['cs_migration_waiting','axolote-night-run','5K',450,'test@example.invalid','pi_migration_waiting','evt_migration_waiting',JSON.stringify([human])]).then(value=>({value}),error=>({error}));
    const blocked=await blockedBy(evidence.connections.B,evidence.connections.A);assert.equal(blocked.wait_event_type,'Lock');assert.equal(blocked.wait_event,'relation');
    await a.query('rollback');const result=await pending;if(result.error)throw result.error;assert.equal(result.value.rows.length,1);await b.query('commit');
    assert.deepEqual(await fingerprint(),original);
  });
  const paidBefore=(await admin.query('select * from public.inscripciones order by order_session_id')).rows;
  await check('migration succeeds over real composite PK, constraints/indexes and reconciled function',async()=>{const t=performance.now();await admin.query(migration);evidence.migrationDurationMs=Number((performance.now()-t).toFixed(2));assert.deepEqual((await admin.query('select * from public.inscripciones order by order_session_id')).rows,paidBefore);});
  await check('pre-launch rollback preserves existing paid races and restores exact prior schema',async()=>{await admin.query(rollback);assert.deepEqual(await fingerprint(),original);assert.deepEqual((await admin.query('select * from public.inscripciones order by order_session_id')).rows,paidBefore);assert.equal((await scalar("select to_regclass('public.registration_dogs') as object")).object,null);});
  await check('previous schema functions remain usable after rollback',async()=>{await admin.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',['cs_after_rollback','axolote-night-run','5K',450,'test@example.invalid','pi_after_rollback','evt_after_rollback',JSON.stringify([human])]);});
  await admin.query(migration);
  await check('browser roles denied every table operation and new RPC, service cannot mutate ledger directly',async()=>{
    for(const table of ['perrun_checkout_orders','perrun_paid_dog_counter','registration_dogs','perrun_engraving_payments'])for(const role of ['anon','authenticated'])for(const operation of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await scalar('select has_table_privilege($1,$2,$3) as allowed',[role,'public.'+table,operation])).allowed,false);
    for(const signature of ['public.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz)','public.finalize_perrun_paid_order(text,text,text,integer,text)']){for(const role of ['anon','authenticated'])assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed',[role,signature,'EXECUTE'])).allowed,false);assert.equal((await scalar("select has_function_privilege('service_role',$1,'EXECUTE') as allowed",[signature])).allowed,true);}
    assert.equal((await scalar("select has_table_privilege('service_role','public.perrun_paid_dog_counter','UPDATE') as allowed")).allowed,false);
  });
  for(const firstIsA of [true,false]){
    await check('A: 298 + two/one dogs, '+(firstIsA?'two-dog':'one-dog')+' order wins lock',async()=>{
      await reset(298);await prepare('cs_A_two',2);await prepare('cs_A_one',1);
      await simultaneous(firstIsA?'cs_A_two':'cs_A_one',firstIsA?2:1,firstIsA?'cs_A_one':'cs_A_two',firstIsA?1:2,298);
      const rows=await verifyPositions(298,3);evidence.concurrency.push({scenario:'A',first:firstIsA?'two':'one',result:'PASS',positions:rows});
    });
  }
  await check('B: same order in two simultaneous backend RPCs finalizes only once',async()=>{
    await reset(298);await prepare('cs_B_same',2);const [left,right]=await simultaneous('cs_B_same',2,'cs_B_same',2,298);assert.deepEqual(right,left);
    const rows=await verifyPositions(298,2);assert.equal(Number((await scalar("select count(*)::integer as n from public.inscripciones where order_session_id='cs_B_same'")).n),1);
    assert.equal(Number((await scalar('select count(*)::integer as n from public.registration_dogs')).n),2);evidence.concurrency.push({scenario:'B',result:'PASS',positions:rows});
  });
  for(const firstIsA of [true,false]){
    await check('C: 297 + two/two dogs, '+(firstIsA?'A':'B')+' first, deterministic dog_index',async()=>{
      await reset(297);await prepare('cs_C_left',2);await prepare('cs_C_right',2);
      const [left,right]=await simultaneous(firstIsA?'cs_C_left':'cs_C_right',2,firstIsA?'cs_C_right':'cs_C_left',2,297);
      assert.deepEqual(left.map(x=>[x.dog_index,Number(x.engraving_sequence)]),[[1,298],[2,299]]);assert.deepEqual(right.map(x=>[x.dog_index,Number(x.engraving_sequence)]),[[1,300],[2,301]]);
      const rows=await verifyPositions(297,4);evidence.concurrency.push({scenario:'C',first:firstIsA?'A':'B',result:'PASS',positions:rows});
    });
  }
  await check('D: deliberate failure after writes rolls back and waiting order takes unconsumed positions',async()=>{
    await reset(298);await prepare('cs_D_fail',2);await prepare('cs_D_success',1);
    await admin.query("create function public.inject_perrun_failure() returns trigger language plpgsql as $$ begin if new.order_session_id='cs_D_fail' and new.finalized_at is not null then raise exception 'deliberate failure after dogs/counter'; end if; return new; end $$; create trigger inject_perrun_failure before update on public.perrun_checkout_orders for each row execute function public.inject_perrun_failure();");
    await begin(a);await begin(b);await a.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");
    const pending=finalize(b,'cs_D_success',1).then(value=>({value}),error=>({error}));await blockedBy(evidence.connections.B,evidence.connections.A);
    await assert.rejects(finalize(a,'cs_D_fail',2),/deliberate failure after dogs\/counter/);await a.query('rollback');
    const waited=await pending;if(waited.error)throw waited.error;await b.query('commit');
    assert.equal((await admin.query("select * from public.inscripciones where order_session_id='cs_D_fail'")).rows.length,0);
    assert.equal((await admin.query("select * from public.registration_dogs where order_session_id='cs_D_fail'")).rows.length,0);
    assert.equal((await scalar("select finalized_at from public.perrun_checkout_orders where order_session_id='cs_D_fail'")).finalized_at,null);
    let rows=await verifyPositions(298,1);assert.equal(rows[0].position,299);
    await admin.query('drop trigger inject_perrun_failure on public.perrun_checkout_orders; drop function public.inject_perrun_failure()');
    await finalize(a,'cs_D_fail',2);rows=await verifyPositions(298,3);evidence.concurrency.push({scenario:'D',result:'PASS',positions:rows});
  });
  await check('repeated webhook after concurrency does not allocate again',async()=>{const before=Number((await scalar('select last_sequence from public.perrun_paid_dog_counter')).last_sequence);const first=(await finalize(a,'cs_D_fail',2)).rows;assert.deepEqual((await finalize(b,'cs_D_fail',2)).rows,first);assert.equal(Number((await scalar('select last_sequence from public.perrun_paid_dog_counter')).last_sequence),before);});
  await check('post-launch rollback refuses history without altering data',async()=>{const before=await fingerprint();await assert.rejects(admin.query(rollback),/Rollback refused/);await admin.query('rollback');assert.deepEqual(await fingerprint(),before);await verifyPositions(298,3);});
  // Optional 4A tests; the original 19 Phase 1 checks run unchanged first.
  if(process.argv[5]==='--payment-state')await require('./perrun-payment-state-native.cjs')({admin,a,b,check,blockedBy,evidence,prepare,finalize,reset,simultaneous,verifyPositions});
  if(process.argv[6]==='--webhook')await require('./perrun-webhook-native.cjs')({admin,a,b,check,blockedBy,evidence,prepare,reset,verifyPositions});
  if(process.argv[7]==='--engraving')await require('./perrun-engraving-native.cjs')({admin,a,b,check,blockedBy,evidence});
  if(process.argv[8]==='--engraving-flow')await require('./perrun-engraving-flow-native.cjs')({admin,a,b,check,blockedBy,evidence});
  evidence.migrationSHA256=crypto.createHash('sha256').update(migration).digest('hex');
  evidence.result='PASS';console.log('NATIVE_POSTGRES_PASS='+evidence.checks.length);console.log('CONCURRENT_SCENARIO_RUNS='+evidence.concurrency.length);
})().catch(error=>{evidence.result='FAIL';evidence.error=error.message;console.error('FAIL '+error.message);process.exitCode=1;}).finally(async()=>{
  for(const client of [a,b,admin])if(client)await client.end().catch(()=>{});
  if(server){const stopped=cp.spawnSync(path.join(bin,'pg_ctl.exe'),['-D',data,'stop','-m','fast','-w'],{windowsHide:true,encoding:'utf8',env:childEnv});evidence.serverStopped=stopped.status===0;if(stopped.status!==0){process.exitCode=1;console.error('Isolated server stop failed');}}
  if(logFd!==undefined)fs.closeSync(logFd);
  if(process.argv[4])fs.writeFileSync(path.resolve(process.argv[4]),JSON.stringify(evidence,null,2)+'\n');
});
