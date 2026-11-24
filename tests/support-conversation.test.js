'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const handler = require('../lib/support-chat');
const {evaluateConversation,conversationTools} = require('../lib/ai/support-conversation');
const {renderAssistantReply} = require('../support-chat');

const openDate = Date.parse('2026-11-25T16:00:00-06:00');
const model = 'simulated';
const result = (...output) => ({status:'completed',model,output,usage:{input_tokens:420,output_tokens:32}});
const call = (name,args) => ({type:'function_call',name,status:'completed',arguments:JSON.stringify(args)});
const decision = (value, pregunta = null, fuente = null) => ({type:'message',role:'assistant',status:'completed',
  content:[{type:'output_text',text:JSON.stringify({decision:value,pregunta,fuente})}]});
const question = text => decision('aclarar',text);
const newestAgent = data => data.messages.filter(message=>message.author==='agent').at(-1)?.body;

function actionLinks(body) {
  const doc = {createElement:tag=>({tag,children:[],append(...items){this.children.push(...items);}})};
  const found = [];
  const pending = [renderAssistantReply(doc,body)];
  while (pending.length) {
    const item = pending.pop();
    if (item.tag === 'a') found.push(item.href);
    if (item.children) pending.push(...item.children);
  }
  return found;
}

test('conversation evaluates only authorized tools, grounded replies and safe clarification', async () => {
  async function decide(output, at = openDate) {
    return evaluateConversation({model,tenantId:'kinetichub',message:'Consulta ficticia',now:()=>at,
      provider:async()=>output});
  }
  for (const output of [
    result(call('execute_sql',{sql:'SELECT 1'})),
    result(call('informacion_publica',{fuente:'conversation-quote'})),
    result(call('cotizar_inscripcion',{carrera:'__proto__',cantidad:2,distancia:null})),
    result(call('cotizar_inscripcion',{carrera:'cascanueces-run',cantidad:0,distancia:null})),
    result(call('ruta_inscripcion',{carrera:'cascanueces-run',cantidad:2,url:'https://example.invalid'})),
    result(call('ruta_inscripcion',{carrera:null,cantidad:2}),question('¿Qué carrera te interesa?')),
    result(question('¿Me compartes tu contraseña?')),
    result(question('¿Quieres pagar en https://example.invalid?')),
  ]) assert.equal((await decide(output)).reason,'invalid_provider_output');
  const closed = await decide(result(call('ruta_inscripcion',{carrera:'cascanueces-run',cantidad:2})),Date.parse('2026-11-30T06:00:00Z'));
  assert.match(closed.response,/inscripciones .* cerradas/);
  assert.deepEqual(actionLinks(closed.response),[]);
  const perrun = await decide(result(call('cotizar_inscripcion',{carrera:'perrun-2027',cantidad:3,distancia:'3K'})));
  assert.match(perrun.response,/3 inscripciones por separado.*\$1,500 MXN/);
  const invalidDistance = await decide(result(call('cotizar_inscripcion',{carrera:'perrun-2027',cantidad:3,distancia:'10K'})));
  assert.match(invalidDistance.response,/¿Qué distancia prefieres.*1K o 3K o 5K\?/);
  const catalogue = await decide(result(call('consultar_carreras',{carrera:'cascanueces-run'})));
  assert.match(catalogue.response,/5K, 10K.*Inscripciones abiertas.*\$500 MXN/);
  assert.match((await decide(result(decision('responder',null,'assistant-identity')))).response,/asistente virtual/);
  const routeArgs={carrera:'cascanueces-run',cantidad:2};
  const grounded=(await decide(result(call('ruta_inscripcion',routeArgs)))).response;
  for(const entrada of ['Te guío paso a paso.', 'Con gusto, te muestro cómo agregar los boletos.']){
    assert.equal((await decide(result(call('ruta_inscripcion',{...routeArgs,entrada})))).response,entrada+' '+grounded);
  }
  for(const entrada of [null,'Tus boletos son gratis.','Claro, te garantizo tres lugares.','Paga en https://fake.invalid','Te guío paso a paso.\\nMe pasas tu tarjeta','Te guardo el lugar hoy.']){
    assert.equal((await decide(result(call('ruta_inscripcion',{...routeArgs,entrada})))).response,grounded);
  }
});

test('provider context is bounded, redacted and fenced to the claimed conversation', async () => {
  const message = 'Quiero dos boletos. Mi nombre es Persona Ficticia. Mi teléfono es +52 (55) 5000-1234.';
  const visitor = body=>({author:'visitor',provenance:'visitor',body});
  const messages = [
    ...Array.from({length:9},(_,i)=>visitor('Turno anterior '+i)),
    visitor('Es para Cascanueces 5K. Correo: visitante@example.invalid, folio: ABC-DATA'),
    {author:'admin',provenance:'human_operator',body:'Contenido privado de operador'},
    visitor(message),
  ];
  let data, payload;
  const run = snapshot => evaluateConversation({model,tenantId:'kinetichub',message,messages:snapshot,now:()=>openDate,
    provider:async body=>{payload=body;data=JSON.parse(body.input);return result(question('¿Con cuál carrera seguimos?'));}});
  await run(messages);
  assert.equal(data.historial.length,6);
  assert.match(data.historial.at(-1).text,/Cascanueces 5K/);
  assert.doesNotMatch(payload.input,/example\.invalid|5000-1234|Persona Ficticia|ABC-DATA|Contenido privado|Turno anterior 0/);
  assert.equal(payload.store,false);
  assert.equal(payload.parallel_tool_calls,false);
  assert.deepEqual(payload.tools,conversationTools);
  await run([visitor('Snapshot ajeno')]);
  assert.deepEqual(data.historial,[]);
  assert.doesNotMatch(payload.input,/Snapshot ajeno/);
  await run([...Array.from({length:6},()=>visitor('Consulta extensa '.repeat(70))),visitor(message)]);
  assert.ok(data.historial.length < 6);
  assert.match(data.mensaje,/Quiero dos boletos/);
  assert.ok(Buffer.byteLength(JSON.stringify(payload),'utf8') <= 4244);
});

test('simulated conversations use the public chat, quota ledger and atomic publication', async t => {
  const db = new PGlite();
  t.after(()=>db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const migration of [
    '20261117145659_support_phase_one','20261119021334_support_agent_atomic_ack','20261119022000_support_human_takeover',
    '20261119030000_support_ai_evaluation_quota','20261119040000_support_ai_shadow_queue','20261119050000_support_private_proposal_read',
    '20261119060000_support_auto_replies','20261121235900_support_visitor_email','20261123230000_support_test_category',
    '20261124000000_support_email_code_and_handoff','20261124010000_support_sales_and_monitor','20261124010354_support_explicit_human_request',
  ]) await db.exec(readFileSync('supabase/migrations/'+migration+'.sql','utf8'));
  await db.exec("INSERT INTO support_ai_limits VALUES ('kinetichub',true,'simulated',60,1000000,750000,4500000);");
  const env = {
    SUPPORT_AI_TENANT:'kinetichub',SUPPORT_AI_AUTO_REPLY_ENABLED:'true',SUPPORT_AI_AUTO_REPLY_START_AT:'2025-01-01T00:00:00Z',
    SUPPORT_AI_SHADOW_ENABLED:'true',SUPPORT_AI_PRIVATE_ENABLED:'true',SUPPORT_AI_TOOL_CONVERSATION_ENABLED:'true',
    SUPPORT_AI_MODEL:model,SUPPORT_AI_OPENAI_API_KEY:'simulated-provider-only',
    VERCEL_ENV:'production',SUPPORT_VISITOR_EMAIL_ENABLED:'true',RESEND_API_KEY:'fixture',
    SUPPORT_VISITOR_EMAIL_SECRET:'fixture-support-secret-not-for-production',
  };
  const rpc = async (name,args={})=>{
    const placeholders=Object.keys(args).map((key,index)=>key+' => $'+(index+1)).join(',');
    const {rows}=await db.query('SELECT public.'+name+'('+placeholders+') AS data',Object.values(args));
    return {data:rows[0].data};
  };
  let requests=0;
  const invoke=async (body, choose, override=env)=>{
    const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.data=value;return this;}};
    let fixtureError;
    const autoFetch=async(url,options)=>{
      requests++;
      try {
        assert.equal(url,'https://api.openai.com/v1/responses');
        const payload=JSON.parse(options.body);
        assert.equal(payload.store,false);
        assert.equal(payload.parallel_tool_calls,false);
        assert.deepEqual(payload.tools,conversationTools);
        assert.ok(choose,'this turn must not contact the provider');
        const output=await choose(JSON.parse(payload.input));
        return output===null ? {ok:false,status:503} : {ok:true,json:async()=>output};
      } catch (error) { fixtureError=error; throw error; }
    };
    await handler({method:'POST',headers:{origin:'https://www.kinetichub.com.mx','content-type':'application/json'},body},
      res,{env:override,rpc,rateLimit:async()=>({allowed:true}),now:()=>openDate,autoFetch});
    if(fixtureError)throw fixtureError;
    assert.equal(res.code,200);
    return res.data;
  };
  const newChat=()=> {
    const token=randomUUID().replaceAll('-','').repeat(2);
    return {
      start:(body,choose,override)=>invoke({action:'start',body,token,requestId:randomUUID(),category:'general',website:''},choose,override),
      send:(body,choose)=>invoke({action:'send',body,token,requestId:randomUUID()},choose),
      read:()=>invoke({action:'read',token}),
    };
  };

  await t.test('A. retains quantity and race and offers the authorized purchase link',async()=>{
    const chat=newChat();
    const first=await chat.start('Quiero tres lugares',context=>{
      assert.deepEqual(context.historial,[]);
      assert.equal(context.mensaje,'Quiero tres lugares');
      return result(question('¿Para qué carrera quieres los tres lugares?'));
    });
    assert.match(newestAgent(first),/¿Para qué carrera/);
    assert.equal(first.followup,undefined);
    const quote=await chat.send('Cascanueces',context=>{
      assert.deepEqual(context.historial.map(turn=>turn.text),['Quiero tres lugares','¿Para qué carrera quieres los tres lugares?']);
      return result(call('cotizar_inscripcion',{carrera:'cascanueces-run',cantidad:3,distancia:null}));
    });
    assert.equal(quote.ticket.id,first.ticket.id);
    assert.match(newestAgent(quote),/\$500 MXN.*\$1,500 MXN/);
    const route=await chat.send('¿Dónde los compro?',context=>{
      assert.ok(context.historial.some(turn=>turn.text==='Cascanueces'));
      assert.ok(context.historial.some(turn=>turn.text.includes('$1,500 MXN')));
      return result(call('ruta_inscripcion',{carrera:'cascanueces-run',cantidad:3}));
    });
    assert.deepEqual(actionLinks(newestAgent(route)),['/cascanueces-run.html#modalidades']);
    assert.equal(requests,3);
    const proposal=await rpc('support_admin_proposal',{p_tenant:'kinetichub',p_ticket:route.ticket.id,p_version:route.ticket.version});
    assert.equal(proposal.data.proposal.source,'conversation-registration-route');
    const decisionTrace=(await db.query(`SELECT p.reason FROM support_ai_proposals p
      JOIN support_ai_jobs j ON j.id=p.job_id WHERE j.ticket_id=$1 ORDER BY p.created_at DESC LIMIT 1`,[route.ticket.id])).rows[0];
    assert.equal(decisionTrace.reason,'registration_route');
    const usage=(await db.query('SELECT count(*)::int AS total FROM support_ai_attempts WHERE input_tokens IS NOT NULL')).rows[0];
    assert.equal(usage.total,3);
  });

  await t.test('B. clarifies an unfamiliar duo reference and shows checkout steps',async()=>{
    const chat=newChat();
    const opened=await chat.start('No veo el ícono de dúo',context=>{
      assert.deepEqual(context.historial,[]);
      return result(question('¿Quieres agregar dos boletos o buscas una promoción especial?'));
    });
    assert.match(newestAgent(opened),/dos boletos o buscas una promoción/);
    const answered=await chat.send('Dos boletos',context=>{
      assert.equal(context.historial[0].text,'No veo el ícono de dúo');
      return result(call('ruta_inscripcion',{carrera:null,cantidad:2}));
    });
    assert.match(newestAgent(answered),/\+ Agregar ticket/);
    assert.doesNotMatch(newestAgent(answered),/descuento|promoción disponible/);
    assert.equal(answered.followup,undefined);
  });

  await t.test('Dúo transfer follow-up asks once, never quotes, and parks the exact confirmation for a person',async()=>{
    const before=requests;
    const chat=newChat();
    const first=await chat.start('Vi una promoción Dúo 5K de 850 pesos en WhatsApp, ¿sigue vigente?');
    assert.match(newestAgent(first),/¿Para qué carrera viste la promoción Dúo\?/);
    const followup=await chat.send('Para la de Cascanueces 5K');
    const reply=newestAgent(followup);
    assert.match(reply,/mensuales.*transferencia.*no se aplican en el checkout web/);
    assert.match(reply,/confirme si la promoción Dúo sigue vigente para esa carrera.*canal oficial/);
    assert.doesNotMatch(reply,/850|1,000|500|https?:|#modalidades/);
    assert.deepEqual(actionLinks(reply),[]);
    assert.equal(requests,before);
    const ticket=(await db.query('SELECT automation_paused_at FROM support_tickets WHERE id=$1',[followup.ticket.id])).rows[0];
    assert.ok(ticket.automation_paused_at);
    const trace=(await db.query(`SELECT p.reason,p.decision FROM support_ai_proposals p
      JOIN support_ai_jobs j ON j.id=p.job_id WHERE j.ticket_id=$1 ORDER BY p.created_at DESC LIMIT 1`,[followup.ticket.id])).rows[0];
    assert.deepEqual(trace,{reason:'confirm_duo_transfer_validity',decision:'escalate'});
    const direct=await newChat().start('¿Sigue la promo Dúo de Cascanueces por transferencia?');
    assert.equal(newestAgent(direct),reply);
    assert.equal(requests,before);
    const switched=newChat();
    await switched.start('¿Sigue vigente la promo Dúo por WhatsApp?');
    const regular=await switched.send('Mejor tres boletos normales para Cascanueces 5K',()=>
      result(call('cotizar_inscripcion',{carrera:'cascanueces-run',cantidad:3,distancia:'5K'})));
    assert.match(newestAgent(regular),/3 boletos suman \$1,500 MXN/);
  });

  await t.test('Cascanueces minors: keeps the race across turns, confirms the waiver, and never assumes age eligibility',async()=>{
    const before=requests;
    const chat=newChat();
    const first=await chat.start('¿Pueden participar mis hijos de 7 y 11 años?');
    assert.match(newestAgent(first),/¿Para qué carrera/);
    const followup=await chat.send('Para la de Cascanueces 5K');
    const reply=newestAgent(followup);
    assert.match(reply,/Cascanueces.*participación de menores.*exoneración.*madre, padre o tutor legal/);
    assert.match(reply,/No publica una edad mínima ni una restricción de edad por distancia.*no confirma la elegibilidad/);
    assert.doesNotMatch(reply,/pueden participar ambos|compárteme|envíame|fecha de nacimiento/);
    const explicit=await newChat().start('¿Mis hijos de 7 y 11 años pueden correr en Cascanueces 5K?');
    assert.equal(newestAgent(explicit),reply);
    const different=newChat();
    await different.start('¿Pueden participar niños de 7 y 11 años?');
    const other=await different.send('Perrun');
    assert.match(newestAgent(other),/no tengo confirmada la regla de edad/);
    assert.doesNotMatch(newestAgent(other),/Cascanueces|tutor legal|edad mínima/);
    assert.equal(requests,before);
    const unrelated=await newChat().start('Mi hijo ya pagó pero no aparece su inscripción de Cascanueces',()=>
      result(call('informacion_publica',{fuente:'registration-self-service'})));
    assert.match(newestAgent(unrelated),/Mis carreras/);
    assert.doesNotMatch(newestAgent(unrelated),/tutor legal/);
  });

  await t.test('C. directs private registration questions to existing authenticated self-service',async()=>{
    const answer=await newChat().start('No encuentro mi inscripción',()=>result(call('informacion_publica',{fuente:'registration-self-service'})));
    assert.match(newestAgent(answer),/Inicia sesión.*Mis carreras/);
    assert.ok(actionLinks(newestAgent(answer)).includes('/perfil.html'));
    assert.doesNotMatch(newestAgent(answer),/estás inscrito|tu pago está confirmado/);
  });

  await t.test('D. transfers immediately without the model or provider gates',async()=>{
    const before=requests;
    const data=await newChat().start('Quiero hablar con alguien',undefined,{...env,SUPPORT_AI_AUTO_REPLY_ENABLED:'false'});
    assert.match(newestAgent(data),/Voy a comunicarte con nuestro equipo de atención/);
    assert.equal(data.followup,'eligible');
    assert.equal(requests,before);
    const ticket=(await db.query('SELECT automation_paused_at FROM support_tickets WHERE id=$1',[data.ticket.id])).rows[0];
    assert.ok(ticket.automation_paused_at);
  });

  await t.test('E. a human reply during inference prevents late publication',async()=>{
    const chat=newChat();
    const existing=await chat.start('Quiero correr',()=>result(question('¿Qué carrera te interesa?')));
    const data=await chat.send('Cascanueces',async()=>{
      const latest=(await db.query('SELECT version FROM support_tickets WHERE id=$1',[existing.ticket.id])).rows[0];
      const human=await rpc('support_admin_action',{p_ticket_id:existing.ticket.id,p_request_id:randomUUID(),
        p_expected_version:latest.version,p_action:'reply',p_body:'Te atiendo personalmente.',p_actor:'operator'});
      assert.ok(human.data.ok);
      return result(call('ruta_inscripcion',{carrera:'cascanueces-run',cantidad:1}));
    });
    const after=await chat.read();
    assert.equal(data.ticket.id,existing.ticket.id);
    assert.equal(after.messages.filter(message=>message.author==='agent').length,1);
    assert.equal(after.messages.at(-1).body,'Te atiendo personalmente.');
  });

  await t.test('a newer visitor turn supersedes an in-flight quote',async()=>{
    const chat=newChat();
    await chat.start('Quiero dos lugares',()=>result(question('¿Para qué carrera quieres los dos lugares?')));
    await chat.send('Cascanueces',async()=>{
      await chat.send('Mejor para Perrun',()=>result(call('cotizar_inscripcion',{carrera:'perrun-2027',cantidad:2,distancia:null})));
      return result(call('cotizar_inscripcion',{carrera:'cascanueces-run',cantidad:2,distancia:null}));
    });
    const current=await chat.read();
    assert.match(newestAgent(current),/Perrun.*2 inscripciones por separado/);
    assert.equal(current.messages.filter(message=>message.author==='agent').length,2);
  });

  await t.test('scoped conversational routing resolves known facts before handoff',async()=>{
    const baseline=requests;
    const children=newChat();
    await children.start('¿Pueden participar mis hijos de 7 y 11 años en Cascanueces?');
    const childFollowup=await children.send('¿Entonces los dos sí pueden participar en 5K?');
    assert.match(newestAgent(childFollowup),/equipo de atención/);
    assert.doesNotMatch(newestAgent(childFollowup),/entrega del kit|sí pueden participar/);
    const anotherRace=newChat();
    await anotherRace.start('¿Pueden participar mis hijos de 7 y 11 años en Cascanueces?');
    const another=await anotherRace.send('¿Y pueden participar mis hijos en Perrun?');
    assert.match(newestAgent(another),/no tengo confirmada la regla de edad/);
    const order=newChat();
    await order.start('Quiero tres boletos',()=>result(question('¿Para qué carrera quieres los tres boletos?')));
    const amount=await order.send('Cascanueces 5K');
    assert.match(newestAgent(amount),/3 boletos suman \$1,500 MXN/);
    const variant=await newChat().start('¿Cuánto cuestan 2 entradas para Cascanueces 10K?');
    assert.match(newestAgent(variant),/2 boletos suman \$1,000 MXN/);
    const paid=newChat();
    const first=await paid.start('Ya se reflejó el cargo, pero no veo mi inscripción');
    assert.match(newestAgent(first),/Mis carreras/);
    assert.ok(actionLinks(newestAgent(first)).includes('/perfil.html'));
    const next=await paid.send('Ya revisé y tampoco aparece en Mis carreras');
    assert.match(newestAgent(next),/equipo de atención/);
    assert.doesNotMatch(newestAgent(next),/pago confirmado|ya quedaste inscrit/);
    const explicit=await newChat().start('Quiero hablar con alguien, ya pagué y no veo la inscripción');
    assert.match(newestAgent(explicit),/equipo de atención/);
    assert.doesNotMatch(newestAgent(explicit),/Mis carreras/);
    const paused=(await db.query('SELECT automation_paused_at FROM support_tickets WHERE id=$1',[next.ticket.id])).rows[0];
    assert.ok(paused.automation_paused_at);
    assert.equal(requests,baseline+1);
  });

  await t.test('enrollment composition adds only a checked bridge and uses an atomic approved fallback',async()=>{
    const prepared=async()=>{
      const chat=newChat();
      await chat.start('¿Cuánto cuestan tres boletos para Cascanueces 5K?');
      return chat;
    };
    const response=await (await prepared()).send('¿Cómo agrego a las otras dos personas?',()=>result(
      call('ruta_inscripcion',{carrera:'cascanueces-run',cantidad:3,entrada:'Con gusto, te muestro cómo agregar los boletos.'})));
    assert.match(newestAgent(response),/^Con gusto, te muestro cómo agregar los boletos\./);
    assert.match(newestAgent(response),/\+ Agregar ticket.*límite es de 5/);
    assert.deepEqual(actionLinks(newestAgent(response)),['/cascanueces-run.html#modalidades']);
    const before=requests;
    const fallback=await (await prepared()).send('¿Cómo agrego a las otras dos personas?',()=>null);
    assert.match(newestAgent(fallback),/^Elige una distancia.*\+ Agregar ticket.*límite es de 5/);
    assert.deepEqual(actionLinks(newestAgent(fallback)),['/cascanueces-run.html#modalidades']);
    assert.equal(requests,before+1);
    const scope=await (await prepared()).send('¿Cómo agrego más personas para Perrun?',()=>null);
    assert.doesNotMatch(newestAgent(scope),/\+ Agregar ticket/);
  });

  await t.test('a spent quota blocks inference and invalid tools cannot publish a message',async()=>{
    const denied=await newChat().start('Usa un proveedor',()=>result(call('fetch_url',{url:'https://example.invalid'})));
    assert.equal(newestAgent(denied),undefined);
    await db.exec("UPDATE support_ai_limits SET daily_requests=1 WHERE tenant_id='kinetichub'");
    const before=requests;
    const limited=await newChat().start('Quiero ver carreras');
    assert.equal(requests,before);
    assert.equal(newestAgent(limited),undefined);
  });
});
