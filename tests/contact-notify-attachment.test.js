// tests/contact-notify-attachment.test.js - Batch 6 (rev): signed uploads.
// attachment_path UUIDv4 estricto + signed URL solo admin. Sin envíos reales.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_mock';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';
process.env.RATE_LIMIT_SECRET = process.env.RATE_LIMIT_SECRET || 'test-only-rate-limit-secret-0123456789';

const HANDLER_PATH = path.join(__dirname, '..', 'api', 'contact-notify.js');
const VALID_PATH = 'contact/550e8400-e29b-41d4-a716-446655440000.pdf';

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

async function runContact(state, body, options = {}) {
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
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args });
        const next = (state.rpcResults || []).shift();
        return next || { data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null };
      },
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
          createSignedUploadUrl: async (objectPath, options) => {
            state.signedUploadCalls.push({ bucket, objectPath, options });
            const next = (state.signedUploadResults || []).shift();
            return next || {
              data: { path: objectPath, signedUrl: `https://up.test/${objectPath}?token=tok_test_123` },
              error: null,
            };
          },
        }),
      },
    }),
  });
  const restoreMeta = mockModule('../lib/_meta-capi', {
    trackMetaEvent: async () => ({ ok: true }),
  });
  delete require.cache[HANDLER_PATH];
  const savedResendKey = process.env.RESEND_API_KEY;
  if (options.withoutResendKey) delete process.env.RESEND_API_KEY;
  try {
    const handler = require(HANDLER_PATH);
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body }, res);
    return res;
  } finally {
    if (options.withoutResendKey) process.env.RESEND_API_KEY = savedResendKey;
    delete require.cache[HANDLER_PATH];
    restoreMeta();
    restoreSupabase();
    restoreResend();
  }
}

function baseState(overrides = {}) {
  return {
    emailSends: [], inserts: [], signCalls: [], signedUploadCalls: [],
    insertResults: [], signResults: [], signedUploadResults: [], emailResults: [],
    rpcCalls: [], rpcResults: [],
    ...overrides,
  };
}

function adminHtml(state) {
  const admin = state.emailSends.find((e) => e.to === 'hola@kinetichub.com.mx');
  return admin ? admin.html : '';
}

function userHtml(state) {
  const user = state.emailSends.find((e) => e.to === 'user@example.com');
  return user ? user.html : '';
}

// ---------- Modo upload intent ----------

test('B6-upload-1: MIME válido genera path server-side + token', async () => {
  const state = baseState();
  const res = await runContact(state, { action: 'create_attachment_upload', mime_type: 'image/jpeg', size: 1000 });

  assert.equal(res.statusCode, 200);
  assert.match(res.body.path, /^contact\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(res.body.token, 'tok_test_123');
  assert.equal(state.signedUploadCalls.length, 1);
  assert.equal(state.signedUploadCalls[0].bucket, 'contact-private');
  assert.deepEqual(state.signedUploadCalls[0].options, { upsert: false });
});

test('B6-upload-2: MIME inválido rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, { action: 'create_attachment_upload', mime_type: 'image/svg+xml', size: 1000 });

  assert.equal(res.statusCode, 400);
  assert.equal(state.signedUploadCalls.length, 0);
});

test('B6-upload-3: tamaño >5MB rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, { action: 'create_attachment_upload', mime_type: 'image/png', size: 6 * 1024 * 1024 });

  assert.equal(res.statusCode, 400);
  assert.equal(state.signedUploadCalls.length, 0);
});

test('B6-upload-intent-sin-resend: funciona sin RESEND_API_KEY', async () => {
  const state = baseState();
  const res = await runContact(
    state,
    { action: 'create_attachment_upload', mime_type: 'image/png', size: 1000 },
    { withoutResendKey: true }
  );

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.path && res.body.token);
});

test('B6-submit-sin-resend: submission normal sigue exigiendo RESEND_API_KEY', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({}), { withoutResendKey: true });

  assert.equal(res.statusCode, 500);
  assert.equal(state.inserts.length, 0);
});

test('B6-upload-4: browser no controla el path', async () => {
  const state = baseState();
  const res = await runContact(state, {
    action: 'create_attachment_upload',
    mime_type: 'image/png',
    size: 1000,
    path: 'contact/yo-lo-elijo.png',
  });

  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.path.includes('yo-lo-elijo'));
  assert.equal(state.signedUploadCalls[0].objectPath, res.body.path);
});

// ---------- Submit normal ----------

test('B6-submit-uuid: path UUIDv4 válido aceptado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: VALID_PATH }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts[0].row.attachment_path, VALID_PATH);
  assert.equal(state.inserts[0].row.attachment_url, null);
});

test('B6-reject-short: contact/a.pdf rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'contact/a.pdf' }));

  assert.equal(res.statusCode, 400);
  assert.equal(state.inserts.length, 0);
});

test('B6-reject-url: URL absoluta rechazada', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'https://evil.test/x.jpg' }));

  assert.equal(res.statusCode, 400);
  assert.equal(state.inserts.length, 0);
});

test('B6-reject-traversal: ../ rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'contact/../../x.jpg' }));

  assert.equal(res.statusCode, 400);
});

test('B6-reject-ext: extensión inválida rechazada', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'contact/550e8400-e29b-41d4-a716-446655440000.exe' }));

  assert.equal(res.statusCode, 400);
});

test('B6-reject-prefix: otro bucket/prefijo rechazado', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({ attachment_path: 'avatars/u1/avatar.jpg' }));

  assert.equal(res.statusCode, 400);
});

test('B6-sign-ttl: download signed URL TTL 3600 en contact-private', async () => {
  const state = baseState();
  await runContact(state, baseBody({ attachment_path: VALID_PATH }));

  assert.equal(state.signCalls.length, 1);
  assert.equal(state.signCalls[0].bucket, 'contact-private');
  assert.equal(state.signCalls[0].objectPath, VALID_PATH);
  assert.equal(state.signCalls[0].ttl, 3600);
});

test('B6-admin-only: signed URL solo en email admin', async () => {
  const state = baseState();
  await runContact(state, baseBody({ attachment_path: VALID_PATH }));

  assert.ok(adminHtml(state).includes('https://signed.test/adjunto'));
  assert.ok(adminHtml(state).includes('Ver adjunto'));
  assert.ok(!userHtml(state).includes('signed.test'));
  assert.ok(!userHtml(state).includes('Ver adjunto'));
});

test('B6-no-persist-url: signed URL nunca persistida', async () => {
  const state = baseState();
  await runContact(state, baseBody({ attachment_path: VALID_PATH }));

  const row = state.inserts[0].row;
  assert.equal(row.attachment_url, null);
  assert.ok(!JSON.stringify(row).includes('signed.test'));
});

test('B6-browser-url-ignored: attachment_url del browser ignorada', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({
    attachment_path: VALID_PATH,
    attachment_url: 'https://evil.test/x.jpg',
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts[0].row.attachment_url, null);
  assert.ok(!adminHtml(state).includes('evil.test'));
  assert.ok(!JSON.stringify(state.inserts[0].row).includes('evil.test'));
});

test('B6-sign-fail: fallo al firmar no pierde el contacto', async () => {
  const state = baseState({ signResults: [{ data: null, error: { message: 'sign down' } }] });
  const res = await runContact(state, baseBody({ attachment_path: VALID_PATH }));

  assert.equal(res.statusCode, 200);
  assert.equal(state.inserts.length, 1);
  assert.equal(state.emailSends.length, 2);
  assert.ok(adminHtml(state).includes('Adjunto no disponible'));
  assert.ok(!adminHtml(state).includes('signed.test'));
});

test('B6-labels: Cascanueces muestra etiqueta legible en ambos correos', async () => {
  const state = baseState();
  const res = await runContact(state, baseBody({
    full_name: 'María López',
    event_slug: 'cascanueces-run',
    reason: 'pago',
    subject: 'Duda de pago',
  }));

  assert.equal(res.statusCode, 200);
  assert.ok(adminHtml(state).includes('Cascanueces Run 2026'));
  assert.ok(userHtml(state).includes('Cascanueces Run 2026'));
  assert.ok(adminHtml(state).includes('Aclaración de pago'));
  assert.ok(userHtml(state).includes('Aclaración de pago'));
  assert.ok(adminHtml(state).includes('María López'));
  assert.ok(adminHtml(state).includes('user@example.com'));
  assert.ok(adminHtml(state).includes('5512345678'));
  assert.ok(userHtml(state).includes('María López'));
});

test('B6-labels: DB conserva valores canónicos y subject original', async () => {
  const state = baseState();
  await runContact(state, baseBody({ event_slug: 'cascanueces-run', reason: 'facturacion', subject: 'Mi factura' }));

  assert.equal(state.inserts[0].row.event_slug, 'cascanueces-run');
  assert.equal(state.inserts[0].row.reason, 'facturacion');
  assert.ok(adminHtml(state).includes('Facturación'));
  const subjects = state.emailSends.map((e) => e.subject);
  assert.ok(subjects.some((s) => s.includes('Mi factura')));
});

test('B6-labels: valor desconocido usa fallback sanitizado', async () => {
  const state = baseState();
  await runContact(state, baseBody({ event_slug: 'carrera-futura', reason: 'otro-tema' }));

  assert.equal(state.inserts[0].row.event_slug, 'carrera-futura');
  assert.ok(adminHtml(state).includes('carrera-futura'));
  assert.ok(adminHtml(state).includes('otro-tema'));
});

