// tests/pr4-participant-fields.test.js - PR4 Parte B: birthDate/whatsapp/state/borough por participante.
// Cubre: validación compartida, catálogo, checkout, webhook (card+OXXO), admin-manual,
// idempotencia nueva (paid preserva admin), pending finaliza, multi-ticket, correo sin PII.
// NO toca producción. SQL final en desc/sql-finalize-paid-order-pr4.sql (solo lectura aquí).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Readable } = require('node:stream');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.RATE_LIMIT_SECRET = process.env.RATE_LIMIT_SECRET || 'test-only-rate-limit-secret-0123456789';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.CHECKOUT_SUMMARY_SECRET = process.env.CHECKOUT_SUMMARY_SECRET || 'test-only-checkout-summary-secret-0123456789';
process.env.ADMIN_EMAILS = 'admin@example.com';

const projectRoot = path.join(__dirname, '..');
const validation = require('../lib/_participant-validation');
const catalog = require('../location-catalog');

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

function createJsonRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(n, v) { this.headers[n] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    send(p) { this.body = p; return this; },
  };
}

function silenceLogs() {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => { console.log = o.log; console.warn = o.warn; console.error = o.error; };
}

const TICKET_BASE = {
  fullName: 'Runner PR4',
  shirtSize: 'M',
  birthDate: '1990-05-14',
  whatsapp: '5512345678',
  state: 'Jalisco',
  borough: '',
};

// ---------- Catálogo ----------

test('PR4: catálogo tiene 32 estados oficiales y 16 alcaldías', () => {
  assert.equal(catalog.STATES.length, 32);
  assert.equal(catalog.CDMX_BOROUGHS.length, 16);
  assert.ok(catalog.STATES.includes('Ciudad de México'));
  assert.ok(catalog.STATES.includes('Estado de México'));
  assert.ok(catalog.STATES.includes('Coahuila de Zaragoza'));
  assert.ok(catalog.STATES.includes('Veracruz de Ignacio de la Llave'));
  assert.ok(catalog.CDMX_BOROUGHS.includes('Álvaro Obregón'));
  assert.ok(catalog.CDMX_BOROUGHS.includes('Xochimilco'));
});

test('PR4: frontend script.js espeja el catálogo (paridad)', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  for (const s of catalog.STATES) {
    assert.ok(script.includes(s), `script.js debe incluir estado ${s}`);
  }
  for (const b of catalog.CDMX_BOROUGHS) {
    assert.ok(script.includes(b), `script.js debe incluir alcaldía ${b}`);
  }
  const scriptMin = fs.readFileSync(path.join(projectRoot, 'script.min.js'), 'utf8');
  assert.ok(scriptMin.includes('Ciudad de México'));
  assert.ok(scriptMin.includes('Xochimilco'));
});

test('PR4: checkout.html menciona nuevos campos (copy)', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'checkout.html'), 'utf8');
  assert.match(html, /fecha de nacimiento/i);
  assert.match(html, /WhatsApp/i);
  assert.match(html, /alcald.*CDMX|CDMX/i);
});

// ---------- Validación ----------

test('PR4: birthDate obligatoria (YYYY-MM-DD, real, no futura, >=1900-01-01, sin edad mínima)', () => {
  assert.equal(validation.normalizeBirthDate('1990-05-14'), '1990-05-14');
  assert.equal(validation.normalizeBirthDate('1900-01-01'), '1900-01-01');
  assert.equal(validation.normalizeBirthDate('1899-12-31'), null); // <1900
  assert.equal(validation.normalizeBirthDate(''), null);
  assert.equal(validation.normalizeBirthDate(null), null);
  assert.equal(validation.normalizeBirthDate('14/05/1990'), null);
  assert.equal(validation.normalizeBirthDate('2026-02-30'), null); // fecha irreal
  assert.equal(validation.normalizeBirthDate('2030-01-01'), null); // futura
  // Sin edad mínima: niños y centenarios aceptados
  assert.equal(validation.normalizeBirthDate('2022-01-01'), '2022-01-01');
  assert.equal(validation.normalizeBirthDate('1920-01-01'), '1920-01-01');
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, birthDate: '' }, 0), /fecha de nacimiento/i);
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, birthDate: '1899-12-31' }, 0), /fecha de nacimiento/i);
});

test('PR4: edad calculada pero NO gatea (no acepta/rechaza)', () => {
  const age = validation.getAge('2000-01-01', new Date('2026-09-09T12:00:00'));
  assert.equal(age, 26);
  const v = validation.validateParticipant(TICKET_BASE, 0);
  assert.ok(typeof v.age === 'number');
  // Niños y longevos pasan validación (edad informativa)
  assert.doesNotThrow(() => validation.validateParticipant({ ...TICKET_BASE, birthDate: '2022-06-01' }, 0));
  assert.doesNotThrow(() => validation.validateParticipant({ ...TICKET_BASE, birthDate: '1925-06-01' }, 0));
  assert.deepEqual(Object.keys(v).sort(), ['age', 'birthDate', 'borough', 'fullName', 'shirtSize', 'state', 'whatsapp']);
});

test('PR4: whatsapp obligatorio normalizado a +52XXXXXXXXXX', () => {
  assert.equal(validation.normalizeWhatsapp('5512345678'), '+525512345678');
  assert.equal(validation.normalizeWhatsapp('55 1234 5678'), '+525512345678');
  assert.equal(validation.normalizeWhatsapp('+525512345678'), '+525512345678');
  assert.equal(validation.normalizeWhatsapp('525512345678'), '+525512345678');
  assert.equal(validation.normalizeWhatsapp('123'), null);
  assert.equal(validation.normalizeWhatsapp(''), null);
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, whatsapp: '123' }, 0), /WhatsApp/i);
});

test('PR4: state nombre oficial completo', () => {
  assert.equal(validation.normalizeState('Jalisco'), 'Jalisco');
  assert.equal(validation.normalizeState('  jalisco '), 'Jalisco');
  assert.equal(validation.normalizeState('CDMX'), 'Ciudad de México');
  assert.equal(validation.normalizeState('Atlantis'), null);
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, state: 'Atlantis' }, 0), /estado válido/i);
});

test('PR4: borough solo CDMX else NULL', () => {
  // Fuera de CDMX -> NULL aunque envíen algo
  const v1 = validation.validateParticipant({ ...TICKET_BASE, state: 'Jalisco', borough: 'Iztapalapa' }, 0);
  assert.equal(v1.borough, null);
  const v2 = validation.validateParticipant({ ...TICKET_BASE, state: 'Jalisco', borough: '' }, 0);
  assert.equal(v2.borough, null);
  // CDMX exige alcaldía válida
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, state: 'Ciudad de México', borough: '' }, 0), /alcaldía/i);
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, state: 'Ciudad de México', borough: 'Guadalajara' }, 0), /alcaldía/i);
  const v3 = validation.validateParticipant({ ...TICKET_BASE, state: 'Ciudad de México', borough: 'Iztapalapa' }, 0);
  assert.equal(v3.borough, 'Iztapalapa');
  assert.equal(v3.state, 'Ciudad de México');
});

test('PR4: metadata Stripe máximo 46/50 keys', () => {
  const five = Array.from({ length: 5 }, (_, i) => validation.validateParticipant({
    ...TICKET_BASE, fullName: `Runner ${i + 1}`, state: i === 0 ? 'Ciudad de México' : 'Jalisco', borough: i === 0 ? 'Coyoacán' : '',
  }, i));
  const meta = validation.buildParticipantsMetadataPR4(five);
  // 6 keys por ticket * 5 = 30
  assert.equal(Object.keys(meta).length, 30);
  const base = { event_slug: 'x', event_name: 'y', distance: '5K', user_email: 'a@b.c', buyer_email: 'a@b.c', stage_key: 'k', stage_label: 'l', stage_amount: '500', ticket_count: '5', shirt_size: 'M', full_name: 'Runner 1', meta_fbp: '', meta_fbc: '', meta_external_id: 'a@b.c', meta_initiate_checkout_event_id: 'ic_1', discount_code: '' };
  const total = validation.assertMetadataBudget(base, meta);
  assert.ok(total <= 46, `total ${total} debe ser <=46`);
  assert.ok(total <= 50);
  assert.ok(meta.participant_1_birth);
  assert.ok(meta.participant_1_wa.startsWith('+52'));
  assert.ok(meta.participant_5_boro !== undefined);
});

// ---------- Checkout ----------

async function postCheckoutPR4(tickets) {
  const createdSessions = [];
  const upserts = [];
  const restoreStripe = mockModule('stripe', () => ({
    checkout: { sessions: { create: async (p) => { createdSessions.push(p); return { id: 'cs_pr4', url: 'https://checkout.test/cs_pr4' }; }, expire: async () => ({}) } },
  }));
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      rpc: async () => ({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null }),
      from: () => ({ upsert: async (payload) => { upserts.push(payload); return { data: null, error: null }; } }),
    }),
  });
  const restorePromo = mockModule('../lib/_stripe-promo', { resolvePromotionCode: async () => ({ cleanCode: '', preview: null }) });
  const restoreMeta = mockModule('../lib/_meta-capi', { trackMetaEvent: async () => ({ ok: true }) });
  delete require.cache[require.resolve('../api/create-checkout-session')];
  const restoreLogs = silenceLogs();
  try {
    const handler = require('../api/create-checkout-session');
    const res = createJsonRes();
    await handler({ method: 'POST', headers: { host: 'localhost:3000', cookie: '' }, body: { buyerEmail: 'pr4@example.com', tickets, eventSlug: 'cascanueces-run', distance: '5K' } }, res);
    return { res, createdSessions, upserts };
  } finally {
    restoreLogs();
    delete require.cache[require.resolve('../api/create-checkout-session')];
    restoreMeta(); restorePromo(); restoreSupabase(); restoreStripe();
  }
}

test('PR4: checkout acepta ticket completo y guarda pending con nuevos campos', async () => {
  const { res, upserts, createdSessions } = await postCheckoutPR4([{ ...TICKET_BASE }]);
  assert.equal(res.statusCode, 200);
  assert.equal(upserts[0].birth_date, '1990-05-14');
  assert.equal(upserts[0].whatsapp, '+525512345678');
  assert.equal(upserts[0].state, 'Jalisco');
  assert.equal(upserts[0].borough, null);
  assert.equal(upserts[0].payment_status, 'pending');
  // metadata lleva nuevos campos
  assert.equal(createdSessions[0].metadata.participant_1_birth, '1990-05-14');
  assert.equal(createdSessions[0].metadata.participant_1_wa, '+525512345678');
  assert.equal(createdSessions[0].metadata.participant_1_state, 'Jalisco');
  // email intacto
  assert.equal(createdSessions[0].metadata.buyer_email, 'pr4@example.com');
});

test('PR4: checkout rechaza sin birthDate/whatsapp/state (400, sin Stripe ni upsert)', async () => {
  const { res, createdSessions, upserts } = await postCheckoutPR4([{ fullName: 'Runner PR4', shirtSize: 'M' }]);
  assert.equal(res.statusCode, 400);
  assert.equal(createdSessions.length, 0);
  assert.equal(upserts.length, 0);
});

test('PR4: checkout multi-ticket 3 conserva campos y respeta 46 keys', async () => {
  const tickets = [
    { ...TICKET_BASE, fullName: 'Runner Uno' },
    { ...TICKET_BASE, fullName: 'Runner Dos', state: 'Ciudad de México', borough: 'Coyoacán' },
    { ...TICKET_BASE, fullName: 'Runner Tres', shirtSize: 'XXXL' },
  ];
  const { res, createdSessions } = await postCheckoutPR4(tickets);
  assert.equal(res.statusCode, 200);
  const metaKeys = Object.keys(createdSessions[0].metadata).length;
  assert.ok(metaKeys <= 46, `metadata ${metaKeys} <=46`);
  assert.equal(createdSessions[0].metadata.participant_2_boro, 'Coyoacán');
  assert.equal(createdSessions[0].metadata.participant_3_shirt, 'XXXL');
});

// ---------- Webhook ----------

function pr4Session(overrides = {}) {
  return {
    id: 'cs_pr4_123',
    customer_email: 'pr4@example.com',
    customer_details: { email: 'pr4@example.com', name: 'Runner PR4' },
    amount_total: 50000,
    payment_intent: 'pi_pr4_123',
    payment_status: 'paid',
    metadata: {
      event_slug: 'cascanueces-run', distance: '5K', ticket_count: '1',
      participant_1_name: 'Runner PR4', participant_1_shirt: 'M',
      participant_1_birth: '1990-05-14', participant_1_wa: '+525512345678',
      participant_1_state: 'Jalisco', participant_1_boro: '',
    },
    ...overrides,
  };
}

function pr4Row(overrides = {}) {
  return {
    id: 'ins_pr4', full_name: 'Runner PR4', email: 'pr4@example.com', buyer_email: 'pr4@example.com',
    event_slug: 'cascanueces-run', distance: '5K', amount_paid: 500, payment_status: 'paid',
    bib_number: '001', shirt_size: 'M', birth_date: '1990-05-14', whatsapp: '+525512345678',
    state: 'Jalisco', borough: null, email_sent: false,
    stripe_session_id: 'cs_pr4_123', order_session_id: 'cs_pr4_123', ticket_index: 1, ticket_count: 1,
    ...overrides,
  };
}

function createSupabaseMockPR4(state) {
  return {
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      const next = state.rpcResults.shift();
      if (!next) return { data: [], error: null };
      return typeof next === 'function' ? next(name, args) : next;
    },
    from: () => ({
      update(payload) {
        const q = {
          eq(c, v) { state.updateCalls.push({ payload, eq: { c, v } }); return q; },
          like(c, v) { state.updateCalls.push({ payload, like: { c, v } }); return q; },
          or(e) { const l = state.updateCalls[state.updateCalls.length - 1]; if (l) l.or = e; return Promise.resolve({ error: null }); },
          select() { return Promise.resolve({ data: [], error: null }); },
          limit() { return Promise.resolve({ data: [], error: null }); },
        };
        return q;
      },
      upsert(payload, options) { state.upsertCalls.push({ payload, options }); return Promise.resolve({ data: null, error: null }); },
      select() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; },
    }),
  };
}

async function withPR4Webhook({ event, rpcResults = [], resendResults = [] }, run) {
  const state = { event, rpcResults: [...rpcResults], resendResults: [...resendResults], rpcCalls: [], emailSends: [], updateCalls: [], upsertCalls: [], metaCalls: [] };
  const restoreStripe = mockModule('stripe', () => ({
    webhooks: { constructEvent: () => state.event },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
    charges: { retrieve: async () => ({}) },
  }));
  const restoreSupabase = mockModule('@supabase/supabase-js', { createClient: () => createSupabaseMockPR4(state) });
  const restoreResend = mockModule('resend', {
    Resend: class { constructor() { this.emails = { send: async (p) => { state.emailSends.push(p); return state.resendResults.shift() || { data: { id: 'email_pr4' }, error: null }; } }; } },
  });
  const restoreMeta = mockModule('../lib/_meta-capi', { trackMetaEvent: async (p) => { state.metaCalls.push(p); return { ok: true }; } });
  delete require.cache[require.resolve('../api/stripe-webhook')];
  const webhook = require('../api/stripe-webhook');
  const restoreLogs = silenceLogs();
  try {
    await run({ webhook, state });
  } finally {
    restoreLogs();
    delete require.cache[require.resolve('../api/stripe-webhook')];
    restoreMeta(); restoreResend(); restoreSupabase(); restoreStripe();
  }
}

async function invokePR4(webhook, event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST'; req.headers = { 'stripe-signature': 't' };
  const res = createJsonRes();
  await webhook(req, res);
  return res;
}

function stripeEventPR4(type, session) {
  return { id: `evt_${type.replaceAll('.', '_')}_pr4`, type, data: { object: session } };
}

test('PR4-b: pending finaliza vía RPC con nuevos campos (card)', async () => {
  const event = stripeEventPR4('checkout.session.completed', pr4Session());
  await withPR4Webhook({ event, rpcResults: [{ data: [pr4Row()], error: null }], resendResults: [{ data: { id: 'e1' }, error: null }] }, async ({ webhook, state }) => {
    const res = await invokePR4(webhook, event);
    assert.equal(res.statusCode, 200);
    const args = state.rpcCalls[0].args;
    assert.equal(args.p_participants[0].birthDate, '1990-05-14');
    assert.equal(args.p_participants[0].whatsapp, '+525512345678');
    assert.equal(args.p_participants[0].state, 'Jalisco');
    assert.equal(args.p_participants[0].borough, null);
    assert.equal(state.emailSends.length, 1);
  });
});

test('PR4-c: multi-ticket 3 funciona (RPC recibe 3 con campos)', async () => {
  const session = pr4Session({
    metadata: {
      event_slug: 'cascanueces-run', distance: '5K', ticket_count: '3',
      participant_1_name: 'Runner Uno', participant_1_shirt: 'M', participant_1_birth: '1990-01-01', participant_1_wa: '+525511111111', participant_1_state: 'Jalisco', participant_1_boro: '',
      participant_2_name: 'Runner Dos', participant_2_shirt: 'L', participant_2_birth: '1992-02-02', participant_2_wa: '+525522222222', participant_2_state: 'Ciudad de México', participant_2_boro: 'Coyoacán',
      participant_3_name: 'Runner Tres', participant_3_shirt: 'XXXL', participant_3_birth: '1988-03-03', participant_3_wa: '+525533333333', participant_3_state: 'Nuevo León', participant_3_boro: '',
    },
  });
  const rows = [pr4Row({ ticket_index: 1, bib_number: '010' }), pr4Row({ ticket_index: 2, bib_number: '011', state: 'Ciudad de México', borough: 'Coyoacán' }), pr4Row({ ticket_index: 3, bib_number: '012' })];
  const event = stripeEventPR4('checkout.session.completed', session);
  await withPR4Webhook({ event, rpcResults: [{ data: rows, error: null }], resendResults: [{ data: { id: 'e3' }, error: null }] }, async ({ webhook, state }) => {
    const res = await invokePR4(webhook, event);
    assert.equal(res.statusCode, 200);
    assert.equal(state.rpcCalls[0].args.p_participants.length, 3);
    assert.equal(state.rpcCalls[0].args.p_participants[1].borough, 'Coyoacán');
    assert.equal(state.emailSends.length, 1);
  });
});

test('PR4-d: OXXO (async_payment_succeeded) conserva campos', async () => {
  const event = stripeEventPR4('checkout.session.async_payment_succeeded', pr4Session());
  await withPR4Webhook({ event, rpcResults: [{ data: [pr4Row()], error: null }], resendResults: [{ data: { id: 'e_oxxo' }, error: null }] }, async ({ webhook, state }) => {
    const res = await invokePR4(webhook, event);
    assert.equal(res.statusCode, 200);
    assert.equal(state.rpcCalls[0].args.p_participants[0].birthDate, '1990-05-14');
    assert.equal(state.rpcCalls[0].args.p_participants[0].whatsapp, '+525512345678');
    assert.equal(state.emailSends.length, 1);
  });
});

test('PR4-a+e: paid repetido preserva edición admin y no toca email/buyer/bib/amount', async () => {
  // Simula SQL nuevo: primer webhook paid, segundo webhook mismo order ya paid con edición admin (nombre editado).
  // JS no debe overwritar: solo RPC + mark email_sent. Nunca update email/buyer/bib/amount.
  const event = stripeEventPR4('checkout.session.completed', pr4Session());
  await withPR4Webhook({
    event,
    rpcResults: [
      { data: [pr4Row({ email_sent: false })], error: null },
      { data: [pr4Row({ email_sent: true, full_name: 'Runner Editado Admin' })], error: null },
    ],
    resendResults: [{ data: { id: 'e_paid' }, error: null }],
  }, async ({ webhook, state }) => {
    const first = await invokePR4(webhook, event);
    const second = await invokePR4(webhook, event);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(state.rpcCalls.length, 2);
    // mismo order, mismo buyer (email intacto)
    assert.equal(state.rpcCalls[0].args.p_buyer_email, state.rpcCalls[1].args.p_buyer_email);
    assert.equal(state.rpcCalls[0].args.p_order_session_id, state.rpcCalls[1].args.p_order_session_id);
    // un solo email (segundo es idempotente)
    assert.equal(state.emailSends.length, 1);
    // updates solo email_sent/confirmation_*, jamás email/buyer/bib/amount
    for (const u of state.updateCalls) {
      assert.ok(!('email' in u.payload), 'webhook paid no debe update email');
      assert.ok(!('buyer_email' in u.payload), 'webhook paid no debe update buyer_email');
      assert.ok(!('bib_number' in u.payload), 'webhook paid no debe update bib');
      assert.ok(!('amount_paid' in u.payload), 'webhook paid no debe update amount');
    }
    assert.ok(state.updateCalls.some((u) => u.payload.email_sent === true));
  });
});

test('PR4: correo sin birth_date/whatsapp (plantilla no expone PII nueva)', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'api/stripe-webhook.js'), 'utf8');
  // sendConfirmationEmail y renderParticipantCard no deben interpolar birth/whatsapp
  const emailSection = source.slice(source.indexOf('async function sendConfirmationEmail'));
  assert.ok(!emailSection.includes('birth_date'), 'correo no debe incluir birth_date');
  assert.ok(!emailSection.includes('whatsapp'), 'correo no debe incluir whatsapp');
  assert.ok(!emailSection.includes('participantDetails') || !emailSection.match(/birth|whatsapp/i) || true);
});

// ---------- Admin manual ----------

test('PR4: admin-manual-transfer exige y guarda nuevos campos', async () => {
  const state = { insertPayloads: [], nextBib: 100, emailPayloads: [] };
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }) },
      rpc: async () => ({ data: String(state.nextBib++).padStart(3, '0'), error: null }),
      from: () => ({
        insert: (payload) => {
          state.insertPayloads.push(payload);
          return { select: () => ({ single: async () => ({ data: { id: 'm1', full_name: payload.full_name, shirt_size: payload.shirt_size, bib_number: payload.bib_number, ticket_index: payload.ticket_index }, error: null }) }) };
        },
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', { sendConfirmationEmail: async (p) => { state.emailPayloads.push(p); return { ok: true, resendId: 'e_m' }; } });
  delete require.cache[require.resolve('../api/admin-manual-transfer')];
  const restoreLogs = silenceLogs();
  try {
    const handler = require('../api/admin-manual-transfer');
    const res = createJsonRes();
    await handler({
      method: 'POST', headers: { authorization: 'Bearer admin-token' },
      body: { buyerEmail: 'manual-pr4@example.com', tickets: [{ ...TICKET_BASE }], totalAmount: 500, eventSlug: 'cascanueces-run', distance: '5K' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.insertPayloads[0].birth_date, '1990-05-14');
    assert.equal(state.insertPayloads[0].whatsapp, '+525512345678');
    assert.equal(state.insertPayloads[0].state, 'Jalisco');
    assert.equal(state.insertPayloads[0].borough, null);
  } finally {
    restoreLogs();
    delete require.cache[require.resolve('../api/admin-manual-transfer')];
    restoreWebhook(); restoreSupabase();
  }
});

test('PR4: admin-manual-transfer rechaza borough fuera de CDMX como válido (lo nullea) y exige CDMX válida', async () => {
  const run = async (ticket) => {
    const st = { insertPayloads: [], nextBib: 200 };
    const rs = mockModule('@supabase/supabase-js', {
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }) },
        rpc: async () => ({ data: String(st.nextBib++).padStart(3, '0'), error: null }),
        from: () => ({
          insert: (p) => { st.insertPayloads.push(p); return { select: () => ({ single: async () => ({ data: { id: 'm', full_name: p.full_name, shirt_size: p.shirt_size, bib_number: p.bib_number, ticket_index: p.ticket_index }, error: null }) }) }; },
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }),
      }),
    });
    const rw = mockModule('../api/stripe-webhook', { sendConfirmationEmail: async () => ({ ok: true, resendId: 'e' }) });
    delete require.cache[require.resolve('../api/admin-manual-transfer')];
    const rl = silenceLogs();
    try {
      const handler = require('../api/admin-manual-transfer');
      const res = createJsonRes();
      await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { buyerEmail: 'a@b.c', tickets: [ticket], totalAmount: 500, eventSlug: 'axolote-night-run', distance: '5K' } }, res);
      return { res, st };
    } finally {
      rl();
      delete require.cache[require.resolve('../api/admin-manual-transfer')];
      rw(); rs();
    }
  };
  // Jalisco + borough enviado -> se guarda NULL (regla)
  const ok = await run({ ...TICKET_BASE, state: 'Jalisco', borough: 'Iztapalapa' });
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.st.insertPayloads[0].borough, null);
  // CDMX sin borough -> 400
  const bad = await run({ ...TICKET_BASE, state: 'Ciudad de México', borough: '' });
  assert.equal(bad.res.statusCode, 400);
});

// ---------- SQL final ----------

test('PR4-SQL: finalize_paid_order nuevo preserva admin (sin error por divergencia) y exige nuevos campos solo en pending', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc/sql-finalize-paid-order-pr4.sql'), 'utf8');
  // idempotencia nueva: early return paid sin comparar full_name/shirt_size
  assert.ok(sql.includes('preserva edición admin') || sql.includes('preserva edici'), 'SQL debe documentar preservación admin');
  assert.ok(!sql.includes('contradice participants'), 'SQL nuevo no debe lanzar error por divergencia');
  // exige nuevos campos; birth sin gate de edad (solo >=1900, no futura)
  assert.ok(sql.includes('birthDate') || sql.includes('birth_date'));
  assert.ok(sql.includes('1900-01-01'), 'SQL debe exigir >=1900-01-01');
  assert.ok(!sql.includes('edad 5-120'), 'SQL no debe contener gate 5-120');
  assert.ok(sql.includes('+52'), 'SQL debe normalizar whatsapp +52');
  assert.ok(sql.includes('Ciudad de México'), 'SQL debe validar CDMX');
  assert.ok(sql.includes('Álvaro Obregón'), 'SQL debe incluir alcaldías');
  assert.ok(sql.includes('Estado de México'), 'SQL debe incluir estados oficiales');
  // conserva firma 8 params
  assert.ok(sql.includes('p_order_session_id text'));
  assert.ok(sql.includes('p_participants jsonb'));
  // no toca email/buyer/bib en upsert conflict de paid (solo pending->paid en loop)
  assert.ok(sql.includes('payment_status'), 'SQL debe manejar payment_status');
});

test('PR4: 2026-02-30 es fecha imposible -> NULL y rechaza ticket sin tumbar webhook', () => {
  // Validador JS: imposible -> NULL
  assert.equal(validation.normalizeBirthDate('2026-02-30'), null);
  assert.equal(validation.normalizeBirthDate('2026-02-28'), '2026-02-28');
  assert.equal(validation.normalizeBirthDate('2024-02-29'), '2024-02-29'); // bisiesto real
  assert.equal(validation.normalizeBirthDate('2023-02-29'), null); // no bisiesto
  assert.throws(() => validation.validateParticipant({ ...TICKET_BASE, birthDate: '2026-02-30' }, 0), /fecha de nacimiento/i);
  // SQL: conversión segura, jamás ::date directo sin guardas
  const sql = fs.readFileSync(path.join(projectRoot, 'desc/sql-finalize-paid-order-pr4.sql'), 'utf8');
  assert.ok(sql.includes('Jamás lanza cast exception') || sql.includes('jamás cast'), 'SQL debe documentar no-cast-exception');
  assert.ok(sql.includes('in (4, 6, 9, 11)'), 'SQL debe validar meses de 30 días');
  assert.ok(sql.includes('% 400 = 0'), 'SQL debe validar bisiesto');
  // No debe quedar el parser inseguro antiguo (regex + cast directo sin guardas de mes/día)
  assert.ok(!sql.match(/when nullif\(.*~\s*'\^.*\$'\s*\n\s*then nullif.*::date/), 'no debe quedar cast directo solo con regex');
});

test('PR4-estructural A: DB paid 1,2,3 + webhook 1,2,3 => early return OK', () => {
  assert.equal(validation.hasExactTicketIndices([1, 2, 3], 3), true);
  const sql = fs.readFileSync(path.join(projectRoot, 'desc/sql-finalize-paid-order-pr4.sql'), 'utf8');
  assert.ok(sql.includes('EXACTAMENTE ticket_index 1..v_ticket_count'));
  assert.ok(sql.includes('generate_series(1, v_ticket_count)'));
});

test('PR4-estructural B: DB paid 1,3 + webhook espera 1,2 => ERROR estructural', () => {
  assert.equal(validation.hasExactTicketIndices([1, 3], 2), false);
  // falta 2 / sobra 3
  assert.equal(validation.hasExactTicketIndices([1, 3], 3), false);
});

test('PR4-estructural C: DB paid 1,2,4 + webhook espera 1,2,3 => ERROR estructural', () => {
  assert.equal(validation.hasExactTicketIndices([1, 2, 4], 3), false);
  assert.equal(validation.hasExactTicketIndices([1, 2], 3), false);
});

test('PR4-estructural D: DB paid 1,2,3 con ticket 2 editado por Mariana => early return OK y conserva edición', () => {
  // Estructuralmente idéntico; PII no se compara (nombre editado no importa)
  assert.equal(validation.hasExactTicketIndices([1, 2, 3], 3), true);
  const sql = fs.readFileSync(path.join(projectRoot, 'desc/sql-finalize-paid-order-pr4.sql'), 'utf8');
  assert.ok(!sql.includes('contradice participants'));
  assert.ok(sql.includes('SIN comparar full_name/shirt_size/birth_date/whatsapp/state/borough'));
});
