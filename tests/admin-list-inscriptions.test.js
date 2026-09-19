// tests/admin-list-inscriptions.test.js - Batch 1A.
// Contrato: Bearer + allowlist server-side; paginación acotada; filtros allowlist.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.ADMIN_EMAILS = 'admin@example.com';

const HANDLER_PATH = path.join(__dirname, '..', 'lib', 'admin-list-inscriptions.js');
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
    select(cols, opts) { state.selectCols = cols; state.selectOpts = opts; return chain; },
    eq(col, val) { state.eqCalls.push({ col, val }); return chain; },
    or(expr) { state.orCalls.push(expr); return chain; },
    order(col, opts) { state.orderCalls.push({ col, opts }); return chain; },
    range(from, to) {
      state.rangeCalls.push({ from, to });
      return Promise.resolve({ data: state.rows, error: state.queryError || null, count: state.count ?? null });
    },
  };
  return {
    auth: {
      getUser: async (token) => {
        const user = (state.usersByToken || {})[token];
        if (!user) return { data: { user: null }, error: new Error('invalid token') };
        return { data: { user }, error: null };
      },
    },
    from(table) { state.fromTable = table; return chain; },
  };
}

function createReqRes({ method = 'GET', headers = {}, query = {} } = {}) {
  return {
    req: { method, headers, query },
    res: {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    },
  };
}

function baseState(overrides = {}) {
  return {
    usersByToken: {
      'admin-token': { id: 'admin-1', email: 'Admin@Example.com' },
      'user-token': { id: 'user-1', email: 'user@example.com' },
    },
    eqCalls: [], orCalls: [], orderCalls: [], rangeCalls: [],
    rows: [], count: 0,
    ...overrides,
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

test('admin-list-inscriptions rechaza método no permitido', async () => {
  const state = baseState();
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ method: 'POST' });
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });
});

test('admin-list-inscriptions sin token → 401', async () => {
  const state = baseState();
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: {} });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });
});

test('admin-list-inscriptions token inválido → 401', async () => {
  const state = baseState();
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer bad' } });
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });
});

test('admin-list-inscriptions usuario normal → 403', async () => {
  const state = baseState();
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer user-token' } });
    await handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(state.rangeCalls.length, 0);
  });
});

test('admin-list-inscriptions admin → 200 con status paid por defecto', async () => {
  const rows = [{ id: 'x', full_name: 'Runner' }];
  const state = baseState({ rows, count: 1 });
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer admin-token' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.rows, rows);
    assert.deepEqual(state.eqCalls, [{ col: 'payment_status', val: 'paid' }]);
    assert.equal(state.fromTable, 'inscripciones');
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 100);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.hasMore, false);
  });
});

test('admin-list-inscriptions status=all no filtra por estado', async () => {
  const state = baseState({ rows: [], count: 0 });
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      query: { status: 'all' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(!state.eqCalls.some((c) => c.col === 'payment_status'));
  });
});

test('admin-list-inscriptions rechaza status y evento inválidos', async () => {
  const state = baseState();
  await withMocks(state, async (handler) => {
    const badStatus = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      query: { status: 'paid; DROP TABLE x' },
    });
    await handler(badStatus.req, badStatus.res);
    assert.equal(badStatus.res.statusCode, 400);

    const badEvent = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      query: { event: 'otro-evento' },
    });
    await handler(badEvent.req, badEvent.res);
    assert.equal(badEvent.res.statusCode, 400);
    assert.equal(state.rangeCalls.length, 0);
  });
});

test('admin-list-inscriptions acota limit a 100 y pagina por range', async () => {
  const state = baseState({ rows: [], count: 250 });
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      query: { limit: '500', page: '2' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(state.rangeCalls, [{ from: 100, to: 199 }]);
    assert.equal(res.body.limit, 100);
    assert.equal(res.body.page, 2);
    assert.equal(res.body.hasMore, true);
  });
});

test('admin-list-inscriptions search usa or() escapado', async () => {
  const state = baseState({ rows: [], count: 0 });
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      query: { search: 'maria, (test)%_\\' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.orCalls.length, 1);
    const expr = state.orCalls[0];
    // Sin comas/paréntesis literales sin escapar ni comodines crudos.
    assert.ok(!expr.includes('maria, (test)'));
    assert.ok(expr.includes('full_name.ilike.'));
    assert.ok(expr.includes('buyer_email.ilike.'));
    assert.ok(expr.includes('order_session_id.ilike.'));
  });
});

test('admin-list-inscriptions no expone columnas fuera del panel', async () => {
  const state = baseState({ rows: [], count: 0 });
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer admin-token' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    for (const col of ['payment_intent_id', 'stripe_event_id', 'stripe_session_id', 'confirmation_email_id']) {
      assert.ok(!state.selectCols.includes(col), `columna inesperada: ${col}`);
    }
    for (const col of ['birth_date', 'whatsapp', 'state', 'borough', 'email_sent']) {
      assert.ok(state.selectCols.includes(col), `columna faltante: ${col}`);
    }
  });
});

test('admin-list-inscriptions error de DB → 500', async () => {
  const state = baseState({ rows: null, count: null, queryError: new Error('db down') });
  await withMocks(state, async (handler) => {
    const { req, res } = createReqRes({ headers: { authorization: 'Bearer admin-token' } });
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });
});
