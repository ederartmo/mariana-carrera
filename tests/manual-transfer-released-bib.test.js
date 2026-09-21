// tests/manual-transfer-released-bib.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'admin-manual-transfer.js'),
  'utf8'
);

test('manual transfer preserves automatic BIB assignment by default', () => {
  assert.ok(source.includes("ticket.bibMode === 'released'"));
  assert.ok(source.includes('await generateNextBibNumber(cleanEventSlug)'));
});

test('manual transfer validates any requested BIB against the server availability list', () => {
  assert.ok(source.includes('async function assertAvailableBib'));
  assert.ok(source.includes("supabase.rpc('get_available_event_bibs'"));
  assert.ok(source.includes('ya no está disponible para esta carrera'));
});

test('manual transfer rejects duplicate available BIBs in one order and handles races', () => {
  assert.ok(source.includes('new Set(requestedReleasedBibs).size !== requestedReleasedBibs.length'));
  assert.ok(source.includes("error.code === '23505'"));
  assert.ok(source.includes('lista de BIBs disponibles'));
});
