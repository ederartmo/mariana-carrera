'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createPrivateResponsesProvider}=require('../lib/ai/private-responses-provider');
const {runMockEvaluation}=require('../scripts/support-ai-private-eval');

const env={SUPPORT_AI_TENANT:'kinetichub',SUPPORT_AI_PRIVATE_ENABLED:'true',SUPPORT_AI_MODEL:'fixture-model',
  SUPPORT_AI_OPENAI_API_KEY:'not-a-real-key'};
const attemptId='00000000-0000-4000-8000-000000000001';
const payload={model:env.SUPPORT_AI_MODEL,input:'synthetic',instructions:'fixture',max_output_tokens:96,text:{}};

test('27 private fixtures have no prompt or response text in report',async()=>{
  const rows=await runMockEvaluation();
  assert.equal(rows.length,27);
  assert.deepEqual(rows.filter(r=>!r.pass),[]);
  assert.deepEqual(Object.keys(rows[0]),['id','decision','source','reason','pass']);
});

test('transport reserves before fixed Responses POST and records usage without a network call',async()=>{
  const events=[];
  const adapter=createPrivateResponsesProvider({env,attemptId,rpc:async(name)=>{
    events.push(name);return {data:name.startsWith('reserve')?'reserved':true};
  },fetchImpl:async(url,options)=>{
    events.push('fake-fetch');
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);assert.deepEqual(body.tools,[]);
    return {ok:true,json:async()=>({model:env.SUPPORT_AI_MODEL,output:[{type:'reasoning'},{type:'message'}],
      usage:{input_tokens:20,output_tokens:30}})};
  }});
  const args={tenantId:'kinetichub',signal:new AbortController().signal};
  await assert.rejects(adapter(payload,{...args,tenantId:'foreign'}),/blocked/);
  assert.deepEqual((await adapter(payload,args)).output,[{type:'message'}]);
  await assert.rejects(adapter(payload,args),/blocked/);
  assert.deepEqual(events,['reserve_support_ai_attempt','fake-fetch','record_support_ai_usage']);
});

test('disabled, denied and uncertain attempts do not retry or refund',async()=>{
  assert.equal(createPrivateResponsesProvider({env:{...env,SUPPORT_AI_PRIVATE_ENABLED:'false'},attemptId}),undefined);
  let posts=0;
  const fake=async()=>{posts++;throw Error('private provider details');};
  const args={tenantId:'kinetichub',signal:new AbortController().signal};
  for(const data of ['duplicate','disabled','rate_limit','budget_limit','reserved']){
    const provider=createPrivateResponsesProvider({env,attemptId,rpc:async()=>({data}),fetchImpl:fake});
    await assert.rejects(provider(payload,args),/^Error: private_provider_failed$/);
    await assert.rejects(provider(payload,args),/blocked/);
  }
  assert.equal(posts,1);
});

test('isolated ledger: quotas, SQL ACL, idempotency and tenant isolation',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/migrations/20261119030000_support_ai_evaluation_quota.sql','utf8'));
    await db.exec("insert into support_ai_limits values ('kinetichub',true,'fixture-model',2,700,250000,2000000),('other',true,'fixture-model',1,1000,250000,2000000);");
    const id2='00000000-0000-4000-8000-000000000002';
    const reserve=async(t,id,n=600)=>(await db.query("select reserve_support_ai_attempt($1,$2,'fixture-model',$3,96) as result",[t,id,n])).rows[0].result;
    await db.exec('set role anon');
    await assert.rejects(reserve('kinetichub',attemptId),/permission denied/);
    await db.exec('reset role; set role service_role');
    const same=await Promise.all([reserve('kinetichub',attemptId),reserve('kinetichub',attemptId)]);
    assert.deepEqual(same.sort(),['duplicate','reserved']);
    assert.equal(await reserve('kinetichub',id2,2000),'budget_limit');
    assert.equal(await reserve('other',attemptId),'reserved');
    assert.equal(await reserve('other',id2),'rate_limit');
    const record=async(t)=>(await db.query('select record_support_ai_usage($1,$2,100,20) as result',[t,attemptId])).rows[0].result;
    assert.equal(await record('missing'),false);
    assert.equal(await record('kinetichub'),true);
    assert.equal(await record('kinetichub'),false);
    assert.equal(await reserve('kinetichub',id2,2000),'budget_limit');
    await assert.rejects(db.query('select * from support_ai_attempts'),/permission denied/);
    await db.exec("reset role; update support_ai_limits set enabled=false where tenant_id='kinetichub'; set role service_role;");
    assert.equal(await reserve('kinetichub',id2),'disabled');
  }finally{await db.close();}
});


test('internal composition screens synthetic context before RPC and never publishes',async()=>{
  const {evaluatePrivately}=require('../lib/ai/private-evaluation');
  const calls=[];
  const context={tenantId:'kinetichub',status:'pending',automationPausedAt:null,
    humanIntervened:false,historyVerified:true};
  const fixed={env,attemptId,now:()=>Date.UTC(2026,10,19),rpc:async(name)=>{
    calls.push(name); return {data:name.startsWith('reserve')?'reserved':true};
  },fetchImpl:async(_url,opts)=>{
    calls.push('fake-fetch');
    assert.equal(opts.signal instanceof AbortSignal,true);
    const body=JSON.parse(opts.body);
    assert.deepEqual(JSON.parse(body.input).history,[]);
    return {ok:true,json:async()=>({model:env.SUPPORT_AI_MODEL,status:'completed',
      output:[{type:'reasoning'},{type:'message',role:'assistant',content:[{type:'output_text',
      text:'{"decision":"respond","source_id":"perrun-kit","reason":"none"}'}]}],
      usage:{input_tokens:100,output_tokens:20}})};
  }};
  const input={message:'Horario de kits de Perrun',context};
  for(const invalid of [
    {...input,history:[{tenantId:'kinetichub',role:'visitor',text:'synthetic'}]},
    {...input,context:{...context,historyVerified:false}},
    {...input,context:{...context,humanIntervened:true}},
    {...input,context:{...context,tenantId:'other'}},
  ]) assert.equal((await evaluatePrivately({...fixed,input:invalid})).decision,'escalate');
  assert.deepEqual(calls,[]);
  const proposal=await evaluatePrivately({...fixed,input});
  assert.equal(proposal.decision,'respond');
  assert.equal(proposal.sources[0].id,'perrun-kit');
  assert.deepEqual(calls,['reserve_support_ai_attempt','fake-fetch','record_support_ai_usage']);
});
