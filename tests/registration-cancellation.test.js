// tests/registration-cancellation.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('cancel registration keeps history, releases BIB and stores structured outcome', () => {
  const source = read('lib/admin-cancel-registration.js');
  assert.ok(source.includes("registration_status: 'cancelled'"));
  assert.ok(source.includes('cancellation_type: cleanCancellationType'));
  assert.ok(source.includes('cancelled_bib_number: releasedBibNumber'));
  assert.ok(source.includes('bib_number: null'));
  assert.ok(source.includes("cleanCancellationType === 'duplicate'"));
  assert.ok(source.includes("updates.payment_status = 'duplicate'"));
  assert.ok(source.includes("cleanCancellationType === 'refunded'"));
  assert.ok(source.includes("updates.payment_status = 'refunded'"));
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

test('admin exposes cancelled filter and cancel action', () => {
  for (const file of ['admin-inscripciones.html', 'public/admin-inscripciones.html']) {
    const source = read(file);
    assert.ok(source.includes('<option value="cancelled">Anuladas</option>'));
    assert.ok(source.includes('data-cancel-registration-id'));
    assert.ok(source.includes('data-cancel-registration-order'));
    assert.ok(source.includes('duplicado, reembolsado o cancelar'));
    assert.ok(source.includes("cancellationType = 'participation_cancelled'"));
    assert.ok(!source.includes('data-payment-status-id'));
    assert.ok(!source.includes('Estado pago'));
  }
});
