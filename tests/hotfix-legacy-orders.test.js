// tests/hotfix-legacy-orders.test.js - HOTFIX órdenes legacy pre-PR4.
// Regla: orden con filas previas en DB con PR4 NULL => finaliza sin exigirlos.
// Orden NUEVA (cero filas) => validación estricta intacta.
// NO toca producción. El SQL nuevo vive en desc/sql-finalize-paid-order-hotfix-legacy.sql
// (solo lectura aquí). La prueba real del RPC exige staging DB antes de aplicar.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
process.env.RATE_LIMIT_SECRET = process.env.RATE_LIMIT_SECRET || 'test-only-rate-limit-secret-0123456789';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.CHECKOUT_SUMMARY_SECRET = process.env.CHECKOUT_SUMMARY_SECRET || 'test-only-checkout-summary-secret-0123456789';

const projectRoot = path.join(__dirname, '..');
const HOTFIX_SQL = path.join(projectRoot, 'desc/sql-finalize-paid-order-hotfix-legacy.sql');
const PR4_SQL = path.join(projectRoot, 'desc/sql-finalize-paid-order-pr4.sql');

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

async function postCheckout(ticket) {
  return withMockedNow('2026-09-09T12:00:00-06:00', async () => {
    const createdSessions = [];
    const upserts = [];
    const restoreStripe = mockModule('stripe', () => ({
      checkout: {
        sessions: {
          create: async (payload) => {
            createdSessions.push(payload);
            return { id: 'cs_test_hotfix', url: 'https://checkout.stripe.test/cs_test_hotfix' };
          },
          expire: async () => ({}),
        },
      },
    }));
    const restoreSupabase = mockModule('@supabase/supabase-js', {
      createClient: () => ({
        rpc: async () => ({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null }),
        from: () => ({
          upsert: async (payload) => {
            upserts.push(payload);
            return { data: null, error: null };
          },
        }),
      }),
    });
    const restorePromo = mockModule('../lib/_stripe-promo', {
      resolvePromotionCode: async () => ({ cleanCode: '', preview: null }),
    });
    const restoreMeta = mockModule('../lib/_meta-capi', {
      trackMetaEvent: async () => ({ ok: true }),
    });
    delete require.cache[require.resolve('../api/create-checkout-session')];

    const silenced = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      const handler = require('../api/create-checkout-session');
      const res = createJsonRes();
      await handler({
        method: 'POST',
        headers: { host: 'localhost:3000', cookie: '' },
        body: {
          buyerEmail: 'hotfix@example.com',
          tickets: [ticket],
          eventSlug: 'axolote-night-run',
          distance: '5K',
        },
      }, res);
      return { res, createdSessions, upserts };
    } finally {
      console.log = silenced.log;
      console.warn = silenced.warn;
      console.error = silenced.error;
      delete require.cache[require.resolve('../api/create-checkout-session')];
      restoreMeta();
      restorePromo();
      restoreSupabase();
      restoreStripe();
    }
  });
}

const FULL_TICKET = {
  fullName: 'Runner Hotfix',
  shirtSize: 'M',
  birthDate: '1990-04-11',
  whatsapp: '+525512345678',
  state: 'Ciudad de México',
  borough: 'Benito Juárez',
};

// ---------- A/B/C: órdenes NUEVAS siguen estrictas ----------

test('HOTFIX-A: nueva orden sin birthDate -> 400 sin Stripe ni upsert', async () => {
  const { res, createdSessions, upserts } = await postCheckout({ ...FULL_TICKET, birthDate: '' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /nacimiento/i);
  assert.equal(createdSessions.length, 0);
  assert.equal(upserts.length, 0);
});

test('HOTFIX-B: nueva orden sin whatsapp -> 400 sin Stripe ni upsert', async () => {
  const { res, createdSessions, upserts } = await postCheckout({ ...FULL_TICKET, whatsapp: 'no-es-numero' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /whatsapp/i);
  assert.equal(createdSessions.length, 0);
  assert.equal(upserts.length, 0);
});

test('HOTFIX-C: nueva orden sin state -> 400 sin Stripe ni upsert', async () => {
  const { res, createdSessions, upserts } = await postCheckout({ ...FULL_TICKET, state: 'Narnia', borough: null });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /estado/i);
  assert.equal(createdSessions.length, 0);
  assert.equal(upserts.length, 0);
});

// ---------- H: nueva orden completa funciona igual y guarda canónico ----------

test('HOTFIX-H: nueva orden PR4 completa -> 200 y upsert con canónicos + acentos', async () => {
  const { res, createdSessions, upserts } = await postCheckout({ ...FULL_TICKET });
  assert.equal(res.statusCode, 200);
  assert.equal(upserts[0].birth_date, '1990-04-11');
  assert.equal(upserts[0].whatsapp, '+525512345678');
  assert.equal(upserts[0].state, 'Ciudad de México');
  assert.equal(upserts[0].borough, 'Benito Juárez');
  assert.equal(createdSessions[0].metadata.participant_1_state, 'Ciudad de México');
});

// ---------- D: legacy pending con PR4 NULL finaliza (diseño SQL) ----------

test('HOTFIX-D: flag legacy por filas preexistentes con PR4 NULL (no por payload)', () => {
  const sql = fs.readFileSync(HOTFIX_SQL, 'utf8');
  // condición: existencia previa en DB con los 4 campos NULL
  assert.ok(sql.includes('v_is_legacy_order'), 'SQL debe definir el flag legacy');
  assert.ok(sql.includes('i.birth_date is null'), 'flag exige birth_date NULL previo');
  assert.ok(sql.includes('i.whatsapp is null'), 'flag exige whatsapp NULL previo');
  assert.ok(sql.includes('i.state is null'), 'flag exige state NULL previo');
  assert.ok(sql.includes('i.borough is null'), 'flag exige borough NULL previo');
  assert.ok(sql.includes('i.order_session_id = p_order_session_id'), 'flag acotado a la orden');
  // en legacy se fuerzan NULL (conservar) y se avisa, sin error
  assert.ok(sql.includes('set birth_date = null, whatsapp = null, state = null, borough = null'));
  assert.ok(sql.includes('finaliza con PR4 NULL'));
  // validación estricta gated: solo órdenes nuevas
  assert.ok(sql.includes('if not v_is_legacy_order then'), 'estrictos dentro del gate');
  // upsert + loop BIB intactos (finaliza pago, genera BIB, correo normal vía caller)
  assert.ok(sql.includes('on conflict (order_session_id, ticket_index)'));
  assert.ok(sql.includes("payment_status = 'paid'"));
});

// ---------- E: legacy multi-ticket ----------

test('HOTFIX-E: multi-ticket legacy crea/finaliza faltantes con PR4 NULL', () => {
  const sql = fs.readFileSync(HOTFIX_SQL, 'utf8');
  assert.ok(sql.includes('jsonb_array_elements(p_participants)'), 'itera por ticket');
  assert.ok(sql.includes('v_ticket_count < 1 or v_ticket_count > 5'), 'límite 1..5 intacto');
  assert.ok(sql.includes('for v_next_bib in'), 'loop de BIB intacto');
  assert.ok(sql.includes('no quedó finalizada correctamente'), 'verificación final intacta');
});

// ---------- F: OXXO legacy usa la misma ruta ----------

test('HOTFIX-F: async_payment_succeeded legacy llega al mismo RPC', () => {
  const webhook = fs.readFileSync(path.join(projectRoot, 'api/stripe-webhook.js'), 'utf8');
  const branchAt = webhook.indexOf("event.type === 'checkout.session.async_payment_succeeded'");
  assert.ok(branchAt > -1, 'rama OXXO existe');
  assert.ok(webhook.indexOf('finalizePaidOrder(', branchAt) > -1, 'OXXO llama finalizePaidOrder');
});

// ---------- G: paid legacy idempotente, sin overwrite ----------

test('HOTFIX-G: early-return paid precede al gate legacy y no toca editables', () => {
  const sql = fs.readFileSync(HOTFIX_SQL, 'utf8');
  const earlyReturnAt = sql.indexOf('Idempotencia nueva: paid repetido preserva');
  const gateAt = sql.indexOf('if not v_is_legacy_order then');
  assert.ok(earlyReturnAt > -1 && gateAt > -1 && earlyReturnAt < gateAt,
    'early-return paid debe ejecutarse antes del gate legacy');
  // el loop BIB solo toca filas no-paid sin BIB
  assert.ok(sql.includes("and i.payment_status <> 'paid'"));
  assert.ok(sql.includes('and i.bib_number is null'));
});

// ---------- Integridad del hotfix: solo hunks mínimos ----------

test('HOTFIX: diff mínimo vs PR4 (sin tocar email/bib/amount/evento/PK/RLS)', () => {
  const sql = fs.readFileSync(HOTFIX_SQL, 'utf8');
  const pr4 = fs.readFileSync(PR4_SQL, 'utf8');
  // firma intacta
  assert.ok(sql.includes('p_order_session_id text'));
  assert.ok(sql.includes('p_participants jsonb'));
  assert.ok(sql.includes('RETURNS SETOF inscripciones'));
  assert.ok(sql.includes('SECURITY DEFINER'));
  // intactos: email/buyer, montos, evento, distancia, PK/índices/RLS no se mencionan como ALTER
  assert.ok(!sql.match(/alter\s+table/i), 'sin ALTER TABLE');
  assert.ok(!sql.match(/drop\s+(index|constraint)/i), 'sin DROP de constraints/índices');
  assert.ok(!sql.includes('payment_status = excluded.payment_status'), 'no pisa payment_status en upsert');
  assert.ok(!sql.includes('bib_number = excluded.bib_number'), 'no pisa bib en upsert');
  // el archivo creció solo por el hotfix (~30 líneas)
  const added = sql.split('\n').length - pr4.split('\n').length;
  assert.ok(added > 5 && added < 60, `hunk acotado, líneas añadidas=${added}`);
});
