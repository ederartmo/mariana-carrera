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
