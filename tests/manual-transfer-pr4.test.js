// tests/manual-transfer-pr4.test.js - Alta manual con campos PR4.
// El panel admin (admin-inscripciones.html) debe enviar por ticket:
// {fullName, shirtSize, birthDate, whatsapp, state, borough} con borough null fuera de CDMX.
// La autoridad final es validateParticipant() en api/admin-manual-transfer.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.ADMIN_EMAILS = 'admin@example.com';

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

async function runManualTransfer(body) {
  const state = { insertPayloads: [], updateCalls: [], emailPayloads: [], nextBib: 200 };
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: 'admin@example.com' } }, error: null }),
      },
      rpc: async () => ({ data: String(state.nextBib++).padStart(3, '0'), error: null }),
      from: () => ({
        insert(payload) {
          state.insertPayloads.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: `ins_${state.insertPayloads.length}`,
                  full_name: payload.full_name,
                  shirt_size: payload.shirt_size,
                  bib_number: payload.bib_number,
                  ticket_index: payload.ticket_index,
                },
                error: null,
              }),
            }),
          };
        },
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  });
  const restoreWebhook = mockModule('../api/stripe-webhook', {
    sendConfirmationEmail: async (payload) => {
      state.emailPayloads.push(payload);
      return { ok: true, resendId: 'email_test' };
    },
  });
  delete require.cache[require.resolve('../api/admin-manual-transfer')];

  const silenced = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  try {
    const handler = require('../api/admin-manual-transfer');
    const res = createResponse();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
      body: {
        buyerEmail: 'manual-pr4@example.com',
        totalAmount: 550,
        eventSlug: 'axolote-night-run',
        distance: '5K',
        ...body,
      },
    }, res);
    return { res, state };
  } finally {
    console.log = silenced.log;
    console.error = silenced.error;
    delete require.cache[require.resolve('../api/admin-manual-transfer')];
    restoreWebhook();
    restoreSupabase();
  }
}

const TICKET_JALISCO = {
  fullName: 'Runner Jalisco',
  shirtSize: 'M',
  birthDate: '1990-04-11',
  whatsapp: '+525512345678',
  state: 'Jalisco',
  borough: null,
};

const TICKET_CDMX = {
  fullName: 'Runner CDMX',
  shirtSize: 'L',
  birthDate: '1985-07-20',
  whatsapp: '5512345678',
  state: 'Ciudad de México',
  borough: 'Benito Juárez',
};

test('manual PR4: 1 ticket válido no-CDMX guarda borough null', async () => {
  const { res, state } = await runManualTransfer({ tickets: [TICKET_JALISCO] });
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads.length, 1);
  assert.equal(state.insertPayloads[0].state, 'Jalisco');
  assert.equal(state.insertPayloads[0].borough, null);
  assert.equal(state.insertPayloads[0].birth_date, '1990-04-11');
  assert.equal(state.insertPayloads[0].whatsapp, '+525512345678');
});

test('manual PR4: 1 ticket válido CDMX con alcaldía', async () => {
  const { res, state } = await runManualTransfer({ tickets: [TICKET_CDMX] });
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].state, 'Ciudad de México');
  assert.equal(state.insertPayloads[0].borough, 'Benito Juárez');
});

test('manual PR4: rechazo sin birthDate', async () => {
  const { res, state } = await runManualTransfer({
    tickets: [{ ...TICKET_JALISCO, birthDate: '' }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /nacimiento/i);
  assert.equal(state.insertPayloads.length, 0);
});

test('manual PR4: rechazo whatsapp inválido', async () => {
  const { res, state } = await runManualTransfer({
    tickets: [{ ...TICKET_JALISCO, whatsapp: '123' }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /whatsapp/i);
  assert.equal(state.insertPayloads.length, 0);
});

test('manual PR4: rechazo CDMX sin borough', async () => {
  const { res, state } = await runManualTransfer({
    tickets: [{ ...TICKET_CDMX, borough: null }],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /alcald/i);
  assert.equal(state.insertPayloads.length, 0);
});

test('manual PR4: borough enviado para no-CDMX termina null', async () => {
  const { res, state } = await runManualTransfer({
    tickets: [{ ...TICKET_JALISCO, borough: 'Benito Juárez' }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads[0].borough, null);
});

test('manual PR4: XXL y XXXL aceptadas', async () => {
  const { res: resXXL } = await runManualTransfer({
    tickets: [{ ...TICKET_JALISCO, shirtSize: 'XXL' }],
  });
  assert.equal(resXXL.statusCode, 200);
  const { res: resXXXL, state } = await runManualTransfer({
    tickets: [{ ...TICKET_JALISCO, shirtSize: 'XXXL' }],
  });
  assert.equal(resXXXL.statusCode, 200);
  assert.equal(state.insertPayloads[0].shirt_size, 'XXXL');
});

test('manual PR4: multi-ticket 3 válido', async () => {
  const { res, state } = await runManualTransfer({
    tickets: [
      TICKET_JALISCO,
      TICKET_CDMX,
      { ...TICKET_JALISCO, fullName: 'Tercer Runner', shirtSize: 'S' },
    ],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertPayloads.length, 3);
  assert.deepEqual(
    state.insertPayloads.map((p) => p.ticket_index),
    [1, 2, 3]
  );
});

test('manual PR4: panel usa el catálogo compartido (sin tercera lista)', () => {
  const catalog = require('../location-catalog');
  assert.equal(catalog.STATES.length, 32);
  assert.equal(catalog.CDMX_BOROUGHS.length, 16);
  assert.ok(catalog.STATES.includes('Ciudad de México'));
  assert.ok(catalog.CDMX_BOROUGHS.includes('Benito Juárez'));
  assert.ok(catalog.CDMX_BOROUGHS.includes('La Magdalena Contreras'));

  const admin = fs.readFileSync(path.join(projectRoot, 'admin-inscripciones.html'), 'utf8');
  assert.ok(admin.includes('location-catalog.js'), 'panel carga el catálogo compartido');
  assert.ok(admin.includes('KineticHubLocationCatalog'), 'panel usa el catálogo compartido');
  assert.ok(!admin.includes('Michoacán de Ocampo'), 'panel sin lista propia de estados');
  assert.ok(!admin.includes('La Magdalena Contreras'), 'panel sin lista propia de alcaldías');
  for (const field of ['birthDate', 'whatsapp', 'state', 'borough']) {
    assert.ok(admin.includes(`data-manual-field="${field}"`), `panel captura ${field}`);
  }
});
