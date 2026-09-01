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

test('resend-single-confirmation passes stored inscription distance to email sender', async () => {
  const emailPayloads = [];
  const records = [{
    full_name: 'Runner 10K',
    shirt_size: 'M',
    bib_number: '123',
    buyer_email: 'runner10k@example.com',
    email: 'runner10k@example.com',
    event_slug: 'cascanueces-run',
    distance: '10K',
    amount_paid: 400,
  }];

  const supabaseMock = {
    auth: {
      getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: records, error: null }),
        }),
      }),
      update: (payload) => ({
        eq: async (column, value) => ({ data: { table, payload, column, value }, error: null }),
      }),
    }),
  };

  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => supabaseMock,
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      emailPayloads.push(payload);
      return { ok: true, resendId: 'email_test' };
    },
  });

  delete require.cache[require.resolve('../api/resend-single-confirmation')];
  const handler = require('../api/resend-single-confirmation');

  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer admin-token' },
    body: { orderSessionId: 'cs_test_order' },
  };
  const res = createResponse();

  const originalLog = console.log;
  try {
    console.log = () => {};
    await handler(req, res);
  } finally {
    console.log = originalLog;
    delete require.cache[require.resolve('../api/resend-single-confirmation')];
    restoreWebhook();
    restoreSupabase();
  }

  assert.equal(res.statusCode, 200);
  assert.equal(emailPayloads.length, 1);
  assert.equal(emailPayloads[0].eventSlug, 'cascanueces-run');
  assert.equal(emailPayloads[0].distance, '10K');
});
