// tests/shirt-sizes.test.js - PR3: verdad única XS,S,M,L,XL,XXL,XXXL.
// Cubre: helper canónico, paridad frontend/backend, checkout, webhook y
// transferencia manual. La capa DB (CHECK + NULL histórico + rechazo XLL)
// se valida en la ventana SQL coordinada (ver plan PR3 Parte A/B).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.ADMIN_EMAILS = 'admin@example.com';

const projectRoot = path.join(__dirname, '..');
const { SHIRT_SIZES, normalizeShirtSize, isValidShirtSize } = require('../lib/_shirt-sizes');

const EXPECTED_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  return () => {
    if (previous) {
      require.cache[resolved] = previous;
    } else {
      delete require.cache[resolved];
    }
  };
}

function createJsonRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function silenceLogs() {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
}

// ---------- Helper canónico ----------

test('PR3: helper expone la secuencia canónica XS–XXXL en orden', () => {
  assert.deepEqual(SHIRT_SIZES, EXPECTED_SIZES);
});

test('PR3: helper normaliza (espacios/minúsculas) y valida 7 tallas', () => {
  assert.equal(normalizeShirtSize('  xxl '), 'XXL');
  assert.equal(normalizeShirtSize('xxxl'), 'XXXL');
  for (const size of EXPECTED_SIZES) {
    assert.equal(isValidShirtSize(size), true, `debe aceptar ${size}`);
    assert.equal(isValidShirtSize(size.toLowerCase()), true, `debe aceptar ${size.toLowerCase()}`);
  }
});

test('PR3: helper rechaza XLL y valores fuera de allowlist', () => {
  for (const bad of ['XLL', 'XX', 'XXXXL', '', '   ', 'Talla M', 'M-L']) {
    assert.equal(isValidShirtSize(bad), false, `debe rechazar ${JSON.stringify(bad)}`);
  }
  assert.equal(isValidShirtSize(null), false);
  assert.equal(isValidShirtSize(undefined), false);
  assert.equal(isValidShirtSize(123), false);
});

// ---------- Paridad frontend/backend (test 12) ----------

function extractOptionSizes(source) {
  const found = [];
  const re = /<option value="(XS|S|M|L|XL|XXL|XXXL)"/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

function extractManualShirtSizes(source) {
  const m = source.match(/const MANUAL_SHIRT_SIZES = \[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/'([A-Z]+)'/g)].map((x) => x[1]);
}

test('PR3-12: script.js, script.min.js y admin-inscripciones.html usan la misma secuencia', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const scriptMin = fs.readFileSync(path.join(projectRoot, 'script.min.js'), 'utf8');
  const admin = fs.readFileSync(path.join(projectRoot, 'admin-inscripciones.html'), 'utf8');

  assert.deepEqual(extractOptionSizes(script), EXPECTED_SIZES);
  assert.deepEqual(extractOptionSizes(scriptMin), EXPECTED_SIZES);
  // El panel admin genera las opciones desde MANUAL_SHIRT_SIZES (no literales).
  assert.deepEqual(extractManualShirtSizes(admin), EXPECTED_SIZES);

  assert.ok(script.includes('["XS", "S", "M", "L", "XL", "XXL", "XXXL"]'));
  assert.ok(admin.includes("MANUAL_SHIRT_SIZES.includes("));
});

test('PR3-12: backends usan el helper canónico y no conservan la lista vieja de 5', () => {
  for (const file of ['api/create-checkout-session.js', 'api/stripe-webhook.js', 'api/admin-manual-transfer.js']) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    assert.ok(source.includes("require('../lib/_shirt-sizes')"), `${file} debe requerir el helper`);
    assert.ok(!source.includes("['XS', 'S', 'M', 'L', 'XL']"), `${file} no debe conservar la lista de 5`);
  }
});

// ---------- Checkout (tests 1-4, 9) ----------

function withMockedNow(isoDate, run) {
  const RealDate = Date;
  const fixedTime = new RealDate(isoDate).getTime();
  global.Date = class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedTime);
        return;
      }
      super(...args);
    }

    static now() {
      return fixedTime;
    }
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.Date = RealDate;
    });
}

async function postCheckout(shirtSize) {
  return withMockedNow('2026-09-09T12:00:00-06:00', async () => {
    const createdSessions = [];
    const upserts = [];
    const restoreStripe = mockModule('stripe', () => ({
      checkout: {
        sessions: {
          create: async (payload) => {
            createdSessions.push(payload);
            return { id: 'cs_test_sizes', url: 'https://checkout.stripe.test/cs_test_sizes' };
          },
          expire: async () => ({}),
        },
      },
    }));
    const restoreSupabase = mockModule('@supabase/supabase-js', {
      createClient: () => ({
        from: () => ({
          upsert: async (payload) => {
            upserts.push(payload);
            return { data: null, error: null };
          },
        }),
      }),
    });
    const restorePromo = mockModule('../lib/_stripe-promo', {
      resolvePromotionCode: async () => ({ cleanCode: '', preview: null }),
    });
    const restoreMeta = mockModule('../lib/_meta-capi', {
      trackMetaEvent: async () => ({ ok: true }),
    });
    delete require.cache[require.resolve('../api/create-checkout-session')];

    const restoreLogs = silenceLogs();
    try {
      const handler = require('../api/create-checkout-session');
      const res = createJsonRes();
      await handler({
        method: 'POST',
        headers: { host: 'localhost:3000', cookie: '' },
        body: {
          buyerEmail: 'tallas@example.com',
          tickets: [{ fullName: 'Runner Tallas', shirtSize, birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
          eventSlug: 'axolote-night-run',
          distance: '5K',
        },
      }, res);
      return { res, createdSessions, upserts };
    } finally {
      restoreLogs();
      delete require.cache[require.resolve('../api/create-checkout-session')];
      restoreMeta();
      restorePromo();
      restoreSupabase();
      restoreStripe();
    }
  });
}

test('PR3-1: checkout acepta XS (regresión)', async () => {
  const { res, upserts } = await postCheckout('XS');
  assert.equal(res.statusCode, 200);
  assert.equal(upserts[0].shirt_size, 'XS');
});

test('PR3-2: checkout acepta XL (regresión)', async () => {
  const { res, upserts } = await postCheckout('XL');
  assert.equal(res.statusCode, 200);
  assert.equal(upserts[0].shirt_size, 'XL');
});

test('PR3-3: checkout acepta XXL', async () => {
  const { res, upserts, createdSessions } = await postCheckout('XXL');
  assert.equal(res.statusCode, 200);
  assert.equal(upserts[0].shirt_size, 'XXL');
  assert.equal(createdSessions[0].metadata.participant_1_shirt, 'XXL');
});

test('PR3-4: checkout acepta XXXL', async () => {
  const { res, upserts, createdSessions } = await postCheckout('XXXL');
  assert.equal(res.statusCode, 200);
  assert.equal(upserts[0].shirt_size, 'XXXL');
  assert.equal(createdSessions[0].metadata.participant_1_shirt, 'XXXL');
});

test('PR3-9: checkout rechaza XLL con 400', async () => {
  const { res, createdSessions, upserts } = await postCheckout('XLL');
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /talla válida/);
  assert.equal(createdSessions.length, 0);
  assert.equal(upserts.length, 0);
});

// ---------- Webhook (tests 5-6) ----------

async function invokeWebhookWithShirt(shirtSize) {
  const { Readable } = require('node:stream');
  const state = { rpcCalls: [], emailSends: [], updateCalls: [] };
  const session = {
    id: 'cs_test_sizes',
    customer_email: 'tallas@example.com',
    customer_details: { email: 'tallas@example.com', name: 'Runner Tallas' },
    amount_total: 55000,
    payment_intent: 'pi_test_sizes',
    payment_status: 'paid',
    metadata: {
      event_slug: 'axolote-night-run',
      distance: '5K',
      ticket_count: '1',
      participant_1_name: 'Runner Tallas',
      participant_1_shirt: shirtSize,
    },
  };
  const event = { id: 'evt_test_sizes', type: 'checkout.session.completed', data: { object: session } };
  const finalizedRows = [{
    ticket_index: 1, full_name: 'Runner Tallas', shirt_size: shirtSize,
    bib_number: '001', email_sent: false,
  }];

  const restoreStripe = mockModule('stripe', () => ({
    webhooks: { constructEvent: () => event },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
    charges: { retrieve: async () => ({}) },
  }));
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args });
        return { data: finalizedRows, error: null };
      },
      from: () => ({
        update(payload) {
          const query = {
            eq(column, value) {
              state.updateCalls.push({ payload, column, value });
              return query;
            },
            or() {
              return Promise.resolve({ error: null });
            },
            select() {
              return Promise.resolve({ data: [], error: null });
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      }),
    }),
  });
  const restoreResend = mockModule('resend', {
    Resend: class MockResend {
      constructor() {
        this.emails = {
          send: async (payload) => {
            state.emailSends.push(payload);
            return { data: { id: 'email_sizes' }, error: null };
          },
        };
      }
    },
  });
  const restoreMeta = mockModule('../lib/_meta-capi', {
    trackMetaEvent: async () => ({ ok: true }),
  });
  delete require.cache[require.resolve('../api/stripe-webhook')];

  const restoreLogs = silenceLogs();
  try {
    const webhook = require('../api/stripe-webhook');
    const req = Readable.from([Buffer.from(JSON.stringify(event))]);
    req.method = 'POST';
    req.headers = { 'stripe-signature': 'test_signature' };
    const res = createJsonRes();
    await webhook(req, res);
    return { res, state };
  } finally {
    restoreLogs();
    delete require.cache[require.resolve('../api/stripe-webhook')];
    restoreMeta();
    restoreResend();
    restoreSupabase();
    restoreStripe();
  }
}

test('PR3-5: webhook conserva XXL (no lo nullea)', async () => {
  const { res, state } = await invokeWebhookWithShirt('XXL');
  assert.equal(res.statusCode, 200);
  assert.equal(state.rpcCalls[0].name, 'finalize_paid_order');
  assert.equal(state.rpcCalls[0].args.p_participants[0].shirtSize, 'XXL');
});

test('PR3-6: webhook conserva XXXL (no lo nullea)', async () => {
  const { res, state } = await invokeWebhookWithShirt('XXXL');
  assert.equal(res.statusCode, 200);
  assert.equal(state.rpcCalls[0].name, 'finalize_paid_order');
  assert.equal(state.rpcCalls[0].args.p_participants[0].shirtSize, 'XXXL');
});

// ---------- Transferencia manual (tests 7-8) ----------

async function runManualWithShirt(shirtSize) {
  const state = { insertPayloads: [], nextBib: 90 };
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
      },
      rpc: async () => ({ data: String(state.nextBib++).padStart(3, '0'), error: null }),
      from: () => ({
        insert(payload) {
          state.insertPayloads.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: `ins_${state.insertPayloads.length}`,
                  full_name: payload.full_name,
                  shirt_size: payload.shirt_size,
                  bib_number: payload.bib_number,
                  ticket_index: payload.ticket_index,
                },
                error: null,
              }),
            }),
          };
        },
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async () => ({ ok: true, resendId: 'email_test' }),
  });
  delete require.cache[require.resolve('../api/admin-manual-transfer')];

  const restoreLogs = silenceLogs();
  try {
    const handler = require('../api/admin-manual-transfer');
    const res = createJsonRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
      body: {
        buyerEmail: 'manual-tallas@example.com',
        tickets: [{ fullName: 'Runner Manual Tallas', shirtSize, birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
        totalAmount: 550,
        eventSlug: 'axolote-night-run',
        distance: '5K',
      },
    }, res);
    return { res, state };
  } finally {
    restoreLogs();
    delete require.cache[require.resolve('../api/admin-manual-transfer')];
    restoreWebhook();
    restoreSupabase();
  }
}

test('PR3-7: transferencia manual acepta XXL', async () => {
  const { res, state } = await runManualWithShirt('XXL');
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].shirt_size, 'XXL');
});

test('PR3-8: transferencia manual acepta XXXL', async () => {
  const { res, state } = await runManualWithShirt('XXXL');
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].shirt_size, 'XXXL');
});

// ---------- NULL histórico y contrato DB (tests 10-11, capa app) ----------

test('PR3-10: tallas inválidas caen a null en webhook (históricos/paid_no_email intactos)', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'api/stripe-webhook.js'), 'utf8');
  assert.ok(source.includes('? rawShirt : null'));
  assert.ok(source.includes("shirt_size: null"));
  assert.equal(isValidShirtSize(''), false);
});

test('PR3-11: contrato DB esperado (NULL + 7 tallas, XLL fuera)', () => {
  const dbCheck = `CHECK (shirt_size IS NULL OR shirt_size IN (${EXPECTED_SIZES.map((s) => `'${s}'`).join(',')}))`;
  assert.ok(dbCheck.includes("'XXL'"));
  assert.ok(dbCheck.includes("'XXXL'"));
  assert.ok(!dbCheck.includes("'XLL'"));
  assert.ok(dbCheck.includes('IS NULL'));
});
