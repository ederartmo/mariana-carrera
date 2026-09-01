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

function buildSupabaseMock(state) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
    },
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      return { data: String(state.nextBib++).padStart(3, '0'), error: null };
    },
    from: (table) => ({
      insert(payload) {
        state.insertPayloads.push(payload);
        const inserted = {
          id: `ins_${state.insertPayloads.length}`,
          full_name: payload.full_name,
          shirt_size: payload.shirt_size,
          bib_number: payload.bib_number,
          ticket_index: payload.ticket_index,
        };
        return {
          select: () => ({
            single: async () => ({ data: inserted, error: null }),
          }),
        };
      },
      update(payload) {
        return {
          eq: async (column, value) => {
            state.updateCalls.push({ table, payload, column, value });
            return { data: null, error: null };
          },
        };
      },
    }),
  };
}

async function runManualTransfer({ eventSlug, distance }) {
  const state = {
    emailPayloads: [],
    insertPayloads: [],
    rpcCalls: [],
    updateCalls: [],
    nextBib: 84,
  };

  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => buildSupabaseMock(state),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      state.emailPayloads.push({
        ...payload,
        html: `Evento: ${payload.eventSlug} Distancia: ${payload.distance}`,
      });
      return { ok: true, resendId: 'email_test' };
    },
  });

  delete require.cache[require.resolve('../api/admin-manual-transfer')];
  const handler = require('../api/admin-manual-transfer');
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer admin-token' },
    body: {
      buyerEmail: 'manual-test@example.com',
      tickets: [{ fullName: 'Runner Manual Test', shirtSize: 'M' }],
      totalAmount: 400,
      eventSlug,
      distance,
      transferReference: 'TEST',
      paidAt: '2026-08-31T17:20:00-06:00',
    },
  };
  const res = createResponse();

  const originalLog = console.log;
  try {
    console.log = () => {};
    await handler(req, res);
  } finally {
    console.log = originalLog;
    delete require.cache[require.resolve('../api/admin-manual-transfer')];
    restoreWebhook();
    restoreSupabase();
  }

  return { state, res };
}

test('admin manual Cascanueces 10K stores and emails 10K', async () => {
  const { state, res } = await runManualTransfer({
    eventSlug: 'cascanueces-run',
    distance: '10K',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].distance, '10K');
  assert.equal(state.emailPayloads[0].distance, '10K');
  assert.match(state.emailPayloads[0].html, /Distancia: 10K/);
});

test('admin manual Cascanueces 5K stores and emails 5K', async () => {
  const { state, res } = await runManualTransfer({
    eventSlug: 'cascanueces-run',
    distance: '5K',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].distance, '5K');
  assert.equal(state.emailPayloads[0].distance, '5K');
  assert.match(state.emailPayloads[0].html, /Distancia: 5K/);
});

test('admin manual Axolote keeps 5K in storage and email', async () => {
  const { state, res } = await runManualTransfer({
    eventSlug: 'axolote-night-run',
    distance: '5K',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].distance, '5K');
  assert.equal(state.emailPayloads[0].distance, '5K');
  assert.match(state.emailPayloads[0].html, /Distancia: 5K/);
});
