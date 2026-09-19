// tests/admin-mutations.test.js - Batch 4: auth central + delete hardening.
// Cubre: auth (1-5), delete (6-17), update-email (18-21), update-participant
// (22-23), manual-transfer (24-25).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.ADMIN_EMAILS = 'admin@example.com';

const projectRoot = path.join(__dirname, '..');

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
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function terminal(state, queueName, calls, entry) {
  const queue = state[queueName];
  const next = Array.isArray(queue) && queue.length > 0 ? queue.shift() : null;
  if (entry) calls.push(entry);
  return Promise.resolve(next || { data: [], error: null });
}

function createSupabaseMock(state) {
  return {
    auth: {
      getUser: async (token) => {
        const email = (state.usersByToken || {})[token];
        if (!email) return { data: { user: null }, error: new Error('invalid token') };
        return { data: { user: { id: 'u_admin', email } }, error: null };
      },
    },
    rpc: async (name, args) => {
      state.calls.rpc.push({ name, args });
      const next = (state.rpcResults || []).shift();
      return next || { data: '001', error: null };
    },
    from: (table) => ({
      select(cols) {
        const chain = {
          eq(col, val) { state.calls.select.push({ table, cols, op: 'eq', col, val }); return chain; },
          in(col, vals) { state.calls.select.push({ table, cols, op: 'in', col, vals }); return chain; },
          order() { return chain; },
          limit() { return chain; },
          single() { return terminal(state, 'selectResults', [], null).then((r) => ({ data: (r.data || [])[0] || null, error: r.error })); },
          then(resolve, reject) { return terminal(state, 'selectResults', [], null).then(resolve, reject); },
        };
        return chain;
      },
      update(payload) {
        const chain = {
          eq(col, val) { state.calls.update.push({ table, payload, op: 'eq', col, val }); return chain; },
          in(col, vals) { state.calls.update.push({ table, payload, op: 'in', col, vals }); return chain; },
          select() { return terminal(state, 'updateResults', [], null); },
          single() { return terminal(state, 'updateResults', [], null).then((r) => ({ data: (r.data || [])[0] || null, error: r.error })); },
        };
        return chain;
      },
      insert(payload) {
        state.calls.insert.push({ table, payload });
        return {
          select: () => ({
            single: async () => {
              const next = (state.insertResults || []).shift();
              return next || { data: { id: 'ins_new', ...payload }, error: null };
            },
          }),
        };
      },
      delete() {
        const chain = {
          eq(col, val) { state.calls.delete.push({ table, op: 'eq', col, val }); return chain; },
          select() { return chain; },
          then(resolve, reject) { return terminal(state, 'deleteResults', [], null).then(resolve, reject); },
        };
        return chain;
      },
    }),
  };
}

function baseState(overrides = {}) {
  return {
    usersByToken: { 'admin-token': 'admin@example.com', 'user-token': 'user@example.com' },
    selectResults: [],
    updateResults: [],
    deleteResults: [],
    insertResults: [],
    rpcResults: [],
    calls: { select: [], update: [], delete: [], insert: [], rpc: [] },
    ...overrides,
  };
}

function loadFresh(relativePath) {
  const full = path.join(projectRoot, relativePath);
  delete require.cache[full];
  return require(full);
}

async function withAdminMocks(state, extraMocks, run) {
  const restores = [
    mockModule('@supabase/supabase-js', { createClient: () => createSupabaseMock(state) }),
    ...(extraMocks || []),
  ];
  try {
    await run();
  } finally {
    restores.forEach((restore) => restore());
  }
}

function adminReq(body, token = 'admin-token') {
  return {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body || {},
    query: {},
  };
}

function testRow(overrides = {}) {
  return { id: 'row_1', order_session_id: 'cs_test_order', stripe_session_id: 'cs_test_order', payment_status: 'pending', ...overrides };
}

// ---------- AUTH (1-5) ----------

test('B4-1: admin válido puede borrar orden test', async () => {
  const rows = [testRow(), testRow({ id: 'row_2' })];
  const state = baseState({ selectResults: [{ data: rows, error: null }], deleteResults: [{ data: [{ id: 'row_1' }, { id: 'row_2' }], error: null }] });
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-delete-inscription.js');
    const res = createRes();
    await handler(adminReq({ orderSessionId: 'cs_test_order', confirmTarget: 'cs_test_order' }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deletedCount, 2);
  });
});

test('B4-2: token inválido → 401', async () => {
  const state = baseState();
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-delete-inscription.js');
    const res = createRes();
    await handler(adminReq({ orderSessionId: 'cs_test_order', confirmTarget: 'cs_test_order' }, 'bad-token'), res);

    assert.equal(res.statusCode, 401);
    assert.equal(state.calls.delete.length, 0);
  });
});

test('B4-3: usuario válido no-admin → 403', async () => {
  const state = baseState();
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-delete-inscription.js');
    const res = createRes();
    await handler(adminReq({ orderSessionId: 'cs_test_order', confirmTarget: 'cs_test_order' }, 'user-token'), res);

    assert.equal(res.statusCode, 403);
    assert.equal(state.calls.delete.length, 0);
  });
});

test('B4-4: ADMIN_EMAILS ausente → 403 (fail closed)', async () => {
  const saved = process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
  const state = baseState();
  try {
    await withAdminMocks(state, null, async () => {
      const handler = loadFresh('api/admin-delete-inscription.js');
      const res = createRes();
      await handler(adminReq({ orderSessionId: 'cs_test_order', confirmTarget: 'cs_test_order' }), res);

      assert.equal(res.statusCode, 403);
      assert.equal(state.calls.delete.length, 0);
    });
  } finally {
    process.env.ADMIN_EMAILS = saved;
  }
});

test('B4-5: sin fallback hardcodeado ni auth duplicada en endpoints', () => {
  const files = [
    'api/admin-delete-inscription.js',
    'api/admin-update-participant.js',
    'api/admin-update-inscription-email.js',
    'api/admin-manual-transfer.js',
    'api/resend-confirmations.js',
    'api/resend-single-confirmation.js',
    'lib/resend-emails-list.js',
    'lib/_auth.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    assert.ok(!source.includes('mariana@kinetichub.com.mx'), `${file} sin email hardcodeado`);
    assert.ok(!source.includes('gato.jijen01'), `${file} sin email hardcodeado`);
    assert.ok(!source.includes('getAdminUserFromRequest'), `${file} sin auth duplicada`);
  }
  for (const file of files.filter((f) => f !== 'lib/_auth.js')) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    assert.ok(source.includes("require('../lib/_auth')") || source.includes("require('./_auth')"), `${file} usa auth central`);
    assert.ok(source.includes('getAdminUser(req)'), `${file} valida con getAdminUser`);
  }
  const authSource = fs.readFileSync(path.join(projectRoot, 'lib/_auth.js'), 'utf8');
  assert.ok(authSource.includes("process.env.ADMIN_EMAILS || ''"), 'fail closed sin fallback');
});

// ---------- DELETE (6-17) ----------

async function runDelete(state, body, token) {
  let handler;
  await withAdminMocks(state, null, async () => {
    handler = loadFresh('api/admin-delete-inscription.js');
    const res = createRes();
    await handler(adminReq(body, token), res);
    state.__res = res;
  });
  return state.__res;
}

test('B4-6: sin confirmTarget → 400, zero delete', async () => {
  const state = baseState({ selectResults: [{ data: [testRow()], error: null }] });
  const res = await runDelete(state, { orderSessionId: 'cs_test_order' });

  assert.equal(res.statusCode, 400);
  assert.equal(state.calls.delete.length, 0);
});

test('B4-7: confirmTarget incorrecto → 400, zero delete', async () => {
  const state = baseState({ selectResults: [{ data: [testRow()], error: null }] });
  const res = await runDelete(state, { orderSessionId: 'cs_test_order', confirmTarget: 'cs_test_otro' });

  assert.equal(res.statusCode, 400);
  assert.equal(state.calls.delete.length, 0);
});

test('B4-8: orden cs_test_ válida → delete permitido', async () => {
  const rows = [testRow(), testRow({ id: 'row_2' })];
  const state = baseState({
    selectResults: [{ data: rows, error: null }],
    deleteResults: [{ data: [{ id: 'row_1' }, { id: 'row_2' }], error: null }],
  });
  const res = await runDelete(state, { orderSessionId: 'cs_test_order', confirmTarget: 'cs_test_order' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deletedCount, 2);
  assert.deepEqual(res.body.deletedIds, ['row_1', 'row_2']);
});

test('B4-9: orden cs_live_ → 409 bloqueada, zero delete', async () => {
  const rows = [testRow({ id: 'l1', order_session_id: 'cs_live_abc', stripe_session_id: 'cs_live_abc', payment_status: 'paid' })];
  const state = baseState({ selectResults: [{ data: rows, error: null }] });
  const res = await runDelete(state, { orderSessionId: 'cs_live_abc', confirmTarget: 'cs_live_abc' });

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /prueba/);
  assert.equal(state.calls.delete.length, 0);
});

test('B4-10: orden mixta test+live → bloqueada completa', async () => {
  const rows = [
    testRow({ id: 'm1', order_session_id: 'cs_test_mix', stripe_session_id: 'cs_test_mix' }),
    testRow({ id: 'm2', order_session_id: 'cs_test_mix', stripe_session_id: 'cs_live_otro', payment_status: 'paid' }),
  ];
  const state = baseState({ selectResults: [{ data: rows, error: null }] });
  const res = await runDelete(state, { orderSessionId: 'cs_test_mix', confirmTarget: 'cs_test_mix' });

  assert.equal(res.statusCode, 409);
  assert.equal(state.calls.delete.length, 0);
});

test('B4-11/12/13: paid, refunded y paid_no_email live → bloqueados', async () => {
  for (const paymentStatus of ['paid', 'refunded', 'paid_no_email']) {
    const rows = [testRow({ order_session_id: 'cs_live_fin', stripe_session_id: 'cs_live_fin', payment_status: paymentStatus })];
    const state = baseState({ selectResults: [{ data: rows, error: null }] });
    const res = await runDelete(state, { orderSessionId: 'cs_live_fin', confirmTarget: 'cs_live_fin' });

    assert.equal(res.statusCode, 409, paymentStatus);
    assert.equal(state.calls.delete.length, 0, paymentStatus);
  }
});

test('B4-14: manual_* NO se considera test automáticamente', async () => {
  const rows = [testRow({ order_session_id: 'manual_123', stripe_session_id: 'manual_123', payment_status: 'paid' })];
  const state = baseState({ selectResults: [{ data: rows, error: null }] });
  const res = await runDelete(state, { orderSessionId: 'manual_123', confirmTarget: 'manual_123' });

  assert.equal(res.statusCode, 409);
  assert.equal(state.calls.delete.length, 0);
});

test('B4-15: target inexistente → 404', async () => {
  const state = baseState({ selectResults: [{ data: [], error: null }] });
  const res = await runDelete(state, { orderSessionId: 'cs_test_nada', confirmTarget: 'cs_test_nada' });

  assert.equal(res.statusCode, 404);
  assert.equal(state.calls.delete.length, 0);
});

test('B4-16: multi-ticket test borra las filas exactas', async () => {
  const rows = [
    testRow({ id: 't1', order_session_id: 'cs_test_multi', stripe_session_id: 'cs_test_multi' }),
    testRow({ id: 't2', order_session_id: 'cs_test_multi', stripe_session_id: 'cs_test_multi::2' }),
    testRow({ id: 't3', order_session_id: 'cs_test_multi', stripe_session_id: 'cs_test_multi::3' }),
  ];
  const state = baseState({
    selectResults: [{ data: rows, error: null }],
    deleteResults: [{ data: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], error: null }],
  });
  const res = await runDelete(state, { orderSessionId: 'cs_test_multi', confirmTarget: 'cs_test_multi' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deletedCount, 3);
  assert.deepEqual(res.body.deletedIds, ['t1', 't2', 't3']);
});

test('B4-17: inscripción individual production → bloqueada', async () => {
  const rows = [testRow({ id: 'solo1', order_session_id: 'cs_live_solo', stripe_session_id: 'cs_live_solo', payment_status: 'paid' })];
  const state = baseState({ selectResults: [{ data: rows, error: null }] });
  const res = await runDelete(state, { inscriptionId: 'solo1', confirmTarget: 'solo1' });

  assert.equal(res.statusCode, 409);
  assert.equal(state.calls.delete.length, 0);
});

// ---------- UPDATE EMAIL (18-21) ----------

test('B4-18: update-email sin admin → bloqueado', async () => {
  const state = baseState();
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-update-inscription-email.js');
    const res = createRes();
    await handler(adminReq({ inscriptionId: 'x', email: 'nuevo@example.com' }, 'user-token'), res);

    assert.equal(res.statusCode, 403);
    assert.equal(state.calls.update.length, 0);
  });
});

test('B4-19: update-email inválido → 400, zero update', async () => {
  const state = baseState();
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-update-inscription-email.js');
    const res = createRes();
    await handler(adminReq({ inscriptionId: 'x', email: 'no-es-email' }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(state.calls.update.length, 0);
  });
});

test('B4-20: update-email por orden afecta solo esa orden', async () => {
  const existing = [
    { id: 'e1', order_session_id: 'cs_ord_1' },
    { id: 'e2', order_session_id: 'cs_ord_1' },
  ];
  const updated = existing.map((r) => ({ ...r, email: 'nuevo@example.com', buyer_email: 'nuevo@example.com', email_sent: false }));
  const state = baseState({
    selectResults: [{ data: existing, error: null }],
    updateResults: [{ data: updated, error: null }],
  });
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-update-inscription-email.js');
    const res = createRes();
    await handler(adminReq({ orderSessionId: 'cs_ord_1', email: 'nuevo@example.com' }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updatedCount, 2);
    assert.deepEqual(res.body.updatedIds, ['e1', 'e2']);
    assert.ok(state.calls.update.every((c) => c.col === 'order_session_id' && c.val === 'cs_ord_1'));
  });
});

test('B4-21: update-email no toca campos financieros/protegidos', async () => {
  const existing = [{ id: 'e1', order_session_id: 'cs_ord_1' }];
  const state = baseState({
    selectResults: [{ data: existing, error: null }],
    updateResults: [{ data: [{ ...existing[0], email: 'nuevo@example.com' }], error: null }],
  });
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-update-inscription-email.js');
    const res = createRes();
    await handler(adminReq({ inscriptionId: 'e1', email: 'nuevo@example.com' }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(state.calls.update[0].payload).sort(), ['buyer_email', 'email', 'email_sent']);
  });
});

// ---------- UPDATE PARTICIPANT (22-23) ----------

function participantBody(overrides = {}) {
  return {
    id: 'p1',
    email: 'buyer@example.com',
    participant: {
      fullName: 'Runner Editado',
      shirtSize: 'M',
      birthDate: '1990-05-14',
      whatsapp: '5512345678',
      state: 'Jalisco',
      borough: '',
      ...overrides,
    },
  };
}

test('B4-22: update-participant sigue rechazando campos protegidos', async () => {
  const state = baseState();
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-update-participant.js');
    const res = createRes();
    await handler(adminReq({ ...participantBody(), payment_status: 'refunded' }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(state.calls.update.length, 0);
  });
});

test('B4-23: update-participant con auth nueva mantiene funcionalidad', async () => {
  const existing = { id: 'p1', email: 'buyer@example.com', payment_status: 'paid' };
  const state = baseState({
    selectResults: [{ data: [existing], error: null }],
    updateResults: [{ data: [{ ...existing, full_name: 'Runner Editado' }], error: null }],
  });
  await withAdminMocks(state, null, async () => {
    const handler = loadFresh('api/admin-update-participant.js');
    const res = createRes();
    await handler(adminReq(participantBody()), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });
});

// ---------- MANUAL TRANSFER (24-25) ----------

function manualTransferMocks(state) {
  return [
    mockModule('../api/stripe-webhook', {
      sendConfirmationEmail: async () => ({ ok: true, resendId: 'e_test' }),
    }),
  ];
}

function manualTransferBody() {
  return {
    buyerEmail: 'manual@example.com',
    tickets: [{ fullName: 'Runner Manual', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
    totalAmount: 400,
    eventSlug: 'axolote-night-run',
    distance: '5K',
    transferReference: 'TEST-1',
  };
}

test('B4-24: manual-transfer sin admin → zero insert', async () => {
  const state = baseState();
  await withAdminMocks(state, manualTransferMocks(state), async () => {
    const handler = loadFresh('api/admin-manual-transfer.js');
    const res = createRes();
    await handler(adminReq(manualTransferBody(), 'user-token'), res);

    assert.equal(res.statusCode, 403);
    assert.equal(state.calls.insert.length, 0);
  });
});

test('B4-25: manual-transfer admin válido mantiene flujo', async () => {
  const state = baseState({
    rpcResults: [{ data: '084', error: null }],
    insertResults: [{ data: { id: 'm1', full_name: 'Runner Manual', shirt_size: 'M', bib_number: '084', ticket_index: 1 }, error: null }],
  });
  await withAdminMocks(state, manualTransferMocks(state), async () => {
    const handler = loadFresh('api/admin-manual-transfer.js');
    const res = createRes();
    await handler(adminReq(manualTransferBody()), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ticketsCreated, 1);
    assert.equal(state.calls.insert.length, 1);
  });
});
