const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const projectRoot = path.join(__dirname, '..');

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

function createJsonRes() {
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

function createSummaryRows(overrides = {}) {
  return [{
    id: 'ins_summary_1',
    full_name: 'Runner Test',
    email: 'runner@example.com',
    buyer_email: 'runner@example.com',
    order_session_id: 'cs_summary_123',
    ticket_index: 1,
    ticket_count: 1,
    event_slug: 'cascanueces-run',
    distance: '10K',
    amount_paid: 450,
    payment_status: 'paid',
    bib_number: '010',
    shirt_size: 'M',
    created_at: '2026-09-01T06:00:00.000Z',
    stripe_session_id: 'cs_summary_123',
    ...overrides,
  }];
}

function createQuery(rows) {
  return {
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
}

async function withCheckoutSummaryMocks(rows, run) {
  const restoreStripe = mockModule('stripe', () => ({
    checkout: {
      sessions: {
        retrieve: async () => ({
          metadata: {
            event_name: 'Cascanueces Run 2026',
            event_slug: 'cascanueces-run',
            distance: '10K',
          },
        }),
      },
    },
  }));
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      from: () => ({
        select: () => createQuery(rows),
      }),
    }),
  });
  delete require.cache[require.resolve('../api/checkout-summary')];

  try {
    const handler = require('../api/checkout-summary');
    await run(handler);
  } finally {
    delete require.cache[require.resolve('../api/checkout-summary')];
    restoreSupabase();
    restoreStripe();
  }
}

async function invokeSummary(handler) {
  const res = createJsonRes();
  await handler({
    method: 'GET',
    query: { session_id: 'cs_summary_123' },
  }, res);
  return res;
}

test('checkout-summary returns payment_status paid and primary bib_number', async () => {
  await withCheckoutSummaryMocks(createSummaryRows(), async (handler) => {
    const res = await invokeSummary(handler);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payment_status, 'paid');
    assert.equal(res.body.bib_number, '010');
    assert.equal(res.body.participants[0].bibNumber, '010');
    assert.equal(res.body.eventSlug, 'cascanueces-run');
    assert.equal(res.body.distance, '10K');
    assert.equal(res.body.amountPaid, 450);
  });
});

test('checkout-summary returns payment_status pending without inventing a bib', async () => {
  await withCheckoutSummaryMocks(createSummaryRows({
    payment_status: 'pending',
    bib_number: null,
  }), async (handler) => {
    const res = await invokeSummary(handler);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payment_status, 'pending');
    assert.equal(res.body.bib_number, null);
    assert.equal(res.body.participants[0].bibNumber, null);
  });
});

test('checkout-summary returns payment_failed status without inventing a bib', async () => {
  await withCheckoutSummaryMocks(createSummaryRows({
    payment_status: 'payment_failed',
    bib_number: null,
  }), async (handler) => {
    const res = await invokeSummary(handler);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.payment_status, 'payment_failed');
    assert.equal(res.body.bib_number, null);
    assert.equal(res.body.participants[0].bibNumber, null);
  });
});

test('success page supports paid, pending, and payment_failed states', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'succes.html'), 'utf8');

  assert.match(html, /paymentStatus === 'paid'/);
  assert.match(html, /paymentStatus === 'payment_failed'/);
  assert.match(html, /Tu pago está pendiente/);
  assert.match(html, /Pago no completado/);
  assert.match(html, /Pago completado/);
});

test('success page polls pending summary without an infinite loop', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'succes.html'), 'utf8');

  assert.match(html, /const maxAttempts = 5/);
  assert.match(html, /const delayMs = 1500/);
  assert.match(html, /paymentStatus !== 'pending' \|\| attempt === maxAttempts/);
});

test('success page does not render false #000 bibs for pending payments', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'succes.html'), 'utf8');

  assert.match(html, /const rawBibNumber = participant\.bibNumber == null \? '' : String\(participant\.bibNumber\)\.trim\(\)/);
  assert.match(html, /: 'Pendiente'/);
  assert.doesNotMatch(html, /String\(participant\.bibNumber \|\| ''\)\.padStart\(3, '0'\)/);
});
