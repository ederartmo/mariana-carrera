// tests/admin-update-participant.test.js - PR5: editor de UN participante (paid only).
// Allowlist estricta: full_name, shirt_size, birth_date, whatsapp, state, borough.
// Todo lo demás => 400 sin UPDATE. Solo paid (409 si no). Lookup por PK id+email.

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.ADMIN_EMAILS = 'admin@example.com';

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

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const BASE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'runner@example.com',
  buyer_email: 'runner@example.com',
  full_name: 'Runner Original',
  shirt_size: 'M',
  birth_date: '1990-04-11',
  whatsapp: '+525512345678',
  state: 'Jalisco',
  borough: null,
  payment_status: 'paid',
  bib_number: '520',
  order_session_id: 'cs_test_order',
  ticket_index: 1,
  ticket_count: 2,
  event_slug: 'axolote-night-run',
  distance: '5K',
  amount_paid: 550,
};

const PARTICIPANT = {
  fullName: 'Runner Original',
  shirtSize: 'M',
  birthDate: '1990-04-11',
  whatsapp: '+525512345678',
  state: 'Jalisco',
  borough: null,
};

async function runUpdate({ body, row = BASE_ROW, adminEmail = 'admin@example.com' }) {
  const state = { updateCalls: 0, updatePayload: null, eqFilters: [] };
  const updatedRow = { ...row };
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => (adminEmail
          ? { data: { user: { email: adminEmail } }, error: null }
          : { data: { user: null }, error: { message: 'bad token' } }),
      },
      from: () => ({
        select: () => ({
          eq: (column, value) => ({
            eq: (column2, value2) => ({
              single: async () => {
                state.eqFilters.push([[column, value], [column2, value2]]);
                if (!row) return { data: null, error: { message: 'no rows' } };
                return { data: { ...row }, error: null };
              },
            }),
          }),
        }),
        update: (payload) => {
          state.updateCalls += 1;
          state.updatePayload = payload;
          return {
            eq: (column, value) => ({
              eq: (column2, value2) => ({
                select: async () => {
                  state.eqFilters.push([[column, value], [column2, value2]]);
                  Object.assign(updatedRow, payload);
                  return { data: [{ ...updatedRow }], error: null };
                },
              }),
            }),
          };
        },
      }),
    }),
  });
  delete require.cache[require.resolve('../api/admin-update-participant')];

  const silenced = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  try {
    const handler = require('../api/admin-update-participant');
    const res = createResponse();
    await handler({
      method: 'POST',
      headers: adminEmail === 'NO_TOKEN' ? {} : { authorization: 'Bearer admin-token' },
      body,
    }, res);
    return { res, state, updatedRow };
  } finally {
    console.log = silenced.log;
    console.error = silenced.error;
    delete require.cache[require.resolve('../api/admin-update-participant')];
    restoreSupabase();
  }
}

function validBody(overrides = {}, participantOverrides = {}) {
  return {
    id: BASE_ROW.id,
    email: BASE_ROW.email,
    participant: { ...PARTICIPANT, ...participantOverrides },
    ...overrides,
  };
}

test('PR5-1: edición completa válida', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, {
      fullName: 'Nuevo Corredor', shirtSize: 'XXL', birthDate: '1985-07-20',
      whatsapp: '5533334444', state: 'Ciudad de México', borough: 'Benito Juárez',
    }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(state.updateCalls, 1);
  assert.deepEqual(Object.keys(state.updatePayload).sort(), [
    'birth_date', 'borough', 'full_name', 'shirt_size', 'state', 'whatsapp',
  ]);
  assert.equal(state.updatePayload.whatsapp, '+525533334444');
  assert.equal(state.updatePayload.borough, 'Benito Juárez');
});

test('PR5-2: cambio únicamente de nombre', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { fullName: 'Solo Cambio Nombre' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.updatePayload.full_name, 'Solo Cambio Nombre');
  assert.equal(state.updatePayload.shirt_size, 'M');
});

test('PR5-3: cambio únicamente de talla', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { shirtSize: 'XXXL' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.updatePayload.shirt_size, 'XXXL');
});

test('PR5-4: sustitución completa conserva pago/BIB/orden', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, {
      fullName: 'Sustituto Total', shirtSize: 'L', birthDate: '1992-01-15',
      whatsapp: '+525599887766', state: 'Nuevo León', borough: null,
    }),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(!('bib_number' in state.updatePayload));
  assert.ok(!('order_session_id' in state.updatePayload));
  assert.ok(!('payment_status' in state.updatePayload));
  assert.ok(!('amount_paid' in state.updatePayload));
  assert.equal(res.body.inscription.bib_number, '520');
});

test('PR5-5: CDMX + borough válido', async () => {
  const { res } = await runUpdate({
    body: validBody({}, { state: 'Ciudad de México', borough: 'Coyoacán' }),
  });
  assert.equal(res.statusCode, 200);
});

test('PR5-6: CDMX -> Jalisco produce borough NULL', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { state: 'Jalisco', borough: 'Benito Juárez' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.updatePayload.state, 'Jalisco');
  assert.equal(state.updatePayload.borough, null);
});

test('PR5-7: WhatsApp se normaliza a +52', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { whatsapp: '55 1234 5678' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.updatePayload.whatsapp, '+525512345678');
});

test('PR5-8: fecha inválida', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { birthDate: '2026-02-30' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-9: fecha futura', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { birthDate: '2030-01-01' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-10: fecha anterior a 1900', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { birthDate: '1899-12-31' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-11: talla inválida', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { shirtSize: 'XLL' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-12: estado inválido', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { state: 'Narnia', borough: null }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-13: CDMX sin borough', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { state: 'Ciudad de México', borough: null }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-14: intento de enviar bib_number', async () => {
  const { res, state } = await runUpdate({
    body: validBody({ bib_number: '999' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-15: intento de enviar payment_status', async () => {
  const { res, state } = await runUpdate({
    body: validBody({ payment_status: 'refunded' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-16: intento de enviar email dentro de participant', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { email: 'otro@example.com' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-17: intento de enviar amount_paid', async () => {
  const { res, state } = await runUpdate({
    body: validBody({ amount_paid: 1 }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls, 0);
});

test('PR5-18: sin token', async () => {
  const { res, state } = await runUpdate({
    body: validBody(),
    adminEmail: 'NO_TOKEN',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(state.updateCalls, 0);
});

test('PR5-19: usuario no admin', async () => {
  const { res, state } = await runUpdate({
    body: validBody(),
    adminEmail: 'intruso@example.com',
  });
  assert.equal(res.statusCode, 401);
  assert.equal(state.updateCalls, 0);
});

test('PR5-20: id/email inexistente', async () => {
  const { res, state } = await runUpdate({
    body: validBody({ id: '00000000-0000-4000-8000-000000000000' }),
    row: null,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(state.updateCalls, 0);
});

test('PR5-21: registro pending -> 409', async () => {
  const { res, state } = await runUpdate({
    body: validBody(),
    row: { ...BASE_ROW, payment_status: 'pending' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(state.updateCalls, 0);
});

test('PR5-22: multi-ticket, únicamente cambia la fila objetivo (WHERE id+email)', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { fullName: 'Cambio Ticket 2' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.updateCalls, 1);
  const filters = state.eqFilters.flat();
  assert.ok(filters.some(([c, v]) => c === 'id' && v === BASE_ROW.id));
  assert.ok(filters.some(([c, v]) => c === 'email' && v === BASE_ROW.email));
  assert.ok(!filters.some(([c]) => c === 'order_session_id'));
});

test('PR5-23/24/25/26: BIB, orden, pago y monto intactos tras edición', async () => {
  const { res, state } = await runUpdate({
    body: validBody({}, { fullName: 'Verificacion Intactos' }),
  });
  assert.equal(res.statusCode, 200);
  for (const forbidden of ['bib_number', 'order_session_id', 'payment_status', 'amount_paid',
    'id', 'email', 'buyer_email', 'ticket_index', 'ticket_count', 'event_slug',
    'distance', 'payment_intent_id', 'stripe_event_id']) {
    assert.ok(!(forbidden in state.updatePayload), `no debe tocar ${forbidden}`);
  }
  assert.equal(res.body.inscription.bib_number, '520');
  assert.equal(res.body.inscription.order_session_id, 'cs_test_order');
});
