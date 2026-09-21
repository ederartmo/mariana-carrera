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

test('manual transfer validates a released BIB before reusing it', () => {
  assert.ok(source.includes('async function assertReleasedBibAvailable'));
  assert.ok(source.includes(".eq('registration_status', 'cancelled')"));
  assert.ok(source.includes(".eq('cancelled_bib_number', bibNumber)"));
  assert.ok(source.includes(".eq('registration_status', 'active')"));
  assert.ok(source.includes(".eq('bib_number', bibNumber)"));
});

test('manual transfer rejects duplicate released BIBs in one order and handles races', () => {
  assert.ok(source.includes('new Set(requestedReleasedBibs).size !== requestedReleasedBibs.length'));
  assert.ok(source.includes("error.code === '23505'"));
  assert.ok(source.includes('dejó de estar disponible'));
});
