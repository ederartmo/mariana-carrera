// tests/registration-cancellation.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('cancel registration preserves payment and releases BIB', () => {
  const source = read('lib/admin-cancel-registration.js');
  assert.ok(source.includes("registration_status: 'cancelled'"));
  assert.ok(source.includes('cancelled_bib_number: releasedBibNumber'));
  assert.ok(source.includes('bib_number: null'));
  assert.ok(!source.includes('amount_paid:'));
  assert.ok(!source.includes("payment_status: 'cancelled'"));
});

test('cancel registration is admin-only and routed through consolidated API', () => {
  const handler = read('lib/admin-cancel-registration.js');
  const data = read('api/data.js');
  const vercel = read('vercel.json');
  assert.ok(handler.includes('getAdminUser(req)'));
  assert.ok(data.includes("'admin-cancel-registration': require('../lib/admin-cancel-registration')"));
  assert.ok(vercel.includes('/api/admin-cancel-registration'));
});

test('cancelled registrations are hidden from active user races and resend', () => {
  assert.ok(read('lib/me-registrations.js').includes(".eq('registration_status', 'active')"));
  assert.ok(read('api/resend-single-confirmation.js').includes(".eq('registration_status', 'active')"));
  assert.ok(read('api/resend-confirmations.js').includes(".eq('registration_status', 'active')"));
});

test('manual payment status correction is restricted and history-safe', () => {
  const source = read('lib/admin-update-manual-payment-status.js');
  assert.ok(source.includes("new Set(['paid', 'refunded', 'duplicate'])"));
  assert.ok(source.includes("startsWith('manual_')"));
  assert.ok(source.includes("registration_status !== 'cancelled'"));
  assert.ok(source.includes(".update({ payment_status: cleanStatus })"));
  assert.ok(!source.includes('amount_paid: clean'));
  assert.ok(read('api/data.js').includes("'admin-update-manual-payment-status': require('../lib/admin-update-manual-payment-status')"));
  assert.ok(read('vercel.json').includes('/api/admin-update-manual-payment-status'));
});

test('admin exposes cancelled filter and cancel action', () => {
  for (const file of ['admin-inscripciones.html', 'public/admin-inscripciones.html']) {
    const source = read(file);
    assert.ok(source.includes('<option value="cancelled">Anuladas</option>'));
    assert.ok(source.includes('data-cancel-registration-id'));
    assert.ok(source.includes('El historial del pago se conservó'));
    assert.ok(source.includes('data-payment-status-id'));
    assert.ok(source.includes('pagado, reembolsado o duplicado'));
  }
});
