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
  assert.match(html, /expectedSnapshot:\s*editingParticipant\.snapshot/);
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
