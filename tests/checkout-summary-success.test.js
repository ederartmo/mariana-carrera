const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const { COOKIE_NAME, createCheckoutSummaryClaim } = require('../lib/_checkout-summary-claim');

const TEST_CLAIM_SECRET = 'test-only-checkout-summary-secret-0123456789';
// Keep signing and verification isolated from developer credentials.
process.env.CHECKOUT_SUMMARY_SECRET = TEST_CLAIM_SECRET;

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
    headers: {},
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
  const calls = { selected: false };
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
        select: () => {
          calls.selected = true;
          return createQuery(rows);
        },
      }),
    }),
  });
  delete require.cache[require.resolve('../api/checkout-summary')];

  try {
    const handler = require('../api/checkout-summary');
    await run(handler, calls);
  } finally {
    delete require.cache[require.resolve('../api/checkout-summary')];
    restoreSupabase();
    restoreStripe();
  }
}

function claimCookie(sessionId, secret = TEST_CLAIM_SECRET) {
  // nowSeconds fijo en el pasado relativo al TTL real (72h): el handler usa
  // Date.now() real, así que el claim debe crearse con expiración futura real.
  const { claim } = createCheckoutSummaryClaim(sessionId, { secret });
  return `${COOKIE_NAME}=${claim}`;
}

async function invokeSummary(handler, { sessionId = 'cs_summary_123', cookie } = {}) {
  const res = createJsonRes();
  await handler({
    method: 'GET',
    headers: { cookie: cookie === undefined ? claimCookie(sessionId) : cookie },
    query: { session_id: sessionId },
  }, res);
  return res;
}

function confirmationPage({ handler, cookie, storage, search }) {
  const html = fs.readFileSync(path.join(projectRoot, 'succes.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .find(([, body]) => body.includes('function checkPaymentSuccess'))[1];
  const elements = new Map();
  const location = new URL('https://www.kinetichub.com.mx/succes.html' + search);
  const requests = [];
  let onLoad;
  vm.runInNewContext(script, {
    URL, URLSearchParams, console, setTimeout,
    localStorage: storage,
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', innerHTML: '' });
      return elements.get(id);
    } },
    window: { location, history: { replaceState(_state, _unused, next) {
      location.href = new URL(next, location).href;
    } }, addEventListener(event, callback) { if (event === 'load') onLoad = callback; } },
    async fetch(url) {
      const target = new URL(url, location);
      assert.equal(target.pathname, '/api/checkout-summary');
      requests.push(target.pathname);
      const res = await invokeSummary(handler, { sessionId: target.searchParams.get('session_id'), cookie });
      return { status: res.statusCode, ok: res.statusCode === 200, json: async () => res.body };
    },
  });
  return { load: onLoad, elements, location, requests };
}

const blockedStorage = {
  getItem() { throw Error('Browser storage is blocked'); },
  setItem() { throw Error('Browser storage is blocked'); },
};

test('paid Cascanueces confirmation renders four tickets and reloads with storage blocked', async () => {
  const rows = Array.from({ length: 4 }, (_, index) => createSummaryRows({
    id: 'fixture-' + index, ticket_index: index + 1, ticket_count: 4, amount_paid: 500,
    full_name: 'Participante Ficticio ' + (index + 1),
  })[0]);
  await withCheckoutSummaryMocks(rows, async handler => {
    const options = { handler, cookie: claimCookie('cs_summary_123'), storage: blockedStorage };
    const first = confirmationPage({ ...options, search: '?session_id=cs_summary_123' });
    await first.load();
    assert.equal(first.location.searchParams.get('session_id'), 'cs_summary_123');
    const reload = confirmationPage({ ...options, search: first.location.search });
    await reload.load();
    for (const page of [first, reload]) {
      assert.equal(page.elements.get('statusBadge').textContent, 'Pago completado');
      assert.match(page.elements.get('participantsList').innerHTML, /Participante Ficticio 4/);
      assert.equal(page.elements.get('retryPaymentLink').style.display, 'none');
      assert.equal(page.requests.length, 1);
    }
  });
});

test('confirmation without a valid cookie offers account and support without showing private details or retrying payment', async () => {
  await withCheckoutSummaryMocks(createSummaryRows(), async (handler, calls) => {
    for (const cookie of ['', `${COOKIE_NAME}=invalid`, claimCookie('cs_other_order')]) {
      const page = confirmationPage({ handler, cookie, storage: blockedStorage, search: '?session_id=cs_summary_123' });
      await page.load();
      assert.equal(page.requests.length, 1);
      assert.match(page.elements.get('statusCopy').textContent, /puede haberse procesado/);
      assert.equal(page.elements.get('participantsBlock').style.display, 'none');
      assert.equal(page.elements.get('summaryRecovery').style.display, 'block');
      assert.equal(page.elements.get('retryPaymentLink').style.display, 'none');
      assert.equal(page.location.pathname, '/succes.html');
    }
    assert.equal(calls.selected, false);
  });
});

test('paid confirmation cleans the URL when storage works and can still reload', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  await withCheckoutSummaryMocks(createSummaryRows(), async handler => {
    const options = { handler, cookie: claimCookie('cs_summary_123'), storage };
    const first = confirmationPage({ ...options, search: '?session_id=cs_summary_123' });
    await first.load();
    assert.equal(first.location.search, '');
    const reload = confirmationPage({ ...options, search: first.location.search });
    await reload.load();
    assert.equal(reload.elements.get('statusBadge').textContent, 'Pago completado');
    assert.deepEqual(reload.requests, ['/api/checkout-summary']);
  });
});

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

// ---------- Batch 3: claim requerido (casos 11-21) ----------

test('B3-11/21: session_id solo (sin cookie) → 403 sin PII', async () => {
  await withCheckoutSummaryMocks(createSummaryRows(), async (handler, calls) => {
    const res = await invokeSummary(handler, { cookie: '' });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'No autorizado para consultar este resumen.');
    assert.ok(!('email' in res.body));
    assert.ok(!('participants' in res.body));
    assert.ok(!('bib_number' in res.body));
    assert.ok(!('amountPaid' in res.body));
    assert.equal(calls.selected, false);
  });
});

test('B3-12: cookie inválida → 403 sin PII y sin query', async () => {
  await withCheckoutSummaryMocks(createSummaryRows(), async (handler, calls) => {
    const res = await invokeSummary(handler, { cookie: `${COOKIE_NAME}=alterado.invalido.firma` });

    assert.equal(res.statusCode, 403);
    assert.ok(!('email' in res.body));
    assert.equal(calls.selected, false);
  });
});

test('B3-13: cookie de otra sesión → 403', async () => {
  await withCheckoutSummaryMocks(createSummaryRows(), async (handler, calls) => {
    const res = await invokeSummary(handler, {
      sessionId: 'cs_summary_123',
      cookie: claimCookie('cs_otra_sesion'),
    });

    assert.equal(res.statusCode, 403);
    assert.equal(calls.selected, false);
  });
});

test('B3-14: cookie expirada → 403', async () => {
  const { createCheckoutSummaryClaim: create } = require('../lib/_checkout-summary-claim');
  const pastSeconds = Math.floor(Date.now() / 1000) - (72 * 3600) - 10;
  const { claim } = create('cs_summary_123', { secret: TEST_CLAIM_SECRET, nowSeconds: pastSeconds });

  await withCheckoutSummaryMocks(createSummaryRows(), async (handler, calls) => {
    const res = await invokeSummary(handler, { cookie: `${COOKIE_NAME}=${claim}` });

    assert.equal(res.statusCode, 403);
    assert.equal(calls.selected, false);
  });
});

test('B3-17/18/19: cookie válida conserva contrato, multi-ticket y estados', async () => {
  const rows = [
    ...createSummaryRows({ id: 't1', full_name: 'Madre Test', bib_number: '011', ticket_index: 1, ticket_count: 2 }),
    ...createSummaryRows({ id: 't2', full_name: 'Hijo Test', bib_number: '012', ticket_index: 2, ticket_count: 2 }),
  ];
  await withCheckoutSummaryMocks(rows, async (handler) => {
    const res = await invokeSummary(handler);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ticketCount, 2);
    assert.equal(res.body.participants.length, 2);
    assert.equal(res.body.participants[1].fullName, 'Hijo Test');
    assert.equal(res.body.email, 'runner@example.com');
  });

  for (const paymentStatus of ['pending', 'paid', 'payment_failed']) {
    await withCheckoutSummaryMocks(createSummaryRows({ payment_status: paymentStatus, bib_number: null }), async (handler) => {
      const res = await invokeSummary(handler);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.payment_status, paymentStatus);
    });
  }
});

test('B3-20: respuesta lleva Cache-Control no-store (200 y 403)', async () => {
  await withCheckoutSummaryMocks(createSummaryRows(), async (handler) => {
    const ok = await invokeSummary(handler);
    assert.equal(ok.headers['Cache-Control'], 'no-store');

    const denied = await invokeSummary(handler, { cookie: '' });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.headers['Cache-Control'], 'no-store');
  });
});

test('B3-succes.html: referrer prudente + estado 403 + limpieza de URL', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'succes.html'), 'utf8');

  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(html, /showPrivateSummaryUnavailable/);
  assert.match(html, /No pudimos mostrar el resumen privado de esta compra/);
  assert.match(html, /href="\/auth\.html\?mode=login&amp;returnTo=%2Fperfil\.html"/);
  assert.match(html, /href="\/atencion\.html"/);
  assert.match(html, /window\.history\.replaceState/);
  assert.doesNotMatch(html, /localStorage\.setItem\('kinetic_checkout_claim'|sessionStorage\.setItem\('kh_checkout/);
});
