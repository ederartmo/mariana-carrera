const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../admin-inscripciones.html'), 'utf8');

test('legacy NULL distance can open and submit name corrections without inventing distance', async () => {
  const row = { id: 'fixture', email: 'runner@example.test', event_slug: 'cascanueces-run', payment_status: 'paid', full_name: 'Runner Original', shirt_size: 'M', birth_date: '1990-04-11', whatsapp: '+525512345678', state: 'Jalisco', borough: null, distance: null };
  const nodes = {};
  const node = (id) => nodes[id] ||= { value: '', innerHTML: '', textContent: '', disabled: false, hidden: true, addEventListener(type, fn) { this[type] = fn; } };
  let submitted;
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'fake' } } }) } };
  const context = { cachedRows: [row], document: { getElementById: node }, window: { confirm: () => true, KineticHubEventCatalog: { resolveEvent: () => ({ distances: ['5K', '10K'] }) } }, URLSearchParams,
    fetch: async (_, options) => { if (options.method === 'POST') submitted = JSON.parse(options.body); return { ok: true, json: async () => ({ inscription: row, history: [] }) }; },
    escapeHtml: String, setParticipantModalError: () => {}, manualTodayISO: () => '2026-11-10', manualStateOptions: () => '', refreshEditBorough: () => {}, refreshEditAge: () => {}, renderParticipantHistory: () => {}, isManualCdmxTicket: () => false, manualTicketError: () => '', renderPaidInscriptions: () => {}, client };
  const code = html.slice(html.indexOf('    async function openParticipantModal(id)'), html.indexOf('    function setupDeleteActions(client)'));
  vm.runInNewContext(`let editingParticipant=null; let participantModalLoadId=0; ${code}; setupParticipantModal(client); globalThis.openEditor=openParticipantModal;`, context);
  await context.openEditor(row.id);
  assert.equal(node('editDistance').disabled, false);
  assert.equal(node('editDistance').required, false);
  assert.match(node('editDistance').innerHTML, /Sin distancia/);
  node('editFullName').value = 'Corrected Name';
  await node('participantEditForm').submit({ preventDefault() {} });
  assert.equal(submitted.participant.fullName, 'Corrected Name');
  assert.equal(Object.hasOwn(submitted.participant, 'distance'), false);
  assert.equal(submitted.expectedSnapshot.distance, null);
});

test('participant editor reuses its modal for distance and keeps the six existing fields', () => {
  for (const id of ['editFullName', 'editShirtSize', 'editBirthDate', 'editWhatsapp', 'editState', 'editBorough', 'editDistance']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing existing/new editor control ${id}`);
  }
  assert.match(html, /participantModal/);
  assert.doesNotMatch(html, /substitut(?:e|ion|ing)|transfer(?:encia)? de titularidad/i);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/src\s*=/.test(match[1])) new vm.Script(match[2]);
  }
});

test('participant editor loads durable history and submits the loaded snapshot atomically', () => {
  assert.match(html, /admin-update-participant[\s\S]{0,350}method:\s*['"]GET['"]/);
  assert.match(html, /participantHistory|Historial administrativo/);
  assert.match(html, /expectedSnapshot/);
  assert.match(html, /shirt_size/);
  assert.match(html, /distance/);
  assert.match(html, /expectedSnapshot:\s*(?:editingParticipant|edit)\.snapshot/);
  assert.match(html, /setParticipantModalError\(err\.message \|\| 'Error al guardar\.'\)/);
});

test('participant history renders database audit fields against camel-case before/after snapshots', () => {
  const start = html.indexOf('    function renderParticipantHistory(history) {');
  const end = html.indexOf('    async function openParticipantModal', start);
  assert.ok(start >= 0 && end > start, 'history renderer should remain a focused existing-editor function');
  const container = { innerHTML: '', textContent: '' };
  const context = {
    document: { getElementById: (id) => id === 'participantHistory' ? container : null },
    escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  };
  const renderer = html.slice(start, end);
  vm.runInNewContext(`${renderer}\nrenderParticipantHistory(${JSON.stringify([{
    admin_email: 'admin@example.test',
    changed_fields: ['full_name', 'shirt_size', 'distance'],
    before: { fullName: 'Ana Ruiz', shirtSize: 'M', distance: '5K' },
    after: { fullName: 'Ana Ríos', shirtSize: 'L', distance: '10K' },
    created_at: '2026-11-10T10:00:00.000Z',
  }])});`, context);
  assert.match(container.innerHTML, /Nombre: Ana Ruiz → Ana Ríos/);
  assert.match(container.innerHTML, /Talla: M → L/);
  assert.match(container.innerHTML, /Distancia: 5K → 10K/);
  assert.doesNotMatch(container.innerHTML, /— → —/);
});

test('second-delivery request remains documentation-only with approvals, deadlines, notifications', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/admin-changes-delivery-one.md'), 'utf8');
  assert.ok(/delivery two/i.test(doc));
  assert.ok(/change requests/i.test(doc));
  assert.ok(/approval/i.test(doc));
  assert.ok(/deadlines/i.test(doc));
  assert.ok(/notifications/i.test(doc));
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function editorHarness() {
  const base = { email: 'runner@example.test', event_slug: 'cascanueces-run', payment_status: 'paid', registration_status: 'active', full_name: 'Runner Original', shirt_size: 'M', birth_date: '1990-04-11', whatsapp: '+525512345678', state: 'Jalisco', borough: null, distance: '5K' };
  const rows = [{ ...base, id: 'a' }, { ...base, id: 'b', full_name: 'Runner B' }];
  const nodes = {}, errors = [], requests = [];
  const node = id => nodes[id] ||= { value: '', innerHTML: '', textContent: '', disabled: false, hidden: true, addEventListener(type, fn) { this[type] = fn; } };
  const response = row => ({ ok: true, json: async () => ({ inscription: row, history: [] }) });
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } };
  const h = { nodes, rows, errors, requests, client, response, get: async id => response(rows.find(r => r.id === id)), post: async body => response({ ...rows.find(r => r.id === body.id), full_name: body.participant.fullName }) };
  const context = { cachedRows: rows, document: { getElementById: node }, window: { confirm: () => true, KineticHubEventCatalog: { resolveEvent: () => ({ distances: ['5K', '10K'] }) } }, URLSearchParams,
    fetch: async (url, options) => { if (options.method === 'POST') { const body = JSON.parse(options.body); requests.push(body); return h.post(body); } return h.get(new URLSearchParams(url.split('?')[1]).get('id')); },
    escapeHtml: String, setParticipantModalError: value => { if (value) errors.push(value); }, manualTodayISO: () => '2026-11-15', manualStateOptions: () => 'Jalisco', refreshEditBorough: () => {}, refreshEditAge: () => {}, renderParticipantHistory: () => {}, isManualCdmxTicket: () => false, manualTicketError: () => '', renderPaidInscriptions: () => {}, client };
  const code = html.slice(html.indexOf('    async function openParticipantModal(id)'), html.indexOf('    function setupDeleteActions(client)'));
  vm.runInNewContext(`let editingParticipant=null; let participantModalLoadId=0; ${code}; setupParticipantModal(client); globalThis.openEditor=openParticipantModal; globalThis.closeEditor=closeParticipantModal;`, context);
  h.open = context.openEditor; h.close = context.closeEditor;
  node('participantSaveBtn');
  h.submit = () => node('participantEditForm').submit({ preventDefault() {} });
  return h;
}

test('opening another participant invalidates the old form while its GET is pending', async () => {
  const h = editorHarness(); await h.open('a');
  const gate = deferred(); h.get = () => gate.promise;
  const loading = h.open('b');
  assert.equal(h.nodes.participantSaveBtn.disabled, true);
  await h.submit(); assert.equal(h.requests.length, 0);
  gate.resolve(h.response(h.rows[1])); await loading;
  assert.equal(h.nodes.participantSaveBtn.disabled, false);
});

test('submission remains bound to A while authentication awaits and B opens', async () => {
  const h = editorHarness(); await h.open('a');
  h.nodes.editFullName.value = 'Updated A';
  const gate = deferred(); h.client.auth.getSession = () => gate.promise;
  const saving = h.submit();
  h.client.auth.getSession = async () => ({ data: { session: { access_token: 'synthetic' } } });
  await h.open('b');
  gate.resolve({ data: { session: { access_token: 'synthetic' } } }); await saving;
  assert.equal(h.requests[0].id, 'a');
  assert.equal(h.requests[0].expectedSnapshot.fullName, 'Runner Original');
  assert.equal(h.rows[0].full_name, 'Updated A'); assert.equal(h.rows[1].full_name, 'Runner B');
  assert.equal(h.nodes.participantModal.hidden, false);
  assert.equal(h.nodes.editFullName.value, 'Runner B');
  assert.deepEqual(h.errors, []);
});

test('closing during POST does not report a false failure after a successful save', async () => {
  const h = editorHarness(); await h.open('a'); h.nodes.editFullName.value = 'Updated A';
  const gate = deferred(), started = deferred(); h.post = () => { started.resolve(); return gate.promise; };
  const saving = h.submit(); await started.promise; h.close();
  gate.resolve(h.response({ ...h.rows[0], full_name: 'Updated A' })); await saving;
  assert.equal(h.rows[0].full_name, 'Updated A'); assert.deepEqual(h.errors, []);
  assert.equal(h.nodes.participantModal.hidden, true);
});

test('stale POST completion cannot enable or close a newer loading modal', async () => {
  const h = editorHarness(); await h.open('a');
  const post = deferred(), started = deferred(); h.post = () => { started.resolve(); return post.promise; };
  const saving = h.submit(); await started.promise;
  const get = deferred(); h.get = () => get.promise; const loading = h.open('b');
  post.resolve(h.response(h.rows[0])); await saving;
  assert.equal(h.nodes.participantSaveBtn.disabled, true);
  assert.equal(h.nodes.participantModal.hidden, false);
  get.resolve(h.response(h.rows[1])); await loading;
});

test('a server conflict remains visible and leaves local registration data unchanged', async () => {
  const h = editorHarness(); await h.open('a'); const before = JSON.stringify(h.rows);
  h.post = async () => ({ ok: false, status: 409, json: async () => ({ error: 'La inscripción cambió. Recárgala antes de guardar.' }) });
  await h.submit(); assert.equal(JSON.stringify(h.rows), before);
  assert.match(h.errors[0], /Recárgala/); assert.equal(h.nodes.participantModal.hidden, false);
  assert.equal(h.nodes.participantSaveBtn.disabled, false);
});

test('a freshly loaded cancellation prevents editing even when the cached list was active', async () => {
  const h = editorHarness(); h.get = async id => h.response({ ...h.rows.find(r => r.id === id), registration_status: 'cancelled' });
  await h.open('a'); await h.submit();
  assert.equal(h.requests.length, 0); assert.equal(h.nodes.participantSaveBtn.disabled, true);
  assert.equal(h.errors[0], 'No se puede modificar una inscripción cancelada.');
});

test('repeated submit while one save is pending does not create another request', async () => {
  const h = editorHarness(); await h.open('a'); const gate = deferred(), started = deferred();
  h.post = () => { started.resolve(); return gate.promise; };
  const saving = h.submit(); await started.promise; await h.submit();
  assert.equal(h.requests.length, 1); gate.resolve(h.response(h.rows[0])); await saving;
});

test('registration search sends participant criteria and selected event to the server', async () => {
  const start = html.indexOf('    async function fetchAdminInscriptionsPage(');
  const end = html.indexOf('    async function loadPaidInscriptions(', start);
  const urls = [];
  const context = { URLSearchParams, fetch: async url => {
    urls.push(new URL(url, 'https://fixture.invalid'));
    return {ok:true,status:200,json:async()=>({rows:[],total:0,hasMore:false})};
  }};
  vm.runInNewContext(`${html.slice(start, end)};globalThis.load=fetchAdminInscriptionsPage;`, context);
  await context.load('fixture-token','all',1,'cascanueces-run',50,'520');
  assert.equal(urls[0].searchParams.get('event'),'cascanueces-run');
  assert.equal(urls[0].searchParams.get('search'),'520');
  await context.load('fixture-token','all',1,'all',50,'ANA');
  assert.equal(urls[1].searchParams.get('event'),'all');
  assert.equal(urls[1].searchParams.get('search'),'ANA');
});
