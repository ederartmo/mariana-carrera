'use strict';
const {spawn,execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const {setTimeout:wait}=require('node:timers/promises');

const name='support-shadow-qa-'+randomUUID();
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:20000}).trim();
const psql=['psql','-X','-Atq','-v','ON_ERROR_STOP=1','-U','postgres'];
const sql=body=>docker(['exec','-i',name,...psql],body);
const sources=['20261117145659_support_phase_one.sql','20261119021334_support_agent_atomic_ack.sql',
 '20261119022000_support_human_takeover.sql','20261119030000_support_ai_evaluation_quota.sql'];
const migration=f=>readFileSync('supabase/migrations/'+f,'utf8');
const run=(cmd)=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',name,...psql],{stdio:['pipe','pipe','pipe']});
 let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
 child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));
 child.stdin.end(cmd);
});
const latency=(enabled=false)=>Number(sql("begin; select support_visitor_action('start',repeat('c',64),gen_random_uuid(),'synthetic','general') is not null; "+(enabled?"insert into support_ai_ticket_scope select t.id,'kinetichub',now(),true from support_tickets t join support_conversations c on c.id=t.conversation_id where c.capability_hash=repeat('c',64); ":"")+"do $$ declare t timestamptz:=clock_timestamp(); begin for i in 1..200 loop perform support_visitor_action('send',repeat('c',64),gen_random_uuid(),'synthetic'); end loop; perform set_config('qa.elapsed',extract(epoch from clock_timestamp()-t)::text,true); end $$; select current_setting('qa.elapsed'); rollback;").split(/\r?\n/).at(-1))*5;
const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];

async function main(){
 docker(['run','--rm','--detach','--pull','never','--network','none','--name',name,'-e',
  'POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.11-bookworm']);
 try {
  let ready=false;
  for(let i=0;i<45&&!ready;i++){try{ready=sql('show listen_addresses;')==='*';}catch{}if(!ready)await wait(200);}
  assert.ok(ready);
  sql('create role anon; create role authenticated; create role service_role;\n'+sources.map(migration).join('\n'));
  latency(); const baseline=median(Array.from({length:5},()=>latency(false)));
  sql(migration('20261119040000_support_ai_shadow_queue.sql'));
  latency(); const disabled=median(Array.from({length:5},()=>latency(false)));
  assert.equal(sql('select count(*) from support_ai_jobs;'),'0');
  sql("insert into support_ai_limits values ('kinetichub',true,'fixture',10,60000,750000,4500000); select support_visitor_action('start',repeat('a',64),gen_random_uuid(),'synthetic','general'); insert into support_ai_ticket_scope select id,'kinetichub',now(),true from support_tickets; select support_visitor_action('send',repeat('a',64),gen_random_uuid(),'synthetic');");
  latency(true); const enabled=median(Array.from({length:5},()=>latency(true)));
  const q="select claim_support_shadow_job('kinetichub');";
  const first=run("set application_name='shadow_first';begin;set local role service_role;"+q+"select pg_sleep(6);commit;");
  let sleeping=false;
  for(let i=0;i<25&&!sleeping;i++){
   sleeping=sql("select exists(select from pg_stat_activity where application_name='shadow_first' and wait_event='PgSleep');")==='t';
   if(!sleeping)await wait(120);
  }
  assert.ok(sleeping);
  const second=await run('set role service_role;'+q);
  assert.equal(second,'');
  const initial=JSON.parse((await first).split(/\r?\n/)[0]);
  assert.equal(initial.state,'claimed');
  assert.equal(sql("select count(*) from support_ai_jobs where state='claimed';"),'1');
  console.log('PASS: independent concurrent claim; one winner and one skipped lock');
  sql("update support_ai_jobs set lease_until=now()-interval '1 second';");
  const reclaimed=JSON.parse(await run('set role service_role;'+q));
  assert.equal(reclaimed.id,initial.id);
  assert.notEqual(reclaimed.token,initial.token);
  const gate=token=>"select gate_support_shadow_job('kinetichub','"+reclaimed.id+"','"+token+"','fixture',600,96)->>'state';";
  assert.equal(await run('set role service_role;'+gate(initial.token)),'denied');
  assert.equal(await run('set role service_role;'+gate(reclaimed.token)),'reserved');
  assert.equal(await run("set role service_role; select record_support_ai_usage('kinetichub','"+reclaimed.attempt_id+"',100,20);"),'t');
  const admin=run("set application_name='shadow_human';begin;select support_admin_action(id,gen_random_uuid(),version,'reply','synthetic operator reply',null,null,null,false,'operator') from support_tickets;select pg_sleep(6);commit;");
  let waiting=false;
  for(let i=0;i<25&&!waiting;i++){
   waiting=sql("select exists(select from pg_stat_activity where application_name='shadow_human' and wait_event='PgSleep');")==='t';
   if(!waiting)await wait(120);
  }
  assert.ok(waiting);
  const final=run("set application_name='shadow_finish';set role service_role;select finish_support_shadow_job('kinetichub','"+reclaimed.id+"','"+reclaimed.token+"','proposal','fixture','fixture','respond','perrun-kit',null);");
  let blocked=false;
  for(let i=0;i<25&&!blocked;i++){
   blocked=sql("select exists(select from pg_stat_activity where application_name='shadow_finish' and wait_event_type='Lock');")==='t';
   if(!blocked)await wait(120);
  }
  assert.ok(blocked);
  assert.equal(await final,'obsolete');
  await admin;
  assert.equal(sql('select state from support_ai_proposals;'),'obsolete');
  console.log('PASS: independent lease fencing and human reply/finalization contention');
  console.log(JSON.stringify({baselineMsPerSend:baseline,disabledMsPerSend:disabled,enabledMsPerSend:enabled,sendsPerSample:200,samples:5}));
 }finally{docker(['stop','--time','1',name]);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
