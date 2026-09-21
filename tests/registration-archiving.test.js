// tests/registration-archiving.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('archive attempt is admin-only, live-only and preserves Stripe history', () => {
  const source = read('lib/admin-archive-attempt.js');
  assert.ok(source.includes('getAdminUser(req)'));
  assert.ok(source.includes("new Set(['pending', 'payment_failed'])"));
  assert.ok(source.includes("orderId.startsWith('cs_live_') && stripeId.startsWith('cs_live_')"));
  assert.ok(source.includes("registration_status: 'archived'"));
  assert.ok(source.includes('archived_at: archivedAt'));
  assert.ok(source.includes('archived_by: auth.email'));
  assert.ok(source.includes('archive_reason: cleanReason || null'));
  assert.ok(!source.includes('amount_paid:'));
  assert.ok(!source.includes('delete()'));
});

test('archive action is routed through consolidated API without adding a Vercel function', () => {
  assert.ok(read('api/data.js').includes("'admin-archive-attempt': require('../lib/admin-archive-attempt')"));
  assert.ok(read('vercel.json').includes('/api/admin-archive-attempt'));
});

test('late Stripe payment reactivates an archived checkout before fulfillment', () => {
  const source = read('api/stripe-webhook.js');
  assert.ok(source.includes("registration_status: 'active'"));
  assert.ok(source.includes('archived_at: null'));
  assert.ok(source.includes('archived_by: null'));
  assert.ok(source.includes('archive_reason: null'));
  assert.ok(source.includes(".eq('registration_status', 'archived')"));
});

test('single confirmation resend only reads active paid orders', () => {
  const source = read('api/resend-single-confirmation.js');
  assert.ok(source.includes(".eq('registration_status', 'active')"));
  assert.ok(source.includes(".in('payment_status', ['paid', 'paid_no_email'])"));
});
