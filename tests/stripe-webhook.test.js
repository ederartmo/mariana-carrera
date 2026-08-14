const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

function checkoutSession(overrides = {}) {
  return {
    id: 'cs_test_123',
    customer_email: 'runner@example.com',
    customer_details: { email: 'runner@example.com', name: 'Runner Test' },
    amount_total: 50000,
    payment_intent: 'pi_test_123',
    metadata: {
      event_slug: 'cascanueces-run',
      distance: '5K',
      ticket_count: '1',
      participant_1_name: 'Runner Test',
      participant_1_shirt: 'M',
    },
    ...overrides,
  };
}

function stripeEvent(type = 'checkout.session.completed', session = checkoutSession()) {
  return {
    id: `evt_${type.replaceAll('.', '_')}`,
    type,
    data: { object: session },
  };
}

function finalizedRow(overrides = {}) {
  return {
    id: 'ins_test_123',
    full_name: 'Runner Test',
    email: 'runner@example.com',
    buyer_email: 'runner@example.com',
    event_slug: 'cascanueces-run',
    distance: '5K',
    amount_paid: 500,
    payment_status: 'paid',
    bib_number: '001',
    shirt_size: 'M',
    email_sent: false,
    stripe_session_id: 'cs_test_123',
    order_session_id: 'cs_test_123',
    ticket_index: 1,
    ticket_count: 1,
    ...overrides,
  };
}

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

function createSupabaseMock(state) {
  return {
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      const next = state.rpcResults.shift();
      if (!next) return { data: [], error: null };
      return typeof next === 'function' ? next(name, args) : next;
    },
    from: (table) => ({
      update(payload) {
        const query = {
          eq(column, value) {
            state.updateCalls.push({ table, payload, eq: { column, value } });
            return query;
          },
          or(expression) {
            const last = state.updateCalls[state.updateCalls.length - 1];
            if (last) last.or = expression;
            return Promise.resolve({ error: state.updateError || null });
          },
          select() {
            return Promise.resolve({ data: [], error: state.updateError || null });
          },
          limit() {
            return Promise.resolve({ data: [], error: state.updateError || null });
          },
        };
        return query;
      },
      upsert(payload, options) {
        state.upsertCalls.push({ table, payload, options });
        return Promise.resolve({ data: null, error: state.upsertError || null });
      },
      select() {
        return {
          eq() { return Promise.resolve({ data: [], error: null }); },
          like() { return Promise.resolve({ data: [], error: null }); },
          in() { return Promise.resolve({ data: [], error: null }); },
          order() { return this; },
          limit() { return Promise.resolve({ data: [], error: null }); },
        };
      },
    }),
  };
}

function createReqRes(event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'test_signature' };

  const res = {
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
    send(payload) {
      this.body = payload;
      return this;
    },
  };

  return { req, res };
}

async function withWebhookMocks({ event, rpcResults = [], resendResults = [], updateError = null }, run) {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const state = {
    event,
    rpcResults: [...rpcResults],
    resendResults: [...resendResults],
    rpcCalls: [],
    emailSends: [],
    updateCalls: [],
    upsertCalls: [],
    updateError,
    upsertError: null,
    metaCalls: [],
  };

  const restoreStripe = mockModule('stripe', () => ({
    webhooks: {
      constructEvent: () => state.event,
    },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
    charges: { retrieve: async () => ({}) },
  }));
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => createSupabaseMock(state),
  });
  const restoreResend = mockModule('resend', {
    Resend: class MockResend {
      constructor() {
        this.emails = {
          send: async (payload) => {
            state.emailSends.push(payload);
            return state.resendResults.shift() || { data: { id: 'email_default' }, error: null };
          },
        };
      }
    },
  });
  const restoreMeta = mockModule('../api/_meta-capi', {
    trackMetaEvent: async (payload) => {
      state.metaCalls.push(payload);
      return { ok: true };
    },
  });

  delete require.cache[require.resolve('../api/stripe-webhook')];
  const webhook = require('../api/stripe-webhook');

  try {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    await run({ webhook, state });
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    delete require.cache[require.resolve('../api/stripe-webhook')];
    restoreMeta();
    restoreResend();
    restoreSupabase();
    restoreStripe();
  }
}

async function invoke(webhook, event) {
  const { req, res } = createReqRes(event);
  await webhook(req, res);
  return res;
}

function emailPayload() {
  return {
    email: 'runner@example.com',
    fullName: 'Runner Test',
    primaryBibNumber: '001',
    primaryParticipant: { fullName: 'Runner Test', shirtSize: 'M' },
    amountTotal: 500,
    safeParticipants: [{ fullName: 'Runner Test', shirtSize: 'M' }],
    shirtSize: 'M',
    participantDetails: [{ fullName: 'Runner Test', shirtSize: 'M', bibNumber: '001' }],
    eventSlug: 'cascanueces-run',
    distance: '5K',
  };
}

test('sendConfirmationEmail returns ok and resendId only when Resend returns data.id', async () => {
  await withWebhookMocks({
    event: stripeEvent(),
    resendResults: [{ data: { id: 'email_123' }, error: null }],
  }, async ({ webhook }) => {
    const result = await webhook.sendConfirmationEmail(emailPayload());

    assert.equal(result.ok, true);
    assert.equal(result.resendId, 'email_123');
  });
});

test('sendConfirmationEmail returns failure when Resend returns an error object', async () => {
  await withWebhookMocks({
    event: stripeEvent(),
    resendResults: [{ data: null, error: { message: 'API key is invalid' } }],
  }, async ({ webhook }) => {
    const result = await webhook.sendConfirmationEmail(emailPayload());

    assert.equal(result.ok, false);
    assert.equal(result.error, 'API key is invalid');
  });
});

for (const eventType of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
  test(`${eventType} finalizes paid order and sends one confirmation email`, async () => {
    const event = stripeEvent(eventType);
    await withWebhookMocks({
      event,
      rpcResults: [{ data: [finalizedRow()], error: null }],
      resendResults: [{ data: { id: 'email_001' }, error: null }],
    }, async ({ webhook, state }) => {
      const res = await invoke(webhook, event);

      assert.equal(res.statusCode, 200);
      assert.equal(state.rpcCalls.length, 1);
      assert.equal(state.rpcCalls[0].name, 'finalize_paid_order');
      assert.equal(state.rpcCalls[0].args.p_order_session_id, 'cs_test_123');
      assert.equal(state.rpcCalls[0].args.p_event_slug, 'cascanueces-run');
      assert.equal(state.rpcCalls[0].args.p_participants.length, 1);
      assert.equal(state.emailSends.length, 1);
      assert.equal(state.updateCalls.length, 1);
      assert.equal(state.updateCalls[0].payload.email_sent, true);
      assert.equal(state.updateCalls[0].payload.confirmation_email_id, 'email_001');
    });
  });

  test(`${eventType} duplicate webhook keeps same BIB and does not resend when email_sent is true`, async () => {
    const event = stripeEvent(eventType);
    await withWebhookMocks({
      event,
      rpcResults: [
        { data: [finalizedRow({ bib_number: '001', email_sent: false })], error: null },
        { data: [finalizedRow({ bib_number: '001', email_sent: true })], error: null },
      ],
      resendResults: [{ data: { id: 'email_001' }, error: null }],
    }, async ({ webhook, state }) => {
      const first = await invoke(webhook, event);
      const second = await invoke(webhook, event);

      assert.equal(first.statusCode, 200);
      assert.equal(second.statusCode, 200);
      assert.equal(state.rpcCalls.length, 2);
      assert.equal(state.emailSends.length, 1);
      assert.equal(state.updateCalls.length, 1);
      assert.equal(state.rpcCalls[0].args.p_order_session_id, state.rpcCalls[1].args.p_order_session_id);
    });
  });

  test(`${eventType} returns 5xx and does not email when finalize_paid_order fails`, async () => {
    const event = stripeEvent(eventType);
    await withWebhookMocks({
      event,
      rpcResults: [{ data: null, error: { message: 'payload contradictorio' } }],
    }, async ({ webhook, state }) => {
      const res = await invoke(webhook, event);

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { received: false, error: 'db_processing_failed' });
      assert.equal(state.emailSends.length, 0);
      assert.equal(state.updateCalls.length, 0);
    });
  });

  test(`${eventType} returns 200 and does not mark email_sent when Resend fails`, async () => {
    const event = stripeEvent(eventType);
    await withWebhookMocks({
      event,
      rpcResults: [{ data: [finalizedRow({ email_sent: false })], error: null }],
      resendResults: [{ data: null, error: { message: 'Resend down' } }],
    }, async ({ webhook, state }) => {
      const res = await invoke(webhook, event);

      assert.equal(res.statusCode, 200);
      assert.equal(state.emailSends.length, 1);
      assert.equal(state.updateCalls.length, 0);
    });
  });

  test(`${eventType} retry sends pending confirmation and then marks email_sent`, async () => {
    const event = stripeEvent(eventType);
    await withWebhookMocks({
      event,
      rpcResults: [{ data: [finalizedRow({ payment_status: 'paid', bib_number: '001', email_sent: false })], error: null }],
      resendResults: [{ data: { id: 'email_retry' }, error: null }],
    }, async ({ webhook, state }) => {
      const res = await invoke(webhook, event);

      assert.equal(res.statusCode, 200);
      assert.equal(state.emailSends.length, 1);
      assert.equal(state.updateCalls.length, 1);
      assert.equal(state.updateCalls[0].payload.email_sent, true);
      assert.equal(state.updateCalls[0].payload.confirmation_email_id, 'email_retry');
    });
  });
}

test('payload contradiction returned by RPC produces 5xx and no email', async () => {
  const event = stripeEvent('checkout.session.completed', checkoutSession({
    metadata: {
      event_slug: 'cascanueces-run',
      distance: '5K',
      ticket_count: '1',
      participant_1_name: 'Different Runner',
      participant_1_shirt: 'M',
    },
  }));

  await withWebhookMocks({
    event,
    rpcResults: [{ data: null, error: { message: 'Orden ya procesada, pero contradice participants recibidos' } }],
  }, async ({ webhook, state }) => {
    const res = await invoke(webhook, event);

    assert.equal(res.statusCode, 500);
    assert.equal(state.emailSends.length, 0);
    assert.equal(state.updateCalls.length, 0);
  });
});
