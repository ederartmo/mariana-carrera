// tests/bib-availability.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('available BIB endpoint is admin-only and routed through consolidated API', () => {
  const handler = read('lib/admin-list-available-bibs.js');
  assert.ok(handler.includes('getAdminUser(req)'));
  assert.ok(handler.includes("supabase.rpc('get_available_event_bibs'"));
  assert.ok(read('api/data.js').includes("'admin-list-available-bibs': require('../lib/admin-list-available-bibs')"));
  assert.ok(read('vercel.json').includes('/api/admin-list-available-bibs'));
});

test('test hard-delete preserves assigned BIB in bib_releases before deleting', () => {
  const source = read('api/admin-delete-inscription.js');
  const releasePos = source.indexOf(".from('bib_releases')");
  const deletePos = source.indexOf(".from('inscripciones')\n      .delete()");
  assert.ok(releasePos >= 0);
  assert.ok(deletePos > releasePos, 'el ledger se escribe antes del hard delete');
  assert.ok(source.includes("source_type: 'test_deleted'"));
  assert.ok(source.includes('releasedBibs: releases.map'));
});

test('normal cancellation records an explicit BIB release event', () => {
  const source = read('lib/admin-cancel-registration.js');
  assert.ok(source.includes(".from('bib_releases')"));
  assert.ok(source.includes("source_type: 'cancellation'"));
  assert.ok(source.includes("source_key: `cancellation:${existing.id}`"));
});
