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
    '20261119060000_support_auto_replies','20261121235900_support_visitor_email'])await db.exec(readFileSync('supabase/migrations/'+f+'.sql','utf8'));
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
        text:JSON.stringify({decision:'respond',reason:'none',source_id:JSON.parse(payload.input).sources[0].id,
          ...(JSON.parse(payload.input).parts?{parts:['tone:of-course',...Object.keys(JSON.parse(payload.input).parts).filter(id=>!id.startsWith('tone:'))]}:{})})}]}]})};
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
  const unknown=await invoke({action:'send',token:payload.token,body:'Confirma si el cobro de mi tarjeta está acreditado',requestId:randomUUID()});
  assert.equal(replies(unknown).length,2);
  assert.match(replies(unknown).at(-1).body,/pasar tu consulta a nuestro equipo de atención/);
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
  unavailable=false;
  await db.exec('drop trigger fail_ai_insert on support_messages');
  const conversations=[
    ['e',['Hola','¿Eres una IA?'],['assistant-greeting','assistant-identity']],
    ['f',['¿Cuándo es Perrun?','¿Y qué incluye?','¿Puedo llevar dos perros?'],['perrun-date','perrun-registration','perrun-two-dogs']],
    ['3',['Mi perro es pequeño, ¿puede correr 5 km?'],['clarify-dog-distance']],
    ['1',['Ya hice una transferencia, ¿estoy inscrito?'],[null]],
    ['2',['¿Puedo cambiar el nombre de mi inscripción?'],[null]],
  ];
  const conversationalEnv={...env,SUPPORT_AI_CONVERSATIONAL_ENABLED:'true'};
  for(const [digit,inputs,sources] of conversations){
    let before=0;
    for(let i=0;i<inputs.length;i++){
      const data=await invoke({action:i?'send':'start',token:digit.repeat(64),body:inputs[i],
        requestId:randomUUID(),...(i?{}:{category:'general',website:''})},conversationalEnv);
      const messages=replies(data);
      assert.equal(messages.length,++before,inputs[i]);
      if(sources[i])assert.equal(messages.at(-1).body,'Claro. '+kb.sources.find(s=>s.id===sources[i]).text);
      else assert.match(messages.at(-1).body,/pasar tu consulta a nuestro equipo de atención/);
    }
  }
  const combined=await invoke({...payload,token:'4'.repeat(64),requestId:randomUUID(),body:'¿Cuál es la fecha y ubicación de Perrun?'},conversationalEnv);
  assert.match(replies(combined).at(-1)?.body,/Mapa:.*14 de febrero de 2027/);
  const turns=['Hola, ¿eres una IA?','¿Cuándo es Perrun y dónde será?','¿Y qué incluye mi inscripción?'];
  const texts=[/asistente virtual/, /Mapa:.*14 de febrero de 2027/, /incluye 1 participante humano y 1 perro/];
  for(let i=0;i<turns.length;i++){
    const d=await invoke({action:i?'send':'start',token:'7'.repeat(64),body:turns[i],requestId:randomUUID(),
      ...(i?{}:{category:'general',website:''})},conversationalEnv);
    const published=replies(d);
    assert.equal(published.length,i+1);
    assert.match(published.at(-1).body,texts[i]);
    assert.doesNotMatch(published.at(-1).body,/pasar tu consulta a nuestro equipo de atención/);
  }
  assert.equal(posts,14); // six supported turns; payment and change requests stay local.

  const oxxo = await invoke({...payload,token:'8'.repeat(64),requestId:randomUUID(),
    body:'Voy a pagar en el Oxxo, pero no estoy seguro de haber quedado registrado. El registro, según yo, lo hice anoche.'},conversationalEnv);
  assert.equal(replies(oxxo).at(-1)?.body, 'Claro. '+kb.sources.find(s=>s.id==='oxxo-registration').text);
  assert.equal(posts,15);
  const expired = await invoke({action:'send',token:'8'.repeat(64),requestId:randomUUID(),
    body:'Mi referencia de OXXO expiró.'},conversationalEnv);
  assert.equal(replies(expired).at(-1)?.body,kb.oxxoHandoff);
  assert.equal(posts,15);
  const expiredState = await db.query('select automation_paused_at from support_tickets where id=$1',[expired.ticket.id]);
  assert.ok(expiredState.rows[0].automation_paused_at);

  await rpc('support_admin_action',{p_ticket_id:oxxo.ticket.id,p_request_id:randomUUID(),
    p_expected_version:expired.ticket.version,p_action:'reply',p_body:'Yo te atiendo con tu referencia.',p_actor:'operator'});
  const followup = await invoke({action:'send',token:'8'.repeat(64),requestId:randomUUID(),
    body:'¿Dónde encuentro mi referencia de OXXO?'},conversationalEnv);
  assert.equal(replies(followup).length,2);
  assert.ok(followup.messages.some(message=>message.provenance==='human_operator'));
  assert.equal(posts,15);

  const noAutomation = {...env, SUPPORT_AI_AUTO_REPLY_ENABLED:'false'};
  const guest = await invoke({...payload, token:'9'.repeat(64), requestId:randomUUID(),
    body:'Primera consulta'}, noAutomation);
  await rpc('support_admin_action',{p_ticket_id:guest.ticket.id,p_request_id:randomUUID(),
    p_expected_version:guest.ticket.version,p_action:'update',p_status:'resolved',p_actor:'operator'});
  const next = {action:'send',token:'9'.repeat(64),requestId:randomUUID(),body:'Necesito continuar'};
  const reopened = await invoke(next, noAutomation);
  const repeated = await invoke(next, noAutomation);
  assert.equal(reopened.ticket.id, guest.ticket.id);
  assert.equal(reopened.ticket.status, 'pending');
  assert.deepEqual(repeated.messages.map(m=>m.body), ['Primera consulta','Necesito continuar']);
  const inbox = await rpc('support_admin_list',{p_limit:50,p_status:'pending'});
  assert.equal(inbox.data.tickets.filter(ticket=>ticket.id===guest.ticket.id).length,1);

  const withEmail = {...conversationalEnv, VERCEL_ENV:'production', SUPPORT_VISITOR_EMAIL_ENABLED:'true',
    SUPPORT_VISITOR_EMAIL_SECRET:'fixture-secret-followup-address-only', RESEND_API_KEY:'fixture-only',
    SUPPORT_INTAKE_ENABLED:'true', SUPPORT_INTAKE_START_AT:env.SUPPORT_AI_AUTO_REPLY_START_AT};
  const begin = body => ({...payload,token:randomUUID().replaceAll('-','').repeat(2),requestId:randomUUID(),body});
  const send = (token, body) => invoke({action:'send',token,requestId:randomUUID(),body},withEmail);
  const closeQuestion = begin('¿Hasta cuándo venden boletos?');
  const clarified = await invoke(closeQuestion,withEmail);
  assert.equal(replies(clarified).length,1);
  assert.equal(replies(clarified)[0].body,'¡Claro! ¿Te refieres a Cascanueces Run o Perrun?');
  assert.equal(clarified.followup,undefined);
  assert.equal((await invoke(closeQuestion,withEmail)).messages.length,2);
  const dateAnswer = await send(closeQuestion.token,'Perrun');
  assert.match(replies(dateAnswer).at(-1).body,/25 de enero de 2027.*16:00/);
  assert.equal(dateAnswer.followup,undefined);

  const pickup = begin('¿Puede alguien más recoger mi kit?');
  const pickupPrompt = await invoke(pickup,withEmail);
  assert.match(replies(pickupPrompt).at(-1).body,/¿Para qué carrera/);
  const pickupAnswer = await send(pickup.token,'Para Perrun 2027');
  assert.match(replies(pickupAnswer).at(-1).body,/titular debe acudir personalmente/);

  const quick = begin('Tengo una consulta sobre la entrega de kits.');
  assert.match(replies(await invoke(quick,withEmail)).at(-1).body,/¿De qué carrera/);
  const unsupportedRace = await send(quick.token,'Cascanueces Run');
  assert.match(replies(unsupportedRace).at(-1).body,/pasar tu consulta a nuestro equipo de atención/);
  assert.equal(unsupportedRace.followup,'eligible');

  const repeat = begin('¿Hasta cuándo venden boletos?');
  await invoke(repeat,withEmail);
  const escalated = await send(repeat.token,'¿Hasta cuándo venden boletos?');
  assert.equal(replies(escalated).filter(message=>message.body.includes('¿Te refieres')).length,1);
  assert.match(replies(escalated).at(-1).body,/pasar tu consulta a nuestro equipo de atención/);
  assert.equal(escalated.followup,'eligible');
  const explicit = await invoke(begin('Solicito atencion humana.'),withEmail);
  assert.equal(explicit.followup,'eligible');
  assert.match(replies(explicit).at(-1).body,/pasar tu consulta a nuestro equipo de atención/);
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
