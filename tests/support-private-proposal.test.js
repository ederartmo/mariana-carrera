'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const handler=require('../lib/admin-support');
const {privateProposal}=require('../lib/ai/support-private-proposal');
const kb=require('../lib/ai/kinetichub-knowledge');
const env={SUPPORT_AI_TENANT:'kinetichub',SUPPORT_AI_SHADOW_ENABLED:'true',SUPPORT_AI_PRIVATE_ENABLED:'true'};

test('private detail projects approved knowledge, and never trusts stored text or browser tenant',async()=>{
  const ticket={id:randomUUID(),version:3};
  const calls=[];
  const client={rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='support_admin_detail')return {data:{ticket,messages:[]}};
    return {data:{eligible:true,proposal:{state:'current',source:'contact-chat',knowledge:kb.version,
      decision:'respond',text:'untrusted text',tenant:'other'}}};
  }};
  const res=()=>({headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  for(const status of [401,403]){
    const denied=res();
    await handler({method:'GET',query:{id:ticket.id}},denied,{client,auth:async()=>({error:'denied',status}),proposalEnv:env});
    assert.equal(denied.code,status);
  }
  assert.equal(calls.length,0);
  const options={client,auth:async()=>({user:{id:randomUUID()}}),proposalEnv:env};
  const modified=res();
  await handler({method:'GET',query:{id:ticket.id,tenant:'other'}},modified,options);
  assert.equal(modified.code,400);
  const reply=res();
  await handler({method:'GET',query:{id:ticket.id}},reply,options);
  assert.equal(reply.code,200);assert.equal(reply.headers['cache-control'],'no-store');
  assert.deepEqual(reply.body.ai,{paused:false,proposal:{state:'current',source:'contact-chat',
    text:kb.sources.find(s=>s.id==='contact-chat').text,decision:'respond'}});
  assert.deepEqual(calls.at(-1),['support_admin_proposal',{p_tenant:'kinetichub',p_ticket:ticket.id,p_version:3}]);
  assert.ok(!JSON.stringify(reply.body).includes('untrusted text'));
  const expired=await privateProposal({rpc:async()=>({data:{eligible:true,proposal:{decision:'respond',state:'current',
    source:'perrun-kit',knowledge:kb.version}}})},ticket,{SUPPORT_AI_TENANT:'kinetichub'},Date.UTC(2028,0,1));
  assert.deepEqual(expired,{paused:true,proposal:{state:'obsolete',source:'perrun-kit',text:null,decision:'respond'}});
  const oldEscalation=await privateProposal({rpc:async()=>({data:{eligible:true,
    proposal:{decision:'escalate',state:'current',knowledge:'superseded'}}})},ticket,env);
  assert.equal(oldEscalation.proposal.state,'obsolete');
});

test('SQL binds tenant and version, detects obsolete state and grants the projection only to service role',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const version of ['20261117145659_support_phase_one','20261119021334_support_agent_atomic_ack',
    '20261119022000_support_human_takeover','20261119030000_support_ai_evaluation_quota','20261119040000_support_ai_shadow_queue',
    '20261119050000_support_private_proposal_read'])await db.exec(readFileSync('supabase/migrations/'+version+'.sql','utf8'));
  const val=async(s,p)=>(await db.query(s,p)).rows[0]?.v;
  for(const role of ['anon','authenticated','service_role']){
    assert.equal(await val("select has_function_privilege($1,'public.support_admin_proposal(text,uuid,integer)','EXECUTE') as v",[role]),role==='service_role');
    assert.equal(await val("select has_table_privilege($1,'public.support_ai_proposals','SELECT') as v",[role]),false);
  }
  const hash='a'.repeat(64);
  await db.exec("insert into support_ai_limits values ('kinetichub',true,'simulated',2,10000,750000,4500000);");
  const opened=await val("select support_visitor_action('start',$1,$2,'fixture','general') as v",[hash,randomUUID()]);
  await db.query("insert into support_ai_ticket_scope values ($1,'kinetichub',now(),true)",[opened.ticket.id]);
  const sent=await val("select support_visitor_action('send',$1,$2,'Contacto de soporte') as v",[hash,randomUUID()]);
  await db.query("insert into support_ai_proposals(job_id,tenant_id,knowledge_version,model,decision,source_id,state) select id,tenant_id,$1,'simulated','respond','contact-chat','current' from support_ai_jobs",[kb.version]);
  const state=(tenant,id,version)=>val('select support_admin_proposal($1,$2,$3) as v',[tenant,id,version]);
  assert.equal((await state('kinetichub',sent.ticket.id,sent.ticket.version)).proposal.state,'current');
  assert.equal(await state('other',sent.ticket.id,sent.ticket.version),null);
  assert.equal(await state('kinetichub',randomUUID(),sent.ticket.version),null);
  assert.equal(await state('kinetichub',sent.ticket.id,sent.ticket.version+1),null);
  await db.query('update support_ai_ticket_scope set enabled=false where ticket_id=$1',[sent.ticket.id]);
  assert.equal((await state('kinetichub',sent.ticket.id,sent.ticket.version)).proposal.state,'obsolete');
});
