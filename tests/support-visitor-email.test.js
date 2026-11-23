'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const vm = require('node:vm');
const {PGlite} = require('@electric-sql/pglite');
const email = require('../lib/support-visitor-email');
const chat = require('../lib/support-chat');
const admin = require('../lib/admin-support');
const worker = require('../lib/support-notifications-worker');

test('verified guest gets one private notice per human reply and reopens only that ticket', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const migration of [
    '20261117145659_support_phase_one.sql',
    '20261119021334_support_agent_atomic_ack.sql',
    '20261119022000_support_human_takeover.sql',
    '20261119030000_support_ai_evaluation_quota.sql',
    '20261119040000_support_ai_shadow_queue.sql',
    '20261121235900_support_visitor_email.sql',
    '20261123230000_support_test_category.sql',
  ]) await db.exec(readFileSync('supabase/migrations/' + migration, 'utf8'));
  const rpc = async (name, args) => {
    const parameters = Object.keys(args).map((key, index) => key + '=>$' + (index+1)).join(',');
    const table = name === 'support_claim_visitor_email';
    const sql = table ? 'SELECT * FROM public.' : 'SELECT public.';
    const {rows} = await db.query(sql + name + '(' + parameters + ')' + (table ? '' : ' AS data'), Object.values(args));
    return {data: table ? rows : rows[0].data};
  };
  const env = {VERCEL_ENV:'production', RESEND_API_KEY:'fixture', SUPPORT_VISITOR_EMAIL_ENABLED:'true',
    SUPPORT_VISITOR_EMAIL_SECRET:'fixture-only-independent-secret-12345',
    SUPPORT_NOTIFICATION_WORKER_SECRET:'fixture-worker-secret-not-for-production'};
  const deliveries = [];
  let failNext = false;
  const fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    deliveries.push({key: options.headers['Idempotency-Key'], ...JSON.parse(options.body)});
    if (failNext) { failNext = false; return {ok:false,status:503}; }
    return {ok:true};
  };
  const headers = {origin:'https://www.kinetichub.com.mx','content-type':'application/json'};
  const invoke = async (route, body, deps, authorization) => {
    const response = {setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    await route({method:'POST',headers:{...headers,...(authorization ? {authorization} : {})},body,query:{}},response,deps);
    return response;
  };
  const visit = (body, extra = {}) => invoke(chat,body,{rpc,env,rateLimit:async()=>({allowed:true}),...extra},extra.bearer);
  const follow = (body, extra = {}) => invoke(email.handler,body,{rpc,env,fetch,enforceRateLimit:async()=>null,...extra},extra.bearer);
  const operator = {user:{id:randomUUID()},email:'operator@example.invalid'};
  const reply = (ticket, requestId = randomUUID(), auth = operator) => invoke(admin,
    {id:ticket.id,expectedVersion:ticket.version,requestId,action:'reply',body:'Contenido privado de la respuesta'},
    {client:{rpc,auth:{admin:{getUserById:async()=>({data:{user:accountUser}})}}},
      auth:async()=>auth,getSupportAssignees:()=>[],visitorEmailEnv:env,visitorEmailFetch:fetch});
  const [guest, other] = ['a','b'].map(hex => hex.repeat(64));
  const start = (token, extra) => visit({action:'start',token,requestId:randomUUID(),category:'general',website:'',
    body:'Solicito atencion humana.'},extra);

  const initial = await start(guest);
  const foreign = await start(other);
  assert.equal(initial.data.followup,'eligible');
  const requested = await follow({action:'request',token:guest,email:'guest@example.invalid'});
  assert.equal(requested.code,202);
  assert.deepEqual(requested.data,{ok:true,codeSent:true});
  const throttled = await follow({action:'request',token:guest,email:'replacement@example.invalid'});
  assert.equal(throttled.code,202);
  assert.deepEqual(throttled.data,{ok:true});
  assert.equal(deliveries.length,1);
  const code = deliveries[0].text.match(/: ([A-F0-9]{12})/)[1];
  assert.doesNotMatch(deliveries[0].text,/Folio|Contenido privado|https:/);
  assert.equal((await follow({action:'verify',token:other,code})).code,403);
  assert.equal((await follow({action:'verify',token:guest,code:'0'.repeat(12)})).code,403);

  // The operator can reply while the visit is closed. An unverified recipient gets no notice.
  const beforeVerification = await reply(initial.data.ticket);
  assert.equal(beforeVerification.code,200);
  assert.equal(deliveries.length,1);
  assert.equal((await follow({action:'verify',token:guest,code})).code,200);
  assert.equal((await follow({action:'verify',token:guest,code})).code,403);
  assert.equal((await visit({action:'read',token:guest})).data.followup,'verified');
  await db.query("INSERT INTO support_messages(ticket_id,author,body,provenance,request_id) VALUES ($1,'agent','Respuesta de IA','ai_generated',$2)",
    [initial.data.ticket.id,randomUUID()]);
  const jobs = await db.query('SELECT id FROM support_visitor_email_jobs');
  assert.equal(jobs.rows.length,0);

  const reclassify = (auth, category) => invoke(admin,
    {id:initial.data.ticket.id,expectedVersion:beforeVerification.data.ticket.version,requestId:randomUUID(),action:'update',category},
    {client:{rpc},auth:async()=>auth,authOptions:{adminEmails:['admin@example.invalid']},getSupportAssignees:()=>[]});
  assert.equal((await reclassify(operator,'test')).code,403);
  const changed = await reclassify({...operator,email:'admin@example.invalid'},'test');
  assert.equal(changed.code,200);
  assert.equal(changed.data.ticket.id,initial.data.ticket.id);
  assert.equal(changed.data.ticket.status,beforeVerification.data.ticket.status);
  assert.equal(changed.data.ticket.category,'test');
  const filtered = await rpc('support_admin_list',{p_category:'test'});
  assert.deepEqual(filtered.data.tickets.map(ticket=>ticket.id),[initial.data.ticket.id]);
  const byOriginalCategory = await rpc('support_admin_list',{p_category:'general'});
  assert.deepEqual(byOriginalCategory.data.tickets.map(ticket=>ticket.id),[foreign.data.ticket.id]);
  const existing = await visit({action:'read',token:guest});
  assert.equal(existing.data.followup,'verified');
  assert.ok(existing.data.messages.some(message=>message.body==='Contenido privado de la respuesta'));
  assert.equal(deliveries.length,1);

  const requestId = randomUUID();
  await reply(changed.data.ticket,requestId);
  await reply(changed.data.ticket,requestId);
  assert.equal(deliveries.length,2);
  const notice = deliveries[1];
  assert.deepEqual(notice.to,['guest@example.invalid']);
  assert.match(notice.text,new RegExp(initial.data.ticket.id.slice(0,8),'i'));
  assert.doesNotMatch(notice.text,/Contenido privado|Respuesta de IA|replacement/);
  const [job, proof] = notice.text.match(/#support-reply=([a-f0-9-]+)\.([a-f0-9]{64})/).slice(1);
  assert.equal((await follow({action:'resume',job:randomUUID(),proof})).code,403);
  assert.equal((await follow({action:'resume',job,proof},{bearer:'Bearer fixture'})).code,403);
  const resumed = await follow({action:'resume',job,proof});
  assert.equal(resumed.code,200);
  assert.equal((await follow({action:'resume',job,proof})).code,403);
  const restored = await visit({action:'read',token:resumed.data.token});
  assert.equal(restored.data.ticket.id,initial.data.ticket.id);
  assert.equal(restored.data.messages.filter(message=>message.body==='Contenido privado de la respuesta').length,2);
  assert.equal((await visit({action:'read',token:guest})).code,404);
  assert.equal((await visit({action:'read',token:other})).data.ticket.id,foreign.data.ticket.id);
  assert.equal(deliveries.length,2);

  failNext = true;
  const nextReply = await reply(restored.data.ticket);
  assert.equal(nextReply.code,200);
  await db.exec("UPDATE support_visitor_email_jobs SET ready_at=now() WHERE state='pending'");
  const runWorker = () => invoke(worker,{}, {rpc,env,fetch}, 'Bearer '+env.SUPPORT_NOTIFICATION_WORKER_SECRET);
  assert.equal((await runWorker()).data.visitor,'sent');
  assert.equal((await runWorker()).data.visitor,null);
  assert.equal(deliveries.length,4);
  assert.deepEqual(deliveries[2],deliveries[3]);

  const accountUser = {id:randomUUID(),email:'account@example.invalid',email_confirmed_at:'confirmed',is_anonymous:false};
  const account = {bearer:'Bearer account',auth:async()=>({user:accountUser,email:accountUser.email})};
  const accountTicket = await start(other,account);
  assert.notEqual(accountTicket.data.ticket.id,foreign.data.ticket.id);
  assert.equal((await follow({action:'request',token:other,email:'replacement@example.invalid'},account)).code,400);
  assert.equal((await follow({action:'request',token:other},account)).data.verified,true);
  assert.equal(deliveries.length,4);
  await reply(accountTicket.data.ticket);
  assert.deepEqual(deliveries.at(-1).to,['account@example.invalid']);
  assert.doesNotMatch(deliveries.at(-1).text,/support-reply=/);
  const [oldJob, oldProof] = deliveries[3].text.match(/#support-reply=([a-f0-9-]+)\.([a-f0-9]{64})/).slice(1);
  await db.query("UPDATE support_visitor_email_jobs SET created_at=now()-interval '8 days' WHERE id=$1",[oldJob]);
  assert.equal((await follow({action:'resume',job:oldJob,proof:oldProof})).code,403);
  assert.equal((await follow({action:'request',token:other,email:'expiring@example.invalid'})).code,202);
  const expiredCode = deliveries.at(-1).text.match(/: ([A-F0-9]{12})/)[1];
  await db.query("UPDATE support_email_contacts SET requested_at=now()-interval '16 minutes' WHERE ticket_id=$1",[foreign.data.ticket.id]);
  assert.equal((await follow({action:'verify',token:other,code:expiredCode})).code,403);
  const privileges = await db.query("SELECT has_table_privilege('anon','public.support_email_contacts','SELECT') AS guest, has_function_privilege('authenticated','public.support_resume_visitor_email(uuid,text)','EXECUTE') AS resume");
  assert.deepEqual(privileges.rows,[{guest:false,resume:false}]);
  for (const [index, category] of ['general','events','registration','other','test'].entries()) {
    const body = {action:'start',token:String(index).repeat(64),requestId:randomUUID(),category,website:'',body:'Consulta de prueba ficticia'};
    const response = await visit(body);
    assert.equal(response.code, category==='test' ? 400 : 200);
    if (response.code===200) assert.equal(response.data.ticket.category,category);
  }
});

test('email link is scrubbed, needs a click, and never redeems under an authenticated account', async () => {
  const job = randomUUID(), proof = 'a'.repeat(64), restored = 'b'.repeat(64);
  const script = readFileSync('support-chat.js','utf8');
  for (const account of [false,true]) {
    const nodes = new Map(), calls = [], values = new Map();
    const node = key => {
      if (!nodes.has(key)) nodes.set(key,{hidden:true,value:'',textContent:'',dataset:{},querySelector:node,
        addEventListener(type, listener){this[type]=listener;},replaceChildren(){},append(){}});
      return nodes.get(key);
    };
    node('[data-support-email]').querySelector = key => key === '[data-support-email-request]' ? null : node(key);
    const window = {
      location:{pathname:'/atencion.html',search:'',hash:'#support-reply='+job+'.'+proof},
      history:{replaceState(_state,_title,path){assert.equal(path,'/atencion.html');window.location.hash='';}},
      sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    };
    vm.runInNewContext(script,{window,URL,URLSearchParams,crypto:globalThis.crypto});
    assert.equal(window.location.hash,'');
    const doc = {defaultView:window,querySelector:node,createDocumentFragment:()=>node('fragment')};
    const session = account ? {user:{id:'account'},access_token:'fixture'} : null;
    await window.KineticHubSupport.connectPublicSupportChat({document:doc,
      authClient:{auth:{getSession:async()=>({data:{session}}),onAuthStateChange(){}}},
      fetch:async(path,opts)=>{
        const body = JSON.parse(opts.body);
        calls.push({path,body,authorization:opts.headers.Authorization});
        return {ok:true,json:async()=>body.action==='resume'?{ok:true,token:restored}:{ok:true,messages:[]}};
      }});
    const button = node('[data-support-resume-open]');
    if (account) {
      await new Promise(setImmediate);
      assert.equal(button.hidden,true);
      assert.equal(button.click,undefined);
      assert.deepEqual(calls.map(c=>[c.body.action,c.authorization]),[['read','Bearer fixture']]);
    } else {
      assert.equal(calls.length,0);
      await button.click();
      await new Promise(setImmediate);
      assert.deepEqual(calls.map(c=>c.body.action),['resume','read']);
      assert.deepEqual(calls[0].body,{action:'resume',job,proof});
      assert.equal(calls[1].body.token,restored);
      assert.equal(values.get('kinetichub-support-token'),restored);
    }
  }
});

test('guest follow-up offers both paths and keeps its verified email across messages', async () => {
  const {mountPublicSupportChat,TOKEN_KEY} = require('../support-chat');
  const nodes = new Map(), actions = [];
  const node = key => {
    if (!nodes.has(key)) nodes.set(key,{hidden:true,value:'',textContent:'',dataset:{},querySelector:node,
      addEventListener(type, listener){this[type]=listener;},replaceChildren(){},append(){}});
    return nodes.get(key);
  };
  const request = node('[data-support-email-request]');
  const verify = node('[data-support-email-verify]');
  request.elements = {email:{value:''}};
  verify.elements = {code:{value:''}};
  let followup = 'eligible', acceptCode = false, sentCode = false;
  node('[name="category"]').value = 'general';
  const client = mountPublicSupportChat({root:{querySelector:node},document:{createDocumentFragment:()=>node('fragment')},
    storage:{getItem:key=>key===TOKEN_KEY?'a'.repeat(64):null,setItem(){},removeItem(){}},
    fetch:async(path,opts)=>{
      const input = JSON.parse(opts.body);
      actions.push([path,input.action]);
      if (input.action === 'verify' && !acceptCode) return {ok:false,json:async()=>({error:'El código no es válido o ya venció.'})};
      return {ok:true,json:async()=> ['read','send'].includes(input.action)
        ? {ok:true,ticket:{id:'first',status:'pending'},messages:[],followup}
        : {ok:true,...(input.action==='verify'?{verified:true}:sentCode?{codeSent:true}:{})}};
    }});
  const panel = node('[data-support-email]');
  const event = {preventDefault(){}};
  await new Promise(setImmediate);
  assert.equal(panel.hidden,false);
  const login = node('[data-support-email-login]');
  assert.equal(login.hidden,false);
  const loginUrl = new URL(login.href,'https://example.invalid');
  assert.equal(loginUrl.pathname,'/auth.html');
  assert.equal(loginUrl.searchParams.get('returnTo'),'/atencion.html?from=support-followup-login#premium-conversation');
  request.elements.email.value = 'fixture@example.invalid';
  await request.submit(event);
  assert.equal(verify.hidden,true);
  assert.equal(node('[data-support-email-destination]').hidden,true);
  sentCode = true;
  await request.submit(event);
  followup = 'code_pending';
  assert.equal(verify.hidden,false);
  assert.equal(login.hidden,true);
  assert.equal(node('[data-support-email-destination]').textContent,'fixture@example.invalid');
  assert.equal(node('[data-support-email-expiry]').hidden,false);
  assert.match(node('[data-support-email-title]').textContent,/No necesitas crear una cuenta/);
  verify.elements.code.value = 'A'.repeat(12);
  await verify.submit(event);
  assert.equal(panel.hidden,false);
  assert.equal(node('[data-support-email-state]').textContent,'Pendiente de verificar');
  assert.match(node('[data-support-email-status]').textContent,/código no es válido/);
  node('[name="supportMessage"]').value = 'También tengo otra duda';
  node('[data-support-form]').submit(event);
  await new Promise(setImmediate);
  assert.ok(actions.some(([path, action])=>path==='/api/support-chat' && action==='send'));
  acceptCode = true;
  await verify.submit(event);
  assert.equal(node('[data-support-email-state]').textContent,'Correo verificado');
  assert.equal(node('[data-support-email-title]').textContent,'¡Listo! Te avisaremos por correo cuando nuestro equipo responda.');
  assert.equal(node('[data-support-email-destination]').textContent,'');
  assert.equal(request.hidden,true);
  followup = 'verified';
  await client.refresh();
  assert.equal(request.hidden,true);
  assert.equal(verify.hidden,true);
  assert.deepEqual(actions.filter(([path])=>path.includes('support-visitor-email')).map(([,action])=>action),['request','request','verify','verify']);
});
