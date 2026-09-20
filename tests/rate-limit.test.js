// tests/rate-limit.test.js - Batch 7: rate limiting persistente.
// Sin red, Stripe, emails ni Storage reales: RPC mockeada por contrato.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.RATE_LIMIT_SECRET = 'test-only-rate-limit-secret-0123456789';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
process.env.CHECKOUT_SUMMARY_SECRET = process.env.CHECKOUT_SUMMARY_SECRET || 'test-only-checkout-summary-secret-0123456789';

const projectRoot = path.join(__dirname, '..');
const rateLimit = require('../lib/_rate-limit');

const TEST_SECRET = 'test-only-rate-limit-secret-0123456789';

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

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

function reqWithIp(ip, extraHeaders = {}) {
  return { method: 'POST', headers: { 'x-forwarded-for': ip, ...extraHeaders }, body: {}, query: {} };
}

// Simula el contrato de la RPC con buckets en memoria por (scope,hash).
function rpcBucketMock(state) {
  return async (name, args) => {
    assert.equal(name, 'consume_api_rate_limit');
    state.rpcCalls.push(args);
    const key = `${args.p_scope}|${args.p_key_hash}`;
    const count = (state.buckets[key] || 0) + 1;
    state.buckets[key] = count;
    if (count <= args.p_limit) {
      return { data: [{ allowed: true, remaining: args.p_limit - count, retry_after_seconds: 0 }], error: null };
    }
    return { data: [{ allowed: false, remaining: 0, retry_after_seconds: 42 }], error: null };
  };
}

function supabaseWithBuckets(state) {
  return { createClient: () => ({ rpc: rpcBucketMock(state) }) };
}

function freshState() {
  return { rpcCalls: [], buckets: {} };
}

// 1-3: mismo key dentro del límite permitido, al límite permitido, siguiente 429.
test('B7-01/02/03: límite fijo con 429 al exceder', async () => {
  const state = freshState();
  const restore = mockModule('@supabase/supabase-js', supabaseWithBuckets(state));
  delete require.cache[require.resolve('../lib/_rate-limit')];
  try {
    const rl = require('../lib/_rate-limit');
    const req = reqWithIp('9.9.9.9');
    for (let i = 0; i < 10; i += 1) {
      const res = createRes();
      const out = await rl.enforceRateLimit(req, res, { scope: 't', limit: 10, windowSeconds: 600 });
      assert.equal(out, null, `request ${i + 1} permitida`);
      assert.equal(res.statusCode, 200);
    }
    const res = createRes();
    const out = await rl.enforceRateLimit(req, res, { scope: 't', limit: 10, windowSeconds: 600 });
    assert.equal(out, res);
    assert.equal(res.statusCode, 429);
  } finally {
    restore();
    delete require.cache[require.resolve('../lib/_rate-limit')];
  }
});

test('B7-04: Retry-After presente y cuerpo genérico', async () => {
  const state = freshState();
  const restore = mockModule('@supabase/supabase-js', supabaseWithBuckets(state));
  delete require.cache[require.resolve('../lib/_rate-limit')];
  try {
    const rl = require('../lib/_rate-limit');
    const req = reqWithIp('9.9.9.9');
    for (let i = 0; i < 10; i += 1) {
      const warm = createRes();
      assert.equal(await rl.enforceRateLimit(req, warm, { scope: 't', limit: 10, windowSeconds: 600 }), null);
    }
    const res = createRes();
    const out = await rl.enforceRateLimit(req, res, { scope: 't', limit: 10, windowSeconds: 600 });
    assert.equal(out, res);
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers['Retry-After'], 'Retry-After presente');
    assert.deepEqual(res.body, { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' });
    assert.ok(!JSON.stringify(res.body).includes('9.9.9.9'));
  } finally {
    restore();
    delete require.cache[require.resolve('../lib/_rate-limit')];
  }
});

test('B7-05/06: IP y scope independientes', async () => {
  const state = freshState();
  const restore = mockModule('@supabase/supabase-js', supabaseWithBuckets(state));
  delete require.cache[require.resolve('../lib/_rate-limit')];
  try {
    const rl = require('../lib/_rate-limit');
    for (let i = 0; i < 2; i += 1) {
      assert.equal(await rl.enforceRateLimit(reqWithIp('1.1.1.1'), createRes(), { scope: 's1', limit: 2, windowSeconds: 60 }), null);
    }
    // IP distinta: contador propio.
    assert.equal(await rl.enforceRateLimit(reqWithIp('2.2.2.2'), createRes(), { scope: 's1', limit: 2, windowSeconds: 60 }), null);
    // Scope distinto: contador propio.
    assert.equal(await rl.enforceRateLimit(reqWithIp('1.1.1.1'), createRes(), { scope: 's2', limit: 2, windowSeconds: 60 }), null);
    // Original agotado.
    const res = createRes();
    assert.notEqual(await rl.enforceRateLimit(reqWithIp('1.1.1.1'), res, { scope: 's1', limit: 2, windowSeconds: 60 }), null);
    assert.equal(res.statusCode, 429);
  } finally {
    restore();
    delete require.cache[require.resolve('../lib/_rate-limit')];
  }
});

test('B7-07/08: IP/email crudos jamás persistidos ni logueados', async () => {
  const state = freshState();
  const restore = mockModule('@supabase/supabase-js', supabaseWithBuckets(state));
  delete require.cache[require.resolve('../lib/_rate-limit')];
  try {
    const rl = require('../lib/_rate-limit');
    await rl.enforceRateLimit(reqWithIp('9.9.9.9'), createRes(), {
      scope: 'contact-submit-email', limit: 5, windowSeconds: 3600, identity: 'Victima@Example.com',
    });
    const args = state.rpcCalls[0];
    assert.match(args.p_key_hash, /^[0-9a-f]{64}$/);
    assert.ok(!args.p_key_hash.includes('9.9.9.9'));
    assert.ok(!JSON.stringify(args).includes('Victima'));
    assert.ok(!JSON.stringify(args).toLowerCase().includes('victima'));
  } finally {
    restore();
    delete require.cache[require.resolve('../lib/_rate-limit')];
  }
});

test('B7-09/10: HMAC determinista y sensible al secreto', () => {
  const a = rateLimit.hashRateLimitKey('x', TEST_SECRET);
  const b = rateLimit.hashRateLimitKey('x', TEST_SECRET);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, rateLimit.hashRateLimitKey('x', `${TEST_SECRET}-otro`));
  assert.notEqual(a, rateLimit.hashRateLimitKey('y', TEST_SECRET));
});

test('B7-11: sin secreto en producción falla cerrado', async () => {
  const saved = process.env.RATE_LIMIT_SECRET;
  delete process.env.RATE_LIMIT_SECRET;
  delete require.cache[require.resolve('../lib/_rate-limit')];
  try {
    const rl = require('../lib/_rate-limit');
    const res = createRes();
    const out = await rl.enforceRateLimit(reqWithIp('9.9.9.9'), res, { scope: 't', limit: 1, windowSeconds: 60 });
    assert.equal(out, res);
    assert.equal(res.statusCode, 503);
  } finally {
    process.env.RATE_LIMIT_SECRET = saved;
    delete require.cache[require.resolve('../lib/_rate-limit')];
  }
});

test('B6-ip: prioridad x-vercel-forwarded-for y fallback local', () => {
  assert.equal(
    rateLimit.getClientIp({ headers: { 'x-vercel-forwarded-for': '5.5.5.5', 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' } }),
    '5.5.5.5'
  );
  assert.equal(rateLimit.getClientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' } }), '6.6.6.6');
  assert.equal(rateLimit.getClientIp({ headers: { 'x-real-ip': '7.7.7.7' } }), '7.7.7.7');
  assert.equal(rateLimit.getClientIp({ headers: {} }), 'local');
  assert.equal(rateLimit.getClientIp({}), 'local');
});

// Contacto: upload intent limitado ANTES de firmar (12-13).
test('B7-12/13: upload bloqueado no firma nada', async () => {
  const contactState = { emailSends: [], inserts: [], signCalls: [], signedUploadCalls: [], insertResults: [], signResults: [], signedUploadResults: [], emailResults: [], rpcCalls: [], rpcResults: [] };
  // Agotar las 10 del scope con la misma IP.
  const keyOf = (ip) => rateLimit.hashRateLimitKey(`contact-upload-ip:ip:${ip}`, TEST_SECRET);
  const bucketKey = `contact-upload-ip|${keyOf('9.9.9.9')}`;
  contactState.rpcResults = Array.from({ length: 10 }, () => ({ data: [{ allowed: true, remaining: 0, retry_after_seconds: 0 }], error: null }));
  contactState.rpcResults.push({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 42 }], error: null });

  const restores = [
    mockModule('@supabase/supabase-js', {
      createClient: () => ({
        rpc: async (name, args) => {
          contactState.rpcCalls.push(args);
          return contactState.rpcResults.shift() || { data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null };
        },
        from: () => ({ insert: async () => ({ data: null, error: null }) }),
        storage: {
          from: () => ({
            createSignedUploadUrl: async (...a) => { contactState.signedUploadCalls.push(a); return { data: { path: 'x', signedUrl: 'https://up.test/x?token=z' }, error: null }; },
            createSignedUrl: async (...a) => { contactState.signCalls.push(a); return { data: { signedUrl: 's' }, error: null }; },
          }),
        },
      }),
    }),
    mockModule('resend', { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'e' }, error: null }) }; } } }),
    mockModule('../lib/_meta-capi', { trackMetaEvent: async () => ({ ok: true }) }),
  ];
  delete require.cache[require.resolve('../api/contact-notify')];
  assert.ok(bucketKey.length > 0);
  try {
    const handler = require('../api/contact-notify');
    const headers = { 'x-forwarded-for': '9.9.9.9' };
    for (let i = 0; i < 10; i += 1) {
      const res = createRes();
      await handler({ method: 'POST', headers, body: { action: 'create_attachment_upload', mime_type: 'image/png', size: 100 } }, res);
      assert.equal(res.statusCode, 200);
    }
    assert.equal(contactState.signedUploadCalls.length, 10);
    const blocked = createRes();
    await handler({ method: 'POST', headers, body: { action: 'create_attachment_upload', mime_type: 'image/png', size: 100 } }, blocked);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers['Retry-After'], '42');
    assert.equal(contactState.signedUploadCalls.length, 10, 'cero firmas extra');
  } finally {
    delete require.cache[require.resolve('../api/contact-notify')];
    restores.forEach((r) => r());
  }
});

// Contacto submit: bloqueado antes de DB/emails/CAPI (14-16).
test('B7-14/15/16: submit bloqueado no inserta, no email, no CAPI', async () => {
  let rpcCount = 0;
  const calls = { inserts: 0, emails: 0, capi: 0 };
  const restores = [
    mockModule('@supabase/supabase-js', {
      createClient: () => ({
        rpc: async () => {
          rpcCount += 1;
          // Primer scope (ip) permitido, segundo (email) bloqueado.
          return rpcCount === 1
            ? { data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null }
            : { data: [{ allowed: false, remaining: 0, retry_after_seconds: 60 }], error: null };
        },
        from: () => ({ insert: async () => { calls.inserts += 1; return { data: null, error: null }; } }),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 's' }, error: null }) }) },
      }),
    }),
    mockModule('resend', { Resend: class { constructor() { this.emails = { send: async () => { calls.emails += 1; return { data: { id: 'e' }, error: null }; } }; } } }),
    mockModule('../lib/_meta-capi', { trackMetaEvent: async () => { calls.capi += 1; return { ok: true }; } }),
  ];
  delete require.cache[require.resolve('../api/contact-notify')];
  try {
    const handler = require('../api/contact-notify');
    const res = createRes();
    await handler({
      method: 'POST',
      headers: { 'x-forwarded-for': '9.9.9.9' },
      body: { email: 'user@example.com', full_name: 'U', subject: 'S', message: 'M' },
    }, res);
    assert.equal(res.statusCode, 429);
    assert.equal(calls.inserts, 0);
    assert.equal(calls.emails, 0);
    assert.equal(calls.capi, 0);
  } finally {
    delete require.cache[require.resolve('../api/contact-notify')];
    restores.forEach((r) => r());
  }
});

// Promo 429 (17).
test('B7-17: promo endpoint 429 tras umbral', async () => {
  let rpcCount = 0;
  const restores = [
    mockModule('@supabase/supabase-js', {
      createClient: () => ({
        rpc: async (name, args) => {
          rpcCount += 1;
          assert.equal(args.p_scope, 'promo-ip');
          assert.equal(args.p_limit, 30);
          assert.equal(args.p_window_seconds, 300);
          return rpcCount <= 30
            ? { data: [{ allowed: true, remaining: 0, retry_after_seconds: 0 }], error: null }
            : { data: [{ allowed: false, remaining: 0, retry_after_seconds: 15 }], error: null };
        },
      }),
    }),
    mockModule('../lib/_stripe-promo', { resolvePromotionCode: async () => ({ cleanCode: '', preview: null }) }),
  ];
  delete require.cache[require.resolve('../api/validate-promo-code')];
  // Forzar etapa abierta con fecha real no es necesario: el 429 ocurre antes.
  try {
    const handler = require('../api/validate-promo-code');
    const headers = { 'x-forwarded-for': '9.9.9.9' };
    for (let i = 0; i < 30; i += 1) {
      const res = createRes();
      await handler({ method: 'POST', headers, body: { promoCode: 'X', ticketCount: 1, eventSlug: 'axolote-night-run' } }, res);
      assert.notEqual(res.statusCode, 429);
    }
    const blocked = createRes();
    await handler({ method: 'POST', headers, body: { promoCode: 'X', ticketCount: 1, eventSlug: 'axolote-night-run' } }, blocked);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers['Retry-After'], '15');
  } finally {
    delete require.cache[require.resolve('../api/validate-promo-code')];
    restores.forEach((r) => r());
  }
});

// Checkout 429 (18). Etapa congelada para garantizar apertura.
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

test('B7-18: checkout endpoint 429 tras umbral', async () => {
  await withMockedNow('2026-09-09T12:00:00-06:00', async () => {
  let rpcCount = 0;
  const created = [];
  const restores = [
    mockModule('@supabase/supabase-js', {
      createClient: () => ({
        rpc: async (name, args) => {
          rpcCount += 1;
          assert.equal(args.p_scope, 'checkout-ip');
          return { data: [{ allowed: rpcCount <= 10, remaining: 0, retry_after_seconds: 20 }], error: null };
        },
        from: () => ({ upsert: async () => ({ data: null, error: null }) }),
      }),
    }),
    mockModule('stripe', () => ({
      checkout: { sessions: { create: async (p) => { created.push(p); return { id: 'cs_rl', url: 'https://x' }; }, expire: async () => ({}) } },
    })),
    mockModule('../lib/_stripe-promo', { resolvePromotionCode: async () => ({ cleanCode: '', preview: null }) }),
    mockModule('../lib/_meta-capi', { trackMetaEvent: async () => ({ ok: true }) }),
  ];
  delete require.cache[require.resolve('../api/create-checkout-session')];
  try {
    const handler = require('../api/create-checkout-session');
    const headers = { host: 'localhost:3000', 'x-forwarded-for': '9.9.9.9', cookie: '' };
    const body = {
      buyerEmail: 'rl@example.com',
      tickets: [{ fullName: 'Runner Rl', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
      eventSlug: 'axolote-night-run',
      distance: '5K',
    };
    const first = createRes();
    await handler({ method: 'POST', headers, body }, first);
    assert.equal(first.statusCode, 200);
    for (let i = 1; i < 10; i += 1) {
      const res = createRes();
      await handler({ method: 'POST', headers, body }, res);
      assert.equal(res.statusCode, 200);
    }
    const blocked = createRes();
    await handler({ method: 'POST', headers, body }, blocked);
    assert.equal(blocked.statusCode, 429);
    assert.equal(created.length, 10, 'cero sesiones Stripe extra');
  } finally {
    delete require.cache[require.resolve('../api/create-checkout-session')];
    restores.forEach((r) => r());
  }
  });
});

// 19-20: webhook y admin sin limiter.
test('B7-19/20: webhook y admin no usan rate limiting', () => {
  const webhook = fs.readFileSync(path.join(projectRoot, 'api', 'stripe-webhook.js'), 'utf8');
  assert.ok(!webhook.includes('_rate-limit'), 'webhook sin limiter');
  for (const file of [
    'api/admin-delete-inscription.js',
    'api/admin-update-participant.js',
    'api/admin-update-inscription-email.js',
    'api/admin-manual-transfer.js',
    'api/resend-confirmations.js',
    'api/resend-single-confirmation.js',
    'lib/resend-emails-list.js',
    'lib/me-registrations.js',
    'lib/admin-list-inscriptions.js',
  ]) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    assert.ok(!source.includes('_rate-limit'), `${file} sin limiter`);
  }
});

// 21: contrato RPC atómico en SQL.
test('B7-21: RPC atómica con ON CONFLICT y sin race', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc', 'sql-batch7-rate-limits.sql'), 'utf8');
  assert.ok(sql.includes('on conflict (scope, key_hash, window_start)'), 'upsert atómico');
  assert.ok(sql.includes('do update set request_count'), 'incremento atómico');
  assert.ok(!/select\s+\*\s+from\s+public\.api_rate_limits/i.test(sql), 'sin SELECT previo');
});

// 22: ventana expirada permite de nuevo (contrato: misma key, ventana nueva).
test('B7-22: ventana nueva resetea el contador', async () => {
  const seen = [];
  const restore = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      rpc: async (name, args) => {
        seen.push(args);
        // Primera ventana agotada, segunda ventana permite.
        const allowed = seen.length % 2 === 1;
        return { data: [{ allowed, remaining: allowed ? 0 : 0, retry_after_seconds: allowed ? 0 : 60 }], error: null };
      },
    }),
  });
  delete require.cache[require.resolve('../lib/_rate-limit')];
  try {
    const rl = require('../lib/_rate-limit');
    const req = reqWithIp('9.9.9.9');
    const first = createRes();
    assert.equal(await rl.enforceRateLimit(req, first, { scope: 'w', limit: 1, windowSeconds: 60 }), null);
    const second = createRes();
    assert.notEqual(await rl.enforceRateLimit(req, second, { scope: 'w', limit: 1, windowSeconds: 60 }), null);
    assert.equal(second.statusCode, 429);
  } finally {
    restore();
    delete require.cache[require.resolve('../lib/_rate-limit')];
  }
});

// 23: limpieza acotada en SQL.
test('B6-cleanup: expiración acotada en la función', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc', 'sql-batch7-rate-limits.sql'), 'utf8');
  assert.ok(sql.includes('limit 100'), 'cleanup acotado a 100 filas');
  assert.ok(sql.includes('expires_at'), 'columna de expiración');
});

// 24: funciones Vercel.
test('B6-functions: api/ sigue en 12', () => {
  const files = fs.readdirSync(path.join(projectRoot, 'api')).filter((f) => f.endsWith('.js'));
  assert.ok(files.length <= 12, `api/*.js = ${files.length}`);
});
