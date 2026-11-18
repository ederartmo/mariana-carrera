const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVisiblePoll } = require('../support-premium.js');

test('polls only while visible and never overlaps pending work', async () => {
  let visible = false, calls = 0, release;
  const tick = createVisiblePoll(() => visible, async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
  });
  await tick();
  assert.equal(calls, 0);
  visible = true;
  const request = tick();
  await tick();
  assert.equal(calls, 1);
  release();
  await request;
  const next = tick();
  assert.equal(calls, 2);
  release();
  await next;
});

test('mounted refresh preserves a draft and cannot repaint after identity changes', async () => {
  const { mountPublicSupportChat } = require('../support-chat.js');
  const entries = new Map();
  const elt = () => ({ value: '', addEventListener() {}, replaceChildren() {}, append() {} });
  const root = { querySelector: key => {
    if (!entries.has(key)) entries.set(key, elt());
    return entries.get(key);
  } };
  root.querySelector('[data-support-form]').querySelector = () => elt();
  const store = new Map([['kinetichub-support-token', 'fixture']]);
  const storage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  let active = true, resolve, ticketCount = 0;
  const client = mountPublicSupportChat({
    root, storage, crypto: globalThis.crypto, isActive: () => active,
    document: { createDocumentFragment: elt },
    onTicket: ticket => { if (ticket) ticketCount++; },
    fetch: () => new Promise(accept => { resolve = () => accept({ ok: true, json: async () => ({ ok: true, ticket: { status: 'pending' }, messages: [] }) }); }),
  });
  const draft = root.querySelector('[name="supportMessage"]');
  draft.value = 'No borrar este borrador';
  resolve();
  await new Promise(setImmediate);
  const refresh = client.refresh();
  resolve();
  await refresh;
  assert.equal(ticketCount, 2);
  assert.equal(draft.value, 'No borrar este borrador');
  const stale = client.refresh();
  active = false;
  resolve();
  await stale;
  assert.equal(ticketCount, 2);
});

test('premium page declaration prevents legacy launcher creation before deferred scripts run', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const path = require('node:path');
  const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const pages = ['index', 'eventos', 'evento', 'axolote-night-run', 'cascanueces-run', 'perrun-2027', 'contacto', 'atencion'];
  for (const prefix of ['', 'public/']) {
    for (const page of pages) {
      const html = read(prefix + page + '.html');
      assert.equal([...html.matchAll(/<body\b[^>]*\bdata-premium-support\b/g)].length, 1, prefix + page);
    }
    const source = read(prefix + 'script.min.js').match(/function setupWhatsAppButton\(\) \{[\s\S]*?\n\}/)[0];
    let premium = true, additions = 0;
    const document = {
      title: 'Kinetic Hub',
      querySelector: () => null,
      createElement: () => ({}),
      body: { hasAttribute: key => premium && key === 'data-premium-support', appendChild: () => additions++ },
    };
    vm.runInNewContext(source + '\nsetupWhatsAppButton();', { document });
    assert.equal(additions, 0);
    premium = false;
    vm.runInNewContext(source + '\nsetupWhatsAppButton();', { document });
    assert.equal(additions, 1);
  }
});

test('visible polling reserves at least 40 requests hourly for user activity', () => {
  const { POLL_INTERVAL_MS } = require('../support-premium.js');
  assert.ok(POLL_INTERVAL_MS < 75000);
  assert.ok(Math.ceil(3600000 / POLL_INTERVAL_MS) <= 60);
});
