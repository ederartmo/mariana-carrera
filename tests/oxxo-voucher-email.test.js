'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendOxxoVoucherEmail, renderVoucherEmail, MARKER } = require('../lib/_oxxo-voucher-email');
function fixture() {
  const now = Date.UTC(2026, 10, 14, 12);
  const session = { id: 'cs_fixture', status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_fixture', customer_email: 'runner@example.invalid', amount_total: 50000, currency: 'mxn', metadata: { event_slug: 'cascanueces-run', distance: '10K', participant_1_name: 'Ana <Runner>' } };
  const pi = { id: 'pi_fixture', status: 'requires_action', payment_method: { type: 'oxxo' }, next_action: { type: 'oxxo_display_details', oxxo_display_details: { number: '123456', hosted_voucher_url: 'https://payments.stripe.com/fixture', expires_after: Date.UTC(2026, 10, 16, 5, 59) / 1000 } } };
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
  for (const body of [f.sends[0].payload.html, f.sends[0].payload.text]) {
    assert.match(body, /Referencia: 123456/);
    assert.match(body, /https:\/\/payments\.stripe\.com\/fixture/);
    assert.match(body, /15 de noviembre de 2026/);
    assert.match(body, /23:59/);
    assert.match(body, /America\/Mexico_City/);
  }
  assert.match(f.sends[0].payload.html, /href="https:\/\/payments\.stripe\.com\/fixture"[^>]*>Descargar voucher oficial<\/a>/);
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
  const f = fixture();
  const result = renderVoucherEmail({ name: 'Ana', email: 'ana@example.invalid', eventName: 'Evento', distance: '5K', amount: 50000, currency: 'mxn', hostedVoucherUrl: f.pi.next_action.oxxo_display_details.hosted_voucher_url, expiresAfter: f.pi.next_action.oxxo_display_details.expires_after, now: f.now });
  for (const content of [result.html, result.text]) {
    assert.match(content, /hasta 24 horas/); assert.match(content, /otro correo confirmando tu inscripción/); assert.match(content, /Conserva tu ticket/); assert.match(content, /fotografía de tu comprobante/);
  }
  assert.match(result.html, /role="presentation"/); assert.doesNotMatch(result.html, /<script|<style|display:flex|display:grid/);
});

test('Expired, missing or malformed voucher data never sends or persists a receipt', async () => {
  for (const change of [
    d => { delete d.hosted_voucher_url; }, d => { d.hosted_voucher_url = ''; },
    d => { delete d.expires_after; }, d => { d.expires_after = null; },
    d => { d.expires_after = '1794808740'; }, d => { d.expires_after = NaN; },
    d => { d.expires_after = Infinity; }, d => { d.expires_after = 1e15; },
    d => { d.expires_after = Date.UTC(2026, 10, 14, 12) / 1000; },
    d => { d.expires_after = Date.UTC(2026, 10, 14, 11) / 1000; },
    d => { d.hosted_voucher_url = 'javascript:alert(1)'; },
    d => { d.hosted_voucher_url = 'http://payments.stripe.com/fixture'; },
    d => { d.hosted_voucher_url = 'https://payments.stripe.com.evil.invalid/fixture'; },
    d => { d.hosted_voucher_url = 'https://evil.invalid/fixture'; },
    d => { d.hosted_voucher_url = 'https://user:password@payments.stripe.com/fixture'; },
  ]) {
    const f = fixture(); change(f.pi.next_action.oxxo_display_details);
    const before = structuredClone({ session: f.session, pi: f.pi });
    assert.deepEqual(await sendOxxoVoucherEmail(f), { skipped: true });
    assert.equal(f.sends.length, 0); assert.equal(f.marks.length, 0);
    assert.deepEqual({ session: f.session, pi: f.pi }, before);
  }
});

test('Renderer cannot advertise an unavailable voucher and escapes reference and URL', () => {
  const f = fixture();
  const args = { name: '<img src=x>', email: 'a&b@example.invalid', eventName: '<Event>', distance: '5K', amount: 50000, currency: 'mxn', reference: '123<&"\'', hostedVoucherUrl: 'https://payments.stripe.com/fixture?a=1&label=<voucher>"\'', expiresAfter: f.pi.next_action.oxxo_display_details.expires_after, now: f.now };
  const result = renderVoucherEmail(args);
  assert.match(result.html, /Referencia: 123&lt;&amp;&quot;&#39;/);
  assert.match(result.html, /href="https:\/\/payments.stripe.com\/fixture\?a=1&amp;label=&lt;voucher&gt;&quot;&#39;"/);
  assert.doesNotMatch(result.html, /<img|<Event>|<voucher>/);
  assert.ok(result.text.includes(args.hostedVoucherUrl));
  assert.ok(result.text.includes(args.reference));
  const withoutNumber = renderVoucherEmail({ ...args, reference: undefined });
  assert.doesNotMatch(withoutNumber.text, /Referencia:/);
  assert.match(withoutNumber.text, /https:\/\/payments.stripe.com/);
  for (const patch of [{ hostedVoucherUrl: undefined }, { expiresAfter: undefined }, { expiresAfter: f.now / 1000 }, { hostedVoucherUrl: 'javascript:alert(1)' }]) {
    assert.throws(() => renderVoucherEmail({ ...args, ...patch }), /Voucher unavailable or expired/);
  }
});

test('Missing Resend receipt and legacy payload conflicts never mark success or change payment', async () => {
  for (const response of [{}, { data: {} }, { data: { id: 'ignored' }, error: { message: 'Down' } }, { error: { name: 'invalid_idempotent_request', message: 'Legacy payload differs' } }]) {
    const f = fixture(); let calls = 0;
    f.resend.emails.send = async () => { calls++; return response; };
    const before = structuredClone({ session: f.session, pi: f.pi });
    assert.deepEqual(await sendOxxoVoucherEmail(f), { ok: false });
    assert.equal(calls, 1); assert.equal(f.marks.length, 0);
    assert.deepEqual({ session: f.session, pi: f.pi }, before);
  }
});

test('Previously sent receipt suppresses the new template without any automatic resend', async () => {
  const f = fixture(); f.session.metadata[MARKER] = 'legacy_email';
  assert.deepEqual(await sendOxxoVoucherEmail(f), { skipped: true });
  assert.equal(f.sends.length, 0); assert.equal(f.marks.length, 0);
});

test('Existing Stripe identity, status, currency and recipient guards remain fail closed', async () => {
  for (const change of [
    f => { f.session.status = 'open'; }, f => { f.session.payment_intent = 'pi_other'; },
    f => { f.pi.id = 'pi_other'; }, f => { f.pi.next_action.type = 'other'; },
    f => { f.session.currency = 'usd'; }, f => { f.session.amount_total = -1; },
    f => { delete f.session.customer_email; },
    f => { delete f.session.metadata.event_slug; },
  ]) {
    const f = fixture(); change(f);
    const before = structuredClone({ session: f.session, pi: f.pi });
    const result = await sendOxxoVoucherEmail(f);
    assert.ok(result.skipped || result.ok === false);
    assert.equal(f.sends.length, 0); assert.equal(f.marks.length, 0);
    assert.deepEqual({ session: f.session, pi: f.pi }, before);
  }
});

test('Voucher email never exposes provider client secrets or unrelated metadata', async () => {
  const f = fixture();
  const secret = 'TEST_ONLY_CLIENT_SECRET_DO_NOT_SEND';
  const credential = 'TEST_ONLY_CREDENTIAL_DO_NOT_SEND';
  f.pi.client_secret = secret;
  f.event.data.object.client_secret = secret;
  f.session.metadata.internal_api_key = credential;
  assert.equal((await sendOxxoVoucherEmail(f)).ok, true);
  const output = JSON.stringify({ sends: f.sends, logs: f.logs, marks: f.marks });
  assert.ok(!output.includes(secret)); assert.ok(!output.includes(credential));
  assert.doesNotMatch(output, /client_secret|internal_api_key/);
  assert.match(f.sends[0].payload.text, /Referencia: 123456/);
});

test('Success, transport failures, receipt failures and replay warnings never log voucher details', async () => {
  for (const scenario of ['success', 'transport', 'receipt', 'late_replay']) {
    const f = fixture();
    const details = f.pi.next_action.oxxo_display_details;
    const secret = 'TEST_ONLY_CLIENT_SECRET_DO_NOT_LOG';
    f.pi.client_secret = secret;
    const error = () => Error(JSON.stringify({ number: details.number, hosted_voucher_url: details.hosted_voucher_url, client_secret: secret }));
    if (scenario === 'transport') f.resend.emails.send = async () => { throw error(); };
    if (scenario === 'receipt') f.stripe.checkout.sessions.update = async () => { throw error(); };
    if (scenario === 'late_replay') f.event.created -= 23 * 3600;
    const result = await sendOxxoVoucherEmail(f);
    assert.deepEqual(result, scenario === 'success' ? { ok: true, resendId: 'email_fixture' } : scenario === 'late_replay' ? { skipped: true } : { ok: false });
    assert.equal(f.logs.length, scenario === 'success' ? 0 : 1);
    const logs = JSON.stringify(f.logs);
    for (const sensitive of [details.number, details.hosted_voucher_url, secret]) assert.ok(!logs.includes(sensitive));
    assert.doesNotMatch(logs, /hosted_voucher_url|client_secret/);
  }
});
