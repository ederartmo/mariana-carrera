const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin-inscripciones.html'), 'utf8');
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {innerHTML:'', textContent:'', disabled:false, value:'all',
      addEventListener(event, callback) { this[event] = callback; }});
    return nodes.get(id);
  };
  const calls = [], rendered = [], timers = [];
  const client = {auth:{getSession: async () => ({data:{session:{access_token:'fixture-admin'}}})}};
  const context = vm.createContext({URLSearchParams, console, document:{getElementById:node},
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    escapeHtml: x => String(x), renderPaidInscriptions: rows => rendered.push(rows),
    fetch: (url, options) => new Promise((resolve,reject) => calls.push({url,options,resolve,reject})), client});
  vm.runInContext(`const adminUiState={searchTerm:'',eventSlug:'all',rowLimit:50,page:1,total:0,hasMore:false};
    let cachedRows=[],listRequestId=0,listLoading=false,searchTimer,tableScrollFollowerCleanup=null;`, context);
  const loadStart = source.indexOf('    // Request only the current server page');
  const loadEnd = source.indexOf('    // ====================== EMAILS DE RESEND',loadStart);
  vm.runInContext(source.slice(loadStart,loadEnd),context);
  const listenerStart = source.indexOf('      const reloadFirstPage =');
  const listenerEnd = source.indexOf('      const refreshEmailsBtn',listenerStart);
  vm.runInContext(`const rowsPerPage=document.getElementById('rowsPerPage'),searchFilter=document.getElementById('searchFilter'),
    eventFilter=document.getElementById('eventFilter'),statusFilter=document.getElementById('statusFilter'),
    inscriptionsSection=document.getElementById('inscriptionsSection');
    inscriptionsSection.scrollIntoView = () => { inscriptionsSection.scrolled = true; };
    ${source.slice(listenerStart,listenerEnd)}`,context);
  return {context,calls,rendered,node,timers,run: code => vm.runInContext(code,context)};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function respond(call,rows,total=2505) {call.resolve({ok:true,status:200,json:async()=>({rows,total,hasMore:rows.length>0})});}

test('initial load requests exactly one page of 50, navigation requests the next page', async()=>{
  const h=harness(), pending=h.run('loadPaidInscriptions(client,"all")'); await tick();
  assert.equal(h.calls.length,1);
  const params=new URL(h.calls[0].url,'http://fixture').searchParams;
  assert.equal(params.get('limit'),'50'); assert.equal(params.get('page'),'1');
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer fixture-admin');
  respond(h.calls[0],Array.from({length:50},(_,i)=>({id:i}))); await pending;
  assert.equal(h.rendered[0].length,50); assert.equal(h.calls.length,1);
  h.node('listNext').click(); await tick();
  assert.equal(new URL(h.calls[1].url,'http://fixture').searchParams.get('page'),'2');
  respond(h.calls[1],[{id:51}]); await tick();
  h.node('listPrevious').click(); await tick();
  assert.equal(new URL(h.calls[2].url,'http://fixture').searchParams.get('page'),'1');
  respond(h.calls[2],[{id:1}]); await tick();
});

test('mobile footer advances Cascanueces and keeps both pagers in sync', async () => {
  const h = harness();
  h.node('eventFilter').value = 'cascanueces-run';
  h.node('eventFilter').change();
  await tick();
  respond(h.calls[0], [{ id: 'first-page' }], 51);
  await tick();
  assert.equal(h.node('listNextBottom').disabled, false);
  h.node('listNextBottom').click();
  await tick();
  const params = new URL(h.calls[1].url, 'http://fixture').searchParams;
  assert.equal(params.get('event'), 'cascanueces-run');
  assert.equal(params.get('page'), '2');
  assert.equal(h.node('inscriptionsSection').scrolled, true);
  assert.equal(h.node('listNextBottom').disabled, true);
  h.calls[1].resolve({ ok: true, json: async () => ({
    rows: [{ id: 'last-page' }], total: 51, hasMore: false,
  }) });
  await tick();
  assert.match(h.node('listPageStatusBottom').textContent, /2 \/ 2/);
  assert.equal(h.node('listPageStatusBottom').textContent, h.node('listPageStatus').textContent);
  assert.equal(h.node('listNextBottom').disabled, true);
  assert.equal(h.node('listPreviousBottom').disabled, false);
  h.node('listPreviousBottom').click();
  await tick();
  assert.equal(new URL(h.calls[2].url, 'http://fixture').searchParams.get('page'), '1');
  respond(h.calls[2], [{ id: 'first-page' }], 51);
  await tick();
});

test('search, event, status and page size reset page and are sent to the server', async()=>{
  for(const [id,event,value,key] of [['rowsPerPage','change','200','limit'],['eventFilter','change','cascanueces-run','event'],
    ['statusFilter','change','cancelled','status'],['searchFilter','input','Runner 2505','search']]) {
    const h=harness(); h.run('adminUiState.page=8');h.node(id).value=value;h.node(id)[event]();
    if(id==='searchFilter') h.timers.at(-1)(); await tick();
    const params=new URL(h.calls[0].url,'http://fixture').searchParams;
    assert.equal(params.get('page'),'1');assert.equal(params.get(key),value);
    respond(h.calls[0],[{id:'beyond-first-page'}],1);await tick();
    assert.equal(h.rendered.at(-1)[0].id,'beyond-first-page');
  }
});

test('late success and failure cannot overwrite the latest result',async()=>{
  for(const failure of [false,true]) {
    const h=harness();const old=h.run('loadPaidInscriptions(client,"all")');await tick();
    h.run('adminUiState.searchTerm="latest"');const current=h.run('loadPaidInscriptions(client,"paid")');await tick();
    respond(h.calls[1],[{id:'latest'}],1);await current;
    if(failure) h.calls[0].reject(new Error('obsolete')); else respond(h.calls[0],[{id:'obsolete'}]);await old;
    assert.equal(h.rendered.length,1);assert.equal(h.rendered[0][0].id,'latest');
    assert.ok(!h.node('content').innerHTML.includes('obsolete'));
  }
});

test('typing invalidates requests before debounce and empty results remain empty',async()=>{
  const h=harness(),old=h.run('loadPaidInscriptions(client,"all")');await tick();
  h.node('searchFilter').value='no match';h.node('searchFilter').input();
  respond(h.calls[0],[{id:'stale'}]);await old;assert.equal(h.rendered.length,0);
  h.timers.at(-1)();await tick();respond(h.calls[1],[],0);await tick();
  assert.equal(h.rendered.at(-1).length,0);assert.equal(h.node('listNext').disabled,true);
  assert.equal(h.node('listPrevious').disabled,true);
});

test('a removed last-page row falls back to the last valid page',async()=>{
  const h=harness();h.run('adminUiState.page=3');const pending=h.run('loadPaidInscriptions(client,"all")');await tick();
  respond(h.calls[0],[],50);await tick();assert.equal(h.calls.length,2);
  assert.equal(new URL(h.calls[1].url,'http://fixture').searchParams.get('page'),'1');
  respond(h.calls[1],[{id:'remaining'}],50);await pending;
});
