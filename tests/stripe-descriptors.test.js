'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const catalog = require('../event-catalog');
for (const [slug, suffix, length] of [['axolote-night-run', 'AXOLOTE', 19], ['cascanueces-run', 'CASCANUEZ', 21], ['perrun-2027', 'PERRUN', 18]]) {
  test('Central Stripe descriptor for ' + slug, () => {
    assert.equal(catalog.events[slug].statementDescriptorSuffix, suffix);
    assert.equal(catalog.getStatementDescriptorSuffix(slug), suffix);
    assert.equal((catalog.STRIPE_DESCRIPTOR_PREFIX + '* ' + suffix).length, length);
  });
}
test('Missing descriptor has no fallback to another race', () => {
  assert.throws(() => catalog.validateStatementDescriptorSuffix({ slug: 'future-race' }), /statementDescriptorSuffix is required for future-race/);
  assert.throws(() => catalog.getStatementDescriptorSuffix('future-race'), /statementDescriptorSuffix is required/);
});
for (const suffix of ['', '1234', '<RUN', '>RUN', 'RUN\\', "RUN'", 'RUN"', 'RUN*', 'RUN\n', 'CARRÉRA', 'axolote', ' RUN', 'RUN ', 'CASCANUECES', 'A'.repeat(11)]) {
  test('Reject invalid Stripe suffix ' + JSON.stringify(suffix), () => {
    assert.throws(() => catalog.validateStatementDescriptorSuffix({ slug: 'future-race', statementDescriptorSuffix: suffix }), /Stripe statementDescriptorSuffix/);
  });
}
test('Accept exactly 10 suffix characters: 22 including prefix and separator', () => {
  assert.equal(catalog.validateStatementDescriptorSuffix({ slug: 'future-race', statementDescriptorSuffix: 'MARATON-5K' }), 'MARATON-5K');
});
test('Invalid future race fails at catalog initialization before any Checkout can run', () => {
  const filename = require.resolve('../event-catalog');
  const source = fs.readFileSync(filename, 'utf8').replace("statementDescriptorSuffix:'AXOLOTE',", '');
  assert.throws(() => vm.runInNewContext(source, { module: { exports: {} }, require: createRequire(filename) }, { filename }), /statementDescriptorSuffix is required for axolote-night-run/);
});
