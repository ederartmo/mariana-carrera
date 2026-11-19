const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function response() {
  return { headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; },
    end() { return this; } };
}
function request(method, body, extra = {}) {
  return { method, body, headers: { origin: 'https://kinetichub.com.mx', host: 'kinetichub.com.mx', 'content-type': 'application/json', ...extra.headers }, query: extra.query || {}, url: extra.url || '/api/support-chat' };
}
const adminId = crypto.randomUUID();
const token = 'a'.repeat(64);
process.env.SITE_URL = 'https://kinetichub.com.mx';
const allow = async () => ({ allowed: true, remaining: 10, retryAfter: 0 });

test('visitor start validates payload, hashes capability, and is no-store', async () => {
  const calls = [];
  const rpc = async (name, args) => { calls.push({ name, args }); return { data: { ok: true, ticket: { id: 't1', status: 'pending', category: 'general', version: 1, assigned_to: null }, messages: [], hasMore: false } }; };
  const handler = require('../lib/support-chat');
  const res = response();
  await handler(request('POST', { action: 'start', token, requestId: crypto.randomUUID(), body: 'Hola', category: 'general', website: '' }), res, { rpc, rateLimit: allow });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(JSON.stringify(res.body).includes(token), false);
  assert.ok(calls.length);
  assert.equal(JSON.stringify(calls).includes(token), false);
});

test('visitor rejects cross-origin, unknown keys, and missing capability', async () => {
  const handler = require('../lib/support-chat');
  for (const req of [
    request('POST', { action: 'start', token, requestId: crypto.randomUUID(), body: 'hi', category: 'general', website: '', extra: true }),
    request('POST', { action: 'start', requestId: crypto.randomUUID(), body: 'hi', category: 'general', website: '' }),
    request('POST', { action: 'start', token, requestId: crypto.randomUUID(), body: 'hi', category: 'general', website: '' }, { headers: { origin: 'https://attacker.test' } }),
  ]) {
    const res = response(); await handler(req, res, { rpc: async () => ({ data: {} }), rateLimit: allow });
    assert.ok([400, 403].includes(res.statusCode));
  }
});

test('admin support endpoint authenticates server-side and returns safe errors', async () => {
  const handler = require('../lib/admin-support');
  const res = response();
  await handler(request('GET', null), res, { auth: async () => ({ error: 'denied', status: 401 }) });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.stringify(res.body).includes('denied'), false);
});

test('admin mutations bind actor to validated identity and hide database errors', async () => {
  const handler = require('../lib/admin-support');
  let args;
  const id = crypto.randomUUID();
  const req = request('POST', { id, requestId: crypto.randomUUID(), expectedVersion: 2, action: 'reply', body: 'Respuesta' });
  await handler(req, response(), {
    auth: async () => ({ user: { id: adminId, email: 'Admin@Example.test' }, email: 'admin@example.test' }),
    client: { rpc: async (name, value) => { args = value; return { data: { ok: true, ticket: { id }, messages: [], activity: [], hasMore: false } }; } },
  });
  assert.equal(args.p_actor, 'admin:'+adminId);
  assert.equal(args.p_expected_version, 2);
  const failed = response();
  await handler(req, failed, {
    auth: async () => ({ user: { id: adminId, email: 'admin@example.test' }, email: 'admin@example.test' }),
    client: { rpc: async () => ({ error: { message: 'private database details' } }) },
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(JSON.stringify(failed.body).includes('private database details'), false);
});

test('verified account history is scoped to server identity across browser keys', async () => {
  const handler = require('../lib/support-chat');
  const calls = [];
  const rpc = async (_, args) => { calls.push(args); return {data:{ok:true,ticket:{},messages:[]}}; };
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  for (const [id, key, confirmed] of [[a, token, true], [a, 'b'.repeat(64), true], [b, token, true], [a, token, false]]) {
    const res = response();
    await handler(request('POST',{action:'read',token:key},{headers:{authorization:'Bearer fixture'}}),res,{
      rateLimit:allow,rpc,auth:async()=>({user:{id,email_confirmed_at:confirmed?'fixture':null}})
    });
    assert.equal(res.statusCode,confirmed?200:401);
  }
  assert.equal(calls.length,3);
  assert.equal(calls[0].p_owner_user_id,a);
  assert.equal(calls[0].p_capability_hash,calls[1].p_capability_hash);
  assert.notEqual(calls[0].p_capability_hash,calls[2].p_capability_hash);
});

test('admin assignment accepts only another allowlisted responsible account',async()=>{
 const handler=require('../lib/admin-support'); const assigned=[];
 const deps={auth:async()=>({user:{id:adminId},email:'admin@example.test'}),getSupportAssignees:()=>['admin@example.test','other@example.test'],client:{rpc:async(_,v)=>{assigned.push(v);return {data:{ok:true}}}}};
 for(const [assignTo,status] of [['outsider@example.test',400],['other@example.test',200]]) {
   const res=response();
   await handler(request('POST',{id:crypto.randomUUID(),requestId:crypto.randomUUID(),expectedVersion:1,action:'update',assignTo}),res,deps);
   assert.equal(res.statusCode,status);
 }
 assert.equal(assigned.length,1);
 assert.equal(assigned[0].p_assign_to,'other@example.test');
 assert.equal(assigned[0].p_actor,'admin:'+adminId);
});

test('admin ticket cursor and filters are forwarded only after authorization', async()=>{
 const handler=require('../lib/admin-support');
 const query={status:'resolved',category:'events',assignee:'other@example.test',before:'2026-11-17T12:00:00.123456+00:00',beforeId:crypto.randomUUID()};
 const req=request('GET',null,{query});
 let got;
 const deps={auth:async()=>({email:'admin@example.test'}),getSupportAssignees:()=>['other@example.test'],client:{rpc:async(name,args)=>{got={name,args};return {data:{ok:true,tickets:[],nextCursor:null}};}}};
 const denied=response();
 await handler(req,denied,{...deps,auth:async()=>({error:'no',status:403})});
 assert.equal(denied.statusCode,403); assert.equal(got,undefined);
 const ok=response(); await handler(req,ok,deps);
 assert.equal(ok.statusCode,200); assert.deepEqual(got,{name:'support_admin_list',args:{p_limit:50,p_status:query.status,p_category:query.category,p_assignee:query.assignee,p_before:query.before,p_before_id:query.beforeId}});
 const broken=response(); await handler(request('GET',null,{query:{before:query.before}}),broken,deps);
 assert.equal(broken.statusCode,400);
});

test('origin rejection and empty bearer stop before authentication or persistence', async () => {
 const handler=require('../lib/support-chat');
 const body={action:'read',token};
 for(const [headers,status,code] of [
   [{origin:'https://example.invalid'},403,'origin_not_allowed'],
   [{authorization:'Bearer '},401,'invalid_session']
 ]) {
   const res=response();
   await handler(request('POST',body,{headers}),res,{
     rateLimit:async()=>assert.fail('rate limit called'),
     rpc:async()=>assert.fail('RPC called'),
     auth:async()=>assert.fail('Auth called')
   });
   assert.equal(res.statusCode,status);
   assert.equal(res.body.code,code);
 }
});

test('expired bearer never falls back to guest or reaches the conversation RPC', async () => {
 const handler = require('../lib/support-chat');
 const res = response();
 let authCalls = 0;
 await handler(request('POST', {action:'read', token}, {headers:{authorization:'Bearer expired-fixture'}}), res, {
   rateLimit: allow,
   auth: async () => { authCalls++; return {error:'expired', status:401}; },
   rpc: async () => assert.fail('RPC called'),
 });
 assert.equal(authCalls, 1);
 assert.equal(res.statusCode, 401);
 assert.equal(res.body.code, 'invalid_session');
});

test('official public chat origins survive apex/www and proxy host differences', async () => {
 const handler = require('../lib/support-chat');
 const previous = process.env.SITE_URL;
 try {
   for (const [configured, hostname] of [['www.kinetichub.com.mx','kinetichub.com.mx'], ['kinetichub.com.mx','www.kinetichub.com.mx']]) {
     process.env.SITE_URL = 'https://' + configured;
     for (const host of [hostname, 'deployment.vercel.app']) {
       const res = response();
       await handler(request('POST', {action:'read', token}, {headers:{origin:'https://' + hostname,host}}), res, {
         rateLimit:allow, rpc:async()=>({data:{ok:true,messages:[]}})
       });
       assert.equal(res.statusCode, 200, JSON.stringify(res.body));
     }
   }
 } finally { process.env.SITE_URL = previous; }
});

test('public chat rejects attacker-controlled hosts and missing or non-exact origins', async () => {
 const handler = require('../lib/support-chat');
 for (const origin of [undefined, 'null', 'http://kinetichub.com.mx', 'https://kinetichub.com.mx:444', 'https://kinetichub.com.mx.evil.test', 'https://www.kinetichub.com.mx@evil.test', 'https://evil.test']) {
   const res = response();
   await handler(request('POST', {action:'read', token}, {headers:{origin,host:'kinetichub.com.mx','x-forwarded-host':'www.kinetichub.com.mx','sec-fetch-site':'same-origin'}}), res, {
     rateLimit:async()=>assert.fail('rate limit called'), rpc:async()=>assert.fail('RPC called')
   });
   assert.equal(res.statusCode, 403);
   assert.equal(res.body.code, 'origin_not_allowed');
 }
});

test('public origin policy never inherits admin SITE_URL or Vercel Preview', async (t) => {
 const {writeOriginAllowed} = require('../lib/_support');
 const handler = require('../lib/support-chat');
 const configured = {
   SITE_URL: 'https://configured.example.test',
   VERCEL_URL: 'preview.vercel.app'
 };
 for (const [name, value] of Object.entries(configured)) {
   const previous = process.env[name];
   t.after(() => {
     if (previous === undefined) delete process.env[name];
     else process.env[name] = previous;
   });
   process.env[name] = value;
 }
 for (const origin of [configured.SITE_URL, 'https://' + configured.VERCEL_URL, undefined]) {
   const req = request('POST', {action:'read', token}, {headers:{
     origin, host:origin ? new URL(origin).host : 'preview.vercel.app', 'sec-fetch-site':'same-origin'
   }});
   assert.equal(writeOriginAllowed(req), true);
   if (origin) assert.equal(writeOriginAllowed({...req, headers:{...req.headers,host:'other.test'}}), false);
   const res = response();
   await handler(req, res, {rateLimit:allow, rpc:async()=>({data:{ok:true,messages:[]}})});
   assert.equal(res.statusCode, 403, String(origin));
   assert.equal(res.body.code, 'origin_not_allowed');
 }
});

test('admin activity shows a stable display label without exposing account UUIDs', async () => {
 const handler=require('../lib/admin-support');
 const ticketId=crypto.randomUUID();
 const data={ok:true,ticket:{id:ticketId},activity:[{actor:'admin:'+adminId},{actor:'legacy@example.test'},{actor:'visitor'}]};
 const client={rpc:async()=>({data})};
 const read=response(), written=response();
 const auth=async()=>({user:{id:adminId},email:'changed@example.test'});
 await handler(request('GET',null,{query:{id:ticketId}}),read,{auth,client});
 await handler(request('POST',{id:ticketId,requestId:crypto.randomUUID(),expectedVersion:1,action:'reply',body:'QA'}),written,{auth,client});
 for(const res of [read,written]){
   assert.equal(res.statusCode,200);
   assert.match(res.body.activity[0].actor,/^Administrador · [0-9A-F]{12}$/u);
   assert.equal(res.body.activity[1].actor,'legacy@example.test');
   assert.equal(res.body.activity[2].actor,'visitor');
   assert.equal(JSON.stringify(res.body).includes(adminId),false);
 }
 assert.equal(read.body.activity[0].actor,written.body.activity[0].actor);
 assert.equal(data.activity[0].actor,'admin:'+adminId);
});

test('admin reply cannot inject its actor and missing verified ID fails before RPC', async () => {
 const handler=require('../lib/admin-support');
 const body={id:crypto.randomUUID(),requestId:crypto.randomUUID(),expectedVersion:1,action:'reply',body:'QA'};
 const client={rpc:async()=>assert.fail('unexpected RPC')};
 const invalid=response();
 await handler(request('POST',body),invalid,{auth:async()=>({email:'admin@example.test'}),client});
 assert.equal(invalid.statusCode,401);
 const spoof=response();
 await handler(request('POST',{...body,actor:'admin:'+adminId}),spoof,{auth:async()=>({user:{id:adminId},email:'admin@example.test'}),client});
 assert.equal(spoof.statusCode,400);
});

test('admin returns only configured labels for current authorized assignees', async () => {
 const handler=require('../lib/admin-support');
 const previous=process.env.SUPPORT_ASSIGNEE_LABELS;
 try {
   process.env.SUPPORT_ASSIGNEE_LABELS=JSON.stringify({'admin@example.test':'Equipo Operativo','inactive@example.test':'Private','other@example.test':'hidden@example.test'});
   const res=response();
   await handler(request('GET',null),res,{auth:async()=>({email:'admin@example.test'}),getSupportAssignees:()=>['admin@example.test','other@example.test'],client:{rpc:async()=>({data:{ok:true,tickets:[]}})}});
   assert.equal(res.statusCode,200);
   assert.deepEqual(res.body.assignees,['admin@example.test','other@example.test']);
   assert.deepEqual(res.body.assigneeLabels,{'admin@example.test':'Equipo Operativo'});
 } finally {
   if(previous===undefined) delete process.env.SUPPORT_ASSIGNEE_LABELS;
   else process.env.SUPPORT_ASSIGNEE_LABELS=previous;
 }
});


test('visitor ticket success survives optional intake failure and only start invokes it', async () => {
  const handler = require('../lib/support-chat');
  const ticket = {id:crypto.randomUUID(),status:'pending',category:'general',version:2};
  const saved={ok:true,ticket,messages:[{id:crypto.randomUUID(),author:'visitor',body:'Hola'}],hasMore:false};
  const call=async(action,dispatchIntake)=>{
    const req=request('POST', {
      action,token,...(action==='read'?{}:{requestId:crypto.randomUUID(),body:'Hola'}),
      ...(action==='start'?{category:'general',website:''}:{})
    });
    const res=response();
    await handler(req,res,{rpc:async()=>({data:saved}),rateLimit:allow,dispatchIntake});
    return res;
  };
  const failure=await call('start',async()=>{throw Error('agent offline');});
  assert.equal(failure.statusCode,200);
  assert.deepEqual(failure.body.messages,saved.messages);
  let touched=false;
  const read=await call('read',async()=>{touched=true;throw Error('unexpected');});
  assert.equal(read.statusCode,200);
  assert.equal(touched,false);
  const send=await call('send',async()=>{touched=true;throw Error('unexpected');});
  assert.equal(send.statusCode,200);
  assert.equal(touched,false);
});

test('support operator can POST a reply on either official same-origin host even if SITE_URL uses the other host', async () => {
  const handler = require('../lib/admin-support');
  const savedSite = process.env.SITE_URL;
  process.env.SITE_URL = 'https://www.kinetichub.com.mx';
  try {
    const mutations = [];
    const deps = {
      auth:async()=>({user:{id:adminId,email_confirmed_at:'confirmed',is_anonymous:false},email:'soporte@kinetichub.com.mx'}),
      getSupportAssignees:()=>['soporte@kinetichub.com.mx'],
      client:{rpc:async(name,args)=>{mutations.push(name);return {data:{ok:true,ticket:{id:args.p_ticket_id,version:3},messages:[]}}}}
    };
    const body = { id:crypto.randomUUID(),requestId:crypto.randomUUID(),expectedVersion:2,action:'reply',body:'Mensaje de prueba (no persistido)' };
    for (const host of ['kinetichub.com.mx','www.kinetichub.com.mx']) {
      const res = response();
      await handler(request('POST',body,{headers:{origin:'https://'+host,host,authorization:'Bearer fixture'}}),res,deps);
      assert.equal(res.statusCode,200,host);
    }
    for (const [origin,host] of [
      ['https://attacker.example','kinetichub.com.mx'],
      ['https://www.kinetichub.com.mx','kinetichub.com.mx'],
      ['https://kinetichub.com.mx','www.kinetichub.com.mx']
    ]) {
      const res=response();
      await handler(request('POST',body,{headers:{origin,host,authorization:'Bearer fixture'}}),res,deps);
      assert.equal(res.statusCode,403,origin+' / '+host);
    }
    assert.equal(mutations.length,2);
  } finally {
    if(savedSite===undefined)delete process.env.SITE_URL;
    else process.env.SITE_URL=savedSite;
  }
});
