'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {runShadowOnce}=require('../lib/ai/support-shadow-worker');

const migrations=['20261117145659_support_phase_one.sql','20261119021334_support_agent_atomic_ack.sql',
  '20261119022000_support_human_takeover.sql','20261119030000_support_ai_evaluation_quota.sql',
  '20261119040000_support_ai_shadow_queue.sql'];
async function setup(t){
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const f of migrations)await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
  const scalar=async(s,params)=>(await db.query(s,params)).rows[0]?.v;
  const tool=async(name,args)=>{const keys=Object.keys(args);const data=await scalar(
    'select public.'+name+'('+keys.map((k,i)=>k+' => $'+(i+1)).join(',')+') as v',Object.values(args));return {data};};
  const visit=async(action,hash,request=randomUUID(),body='Horario de kits de Perrun')=>scalar(
    "select support_visitor_action($1,$2,$3,$4,'general') as v",[action,hash,request,body]);
  const config=async tenant=>db.query("insert into support_ai_limits values ($1,true,'fixture-model',10,100000,750000,4500000)",[tenant]);
  const seed=async(hash='a'.repeat(64),tenant='kinetichub')=>{
    const start=await visit('start',hash);
    await db.query('insert into support_ai_ticket_scope values ($1,$2,now(),true)',[start.ticket.id,tenant]);
    return start;
  };
  return {db,scalar,tool,visit,config,seed};
}

test('intake is opt-in, atomic, source-bound and duplicate-safe; acuse is not queued',async t=>{
  const {db,scalar,visit,config,seed}=await setup(t);
  await config('kinetichub'); await config('other');
  const hash='a'.repeat(64), id=randomUUID(), start=await seed(hash);
  assert.equal(await scalar('select count(*)::int as v from support_ai_jobs'),0);
  await db.query('select support_agent_acknowledge_first($1,$2,$3,now()-interval \'1 hour\')',
    [start.ticket.id,start.messages[0].id,'Recibimos tu solicitud.']);
  assert.equal(await scalar('select count(*)::int as v from support_ai_jobs'),0);
  const sent=await visit('send',hash,id);
  assert.deepEqual(await visit('send',hash,id),sent);
  assert.equal((await visit('send',hash,id,'different')).error,'conflict');
  assert.equal((await visit('read',hash)).ticket.id,start.ticket.id);
  assert.equal(await scalar('select count(*)::int as v from support_ai_jobs'),1);
  const other=await seed('b'.repeat(64),'other');
  await assert.rejects(db.query('insert into support_ai_jobs(tenant_id,ticket_id,source_message_id,ticket_version) values ($1,$2,$3,1)',
    ['other',other.ticket.id,start.messages[0].id]),/foreign key/);
  const claim=await scalar("select claim_support_shadow_job('kinetichub') as v");
  assert.equal((await scalar("select gate_support_shadow_job('other',$1,$2) as v",[claim.id,claim.token])).state,'denied');
  for(const role of ['anon','authenticated','service_role']) {
    assert.equal(await scalar("select has_table_privilege($1,'public.support_ai_proposals','SELECT') as v",[role]),false);
    assert.equal(await scalar("select has_function_privilege($1,'public.claim_support_shadow_job(text)','EXECUTE') as v",[role]),role==='service_role');
  }
  await db.exec("create function reject_shadow() returns trigger language plpgsql as $$begin raise exception 'queue failure'; end$$; create trigger fail_insert before insert on support_ai_jobs for each row execute function reject_shadow();");
  await assert.rejects(visit('send',hash),/queue failure/);
  assert.equal((await visit('read',hash)).ticket.version,sent.ticket.version);
});

test('lease recovery before reservation fences the old owner; after reserve it becomes uncertain',async t=>{
  const {db,scalar,tool,visit,config,seed}=await setup(t);
  await config('kinetichub');await seed();await visit('send','a'.repeat(64));
  const p_tenant='kinetichub';
  const claim=async()=> (await tool('claim_support_shadow_job',{p_tenant})).data;
  const first=await claim();
  assert.equal(await claim(),null);
  await db.exec("update support_ai_jobs set lease_until=now()-interval '1 second'");
  const second=await claim();
  assert.equal(second.id,first.id);assert.equal(second.attempt_id,first.attempt_id);assert.notEqual(second.token,first.token);
  const f={p_tenant,p_job:second.id,p_token:second.token};
  assert.equal((await tool('gate_support_shadow_job',{...f,p_token:first.token})).data.state,'denied');
  const reserve=()=>tool('gate_support_shadow_job',{...f,p_model:'fixture-model',p_input:800,p_output:96});
  assert.equal((await reserve()).data.state,'reserved');
  await db.exec("update support_ai_jobs set lease_until=now()-interval '1 second'");
  assert.deepEqual(await claim(),{state:'uncertain'});
  assert.equal(await claim(),null);
  assert.equal(await scalar('select count(*)::int as v from support_ai_attempts'),1);
});

test('human reply during simulated inference makes proposal obsolete and retains cost',async t=>{
  const {db,scalar,tool,visit,config,seed}=await setup(t);
  await config('kinetichub');await seed();const sent=await visit('send','a'.repeat(64));
  const env={SUPPORT_AI_SHADOW_ENABLED:'true',SUPPORT_AI_PRIVATE_ENABLED:'true',SUPPORT_AI_TENANT:'kinetichub',
    SUPPORT_AI_MODEL:'fixture-model',SUPPORT_AI_OPENAI_API_KEY:'fixture-only'};
  const opts={env,rpc:tool,now:()=>Date.UTC(2026,10,20)};
  assert.deepEqual(await runShadowOnce({...opts,env:{...env,SUPPORT_AI_SHADOW_ENABLED:'false'}}),{state:'disabled'});
  let calls=0;
  const r=await runShadowOnce({...opts,fetchImpl:async(_url,x)=>{
    calls++;const body=JSON.parse(x.body);assert.deepEqual(JSON.parse(body.input).history,[]);assert.equal(body.store,false);
    await db.query("select support_admin_action($1,$2,$3,'reply','Respuesta humana',null,null,null,false,'operator')",
      [sent.ticket.id,randomUUID(),sent.ticket.version]);
    return {ok:true,json:async()=>({status:'completed',model:'fixture-model',usage:{input_tokens:90,output_tokens:21},
      output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"decision":"respond","reason":"none","source_id":"perrun-kit"}'}]}]})};
  }});
  assert.deepEqual(r,{state:'obsolete'});assert.equal(calls,1);
  assert.equal(await scalar('select state as v from support_ai_proposals'),'obsolete');
  assert.equal(await scalar('select output_tokens as v from support_ai_attempts'),21);
  assert.equal(await scalar("select count(*)::int as v from support_messages where provenance='ai_generated'"),0);
  assert.deepEqual(await runShadowOnce(opts),{state:'empty'});
});

test('unverified legacy and reopen with intervention never qualify; quota and timeout stay private',async t=>{
  const {db,scalar,tool,visit,config,seed}=await setup(t);
  await config('kinetichub');
  const hash='a'.repeat(64);const start=await seed(hash);
  await db.query('update support_messages set provenance=null where ticket_id=$1',[start.ticket.id]);
  await visit('send',hash);
  await db.query("update support_tickets set status='resolved',automation_paused_at=now() where id=$1",[start.ticket.id]);
  assert.equal((await visit('send',hash)).ticket.status,'pending');
  assert.equal(await scalar('select count(*)::int as v from support_ai_jobs'),0);
  await seed('b'.repeat(64));await visit('send','b'.repeat(64));
  const env={SUPPORT_AI_SHADOW_ENABLED:'true',SUPPORT_AI_PRIVATE_ENABLED:'true',SUPPORT_AI_TENANT:'kinetichub',
    SUPPORT_AI_MODEL:'fixture-model',SUPPORT_AI_OPENAI_API_KEY:'fixture-only'};
  const opts={env,rpc:tool,now:()=>Date.UTC(2026,10,20)};
  await db.exec("update support_ai_limits set daily_budget_micros=1 where tenant_id='kinetichub'");
  assert.deepEqual(await runShadowOnce({...opts,fetchImpl:async()=>assert.fail('unreserved fetch')}),{state:'skipped'});
  await db.exec("update support_ai_limits set daily_budget_micros=100000 where tenant_id='kinetichub'");
  await visit('send','b'.repeat(64));
  let calls=0;
  assert.deepEqual(await runShadowOnce({...opts,limits:{timeoutMs:100},fetchImpl:async()=>{calls++;return new Promise(()=>{});}}),{state:'uncertain'});
  assert.equal(calls,1);
  assert.equal(await scalar("select count(*)::int as v from support_ai_attempts where input_tokens is null"),1);
  assert.equal(await scalar('select count(*)::int as v from support_ai_proposals'),0);
});

test('a current proposal permanently invalidates on version change or close, even after reopen',async t=>{
  const {db,scalar,tool,visit,config,seed}=await setup(t);
  await config('kinetichub'); await seed();
  const hash='a'.repeat(64);
  const sent=await visit('send',hash);
  const p_tenant='kinetichub';
  const j=(await tool('claim_support_shadow_job',{p_tenant})).data;
  const args={p_tenant,p_job:j.id,p_token:j.token,p_status:'proposal',p_knowledge:'fixture-v1',
    p_model:'fixture-model',p_decision:'escalate',p_reason:'insufficient_information'};
  assert.equal((await tool('finish_support_shadow_job',args)).data,'completed');
  assert.equal(await scalar('select state as v from support_ai_proposals'),'current');
  await db.query("update support_tickets set status='resolved',version=version+1 where id=$1",[sent.ticket.id]);
  assert.equal(await scalar('select state as v from support_ai_proposals'),'obsolete');
  assert.equal((await visit('send',hash)).ticket.status,'pending');
  assert.equal((await tool('finish_support_shadow_job',args)).data,'denied');
  assert.equal(await scalar('select state as v from support_ai_proposals'),'obsolete');
  const latest=(await tool('claim_support_shadow_job',{p_tenant})).data;
  assert.notEqual(latest.id,j.id);
  await visit('send',hash);
  assert.equal((await tool('gate_support_shadow_job',{p_tenant,p_job:latest.id,p_token:latest.token})).data.state,'obsolete');
});
