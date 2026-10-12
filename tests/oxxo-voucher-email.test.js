'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendOxxoVoucherEmail, renderVoucherEmail, MARKER } = require('../lib/_oxxo-voucher-email');
function fixture() {
  const now = Date.now();
  const session = { id: 'cs_fixture', status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_fixture', customer_email: 'runner@example.invalid', amount_total: 50000, currency: 'mxn', metadata: { event_slug: 'cascanueces-run', distance: '10K', participant_1_name: 'Ana <Runner>' } };
  const pi = { id: 'pi_fixture', status: 'requires_action', payment_method: { type: 'oxxo' }, next_action: { type: 'oxxo_display_details', oxxo_display_details: { number: '123456', hosted_voucher_url: 'https://payments.stripe.com/fixture' } } };
  const event = { type: 'checkout.session.completed', created: Math.floor(now / 1000), data: { object: structuredClone(session) } };
  const sends = [], accepted = new Map(), marks = [], logs = [];
  const stripe = { checkout: { sessions: {
    retrieve: async () => structuredClone(session),
    update: async (id, patch) => { marks.push(patch); Object.assign(session.metadata, patch.metadata); },
    listLineItems: async () => ({ data: [{ description: 'Perrun 2027 · 5K' }] }),
  } }, paymentIntents: { retrieve: async () => structuredClone(pi) } };
  const resend = { emails: { send: async (payload, options) => {
    const previous = accepted.get(options.idempotencyKey);
    if (previous) { assert.deepEqual(previous.payload, payload); return previous.result; }
    sends.push({ payload, options }); const result = { data: { id: 'email_fixture' } }; accepted.set(options.idempotencyKey, { payload, result }); return result;
  } } };
  const logger = { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
  return { session, pi, event, sends, marks, logs, stripe, resend, logger, now };
}
test('A: generated OXXO voucher sends once and persists separate Stripe receipt', async () => {
  const f = fixture(); assert.equal((await sendOxxoVoucherEmail(f)).ok, true);
  assert.equal(f.sends.length, 1); assert.equal(f.session.metadata[MARKER], 'email_fixture');
  assert.equal(f.pi.status, 'requires_action'); assert.equal(f.session.payment_status, 'unpaid');
  assert.equal(f.sends[0].options.idempotencyKey, 'oxxo-voucher/pi_fixture');
  assert.equal(f.sends[0].payload.subject, 'Tu referencia de pago OXXO está lista');
  assert.match(f.sends[0].payload.html, /Ana &lt;Runner&gt;/);
  assert.match(f.sends[0].payload.text, /Cascanueces Run 2026 · 10K/);
  assert.doesNotMatch(JSON.stringify(f.sends), /123456|payments.stripe.com/);
});
test('B: pending card and paid card send no OXXO email', async () => {
  const f = fixture(); f.pi.payment_method.type = 'card'; await sendOxxoVoucherEmail(f);
  f.event.data.object.payment_status = 'paid'; await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 0);
});
test('C: failed creation or missing voucher never sends', async () => {
  for (const change of [f => { f.pi.status = 'requires_payment_method'; }, f => { f.pi.next_action = null; }, f => { delete f.pi.next_action.oxxo_display_details.number; }, f => { f.event.data.object.payment_intent = null; }]) {
    const f = fixture(); change(f); await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 0);
  }
});
test('D: repetition, concurrent deliveries and missing receipt reuse provider idempotency', async () => {
  const f = fixture(); await Promise.all([sendOxxoVoucherEmail(f), sendOxxoVoucherEmail(f)]);
  await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 1);
  delete f.session.metadata[MARKER]; await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 1);
  f.now += 24 * 3600 * 1000; await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 1);
});
test('E: Resend errors and exceptions preserve voucher and leave receipt unset', async () => {
  for (const send of [async () => ({ error: { message: 'Down' } }), async () => { throw Error('Down'); }]) {
    const f = fixture(); f.resend.emails.send = send;
    assert.equal((await sendOxxoVoucherEmail(f)).ok, false); assert.equal(f.marks.length, 0);
    assert.equal(f.pi.status, 'requires_action'); assert.ok(f.pi.next_action.oxxo_display_details.number); assert.equal(f.logs.length, 1);
  }
});
test('Receipt write failure is nonfatal and repetition within window does not duplicate', async () => {
  const f = fixture(); f.stripe.checkout.sessions.update = async () => { throw Error('Stripe unavailable'); };
  assert.equal((await sendOxxoVoucherEmail(f)).ok, false); await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 1);
});
test('Other events, confirmed payment, engraving and unknown events never send', async () => {
  for (const change of [f => { f.event.type = 'checkout.session.async_payment_succeeded'; }, f => { f.session.payment_status = 'paid'; }, f => { f.event.data.object.metadata.flow = 'perrun-engraving-v1'; }, f => { f.event.data.object.metadata.event_slug = 'unknown'; }]) {
    const f = fixture(); change(f); await sendOxxoVoucherEmail(f); assert.equal(f.sends.length, 0);
  }
});
test('Perrun distance uses Stripe line items without DB access', async () => {
  const f = fixture(); f.session.metadata.event_slug = f.event.data.object.metadata.event_slug = 'perrun-2027'; delete f.session.metadata.distance;
  await sendOxxoVoucherEmail(f); assert.match(f.sends[0].payload.text, /Perrun 2027 · 5K/);
});
test('HTML is inline, table based, escaped and includes requested guidance plus plaintext', () => {
  const result = renderVoucherEmail({ name: 'Ana', email: 'ana@example.invalid', eventName: 'Evento', distance: '5K', amount: 50000, currency: 'mxn' });
  for (const content of [result.html, result.text]) {
    assert.match(content, /hasta 24 horas/); assert.match(content, /otro correo confirmando tu inscripción/); assert.match(content, /Conserva tu ticket/); assert.match(content, /fotografía de tu comprobante/);
  }
  assert.match(result.html, /role="presentation"/); assert.doesNotMatch(result.html, /<script|<style|display:flex|display:grid/);
});
