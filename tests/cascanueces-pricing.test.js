const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const projectRoot = path.join(__dirname, '..');
const { CASCANUECES_STAGE_CATALOG, getCascanuecesStageByDate } = require('../cascanueces-stage-config');

function loadBrowserScriptsWithDate(isoDate, files) {
  const RealDate = Date;
  const fixedTime = new RealDate(isoDate).getTime();
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedTime);
        return;
      }
      super(...args);
    }

    static now() {
      return fixedTime;
    }
  }

  const context = {
    Date: MockDate,
    Intl,
    URLSearchParams,
  };
  context.globalThis = context;
  context.window = context;
  context.self = context;

  vm.createContext(context);
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  });

  return context;
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

function withMockedNow(isoDate, run) {
  const RealDate = Date;
  const fixedTime = new RealDate(isoDate).getTime();

  global.Date = class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedTime);
        return;
      }
      super(...args);
    }

    static now() {
      return fixedTime;
    }
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.Date = RealDate;
    });
}

async function createCheckoutSessionPayload(body, {
  now = '2026-09-01T00:00:00-06:00',
  promoResult = { cleanCode: '', preview: null },
} = {}) {
  return withMockedNow(now, async () => {
    const createdSessions = [];
    const upserts = [];
    const promoCalls = [];
    const restoreStripe = mockModule('stripe', () => ({
      checkout: {
        sessions: {
          create: async (payload) => {
            createdSessions.push(payload);
            return { id: 'cs_test_checkout', url: 'https://checkout.stripe.test/cs_test_checkout' };
          },
          expire: async () => ({}),
        },
      },
    }));
    const restoreSupabase = mockModule('@supabase/supabase-js', {
      createClient: () => ({
        from: () => ({
          upsert: async (payload) => {
            upserts.push(payload);
            return { data: null, error: null };
          },
        }),
      }),
    });
    const restorePromo = mockModule('../api/_stripe-promo', {
      resolvePromotionCode: async (payload) => {
        promoCalls.push(payload);
        return promoResult;
      },
    });
    const restoreMeta = mockModule('../api/_meta-capi', {
      trackMetaEvent: async () => ({ ok: true }),
    });
    delete require.cache[require.resolve('../api/create-checkout-session')];

    try {
      const handler = require('../api/create-checkout-session');
      const res = createJsonRes();
      await handler({
        method: 'POST',
        headers: { host: 'localhost:3000', cookie: '' },
        body,
      }, res);

      return { res, createdSessions, upserts, promoCalls };
    } finally {
      delete require.cache[require.resolve('../api/create-checkout-session')];
      restoreMeta();
      restorePromo();
      restoreSupabase();
      restoreStripe();
    }
  });
}

test('Cascanueces pricing uses Mexico-time boundaries for $400 to $450', () => {
  assert.equal(getCascanuecesStageByDate('2026-08-31T23:00:00-06:00').amount, 400);
  assert.equal(getCascanuecesStageByDate('2026-08-31T23:59:59-06:00').amount, 400);
  assert.equal(getCascanuecesStageByDate('2026-09-01T00:00:00-06:00').amount, 450);
  assert.equal(getCascanuecesStageByDate('2026-09-01T00:00:01-06:00').amount, 450);
});

test('Cascanueces stages have no gaps or overlaps at configured boundaries', () => {
  for (let i = 0; i < CASCANUECES_STAGE_CATALOG.length - 1; i += 1) {
    const current = CASCANUECES_STAGE_CATALOG[i];
    const next = CASCANUECES_STAGE_CATALOG[i + 1];
    assert.equal(current.end, next.start);
    assert.equal(getCascanuecesStageByDate(current.end).key, next.key);
  }
});

test('Cascanueces $450 to $500 transition works at midnight Mexico time', () => {
  assert.equal(getCascanuecesStageByDate('2026-10-31T23:59:59-06:00').amount, 450);
  assert.equal(getCascanuecesStageByDate('2026-11-01T00:00:00-06:00').amount, 500);
});

test('Cascanueces event page resolves open Preventa $400 on August 31 afternoon', () => {
  const context = loadBrowserScriptsWithDate('2026-08-31T17:20:00-06:00', [
    'cascanueces-stage-config.js',
    'cascanueces-event-data.js',
  ]);

  const stage = context.KineticHubCascanuecesEvent.pricing.getCurrentStage(new context.Date());
  assert.equal(stage.isOpen, true);
  assert.equal(stage.label, 'Preventa');
  assert.equal(stage.amount, 400);
  assert.equal(stage.price, 400);
});

test('Home includes Cascanueces among open events on August 31', () => {
  const context = loadBrowserScriptsWithDate('2026-08-31T17:20:00-06:00', [
    'axolote-stage-config.js',
    'cascanueces-stage-config.js',
    'featured-events.js',
  ]);

  const openEventIds = context.KineticHubFeaturedEvents
    .filter((event) => event.getStage().isOpen)
    .map((event) => event.id);

  assert.ok(openEventIds.includes('axolote-night-run'));
  assert.ok(openEventIds.includes('cascanueces-run'));
});

test('Cascanueces remains open across August 31 to September 1 boundary', () => {
  const lastPreventaSecond = getCascanuecesStageByDate('2026-08-31T23:59:59-06:00');
  const firstGeneralSecond = getCascanuecesStageByDate('2026-09-01T00:00:00-06:00');

  assert.equal(lastPreventaSecond.isOpen, true);
  assert.equal(lastPreventaSecond.label, 'Preventa');
  assert.equal(lastPreventaSecond.amount, 400);

  assert.equal(firstGeneralSecond.isOpen, true);
  assert.equal(firstGeneralSecond.label, 'Acceso General');
  assert.equal(firstGeneralSecond.amount, 450);
});

test('create-checkout-session enables card and OXXO payment methods', async () => {
  const { res, createdSessions } = await createCheckoutSessionPayload({
    buyerEmail: 'runner@example.com',
    eventSlug: 'cascanueces-run',
    distance: '10K',
    tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(createdSessions[0].payment_method_types, ['card', 'oxxo']);
});

test('create-checkout-session supports Cascanueces 5K metadata and current price', async () => {
  const { res, createdSessions, upserts } = await createCheckoutSessionPayload({
    buyerEmail: 'runner@example.com',
    eventSlug: 'cascanueces-run',
    distance: '5K',
    tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
  });

  const sessionPayload = createdSessions[0];
  assert.equal(res.statusCode, 200);
  assert.equal(sessionPayload.mode, 'payment');
  assert.equal(sessionPayload.customer_email, 'runner@example.com');
  assert.equal(sessionPayload.line_items[0].price_data.currency, 'mxn');
  assert.equal(sessionPayload.line_items[0].price_data.unit_amount, 45000);
  assert.equal(sessionPayload.metadata.event_slug, 'cascanueces-run');
  assert.equal(sessionPayload.metadata.event_name, 'Cascanueces Run 2026');
  assert.equal(sessionPayload.metadata.distance, '5K');
  assert.equal(upserts[0].payment_status, 'pending');
  assert.equal(upserts[0].event_slug, 'cascanueces-run');
  assert.equal(upserts[0].distance, '5K');
});

test('create-checkout-session supports Cascanueces 10K metadata and current price', async () => {
  const { res, createdSessions, upserts } = await createCheckoutSessionPayload({
    buyerEmail: 'runner@example.com',
    eventSlug: 'cascanueces-run',
    distance: '10K',
    tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
  });

  const sessionPayload = createdSessions[0];
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sessionPayload.payment_method_types, ['card', 'oxxo']);
  assert.equal(sessionPayload.mode, 'payment');
  assert.equal(sessionPayload.line_items[0].price_data.currency, 'mxn');
  assert.equal(sessionPayload.line_items[0].price_data.unit_amount, 45000);
  assert.equal(sessionPayload.metadata.event_slug, 'cascanueces-run');
  assert.equal(sessionPayload.metadata.distance, '10K');
  assert.equal(upserts[0].amount_paid, 450);
  assert.equal(upserts[0].payment_status, 'pending');
});

test('create-checkout-session calculates Cascanueces $450 on September 1 Mexico time', async () => {
  await withMockedNow('2026-09-01T00:00:00-06:00', async () => {
    const createdSessions = [];
    const restoreStripe = mockModule('stripe', () => ({
      checkout: {
        sessions: {
          create: async (payload) => {
            createdSessions.push(payload);
            return { id: 'cs_price_450', url: 'https://checkout.stripe.test/cs_price_450' };
          },
          expire: async () => ({}),
        },
      },
    }));
    const restoreSupabase = mockModule('@supabase/supabase-js', {
      createClient: () => ({
        from: () => ({
          upsert: async () => ({ data: null, error: null }),
        }),
      }),
    });
    const restorePromo = mockModule('../api/_stripe-promo', {
      resolvePromotionCode: async () => ({ cleanCode: '', preview: null }),
    });
    const restoreMeta = mockModule('../api/_meta-capi', {
      trackMetaEvent: async () => ({ ok: true }),
    });
    delete require.cache[require.resolve('../api/create-checkout-session')];

    try {
      const handler = require('../api/create-checkout-session');
      const res = createJsonRes();
      await handler({
        method: 'POST',
        headers: { host: 'localhost:3000', cookie: '' },
        body: {
          buyerEmail: 'runner@example.com',
          eventSlug: 'cascanueces-run',
          distance: '10K',
          tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
        },
      }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(createdSessions[0].line_items[0].price_data.unit_amount, 45000);
      assert.equal(createdSessions[0].metadata.stage_key, 'acceso_general');
      assert.equal(createdSessions[0].metadata.stage_amount, '450');
    } finally {
      delete require.cache[require.resolve('../api/create-checkout-session')];
      restoreMeta();
      restorePromo();
      restoreSupabase();
      restoreStripe();
    }
  });
});

test('create-checkout-session keeps Axolote checkout compatible with OXXO', async () => {
  const { res, createdSessions, upserts } = await createCheckoutSessionPayload({
    buyerEmail: 'runner@example.com',
    eventSlug: 'axolote-night-run',
    distance: '5K',
    tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
  });

  const sessionPayload = createdSessions[0];
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sessionPayload.payment_method_types, ['card', 'oxxo']);
  assert.equal(sessionPayload.mode, 'payment');
  assert.equal(sessionPayload.line_items[0].price_data.currency, 'mxn');
  assert.equal(sessionPayload.metadata.event_slug, 'axolote-night-run');
  assert.equal(sessionPayload.metadata.distance, '5K');
  assert.equal(upserts[0].payment_status, 'pending');
});

test('create-checkout-session with Cascanueces coupon preserves event, distance, amount, and OXXO compatibility', async () => {
  const { res, createdSessions, upserts, promoCalls } = await createCheckoutSessionPayload({
    buyerEmail: 'runner@example.com',
    eventSlug: 'cascanueces-run',
    distance: '10K',
    promoCode: 'PROMO10',
    tickets: [{ fullName: 'Runner Test', shirtSize: 'M', birthDate: '1990-05-14', whatsapp: '5512345678', state: 'Jalisco' }],
  }, {
    promoResult: {
      cleanCode: 'PROMO10',
      promotionCodeId: 'promo_123',
      preview: { discountAmount: 45, finalTotal: 405 },
    },
  });

  const sessionPayload = createdSessions[0];
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sessionPayload.payment_method_types, ['card', 'oxxo']);
  assert.deepEqual(sessionPayload.discounts, [{ promotion_code: 'promo_123' }]);
  assert.equal(sessionPayload.allow_promotion_codes, undefined);
  assert.equal(sessionPayload.metadata.event_slug, 'cascanueces-run');
  assert.equal(sessionPayload.metadata.distance, '10K');
  assert.equal(sessionPayload.metadata.discount_code, 'PROMO10');
  assert.equal(sessionPayload.line_items[0].price_data.unit_amount, 45000);
  assert.equal(promoCalls[0].subtotalAmount, 450);
  assert.equal(promoCalls[0].currency, 'mxn');
  assert.equal(upserts[0].event_slug, 'cascanueces-run');
  assert.equal(upserts[0].distance, '10K');
  assert.equal(upserts[0].amount_paid, 450);
  assert.equal(upserts[0].payment_status, 'pending');
});

test('validate-promo-code uses Cascanueces current price when eventSlug is cascanueces-run', async () => {
  await withMockedNow('2026-09-01T00:00:00-06:00', async () => {
    const promoCalls = [];
    const restorePromo = mockModule('../api/_stripe-promo', {
      resolvePromotionCode: async (payload) => {
        promoCalls.push(payload);
        return {
          cleanCode: 'PROMO10',
          preview: { discountAmount: 45, finalTotal: 405 },
        };
      },
    });
    delete require.cache[require.resolve('../api/validate-promo-code')];

    try {
      const handler = require('../api/validate-promo-code');
      const res = createJsonRes();
      await handler({
        method: 'POST',
        body: {
          promoCode: 'PROMO10',
          ticketCount: 1,
          eventSlug: 'cascanueces-run',
        },
      }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(promoCalls[0].subtotalAmount, 450);
      assert.equal(promoCalls[0].currency, 'mxn');
      assert.equal(res.body.subtotalAmount, 450);
    } finally {
      delete require.cache[require.resolve('../api/validate-promo-code')];
      restorePromo();
    }
  });
});

test('checkout promo preview sends selected eventSlug to validate-promo-code', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  assert.match(script, /fetch\("\/api\/validate-promo-code"/);
  assert.match(script, /eventSlug:\s*window\.KineticHubCheckoutSelection\?\.eventSlug\s*\|\|\s*"axolote-night-run"/);
});
