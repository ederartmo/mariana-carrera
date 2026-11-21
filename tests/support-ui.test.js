const test = require('node:test');
const assert = require('node:assert/strict');
const support = require('../support-chat.js');

function element(tag) {
  return {
    tag, children: [], dataset: {}, value: '', hidden: true, textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this[name] = listener; },
    focus() {},
  };
}

test('desktop Enter sends one nonempty message and leaves Shift, IME and mobile alone', async () => {
  const nodes = new Map();
  const find = key => {
    if (!nodes.has(key)) nodes.set(key, element(key));
    return nodes.get(key);
  };
  find('[data-support-form]').querySelector = find;
  find('[name="category"]').value = 'general';
  let desktop = true, finish;
  const writes = [];
  support.mountPublicSupportChat({
    root: {querySelector: find},
    document: {createElement: element, createDocumentFragment: () => element('fragment'),
      defaultView: {matchMedia: () => ({matches: desktop})}},
    storage: {getItem: () => null, setItem() {}, removeItem() {}},
    fetch: async (_, options) => {
      writes.push(JSON.parse(options.body));
      await new Promise(resolve => { finish = resolve; });
      return {ok: true, json: async () => ({ok: true, messages: []})};
    },
  });
  const input = find('[name="supportMessage"]');
  function enter(properties = {}) {
    let prevented = false;
    input.keydown({key: 'Enter', preventDefault() { prevented = true; }, ...properties});
    return prevented;
  }
  input.value = '  ';
  assert.equal(enter(), true);
  input.value = '¿Me pueden apoyar?';
  assert.equal(enter({shiftKey: true}), false);
  assert.equal(enter({isComposing: true}), false);
  assert.equal(enter({keyCode: 229}), false);
  desktop = false;
  assert.equal(enter(), false);
  desktop = true;
  assert.equal(writes.length, 0);
  assert.equal(enter(), true);
  assert.equal(enter({repeat: true}), true);
  assert.equal(enter(), true);
  find('[data-support-form]').submit({preventDefault() {}});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body, '¿Me pueden apoyar?');
  finish();
  await new Promise(setImmediate);
  assert.equal(input.value, '');
});

test('resolved history is collapsible and the same transcript moves back on reopen', async () => {
  const nodes = new Map();
  const find = key => {
    if (!nodes.has(key)) nodes.set(key, element(key));
    return nodes.get(key);
  };
  find('[data-support-form]').querySelector = find;
  const previous = find('[data-support-previous]');
  const transcript = find('[data-support-messages]');
  previous.after = node => { assert.equal(node, transcript); previous.children = []; };
  const messages = [{id: 'first', author: 'visitor', body: 'Original'}];
  let status = 'resolved';
  const client = support.mountPublicSupportChat({
    root: {querySelector: find},
    document: {createElement: element, createDocumentFragment: () => element('fragment')},
    storage: {getItem: key => key === support.TOKEN_KEY ? 'guest-fixture' : null, setItem() {}, removeItem() {}},
    fetch: async () => ({ok: true, json: async () => ({ok: true, ticket: {status}, messages})}),
  });
  await new Promise(setImmediate);
  assert.equal(previous.hidden, false);
  assert.equal(previous.open, true);
  assert.deepEqual(previous.children, [transcript]);
  previous.open = false;
  await client.refresh();
  assert.equal(previous.open, false);
  status = 'pending';
  await client.refresh();
  assert.equal(previous.hidden, true);
  assert.equal(transcript.children[0].children[0].dataset.messageAnchor, 'first');
});

test('OXXO renders three steps with fixed, named actions and a token-free login return', () => {
  const {sources} = require('../lib/ai/kinetichub-knowledge');
  const {text} = sources.find(source => source.id === 'oxxo-registration');
  const reply = support.renderAssistantReply({createElement: element}, text);
  const [intro, steps] = reply.children;
  assert.match(intro.children.join(''), /comprobar si tu inscripción/);
  assert.equal(steps.tag, 'ol');
  assert.equal(steps.children.length, 3);
  const first = steps.children[0].children;
  const login = first.find(node => node.textContent === 'Iniciar sesión');
  const target = new URL(login.href, 'https://www.kinetichub.com.mx');
  assert.equal(target.pathname, '/auth.html');
  assert.equal(target.searchParams.get('mode'), 'login');
  assert.equal(target.searchParams.get('returnTo'), '/atencion.html?from=support-login#premium-conversation');
  assert.deepEqual([...target.searchParams.keys()], ['mode', 'returnTo']);
  assert.ok(first.every(part => typeof part !== 'string' || !part.includes('https://')));
  assert.match(steps.children[1].children.join(''), /Pendiente de pago/);
  assert.match(steps.children[2].children[0], /Tu referencia de pago OXXO está lista/);
  const untrusted = support.renderAssistantReply({createElement: element}, 'Ve a https://example.invalid/auth.html');
  assert.ok(untrusted.children[0].children.every(part => typeof part === 'string'));
});

test('login return and account switching keep guest and account histories separate in a shared tab', async () => {
  const markup = require('node:fs').readFileSync(require.resolve('../support-premium.js'), 'utf8');
  assert.match(markup, /Tu conversación anterior quedó guardada, pero no está vinculada a esta cuenta/);
  assert.match(markup, /no podemos verificar que seas la misma persona/);
  assert.doesNotMatch(markup, /Volver como invitado/);
  const guestToken = 'f'.repeat(64);
  const values = new Map([[support.TOKEN_KEY, guestToken], [support.PENDING_KEY, 'guest-draft']]);
  const sessionStorage = {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const accounts = id => ({ user: { id }, access_token: 'fixture-' + id });
  let session = accounts('a');
  const calls = [];
  const mount = async () => {
    const nodes = new Map();
    const root = element('section');
    const find = key => {
      if (!nodes.has(key)) nodes.set(key, element(key));
      return nodes.get(key);
    };
    root.querySelector = find;
    find('[data-support-form]').querySelector = find;
    find('[data-support-login-return]').querySelector = find;
    const events = {};
    let authChange, reloads = 0;
    const document = {
      querySelector: () => root, createElement: element, createDocumentFragment: () => element('fragment'),
      defaultView: {sessionStorage, location: {search: '?from=support-login', reload() { reloads++; }},
        addEventListener(name, listener) { events[name] = listener; }},
    };
    await support.connectPublicSupportChat({
      document,
      authClient: {auth: {getSession: async () => ({data: {session}}), onAuthStateChange(fn) { authChange = fn; }}},
      fetch: async (_, options) => {
        calls.push(options);
        return {ok: true, json: async () => ({ok: true, messages: [{id: 'm1', body: 'Account history', author: 'admin'}]})};
      },
    });
    await new Promise(setImmediate);
    return { root, find, events, change: next => { session = next; authChange('SIGNED_IN', next); }, reloads: () => reloads };
  };
  const first = await mount();
  assert.equal(values.size, 0);
  assert.equal(first.find('[data-support-login-return]').hidden, false);
  assert.equal(first.find('[data-support-form]').hidden, true);
  assert.equal(calls.length, 0, 'login return must wait for Continue');
  first.find('[data-support-continue-account]').click();
  await new Promise(setImmediate);
  assert.equal(first.find('[data-support-login-return]').hidden, true);
  assert.equal(first.find('[data-support-form]').hidden, false);
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-a');
  assert.notEqual(JSON.parse(calls[0].body).token, guestToken);
  assert.equal(first.find('[data-support-messages]').children.length, 1);
  first.find('[data-support-continue-account]').click();
  assert.equal(calls.length, 1);
  first.change(accounts('b'));
  assert.equal(first.root.hidden, true);
  assert.deepEqual(first.find('[data-support-messages]').children, []);
  assert.equal(first.reloads(), 1);
  first.find('[data-support-continue-account]').click();
  assert.equal(calls.length, 1);
  const second = await mount();
  assert.equal(second.find('[data-support-login-return]').hidden, true);
  assert.equal(calls[1].headers.Authorization, 'Bearer fixture-b');
  assert.notEqual(JSON.parse(calls[1].body).token, guestToken);
  second.events.pagehide();
  assert.deepEqual(second.find('[data-support-messages]').children, []);
  second.events.pageshow({persisted: true});
  assert.equal(second.reloads(), 1);
  session = null;
  await mount();
  assert.equal(calls.length, 2, 'logout must not reload the former guest capability');
});

test('public capability stays in session storage and restores server history', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const calls = [];
  const client = support.createPublicClient({ storage, crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } }, fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, ticket: { id: 't1', status: 'pending', category: 'general', version: 1 }, messages: [{ id: 'm1', author: 'visitor', body: 'Hola', created_at: 'now' }], hasMore: false }) };
  }, makeRequestId: () => '00000000-0000-4000-8000-000000000001' });
  const result = await client.start({ category: 'general', body: 'Hola' });
  assert.equal(result.messages[0].body, 'Hola');
  assert.match(values.get('kinetichub-support-token'), /^[a-f0-9]{64}$/);
  assert.equal(new URL(calls[0].url, 'https://site.test').search, '');
  assert.equal(JSON.stringify(calls[0].options).includes(values.get('kinetichub-support-token')), true);
  const restored = support.createPublicClient({ storage, fetch: async () => ({ ok: true, json: async () => ({ ok: true, ticket: result.ticket, messages: result.messages, hasMore: false }) }) });
  assert.equal((await restored.read()).messages.length, 1);
});

test('failed send retains the same operation id for an idempotent retry', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let ids = 0; let attempts = 0; const requestIds = [];
  const client = support.createPublicClient({ storage, crypto: { getRandomValues(bytes) { bytes.fill(9); return bytes; } }, makeRequestId: () => `id-${++ids}`, fetch: async (_url, options) => {
    const payload = JSON.parse(options.body); requestIds.push(payload.requestId); attempts++;
    if (attempts === 1) throw new Error('offline');
    return { ok: true, json: async () => ({ ok: true, ticket: { id: 't', status: 'pending', category: 'general', version: 1 }, messages: [{ id: 'm', author: 'visitor', body: payload.body, created_at: 'now' }], hasMore: false }) };
  } });
  await assert.rejects(client.start({ category: 'general', body: 'Hola' }), /offline/);
  await client.retryPending();
  assert.deepEqual(requestIds, ['id-1', 'id-1']);
});

test('admin reply sends one request id and stale version asks caller to reload', async () => {
  let calls = 0;
  const client = support.createAdminClient({ getToken: async () => 'bearer', makeRequestId: () => 'request-1', fetch: async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer bearer');
    return { ok: false, status: 409, json: async () => ({ error: 'stale' }) };
  } });
  await assert.rejects(client.update({ id: 'ticket', expectedVersion: 2, action: 'reply', body: 'Respuesta' }), error => error.status === 409);
  assert.equal(calls, 1);
});

test('public and admin renderers use text nodes, never interpolate visitor messages as HTML', () => {
  const source = require('node:fs').readFileSync(require.resolve('../support-chat.js'), 'utf8');
  assert.equal(source.includes('innerHTML'), false);
});

test('account transport uses current bearer only for the mounted identity and rejects switched responses', async () => {
  let current = { user:{id:'a'}, access_token:'fresh-a' };
  const calls=[];
  const transport=support.createSessionTransport({ownerId:'a',getSession:async()=>current,fetch:async(url,options)=>{
    calls.push({url,options}); return {ok:true};
  }});
  await transport('/api/support-chat',{headers:{'Content-Type':'application/json'}});
  assert.equal(calls[0].options.headers.Authorization,'Bearer fresh-a');
  assert.equal(calls[0].url,'/api/support-chat');
  current={user:{id:'b'},access_token:'fresh-b'};
  await assert.rejects(transport('/api/support-chat',{}),{status:401});
  assert.equal(calls.length,1);
  current={user:{id:'a'},access_token:'fresh-a'};
  const late=support.createSessionTransport({ownerId:'a',getSession:async()=>current,fetch:async()=>{current=null;return {ok:true};}});
  await assert.rejects(late('/api/support-chat',{}),{status:401});
});

test('admin client does not drop the selected responsible account', async () => {
  const client = support.createAdminClient({getToken:async()=> 'fixture',makeRequestId:()=> 'id',fetch:async(_,options)=>{
    assert.equal(JSON.parse(options.body).assignTo,'other@example.test');
    return {ok:true,json:async()=>({ok:true})};
  }});
  await client.update({id:'ticket',expectedVersion:2,action:'update',assignTo:'other@example.test'});
});

test('admin inbox clears private content and blocks a delayed response after logout', async () => {
  const { connect } = require('../admin-support.js');
  const old = globalThis.KineticHubSupport;
  globalThis.KineticHubSupport = support;
  let session = {user:{id:'a'},access_token:'fixture'};
  let authChange, done, started;
  const began = new Promise(r=>{started=r;});
  const gate = new Promise(r=>{done=r;});
  const elements = new Map();
  const element = key => {
    if(!elements.has(key))elements.set(key,{addEventListener(){},replaceChildren(){},querySelector:element});
    return elements.get(key);
  };
  const panel = element('[data-admin-support]');let cleared=false;
  panel.replaceChildren=()=>{cleared=true;};
  try {
    await connect({document:{querySelector:element},authClient:{auth:{
      getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{authChange=fn;}
    }},fetch:async()=>{started();return gate;}});
    await began;
    session=null;authChange('SIGNED_OUT',null);
    assert.equal(panel.hidden,true);assert.equal(cleared,true);
    let read=false;done({ok:true,json:async()=>{read=true;return {ok:true,tickets:[]};}});
    await new Promise(r=>setImmediate(r));
    assert.equal(read,false);
  } finally { globalThis.KineticHubSupport=old; }
});

test('guest transport drops inherited Authorization, account never forwards a blank token', async () => {
 let sent=0;
 const guest=support.createSessionTransport({ownerId:null,getSession:async()=>null,fetch:async(_,o)=>{
   sent++; assert.equal(Object.keys(o.headers).some(k=>k.toLowerCase()==='authorization'),false);
   return {ok:true};
 }});
 await guest('/api/support-chat',{headers:{authorization:'Bearer ', 'Content-Type':'application/json'}});
 const account=support.createSessionTransport({ownerId:'a',getSession:async()=>({user:{id:'a'},access_token:'  '}),fetch:async()=>assert.fail('blank token forwarded')});
 await assert.rejects(account('/api/support-chat'),{status:401});
 assert.equal(sent,1);
});

test('admin transport keeps the session for origin rejection and clears it for access denial', async () => {
  const { connect } = require('../admin-support.js');
  const old = globalThis.KineticHubSupport;
  let call, cleared = false, next, stopped = false;
  const notices = [];
  globalThis.KineticHubSupport = {
    ...support,
    createAdminClient: ({fetch}) => { call=fetch; return {list:async()=>({tickets:[]})}; },
    scheduleRefresh: () => () => { stopped=true; }
  };
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key,{addEventListener(){},replaceChildren(){},append(){},querySelector:element});
    return elements.get(key);
  };
  const panel = element('[data-admin-support]');
  panel.replaceChildren = () => {cleared=true;};
  try {
    await connect({
      document:{querySelector:element,createDocumentFragment:()=>({}),createElement:()=>({})},
      authClient:{auth:{getSession:async()=>({data:{session:{user:{id:'fixture'},access_token:'fixture'}}}),onAuthStateChange(){}}},
      fetch:async(_,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture');return next;},
      onAccessDenied:status=>notices.push(status)
    });
    next=Response.json({ok:false,code:'origin_not_allowed'},{status:403});
    const rejected=await call('/api/admin-support',{method:'POST'});
    assert.equal((await rejected.json()).code,'origin_not_allowed');
    assert.equal(cleared,false); assert.equal(stopped,false); assert.deepEqual(notices,[]);
    next=Response.json({ok:false},{status:403});
    await call('/api/admin-support',{method:'POST'});
    assert.equal(cleared,true); assert.equal(stopped,true); assert.deepEqual(notices,[403]);
  } finally { globalThis.KineticHubSupport=old; }
});

test('support portal reports session denial only via the shared authorization callback', () => {
 const html = require('node:fs').readFileSync(require.resolve('../soporte.html'),'utf8');
 assert.match(html,/onAccessDenied\(status\)/);
 assert.doesNotMatch(html,/response\.status === 401 \|\| response\.status === 403/);
});
