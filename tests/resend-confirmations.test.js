const assert = require('node:assert/strict');
const test = require('node:test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
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

function createRes() {
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

function loadHandler() {
  delete require.cache[require.resolve('../api/resend-confirmations')];
  return require('../api/resend-confirmations');
}

function unloadHandler(restorers) {
  delete require.cache[require.resolve('../api/resend-confirmations')];
  restorers.forEach((restore) => restore());
}

test('PR1: resend-confirmations rechaza GET con 405 sin tocar DB ni email', async () => {
  let emailCalls = 0;
  let dbCalls = 0;
  let authCalls = 0;
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => {
          authCalls += 1;
          return { data: { user: null }, error: new Error('no debe validar sesión en 405') };
        },
      },
      from: () => {
        dbCalls += 1;
        throw new Error('no debe consultar DB en 405');
      },
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async () => {
      emailCalls += 1;
      return { ok: true };
    },
  });

  try {
    const handler = loadHandler();
    const res = createRes();
    await handler({ method: 'GET', headers: {}, url: '/api/resend-confirmations' }, res);

    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: 'Método no permitido.' });
    assert.equal(emailCalls, 0);
    assert.equal(dbCalls, 0);
    assert.equal(authCalls, 0);
  } finally {
    unloadHandler([restoreWebhook, restoreSupabase]);
  }
});

test('PR1: resend-confirmations rechaza POST sin token con 401', async () => {
  let emailCalls = 0;
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => {
          throw new Error('no debe validar sesión sin token');
        },
      },
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async () => {
      emailCalls += 1;
      return { ok: true };
    },
  });

  try {
    const handler = loadHandler();
    const res = createRes();
    await handler({ method: 'POST', headers: {} }, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /falta token/i);
    assert.equal(emailCalls, 0);
  } finally {
    unloadHandler([restoreWebhook, restoreSupabase]);
  }
});

test('PR1: resend-confirmations rechaza POST con usuario no admin con 403', async () => {
  let emailCalls = 0;
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: 'intruso@example.com' } }, error: null }),
      },
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async () => {
      emailCalls += 1;
      return { ok: true };
    },
  });

  try {
    const handler = loadHandler();
    const res = createRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer intruso-token' } }, res);

    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /no es admin/i);
    assert.equal(emailCalls, 0);
  } finally {
    unloadHandler([restoreWebhook, restoreSupabase]);
  }
});

test('PR1: resend-confirmations permite POST admin y no expone PII sin auth previa', async () => {
  const records = [];
  const emailCalls = [];
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
      },
      from: () => ({
        select: () => queryResult(records),
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      emailCalls.push(payload);
      return { ok: true };
    },
  });

  try {
    const handler = loadHandler();
    const res = createRes();
    await handler(
      { method: 'POST', headers: { authorization: 'Bearer admin-token' }, url: '/api/resend-confirmations' },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(emailCalls.length, 0);
    assert.match(String(res.body), /No se encontraron inscripciones/);
  } finally {
    unloadHandler([restoreWebhook, restoreSupabase]);
  }
});


test('PR1: resend-confirmations guarda id y fecha de Resend al reenviar', async () => {
  const records = [{
    full_name: 'Runner',
    shirt_size: 'M',
    bib_number: '123',
    buyer_email: 'runner@example.com',
    email: 'runner@example.com',
    event_slug: 'cascanueces-run',
    distance: '5K',
    amount_paid: 450,
    order_session_id: 'cs_test_bulk',
  }];
  const updatePayloads = [];
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
      },
      from: () => ({
        select: () => queryResult(records),
        update: (payload) => ({
          eq: async () => {
            updatePayloads.push(payload);
            return { data: null, error: null };
          },
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async () => ({ ok: true, resendId: 'email_bulk_test' }),
  });

  try {
    const handler = loadHandler();
    const res = createRes();
    await handler(
      { method: 'POST', headers: { authorization: 'Bearer admin-token' }, url: '/api/resend-confirmations' },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(updatePayloads.length, 1);
    assert.equal(updatePayloads[0].email_sent, true);
    assert.equal(updatePayloads[0].confirmation_email_id, 'email_bulk_test');
    assert.match(updatePayloads[0].confirmation_email_sent_at, /^\\d{4}-\\d{2}-\\d{2}T/);
  } finally {
    unloadHandler([restoreWebhook, restoreSupabase]);
  }
});
