// tests/api-data.test.js - HOTFIX Vercel: dispatcher /api/data.js.
// Verifica ruteo por ?action= hacia el handler correcto (con su propia
// auth intacta) y 404 ante actions desconocidas. No duplica los tests
// de autorización de cada handler.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const DATA_PATH = path.join(__dirname, '..', 'api', 'data.js');
const LIB_DIR = path.join(__dirname, '..', 'lib');

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

function loadFreshDispatcher() {
  delete require.cache[DATA_PATH];
  return require(DATA_PATH);
}

function createReqRes(query = {}) {
  return {
    req: { method: 'GET', headers: {}, query },
    res: {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    },
  };
}

async function withMockedHandlers(calls, run) {
  const restores = [
    mockModule(path.join(LIB_DIR, 'me-registrations.js'), async (req, res) => {
      calls.push('me-registrations'); return res.status(200).json({ ok: 'me' });
    }),
    mockModule(path.join(LIB_DIR, 'admin-list-inscriptions.js'), async (req, res) => {
      calls.push('admin-list-inscriptions'); return res.status(200).json({ ok: 'admin' });
    }),
    mockModule(path.join(LIB_DIR, 'resend-emails-list.js'), async (req, res) => {
      calls.push('resend-emails-list'); return res.status(200).json({ ok: 'resend' });
    }),
  ];
  try {
    await run(loadFreshDispatcher());
  } finally {
    restores.forEach((restore) => restore());
    delete require.cache[DATA_PATH];
  }
}

test('data.js despacha me-registrations', async () => {
  const calls = [];
  await withMockedHandlers(calls, async (handler) => {
    const { req, res } = createReqRes({ action: 'me-registrations' });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, ['me-registrations']);
  });
});

test('data.js despacha admin-list-inscriptions', async () => {
  const calls = [];
  await withMockedHandlers(calls, async (handler) => {
    const { req, res } = createReqRes({ action: 'admin-list-inscriptions', status: 'paid' });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, ['admin-list-inscriptions']);
  });
});

test('data.js despacha resend-emails-list', async () => {
  const calls = [];
  await withMockedHandlers(calls, async (handler) => {
    const { req, res } = createReqRes({ action: 'resend-emails-list', limit: '50' });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, ['resend-emails-list']);
  });
});

test('data.js action desconocida o ausente → 404 sin invocar handlers', async () => {
  const calls = [];
  await withMockedHandlers(calls, async (handler) => {
    for (const query of [{}, { action: '' }, { action: 'admin-delete-inscription' }, { action: '../lib/_auth' }]) {
      const { req, res } = createReqRes(query);
      await handler(req, res);
      assert.equal(res.statusCode, 404);
    }
    assert.deepEqual(calls, []);
  });
});
