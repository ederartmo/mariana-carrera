const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const WAIVER_PATH = 'assets/events/cascanueces-run/legal/Cascanueces Run1.pdf';
const WAIVER_URL = 'https://www.kinetichub.com.mx/assets/events/cascanueces-run/legal/Cascanueces%20Run1.pdf';
const FINAL_HASH = 'd2cf5ece04914eb252a1134e2556027d184d602b943d2d1e927b5d85bf87ddf9';

function assertFinalBytes(url) {
  const parsed = new URL(url, 'https://www.kinetichub.com.mx/');
  assert.equal(parsed.origin, 'https://www.kinetichub.com.mx');
  assert.equal(decodeURIComponent(parsed.pathname), `/${WAIVER_PATH}`);
  for (const prefix of ['', 'public/']) {
    const bytes = fs.readFileSync(path.join(ROOT, prefix, decodeURIComponent(parsed.pathname)));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(bytes.length, 915317);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), FINAL_HASH);
  }
}

test('historical and optional versioned waiver URLs resolve to identical final PDF bytes', () => {
  assertFinalBytes(WAIVER_URL);
  // Evaluation only: no production email template or historical URL is changed.
  assertFinalBytes(`${WAIVER_URL}?v=${FINAL_HASH.slice(0, 12)}`);
});

for (const prefix of ['', 'public/']) {
  test(`${prefix}landing, modal, checkout and success preserve the waiver flow`, () => {
    const read = (file) => fs.readFileSync(path.join(ROOT, prefix, file), 'utf8');
    const context = {};
    vm.runInNewContext(read('cascanueces-event-data.js'), context);
    const waiver = context.KineticHubCascanuecesEvent.documents.find(doc => doc.href.endsWith('Cascanueces%20Run1.pdf'));
    assert.ok(waiver);
    assertFinalBytes(waiver.href);
    assert.match(read('cascanueces-run.html'), /src="cascanueces-event-data\.js/);
    assert.match(read('event-landing.js'), /href="\$\{escapeHtml\(document\.href\)\}"/);

    const profile = read('script.js');
    const catalog = profile.match(/const PROFILE_EVENT_CATALOG = (\{[\s\S]*?\n        \});/);
    assert.ok(catalog, 'profile catalog must be inspectable');
    const event = vm.runInNewContext(`(${catalog[1]})`)['cascanueces-run'];
    assertFinalBytes(event.waiverUrl);
    assert.match(profile, /openLegalDocumentsModal\(btn\.dataset\.eventSlug\)/);
    assert.ok(profile.includes('href="${event.waiverUrl}"'), 'document modal uses the selected event waiver');
    assert.match(read('succes.html'), /waiverLink\.href = 'assets\/events\/cascanueces-run\/legal\/Cascanueces%20Run1\.pdf'/);
    // Checkout delivers the waiver through confirmation, not a separate PDF URL.
    assert.match(read('checkout.html'), /exoneración automática por correo al confirmar tu pago/);
    assert.match(read('checkout.html'), /src="script\.min\.js/);
  });
}

function mockModule(name, exports, restores) {
  const id = require.resolve(name);
  const previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  restores.push(() => previous ? require.cache[id] = previous : delete require.cache[id]);
}

function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader() {},
  };
}

async function withOfflineRoutes(run) {
  const restores = [];
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const handlers = ['stripe-webhook', 'resend-single-confirmation', 'resend-confirmations', 'admin-manual-transfer'];
  const row = {
    id: 'mock_registration', order_session_id: 'cs_mock_final_waiver', stripe_session_id: 'cs_mock_final_waiver',
    full_name: 'Offline Runner', email: 'runner@example.com', buyer_email: 'runner@example.com',
    event_slug: 'cascanueces-run', distance: '10K', amount_paid: 500,
    payment_status: 'paid', registration_status: 'active', bib_number: '010', shirt_size: 'M',
    email_sent: false, ticket_index: 1, ticket_count: 1,
  };
  const session = {
    id: row.order_session_id, customer_email: row.email,
    customer_details: { name: row.full_name, email: row.email },
    amount_total: 50000, currency: 'mxn', payment_status: 'paid', payment_intent: 'pi_mock',
    metadata: { event_slug: row.event_slug, distance: '10K', ticket_count: '1', participant_1_name: row.full_name, participant_1_shirt: 'M' },
  };
  const state = { emails: [], writes: [], event: null, externalAttempts: 0 };
  function query(table, operation, payload) {
    const result = () => ({ data: operation === 'select' ? (table === 'inscripciones' ? [row] : []) : null, error: null });
    const q = new Proxy({}, {
      get(_, key) {
        if (key === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        if (key === 'single' || key === 'maybeSingle') return async () => ({ data: table === 'inscripciones' ? { ...row, ...payload } : null, error: null });
        return () => q;
      },
    });
    return q;
  }
  const supabase = {
    rpc: async (name, args) => {
      state.writes.push({ name, args });
      return { data: name === 'finalize_paid_order' ? [row] : '010', error: null };
    },
    from: table => Object.fromEntries(['select', 'insert', 'update', 'upsert'].map(operation => [operation, payload => {
      if (operation !== 'select') state.writes.push({ table, operation, payload });
      return query(table, operation, payload);
    }])),
  };
  try {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: 'whsec_mock', RESEND_API_KEY: 're_mock',
      SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'mock', ADMIN_EMAILS: 'admin@example.com',
    });
    globalThis.fetch = async () => { state.externalAttempts++; throw new Error('Network forbidden in waiver tests'); };
    console.log = console.error = () => {};
    mockModule('stripe', () => ({
      webhooks: { constructEvent: () => state.event },
      checkout: { sessions: { retrieve: async () => session, update: async () => session } },
    }), restores);
    mockModule('@supabase/supabase-js', { createClient: () => supabase }, restores);
    mockModule('resend', { Resend: class {
      constructor() { this.emails = { send: async payload => {
        state.emails.push(payload);
        return { data: { id: 'mock_email_final_waiver' }, error: null };
      } }; }
    } }, restores);
    mockModule('../lib/_auth', { getAdminUser: async () => ({ email: 'admin@example.com' }) }, restores);
    mockModule('../lib/_meta-capi', { trackMetaEvent: async () => ({ ok: true }) }, restores);
    const routes = {};
    for (const name of handlers) {
      const id = require.resolve(`../api/${name}`);
      const previous = require.cache[id];
      delete require.cache[id];
      restores.push(() => previous ? require.cache[id] = previous : delete require.cache[id]);
      routes[name] = require(id);
    }
    await run({ routes, row, session, state });
    assert.equal(state.externalAttempts, 0);
  } finally {
    for (const restore of restores.reverse()) restore();
    process.env = env;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
}

function assertConfirmation(state) {
  assert.equal(state.emails.length, 1, 'one captured email, never an SDK send');
  assert.match(state.emails[0].html, /Cascanueces Run 2026/);
  assert.ok(state.emails[0].html.includes(`href="${WAIVER_URL}"`));
  assertFinalBytes(WAIVER_URL);
  assert.ok(state.writes.some(write => write.payload?.email_sent === true), 'mock persistence records confirmation');
}

for (const [label, type] of [
  ['confirmed card', 'checkout.session.completed'],
  ['confirmed OXXO', 'checkout.session.async_payment_succeeded'],
]) {
  test(`${label} invokes the real confirmation renderer with the stable final waiver link`, async () => {
    await withOfflineRoutes(async ({ routes, session, state }) => {
      if (label === 'confirmed OXXO') session.payment_method_types = ['oxxo'];
      else session.payment_method_types = ['card'];
      state.event = { id: 'evt_mock_final_waiver', type, data: { object: session } };
      const req = Readable.from([Buffer.from(JSON.stringify(state.event))]);
      req.method = 'POST';
      req.headers = { 'stripe-signature': 'mock_signature' };
      const res = response();
      await routes['stripe-webhook'](req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(state.writes.some(write => write.name === 'finalize_paid_order'));
      assertConfirmation(state);
    });
  });
}

for (const [label, route, body] of [
  ['confirmed bank transfer', 'admin-manual-transfer', {
    buyerEmail: 'runner@example.com', totalAmount: 500, eventSlug: 'cascanueces-run', distance: '10K',
    tickets: [{ fullName: 'Offline Runner', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
  }],
  ['individual resend', 'resend-single-confirmation', { orderSessionId: 'cs_mock_final_waiver' }],
  ['administrative resend', 'resend-confirmations', {}],
]) {
  test(`${label} invokes the real confirmation renderer with the stable final waiver link`, async () => {
    await withOfflineRoutes(async ({ routes, state }) => {
      const res = response();
      await routes[route]({ method: 'POST', headers: { authorization: 'Bearer mock_token' }, body }, res);
      assert.equal(res.statusCode, 200);
      assertConfirmation(state);
    });
  });
}
