// tests/contact-notify-attachment.test.js - Batch 6 (rev): attachment_path
// validado + signed URL solo admin. Sin envíos reales.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const HANDLER_PATH = path.join(__dirname, '..', 'api', 'contact-notify.js');

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function baseBody(overrides = {}) {
  return {
    email: 'user@example.com',
    full_name: 'Usuario Test',
    subject: 'Duda',
    event_slug: 'axolote-night-run',
    reason: 'duda',
    message: 'Hola, tengo una duda.',
    phone: '5512345678',
    ...overrides,
  };
}

async function runContact(state, body) {
  const restoreResend = mockModule('resend', {
    Resend: class {
      constructor() {
        this.emails = {
          send: async (payload) => {
            state.emailSends.push(payload);
            const next = (state.emailResults || []).shift();
            if (next && next.error) return { error: next.error };
            return { data: { id: 'email_test' }, error: null };
          },
        };
      }
    },
  });
  const restoreSupabase = mockModule('@supabase/supabase-js', {
    createClient: () => ({
      from: (table) => ({
        insert: async (row) => {
          state.inserts.push({ table, row });
          const next = (state.insertResults || []).shift();
          return next || { data: null, error: null };
        },
      }),
      storage: {
        from: (bucket) => ({
          createSignedUrl: async (objectPath, ttl) => {
            state.signCalls.push({ bucket, objectPath, ttl });
            const next = (state.signResults || []).shift();
            return next || { data: { signedUrl: 'https://signed.test/adjunto' }, error: null };
          },
        }),
      },
    }),
  });
  const restoreMeta = mockModule('../lib/_meta-capi', {
    trackMetaEvent: async () => ({ ok: true }),
  });
  delete require.cache[HANDLER_PATH];
  try {
    const handler = require(HANDLER_PATH);
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body }, res);
    return res;
  } finally {
    delete require.cache[HANDLER_PATH];
    restoreMeta();
    restoreSupabase();
    restoreResend();
  }
}

function baseState(overrides = {}) {
  return { emailSends: [], inserts: [], signCalls: [], insertResults: [], signResults: [], emailResults: [], ...overrides };
}

function adminHtml(state) {
  const admin = state.emailSends.find((e) => e.to === 'hola@kinetichub.com.mx');
  return admin ? admin.html : '';
}

function userHtml(state) {
  const user = state.emailSends.find((e) => e.to === 'user@example.com');
  return user ? user.html : '';
}

test('B6-06: attachment_path inválido rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'contact/../../x.jpg' }));

  assert.equal(res.statusCode, 400);
  assert.equal(state.inserts.length, 0);
  assert.equal(state.emailSends.length, 0);
});

test('B6-07: URL absoluta como path rechazada', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'https://evil.test/x.jpg' }));

  assert.equal(res.statusCode, 400);
  assert.equal(state.inserts.length, 0);
});

test('B6-08: ../ rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: '../contact/x.jpg' }));

  assert.equal(res.statusCode, 400);
});

test('B6-09: prefijo incorrecto rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'avatars/u1/avatar.jpg' }));

  assert.equal(res.statusCode, 400);
});

test('B6-10: extensión inválida rechazada', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'contact/abc123.exe' }));

  assert.equal(res.statusCode, 400);
});

test('B6-11/15: path UUID válido aceptado y persistido', async () => {
  const state = baseState();
  const valid = 'contact/550e8400-e29b-41d4-a716-446655440000.pdf';
  const res = await runContact(state, baseBody({ attachment_path: valid }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts.length, 1);
  assert.equal(state.inserts[0].row.attachment_path, valid);
});

test('B6-12/13: signed URL solo en contact-private con TTL 3600', async () => {
  const state = baseState();
  const valid = 'contact/550e8400-e29b-41d4-a716-446655440000.jpg';
  await runContact(state, baseBody({ attachment_path: valid }));

  assert.equal(state.signCalls.length, 1);
  assert.equal(state.signCalls[0].bucket, 'contact-private');
  assert.equal(state.signCalls[0].objectPath, valid);
  assert.equal(state.signCalls[0].ttl, 3600);
});

test('B6-14: signed URL no persistida, attachment_url null', async () => {
  const state = baseState();
  await runContact(state, baseBody({ attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.jpg' }));

  const row = state.inserts[0].row;
  assert.equal(row.attachment_url, null);
  assert.ok(!JSON.stringify(row).includes('signed.test'));
});

test('B6-15b: sin columna attachment_path reintenta sin ella', async () => {
  const state = baseState({
    insertResults: [
      { data: null, error: { message: 'column attachment_path does not exist' } },
      { data: null, error: null },
    ],
  });
  const res = await runContact(state, baseBody({ attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.jpg' }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts.length, 2);
  assert.ok('attachment_path' in state.inserts[0].row);
  assert.ok(!('attachment_path' in state.inserts[1].row));
});

test('B6-16: attachment_url del browser ignorada', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({
    attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.jpg',
    attachment_url: 'https://evil.test/x.jpg',
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts[0].row.attachment_url, null);
  assert.ok(!adminHtml(state).includes('evil.test'));
  assert.ok(!JSON.stringify(state.inserts[0].row).includes('evil.test'));
});

test('B6-17: admin recibe signed URL', async () => {
  const state = baseState();
  await runContact(state, baseBody({ attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.jpg' }));

  assert.ok(adminHtml(state).includes('https://signed.test/adjunto'));
  assert.ok(adminHtml(state).includes('Ver adjunto'));
});

test('B6-18: usuario NO recibe signed URL ni bloque de adjunto', async () => {
  const state = baseState();
  await runContact(state, baseBody({ attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.jpg' }));

  assert.ok(!userHtml(state).includes('signed.test'));
  assert.ok(!userHtml(state).includes('Ver adjunto'));
});

test('B6-19: fallo al firmar no pierde el contacto', async () => {
  const state = baseState({ signResults: [{ data: null, error: { message: 'sign down' } }] });
  const res = await runContact(state, baseBody({ attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.jpg' }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts.length, 1);
  assert.equal(state.emailSends.length, 2);
  assert.ok(adminHtml(state).includes('Adjunto no disponible'));
  assert.ok(!adminHtml(state).includes('signed.test'));
});
