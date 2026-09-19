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
    payment_status: 'paid',
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
          like(column, value) {
            state.updateCalls.push({ table, payload, like: { column, value } });
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
  const restoreMeta = mockModule('../lib/_meta-capi', {
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

function emailPayload(overrides = {}) {
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
    ...overrides,
  };
}

function countMetaEvent(state, eventName) {
  return state.metaCalls.filter((call) => call.eventName === eventName).length;
}

function createJsonRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
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

function queryResult(data, error = null) {
  return {
    order() { return this; },
    eq() { return this; },
    then(resolve, reject) {
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
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

test('sendConfirmationEmail renders Cascanueces 5K when distance is explicit 5K', async () => {
  await withWebhookMocks({
    event: stripeEvent(),
    resendResults: [{ data: { id: 'email_5k' }, error: null }],
  }, async ({ webhook, state }) => {
    await webhook.sendConfirmationEmail(emailPayload({ distance: '5K' }));

    assert.match(state.emailSends[0].html, />5K<\/td>/);
  });
});

test('sendConfirmationEmail renders Cascanueces 10K when distance is explicit 10K', async () => {
  await withWebhookMocks({
    event: stripeEvent(),
    resendResults: [{ data: { id: 'email_10k' }, error: null }],
  }, async ({ webhook, state }) => {
    await webhook.sendConfirmationEmail(emailPayload({ distance: '10K', amountTotal: 500 }));

    assert.match(state.emailSends[0].html, />10K<\/td>/);
  });
});

test('sendConfirmationEmail does not silently default Cascanueces without distance to 5K', async () => {
  await withWebhookMocks({
    event: stripeEvent(),
  }, async ({ webhook, state }) => {
    await assert.rejects(
      () => webhook.sendConfirmationEmail(emailPayload({ distance: undefined })),
      /Distancia inválida o ausente para cascanueces-run/
    );
    assert.equal(state.emailSends.length, 0);
  });
});

test('sendConfirmationEmail keeps Axolote default 5K when distance is absent', async () => {
  await withWebhookMocks({
    event: stripeEvent(),
    resendResults: [{ data: { id: 'email_axolote' }, error: null }],
  }, async ({ webhook, state }) => {
    await webhook.sendConfirmationEmail(emailPayload({
      eventSlug: 'axolote-night-run',
      distance: undefined,
    }));

    assert.match(state.emailSends[0].html, />5K<\/td>/);
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

test('resend-single-confirmation passes inscription distance to sendConfirmationEmail', async () => {
  const emailCalls = [];
  const records = [finalizedRow({ distance: '10K', order_session_id: 'order_10k' })];
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { email: 'mariana@kinetichub.com.mx' } }, error: null }) },
      from: (table) => ({
        select: () => queryResult(records),
        update: (payload) => ({
          eq: async (column, value) => ({ data: null, error: null, table, payload, column, value }),
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      emailCalls.push(payload);
      return { ok: true, resendId: 'email_single_10k' };
    },
  });
  delete require.cache[require.resolve('../api/resend-single-confirmation')];

  try {
    const handler = require('../api/resend-single-confirmation');
    const res = createJsonRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { orderSessionId: 'order_10k' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(emailCalls[0].distance, '10K');
  } finally {
    delete require.cache[require.resolve('../api/resend-single-confirmation')];
    restoreWebhook();
    restoreSupabase();
  }
});

test('resend-confirmations passes each order distance to sendConfirmationEmail', async () => {
  const emailCalls = [];
  const records = [
    finalizedRow({ distance: '10K', order_session_id: 'bulk_10k' }),
  ];
  const previousAdminEmails = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'admin@example.com';
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
      },
      from: (table) => ({
        select: () => queryResult(records),
        update: (payload) => ({
          eq: async (column, value) => ({ data: null, error: null, table, payload, column, value }),
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      emailCalls.push(payload);
      return { ok: true, resendId: 'email_bulk_10k' };
    },
  });
  delete require.cache[require.resolve('../api/resend-confirmations')];

  try {
    const handler = require('../api/resend-confirmations');
    const res = createJsonRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(emailCalls[0].distance, '10K');
  } finally {
    delete require.cache[require.resolve('../api/resend-confirmations')];
    restoreWebhook();
    restoreSupabase();
    if (previousAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = previousAdminEmails;
    }
  }
});

test('admin-manual-transfer passes validated cleanDistance to sendConfirmationEmail', async () => {
  const emailCalls = [];
  let bib = 1;
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { email: 'mariana@kinetichub.com.mx' } }, error: null }) },
      rpc: async () => ({ data: String(bib++).padStart(3, '0'), error: null }),
      from: (table) => ({
        insert: (payload) => ({
          select: () => ({
            single: async () => ({
              data: {
                id: 'manual_1',
                full_name: payload.full_name,
                shirt_size: payload.shirt_size,
                bib_number: payload.bib_number,
                ticket_index: payload.ticket_index,
              },
              error: null,
            }),
          }),
        }),
        update: (payload) => ({
          eq: async (column, value) => ({ data: null, error: null, table, payload, column, value }),
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      emailCalls.push(payload);
      return { ok: true, resendId: 'email_manual_10k' };
    },
  });
  delete require.cache[require.resolve('../api/admin-manual-transfer')];

  try {
    const handler = require('../api/admin-manual-transfer');
    const res = createJsonRes();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        buyerEmail: 'runner@example.com',
        tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
        totalAmount: 500,
        eventSlug: 'cascanueces-run',
        distance: '10k',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(emailCalls[0].distance, '10K');
  } finally {
    delete require.cache[require.resolve('../api/admin-manual-transfer')];
    restoreWebhook();
    restoreSupabase();
  }
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
      assert.equal(state.rpcCalls[0].args.p_distance, '5K');
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

test('checkout.session.completed with unpaid payment_status defers fulfillment without side effects', async () => {
  const event = stripeEvent('checkout.session.completed', checkoutSession({
    payment_status: 'unpaid',
  }));

  await withWebhookMocks({ event }, async ({ webhook, state }) => {
    const res = await invoke(webhook, event);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { received: true, deferred: true });
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.emailSends.length, 0);
    assert.equal(state.updateCalls.length, 0);
    assert.equal(state.upsertCalls.length, 0);
    assert.equal(countMetaEvent(state, 'Purchase'), 0);
    assert.equal(countMetaEvent(state, 'CompleteRegistration'), 0);
  });
});

test('checkout.session.completed unpaid for Cascanueces 10K does not finalize or email', async () => {
  const event = stripeEvent('checkout.session.completed', checkoutSession({
    payment_status: 'unpaid',
    metadata: {
      event_slug: 'cascanueces-run',
      distance: '10K',
      ticket_count: '1',
      participant_1_name: 'Runner Test',
      participant_1_shirt: 'M',
    },
  }));

  await withWebhookMocks({ event }, async ({ webhook, state }) => {
    const res = await invoke(webhook, event);

    assert.equal(res.statusCode, 200);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.emailSends.length, 0);
    assert.equal(state.upsertCalls.length, 0);
    assert.equal(countMetaEvent(state, 'Purchase'), 0);
    assert.equal(countMetaEvent(state, 'CompleteRegistration'), 0);
  });
});

test('checkout.session.completed unpaid followed by async success finalizes only on async success', async () => {
  const unpaidEvent = stripeEvent('checkout.session.completed', checkoutSession({
    payment_status: 'unpaid',
    metadata: {
      event_slug: 'cascanueces-run',
      distance: '10K',
      ticket_count: '1',
      participant_1_name: 'Runner Test',
      participant_1_shirt: 'M',
    },
  }));
  const paidAsyncEvent = stripeEvent('checkout.session.async_payment_succeeded', checkoutSession({
    payment_status: 'paid',
    metadata: {
      event_slug: 'cascanueces-run',
      distance: '10K',
      ticket_count: '1',
      participant_1_name: 'Runner Test',
      participant_1_shirt: 'M',
    },
  }));

  await withWebhookMocks({
    event: unpaidEvent,
    rpcResults: [{ data: [finalizedRow({ distance: '10K', bib_number: '010' })], error: null }],
    resendResults: [{ data: { id: 'email_async_10k' }, error: null }],
  }, async ({ webhook, state }) => {
    const first = await invoke(webhook, unpaidEvent);
    state.event = paidAsyncEvent;
    const second = await invoke(webhook, paidAsyncEvent);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'finalize_paid_order');
    assert.equal(state.rpcCalls[0].args.p_event_slug, 'cascanueces-run');
    assert.equal(state.rpcCalls[0].args.p_distance, '10K');
    assert.equal(state.emailSends.length, 1);
    assert.match(state.emailSends[0].html, />10K<\/td>/);
    assert.equal(countMetaEvent(state, 'Purchase'), 1);
    assert.equal(countMetaEvent(state, 'CompleteRegistration'), 1);
  });
});

test('checkout.session.async_payment_succeeded duplicate relies on RPC email_sent to avoid duplicate email', async () => {
  const event = stripeEvent('checkout.session.async_payment_succeeded', checkoutSession({
    payment_status: 'paid',
    metadata: {
      event_slug: 'cascanueces-run',
      distance: '10K',
      ticket_count: '1',
      participant_1_name: 'Runner Test',
      participant_1_shirt: 'M',
    },
  }));

  await withWebhookMocks({
    event,
    rpcResults: [
      { data: [finalizedRow({ distance: '10K', bib_number: '010', email_sent: false })], error: null },
      { data: [finalizedRow({ distance: '10K', bib_number: '010', email_sent: true })], error: null },
    ],
    resendResults: [{ data: { id: 'email_async_once' }, error: null }],
  }, async ({ webhook, state }) => {
    const first = await invoke(webhook, event);
    const second = await invoke(webhook, event);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(state.rpcCalls.length, 2);
    assert.equal(state.rpcCalls[0].args.p_distance, '10K');
    assert.equal(state.rpcCalls[1].args.p_distance, '10K');
    assert.equal(state.emailSends.length, 1);
    assert.equal(state.updateCalls.length, 1);
  });
});

test('checkout.session.async_payment_failed does not finalize, email, or track Purchase', async () => {
  const event = stripeEvent('checkout.session.async_payment_failed', checkoutSession({
    payment_status: 'unpaid',
  }));

  await withWebhookMocks({ event }, async ({ webhook, state }) => {
    const res = await invoke(webhook, event);

    assert.equal(res.statusCode, 200);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.emailSends.length, 0);
    assert.equal(state.updateCalls.length, 2);
    assert.equal(state.updateCalls[0].payload.payment_status, 'payment_failed');
    assert.equal(countMetaEvent(state, 'Purchase'), 0);
    assert.equal(countMetaEvent(state, 'CompleteRegistration'), 0);
  });
});

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
