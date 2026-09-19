// tests/checkout-summary-claim.test.js - Batch 3: claim HMAC + cookie HttpOnly.
//
// Cubre: helper (casos 1-5) y create-checkout-session (casos 6-10).
// Clave mock solo para tests (>=32 chars); producción usa env de Vercel.
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.CHECKOUT_SUMMARY_SECRET = process.env.CHECKOUT_SUMMARY_SECRET || 'test-only-checkout-summary-secret-0123456789';

const {
  COOKIE_NAME,
  CLAIM_TTL_SECONDS,
  createCheckoutSummaryClaim,
  verifyCheckoutSummaryClaim,
  buildCheckoutSummaryCookie,
  shouldSecureCheckoutCookie,
} = require('../lib/_checkout-summary-claim');

const TEST_SECRET = 'test-only-checkout-summary-secret-0123456789';
const NOW = 1789842300;

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
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

function withMockedNow(iso, run) {
  const RealDate = Date;
  const fixedTime = new RealDate(iso).getTime();
  global.Date = class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) { super(fixedTime); return; }
      super(...args);
    }
    static now() { return fixedTime; }
  };
  return Promise.resolve().then(run).finally(() => { global.Date = RealDate; });
}

// ---------- Helper: casos 1-5 ----------

test('B3-1: claim válido verifica', () => {
  const { claim, error } = createCheckoutSummaryClaim('cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW });
  assert.equal(error, undefined);
  const check = verifyCheckoutSummaryClaim(`${COOKIE_NAME}=${claim}`, 'cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW + 60 });
  assert.deepEqual(check, { ok: true });
});

test('B3-2: claim alterado falla', () => {
  const { claim } = createCheckoutSummaryClaim('cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW });
  const tampered = claim.slice(0, -1) + (claim.endsWith('A') ? 'B' : 'A');
  const check = verifyCheckoutSummaryClaim(`${COOKIE_NAME}=${tampered}`, 'cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW + 60 });
  assert.equal(check.ok, false);
});

test('B3-3: claim expirado falla', () => {
  const { claim } = createCheckoutSummaryClaim('cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW });
  const check = verifyCheckoutSummaryClaim(`${COOKIE_NAME}=${claim}`, 'cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW + CLAIM_TTL_SECONDS + 1 });
  assert.deepEqual(check, { ok: false, reason: 'expired' });
});

test('B3-4: claim de session A falla para session B', () => {
  const { claim } = createCheckoutSummaryClaim('cs_session_A', { secret: TEST_SECRET, nowSeconds: NOW });
  const check = verifyCheckoutSummaryClaim(`${COOKIE_NAME}=${claim}`, 'cs_session_B', { secret: TEST_SECRET, nowSeconds: NOW + 60 });
  assert.deepEqual(check, { ok: false, reason: 'session_mismatch' });
});

test('B3-5: secret ausente o débil falla cerrado', () => {
  assert.deepEqual(
    createCheckoutSummaryClaim('cs_test_123', { secret: '' }),
    { error: 'missing_secret' }
  );
  assert.deepEqual(
    createCheckoutSummaryClaim('cs_test_123', { secret: 'corta' }),
    { error: 'missing_secret' }
  );
  const { claim } = createCheckoutSummaryClaim('cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW });
  assert.deepEqual(
    verifyCheckoutSummaryClaim(`${COOKIE_NAME}=${claim}`, 'cs_test_123', { secret: 'corta', nowSeconds: NOW }),
    { ok: false, reason: 'missing_secret' }
  );
  const saved = process.env.CHECKOUT_SUMMARY_SECRET;
  delete process.env.CHECKOUT_SUMMARY_SECRET;
  try {
    assert.deepEqual(createCheckoutSummaryClaim('cs_test_123'), { error: 'missing_secret' });
  } finally {
    process.env.CHECKOUT_SUMMARY_SECRET = saved;
  }
});

test('B3-cookie: atributos y Secure por entorno', () => {
  const { claim } = createCheckoutSummaryClaim('cs_test_123', { secret: TEST_SECRET, nowSeconds: NOW });
  const prod = buildCheckoutSummaryCookie(claim, { secure: true });
  assert.ok(prod.includes('HttpOnly'));
  assert.ok(prod.includes('SameSite=Lax'));
  assert.ok(prod.includes(`Max-Age=${CLAIM_TTL_SECONDS}`));
  assert.ok(prod.includes('Path=/api/checkout-summary'));
  assert.ok(prod.includes('Secure'));
  assert.ok(!buildCheckoutSummaryCookie(claim, { secure: false }).includes('Secure'));
  assert.equal(shouldSecureCheckoutCookie({ headers: { host: 'localhost:3000' } }), false);
  assert.equal(shouldSecureCheckoutCookie({ headers: { host: 'www.kinetichub.com.mx' } }), true);
  assert.equal(shouldSecureCheckoutCookie({ headers: {} }), true);
});

// ---------- create-checkout-session: casos 6-10 ----------

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function postCheckout({ host = 'localhost:3000', upsertError = null, unsetSecret = false } = {}) {
  return withMockedNow('2026-09-09T12:00:00-06:00', async () => {
    const createdSessions = [];
    const expiredSessions = [];
    const upsertCalls = [];
    const restoreStripe = mockModule('stripe', () => ({
      checkout: {
        sessions: {
          create: async (payload) => {
            createdSessions.push(payload);
            return { id: 'cs_test_claim', url: 'https://checkout.stripe.test/cs_test_claim' };
          },
          expire: async (id) => { expiredSessions.push(id); return {}; },
        },
      },
      prices: { retrieve: async () => ({}) },
    }));
    const restoreSupabase = mockModule('@supabase/supabase-js', {
      createClient: () => ({
        from: () => ({
          upsert: async (payload) => {
            upsertCalls.push(payload);
            return { data: null, error: upsertError };
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
    const savedSecret = process.env.CHECKOUT_SUMMARY_SECRET;
    if (unsetSecret) delete process.env.CHECKOUT_SUMMARY_SECRET;
    try {
      const handler = require('../api/create-checkout-session');
      const res = createRes();
      await handler({
        method: 'POST',
        headers: { host, cookie: '' },
        body: {
          buyerEmail: 'claim@example.com',
          tickets: [{ fullName: 'Runner Claim', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
          eventSlug: 'axolote-night-run',
          distance: '5K',
        },
      }, res);
      return { res, createdSessions, expiredSessions, upsertCalls };
    } finally {
      if (unsetSecret) process.env.CHECKOUT_SUMMARY_SECRET = savedSecret;
      restoreLogs();
      delete require.cache[require.resolve('../api/create-checkout-session')];
      restoreMeta();
      restorePromo();
      restoreSupabase();
      restoreStripe();
    }
  });
}

test('B3-6/7: checkout exitoso devuelve Set-Cookie HttpOnly con atributos', async () => {
  const { res } = await postCheckout({ host: 'localhost:3000' });

  assert.equal(res.statusCode, 200);
  const setCookie = res.headers['Set-Cookie'];
  assert.ok(setCookie, 'debe enviar Set-Cookie');
  assert.ok(setCookie.startsWith(`${COOKIE_NAME}=`));
  assert.ok(setCookie.includes('HttpOnly'));
  assert.ok(setCookie.includes('SameSite=Lax'));
  assert.ok(setCookie.includes(`Max-Age=${CLAIM_TTL_SECONDS}`));
  assert.ok(setCookie.includes('Path=/api/checkout-summary'));
  assert.ok(!setCookie.includes('Secure'), 'localhost sin Secure');
});

test('B3-7b: en producción la cookie lleva Secure', async () => {
  const { res } = await postCheckout({ host: 'www.kinetichub.com.mx' });

  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['Set-Cookie'].includes('Secure'));
});

test('B3-8/9: JSON y success_url no contienen el claim', async () => {
  const { res, createdSessions } = await postCheckout({});

  assert.deepEqual(Object.keys(res.body), ['url']);
  assert.ok(!JSON.stringify(res.body).includes(COOKIE_NAME));
  assert.ok(!createdSessions[0].success_url.includes(COOKIE_NAME));
  const claimValue = res.headers['Set-Cookie'].split(';')[0].split('=')[1];
  assert.ok(!createdSessions[0].success_url.includes(claimValue));
});

test('B3-10: si pending upsert falla, no hay claim válido y se expira la sesión', async () => {
  const { res, expiredSessions } = await postCheckout({ upsertError: { message: 'db down' } });

  assert.equal(res.statusCode, 500);
  assert.ok(!res.headers['Set-Cookie'], 'sin cookie ante fallo de persistencia');
  assert.deepEqual(expiredSessions, ['cs_test_claim']);
});

test('B3-10b: sin secreto no se intenta el upsert: expira, sin cookie, DB mutation ZERO', async () => {
  const { res, createdSessions, expiredSessions, upsertCalls } = await postCheckout({ unsetSecret: true });

  assert.equal(res.statusCode, 500);
  assert.equal(createdSessions.length, 1);
  assert.deepEqual(expiredSessions, ['cs_test_claim']);
  assert.equal(upsertCalls.length, 0);
  assert.ok(!res.headers['Set-Cookie']);
});

test('B3-10c: flujo exitoso persiste antes de emitir cookie', async () => {
  const { res, upsertCalls } = await postCheckout({});

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.ok(res.headers['Set-Cookie']);
});
