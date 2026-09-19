// tests/me-registrations.test.js - Batch 1A.
// Contrato: ownership siempre del JWT validado; ?email= se ignora.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const HANDLER_PATH = path.join(__dirname, '..', 'lib', 'me-registrations.js');
const AUTH_PATH = path.join(__dirname, '..', 'lib', '_auth.js');

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

function loadFreshHandler() {
  delete require.cache[HANDLER_PATH];
  delete require.cache[AUTH_PATH];
  return require(HANDLER_PATH);
}

function createSupabaseMock(state) {
  const chain = {
    select(cols) { state.selectCols = cols; return chain; },
    eq(col, val) { state.eqCalls.push({ col, val }); return chain; },
    order(col, opts) { state.orderCalls.push({ col, opts }); return chain; },
    then(resolve, reject) {
      return Promise.resolve({ data: state.rows, error: state.queryError || null }).then(resolve, reject);
    },
  };
  return {
    auth: {
      getUser: async (token) => {
        state.seenTokens.push(token);
        const user = (state.usersByToken || {})[token];
        if (!user) return { data: { user: null }, error: new Error('invalid token') };
        return { data: { user }, error: null };
      },
    },
    from(table) { state.fromTable = table; return chain; },
  };
}

function createReqRes({ method = 'GET', headers = {}, query = {}, body = {} } = {}) {
  return {
    req: { method, headers, query, body },
    res: {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    },
  };
}

async function withMocks(state, run) {
  const restore = mockModule('@supabase/supabase-js', {
    createClient: () => createSupabaseMock(state),
  });
  try {
    await run(loadFreshHandler());
  } finally {
    restore();
    delete require.cache[HANDLER_PATH];
    delete require.cache[AUTH_PATH];
  }
}

const userA = { id: 'user-a', email: 'A@Example.com' };

function profileRow(overrides = {}) {
  return {
    id: 'ins_1',
    created_at: '2026-09-01T06:00:00.000Z',
    stripe_session_id: 'cs_test_1',
    email: 'a@example.com',
    full_name: 'Runner A',
    event_slug: 'axolote-night-run',
    distance: '5K',
    amount_paid: 500,
    payment_status: 'paid',
    bib_number: '001',
    ...overrides,
  };
}

test('me/registrations rechaza método no permitido', async () => {
  const state = { usersByToken: {}, eqCalls: [], orderCalls: [], seenTokens: [], rows: [] };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ method: 'POST' });
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });
});

test('me/registrations sin Authorization → 401', async () => {
  const state = { usersByToken: {}, eqCalls: [], orderCalls: [], seenTokens: [], rows: [] };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: {} });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(state.seenTokens.length, 0);
  });
});

test('me/registrations con token inválido → 401', async () => {
  const state = { usersByToken: {}, eqCalls: [], orderCalls: [], seenTokens: [], rows: [] };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer bad-token' } });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });
});

test('me/registrations ignora ?email= malicioso y usa el email del JWT', async () => {
  const rows = [profileRow()];
  const state = {
    usersByToken: { 'token-a': userA },
    eqCalls: [], orderCalls: [], seenTokens: [], rows,
  };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token-a' },
      query: { email: 'b@example.com' },
      body: { email: 'b@example.com' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.registrations, rows);
    // Ownership = email normalizado del JWT, nunca el query/body.
    assert.deepEqual(state.eqCalls, [{ col: 'email', val: 'a@example.com' }]);
    assert.equal(state.fromTable, 'inscripciones');
  });
});

test('me/registrations sin carreras → arreglo vacío', async () => {
  const state = {
    usersByToken: { 'token-a': userA },
    eqCalls: [], orderCalls: [], seenTokens: [], rows: [],
  };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer token-a' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { registrations: [] });
  });
});

test('me/registrations devuelve múltiples filas multi-evento en orden creado DESC', async () => {
  const rows = [
    profileRow({ id: 'ins_2', event_slug: 'cascanueces-run', distance: '10K', bib_number: '010' }),
    profileRow({ id: 'ins_1' }),
  ];
  const state = {
    usersByToken: { 'token-a': userA },
    eqCalls: [], orderCalls: [], seenTokens: [], rows,
  };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer token-a' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.registrations, rows);
    assert.deepEqual(state.orderCalls, [{ col: 'created_at', opts: { ascending: false } }]);
  });
});

test('me/registrations solo expone las columnas del perfil', async () => {
  const state = {
    usersByToken: { 'token-a': userA },
    eqCalls: [], orderCalls: [], seenTokens: [], rows: [profileRow()],
  };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer token-a' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(
      state.selectCols,
      'id, created_at, stripe_session_id, email, full_name, event_slug, distance, amount_paid, payment_status, bib_number'
    );
    assert.ok(!state.selectCols.includes('payment_intent_id'));
    assert.ok(!state.selectCols.includes('buyer_email'));
    assert.ok(!state.selectCols.includes('whatsapp'));
  });
});

test('me/registrations error de DB → 500', async () => {
  const state = {
    usersByToken: { 'token-a': userA },
    eqCalls: [], orderCalls: [], seenTokens: [],
    rows: null,
    queryError: new Error('db down'),
  };
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer token-a' } });
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });
});
