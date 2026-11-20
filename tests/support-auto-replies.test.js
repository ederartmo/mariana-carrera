'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const handler=require('../lib/support-chat');
const kb=require('../lib/ai/kinetichub-knowledge');

test('visitor gets approved automatic text, human handoff and no replies after takeover',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const f of ['20261117145659_support_phase_one','20261119021334_support_agent_atomic_ack','20261119022000_support_human_takeover',
    '20261119030000_support_ai_evaluation_quota','20261119040000_support_ai_shadow_queue','20261119050000_support_private_proposal_read',
    '20261119060000_support_auto_replies'])await db.exec(readFileSync('supabase/migrations/'+f+'.sql','utf8'));
  await db.exec("insert into support_ai_limits values ('kinetichub',true,'simulated',30,100000,750000,4500000);");
  for(const role of ['anon','authenticated','service_role']){
    const {rows}=await db.query("select has_function_privilege($1,'public.support_auto_claim(text,uuid,uuid,timestamp with time zone)','EXECUTE') as claim, has_function_privilege($1,'public.support_auto_finish(text,uuid,uuid,text,text,text,text,text,text,text)','EXECUTE') as finish",[role]);
    assert.deepEqual(rows[0],{claim:role==='service_role',finish:role==='service_role'});
  }
  const env={SUPPORT_AI_TENANT:'kinetichub',SUPPORT_AI_SHADOW_ENABLED:'true',SUPPORT_AI_PRIVATE_ENABLED:'true',
    SUPPORT_AI_AUTO_REPLY_ENABLED:'true',SUPPORT_AI_AUTO_REPLY_START_AT:new Date(Date.now()-30000).toISOString(),
    SUPPORT_AI_MODEL:'simulated',SUPPORT_AI_OPENAI_API_KEY:'fixture-only'};
  let posts=0, intervention, unavailable=false;
  const rpc=async(name,args)=>{
    const keys=Object.keys(args);
    const {rows}=await db.query('select public.'+name+'('+keys.map((k,i)=>k+' => $'+(i+1)).join(',')+') as data',Object.values(args));
    return {data:rows[0]?.data};
  };
  const fake=async(_url,opts)=>{
    posts++;
    if(unavailable)return {ok:false,status:503};
    if(posts===1)await new Promise(resolve=>setTimeout(resolve,2500));
    const payload=JSON.parse(opts.body);
    assert.equal(payload.store,false);
    if(intervention)await intervention();
    return {ok:true,json:async()=>({status:'completed',model:'simulated',usage:{input_tokens:90,output_tokens:20},
      output:[{type:'message',role:'assistant',content:[{type:'output_text',
        text:'{"decision":"respond","reason":"none","source_id":"perrun-kit"}'}]}]})};
  };
  const invoke=async(body,override=env)=>{
    const res={setHeader(){},status(n){this.n=n;return this;},json(data){this.data=data;return this;}};
    await handler({method:'POST',headers:{origin:'https://kinetichub.com.mx','content-type':'application/json'},body},
      res,{env:override,rpc,rateLimit:async()=>({allowed:true}),autoFetch:fake});
    assert.equal(res.n,200);
    return res.data;
  };
  const payload={action:'start',token:'a'.repeat(64),body:'¿Dónde recojo mi kit de Perrun?',category:'events',website:'',requestId:randomUUID()};
  const visitor=await invoke(payload);
  const replies=data=>data.messages.filter(m=>m.provenance==='ai_generated');
  assert.equal(replies(visitor).length,1);
  assert.equal(replies(visitor)[0].body,kb.sources.find(s=>s.id==='perrun-kit').text);
  assert.equal(posts,1);
  assert.equal(replies(await invoke(payload)).length,1);
  assert.equal(posts,1);
  const unknown=await invoke({action:'send',token:payload.token,body:'Confirma si mi pago personal está acreditado',requestId:randomUUID()});
  assert.equal(replies(unknown).length,2);
  assert.match(replies(unknown).at(-1).body,/equipo de soporte revisará/);
  assert.equal(unknown.ticket.status,'pending');
  assert.equal(posts,1);
  await rpc('support_admin_action',{p_ticket_id:unknown.ticket.id,p_request_id:randomUUID(),p_expected_version:unknown.ticket.version,
    p_action:'reply',p_body:'Yo te atiendo.',p_actor:'operator'});
  const after=await invoke({action:'send',token:payload.token,body:payload.body,requestId:randomUUID()});
  assert.equal(replies(after).length,2);
  assert.equal(posts,1);
  const other=await invoke({...payload,token:'b'.repeat(64),requestId:randomUUID()},{...env,SUPPORT_AI_AUTO_REPLY_ENABLED:'false'});
  assert.equal(replies(other).length,0);
  assert.notEqual(other.ticket.id,after.ticket.id);
  intervention=async()=>{
    const {rows}=await db.query("select id,version from support_tickets where id=$1",[other.ticket.id]);
    await rpc('support_admin_action',{p_ticket_id:other.ticket.id,p_request_id:randomUUID(),
      p_expected_version:rows[0].version,p_action:'reply',p_body:'Atención humana en curso.',p_actor:'operator'});
  };
  await invoke({action:'send',token:'b'.repeat(64),body:payload.body,requestId:randomUUID()});
  const takeover=await invoke({action:'read',token:'b'.repeat(64)});
  assert.equal(replies(takeover).length,0);
  assert.ok(takeover.messages.some(m=>m.provenance==='human_operator'));
  assert.equal(posts,2);
  intervention=undefined;
  await db.exec(`create function fail_ai_insert() returns trigger language plpgsql as $$
    begin if new.provenance='ai_generated' then raise exception 'test insertion failure'; end if; return new; end
  $$; create trigger fail_ai_insert before insert on support_messages for each row execute function fail_ai_insert();`);
  const broken=await invoke({...payload,token:'c'.repeat(64),requestId:randomUUID()});
  assert.equal(broken.messages.length,1);
  assert.equal(replies(broken).length,0);
  const {rows}=await db.query(`select j.state,p.job_id from support_ai_jobs j left join support_ai_proposals p
    on p.job_id=j.id where j.ticket_id=$1`,[broken.ticket.id]);
  assert.deepEqual(rows,[{state:'claimed',job_id:null}]);
  assert.equal(posts,3);
  unavailable=true;
  const rejected={...payload,token:'d'.repeat(64),requestId:randomUUID()};
  assert.equal(replies(await invoke(rejected)).length,0);
  assert.equal(replies(await invoke(rejected)).length,0);
  assert.equal(posts,4);
});

test('loopback public chat origin is accepted only by the QA development server',t=>{
  const {writeOriginAllowed}=require('../lib/_support');
  for(const k of ['VERCEL_ENV','SUPABASE_URL']){
    const old=process.env[k];
    t.after(()=>{if(old===undefined)delete process.env[k];else process.env[k]=old;});
  }
  const request={headers:{origin:'http://localhost:3142',host:'localhost:3142'}};
  const allowed=()=>writeOriginAllowed(request,{publicChat:true});
  process.env.SUPABASE_URL='https://lpujenjnxzszfbcjfrrb.supabase.co';
  process.env.VERCEL_ENV='production';
  assert.equal(allowed(),false);
  process.env.VERCEL_ENV='development';
  assert.equal(allowed(),true);
  assert.equal(writeOriginAllowed({headers:{...request.headers,host:'example.com'}},{publicChat:true}),false);
  process.env.SUPABASE_URL='https://uycwzhlcnfijjyzkgkem.supabase.co';
  assert.equal(allowed(),false);
});
