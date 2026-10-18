'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function row(id, overrides = {}) {
  return {
    id: String(id).padStart(6, '0'), event_slug: 'axolote-night-run', full_name: `Runner ${id}`,
    distance: '5K', shirt_size: 'M', email: 'runner@example.invalid', buyer_email: 'buyer@example.invalid',
    bib_number: '007', payment_status: 'paid', registration_status: 'active',
    order_session_id: `cs_live_order_${id}`, stripe_session_id: `cs_live_order_${id}`,
    ticket_index: 1, ticket_count: 1, ...overrides,
  };
}

function loadModule(file, overrides, env = {}) {
  const filename = path.join(__dirname, '..', file);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require(name) { return Object.hasOwn(overrides, name) ? overrides[name] : realRequire(name); },
    process: { env }, console: { error() {} },
  }, { filename });
  return module.exports;
}

function fixture(rows = [], options = {}) {
  const state = { reads: [], authTokens: [] };
  const client = {
    auth: { async getUser(token) {
      state.authTokens.push(token);
      if (token === 'admin-token') return { data: { user: { email: 'Admin@Example.invalid' } } };
      if (token === 'user-token') return { data: { user: { email: 'user@example.invalid' } } };
      return { error: new Error('invalid token') };
    } },
    from(table) {
      assert.equal(table, 'inscripciones', 'export must never read dogs, payment drafts or other tables');
      const call = { table, filters: [], orders: [] };
      state.reads.push(call);
      const query = {
        select(columns) { call.columns = columns; return query; },
        in(column, values) { call.filters.push({ type: 'in', column, values: Array.from(values) }); return query; },
        eq(column, value) { call.filters.push({ type: 'eq', column, value }); return query; },
        gt(column, value) { call.filters.push({ type: 'gt', column, value }); return query; },
        order(column, settings) { call.orders.push({ column, ascending: settings.ascending }); return query; },
        limit(value) { call.limit = value; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (options.throwOnPage === state.reads.length) throw new Error('database unavailable');
            if (options.failOnPage === state.reads.length) return { data: null, error: { message: 'private db details' } };
            let data = options.pageFactory ? options.pageFactory(state.reads.length) : rows;
            if (!options.ignoreFilters) data = data.filter(item => call.filters.every(filter => {
              if (filter.type === 'in') return filter.values.includes(item[filter.column]);
              if (filter.type === 'gt') return item[filter.column] > filter.value;
              return item[filter.column] === filter.value;
            }));
            data = [...data].sort((a, b) => a.id.localeCompare(b.id)).slice(0, call.limit);
            return { data, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const auth = loadModule('lib/_auth.js', { '@supabase/supabase-js': { createClient: () => client } }, {
    SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'mock-key',
    ADMIN_EMAILS: options.adminEmails ?? 'admin@example.invalid',
  });
  const exported = loadModule('lib/admin-export-shirts.js', { './_auth': auth });
  const request = (query = {}, token = 'admin-token') => ({
    method: 'GET', query, headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { state, exported, request };
}

function parseCsv(csv) {
  const rows = [];
  let record = [], cell = '', quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { record.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && text[i + 1] === '\n') {
      record.push(cell); rows.push(record); record = []; cell = ''; i += 1;
    } else cell += char;
  }
  assert.equal(quoted, false);
  assert.equal(cell, '');
  return rows;
}

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

function dispatcher(exported) {
  // Exercise the actual action map without initializing any unrelated services.
  const source = fs.readFileSync(path.join(__dirname, '..', 'api/data.js'), 'utf8');
  const overrides = {};
  for (const [, name] of source.matchAll(/require\('([^']+)'\)/g)) {
    overrides[name] = name === '../lib/admin-export-shirts' ? exported : () => {
      throw new Error(`Unexpected unrelated handler: ${name}`);
    };
  }
  return loadModule('api/data.js', overrides);
}

for (const [token, status, adminEmails] of [
  [null, 401], ['bad-token', 401], ['user-token', 403], ['admin-token', 403, ''],
]) test(`shirts reader rejects ${token || 'missing token'} with ${status} before reading data`, async () => {
  const f = fixture([row(1)], { adminEmails });
  const result = await f.exported.readShirtRegistrations(f.request({}, token));
  assert.equal(result.status, status);
  assert.equal(f.state.reads.length, 0);
});

for (const event of ['all', 'axolote-night-run', 'cascanueces-run', 'perrun-2027']) {
  test(`shirts reader exports only the chosen race ${event}, ignoring visual filters and page limits`, async () => {
    const input = [row(1), row(2, { event_slug: 'cascanueces-run' }), row(3, { event_slug: 'perrun-2027' })];
    const f = fixture(input);
    const result = await f.exported.readShirtRegistrations(f.request({ event, status: 'refunded', search: 'nothing', q: 'nothing', limit: 1, page: 99 }));
    assert.equal(result.status, 200);
    assert.deepEqual(Array.from(result.rows, item => item.id), input.filter(item => event === 'all' || item.event_slug === event).map(item => item.id));
    assert.deepEqual(f.state.reads[0].filters.find(filter => filter.column === 'payment_status').values, ['paid', 'paid_no_email']);
    assert.deepEqual(f.state.reads[0].filters.find(filter => filter.column === 'registration_status'), { type: 'eq', column: 'registration_status', value: 'active' });
    assert.deepEqual(f.state.reads[0].orders, [{ column: 'id', ascending: true }]);
    assert.equal(f.state.reads[0].limit, 100);
  });
}

test('shirts reader defaults to all and rejects unknown or repeated race parameters', async () => {
  const f = fixture([row(1)]);
  assert.equal((await f.exported.readShirtRegistrations(f.request())).event, 'all');
  for (const event of ['unknown', ['all', 'perrun-2027'], { slug: 'all' }]) {
    const bad = fixture([row(1)]);
    assert.equal((await bad.exported.readShirtRegistrations(bad.request({ event }))).status, 400);
    assert.equal(bad.state.reads.length, 0);
  }
});

test('shirts reader enforces payment AND participation status, and excludes TEST in either identifier', async () => {
  const input = [];
  for (const payment_status of ['paid', 'paid_no_email', 'pending', 'payment_failed', 'refunded', 'duplicate']) {
    for (const registration_status of ['active', 'cancelled', 'archived']) {
      input.push(row(input.length + 1, { payment_status, registration_status }));
    }
  }
  input.push(row(90, { order_session_id: 'cs_test_only_order' }));
  input.push(row(91, { stripe_session_id: 'cs_test_only_stripe::2' }));
  input.push(row(92, { order_session_id: 'cs_test_both', stripe_session_id: 'cs_test_both' }));
  input.push(row(93, { event_slug: 'unknown' }));
  const f = fixture(input, { ignoreFilters: true });
  const result = await f.exported.readShirtRegistrations(f.request());
  assert.deepEqual(Array.from(result.rows, item => item.id), ['000001', '000004']);
});

test('shirts reader keeps manual payments, arbitrary names/emails, and paid rows without a sent email', async () => {
  const input = [
    row(1, { order_session_id: 'manual_qa_123', stripe_session_id: 'manual_qa_123', full_name: 'Test', email: 'test@example.invalid', email_sent: false }),
    row(2, { event_slug: 'perrun-2027', order_session_id: 'manual_perrun_123', stripe_session_id: 'manual_perrun_123', email_sent: false }),
  ];
  const f = fixture(input);
  const result = await f.exported.readShirtRegistrations(f.request());
  assert.deepEqual(Array.from(result.rows, item => item.id), ['000001', '000002']);
});

test('shirts reader continues through full TEST pages and uses a unique cursor to fetch every human', async () => {
  const input = Array.from({ length: 205 }, (_, i) => row(i + 1, i < 100 ? { stripe_session_id: `cs_test_${i}` } : {})).reverse();
  const f = fixture(input);
  const result = await f.exported.readShirtRegistrations(f.request());
  assert.equal(result.rows.length, 105);
  assert.equal(new Set(result.rows.map(item => item.id)).size, 105);
  assert.equal(result.rows[0].id, '000101');
  assert.equal(result.rows[104].id, '000205');
  assert.equal(f.state.reads.length, 3);
  assert.deepEqual(f.state.reads.slice(1).map(call => call.filters.find(filter => filter.type === 'gt').value), ['000100', '000200']);
});

test('shirts reader returns an error instead of partial rows when a later page fails', async () => {
  const f = fixture(Array.from({ length: 105 }, (_, i) => row(i + 1)), { failOnPage: 2 });
  const result = await f.exported.readShirtRegistrations(f.request());
  assert.equal(result.status, 500);
  assert.equal(result.rows, undefined);
  assert.ok(!result.error.includes('private db details'));
});

test('shirts CSV has exactly the requested human columns, one row per ticket and one shirt for two Perrun dogs', async () => {
  const input = [
    row(1, { full_name: 'Ana', shirt_size: 'XS', order_session_id: 'cs_live_multi', ticket_index: 1, ticket_count: 2 }),
    row(2, { full_name: 'Bea', shirt_size: 'XXXL', order_session_id: 'cs_live_multi', ticket_index: 2, ticket_count: 2 }),
    row(3, { event_slug: 'cascanueces-run', full_name: 'Carlos', distance: '10K' }),
    row(4, { event_slug: 'perrun-2027', full_name: 'Dani', distance: '3K', dogs: [{ name: 'Luna' }, { name: 'Sol' }] }),
  ];
  const f = fixture(input);
  const result = await f.exported.readShirtRegistrations(f.request());
  const csv = f.exported.shirtsCsv(result.rows);
  const records = parseCsv(csv);
  assert.deepEqual(records[0], ['Carrera', 'Nombre', 'Distancia', 'Talla', 'Cantidad', 'Correo', 'BIB', 'Estado', 'Observacion']);
  assert.equal(records.length, 5);
  assert.deepEqual(records.slice(1).map(record => [record[0], record[1], record[3], record[4]]), [
    ['Axolote Night Run 2026', 'Ana', 'XS', '1'], ['Axolote Night Run 2026', 'Bea', 'XXXL', '1'],
    ['Cascanueces Run 2026', 'Carlos', 'M', '1'], ['Perrun 2027', 'Dani', 'M', '1'],
  ]);
  assert.ok(records.every(record => record.length === 9));
  assert.equal(records[1][6], '007');
  assert.ok(!csv.includes('cs_live_'));
  assert.ok(!csv.includes('Luna'));
  assert.ok(csv.startsWith('\uFEFFCarrera,'));
  assert.ok(csv.endsWith('\r\n'));
});

test('shirts CSV escapes accents, commas, quotes, newlines and spreadsheet formulas', () => {
  const f = fixture();
  const records = parseCsv(f.exported.shirtsCsv([
    row(1, { full_name: 'María, "Luz"\nLópez', email: '=HYPERLINK("unsafe")', distance: '@bad', bib_number: '-1' }),
    row(2, { full_name: '\t=unsafe', email: '+unsafe' }),
  ]));
  assert.equal(records[1][1], 'María, "Luz"\nLópez');
  assert.equal(records[1][2], "'@bad");
  assert.equal(records[1][5], "'=HYPERLINK(\"unsafe\")");
  assert.equal(records[1][6], "'-1");
  assert.equal(records[2][1], "'\t=unsafe");
  assert.equal(records[2][5], "'+unsafe");
});

test('empty shirts export has a valid nine-column header and no invented rows', () => {
  const f = fixture();
  assert.equal(parseCsv(f.exported.shirtsCsv([])).length, 1);
});

test('null, empty and invalid shirts stay visible as TALLA_PENDIENTE without stopping valid rows', async () => {
  const input = [null, '', '  ', 'unknown'].map((shirt_size, index) => row(index + 1, { shirt_size }));
  input.push(row(5));
  const f = fixture(input);
  const res = response();
  await f.exported(f.request(), res);
  assert.equal(res.statusCode, 200);
  const records = parseCsv(res.body);
  assert.equal(records.length, 6);
  for (const record of records.slice(1, 5)) {
    assert.equal(record[3], 'TALLA_PENDIENTE');
    assert.equal(record[4], '1');
    assert.equal(record[8], 'DATOS_INCOMPLETOS_LEGACY');
  }
  assert.equal(records[5][3], 'M');
  assert.equal(records[5][8], '');
});

test('paid_no_email legacy summary reports its ticket count without creating fictitious shirts', async () => {
  const f = fixture([
    row(1, { payment_status: 'paid_no_email', shirt_size: null, ticket_count: 3, email: null, buyer_email: null, bib_number: null }),
    row(2, { event_slug: 'perrun-2027' }),
  ]);
  const res = response();
  await dispatcher(f.exported)(f.request({ action: 'admin-export-shirts', event: 'all' }), res);
  assert.equal(res.statusCode, 200);
  const records = parseCsv(res.body);
  assert.equal(records.length, 3, 'exactly two persisted humans, not three invented legacy participants');
  assert.equal(records[1][3], 'TALLA_PENDIENTE');
  assert.equal(records[1][4], '1');
  assert.equal(records[1][5], '');
  assert.equal(records[1][6], '');
  assert.equal(records[1][7], 'paid_no_email');
  assert.equal(records[1][8], 'DATOS_INCOMPLETOS_LEGACY: orden reporta 3 tickets; tallas individuales no disponibles');
  assert.equal(records[2][0], 'Perrun 2027');
});

test('single-ticket paid_no_email is marked when its size is missing; complete tickets keep known sizes', () => {
  const f = fixture();
  const records = parseCsv(f.exported.shirtsCsv([
    row(1, { payment_status: 'paid_no_email', shirt_size: null }),
    row(2, { payment_status: 'paid_no_email', shirt_size: 'XL' }),
  ]));
  assert.equal(records[1][3], 'TALLA_PENDIENTE');
  assert.equal(records[1][8], 'DATOS_INCOMPLETOS_LEGACY');
  assert.equal(records[2][3], 'XL');
  assert.equal(records[2][8], '');
});

test('complete multi-ticket paid_no_email orders are not mistaken for a single legacy summary', async () => {
  // Put the two persisted participants on separate pages to verify global grouping.
  const input = Array.from({ length: 101 }, (_, i) => row(i + 1));
  input[0] = row(1, { payment_status: 'paid_no_email', shirt_size: 'S', ticket_count: 2, order_session_id: 'shared-order' });
  input[100] = row(101, { payment_status: 'paid_no_email', shirt_size: 'XL', ticket_count: 2, ticket_index: 2, order_session_id: 'shared-order' });
  const f = fixture(input);
  const res = response();
  await f.exported(f.request(), res);
  const records = parseCsv(res.body);
  assert.equal(records.length, 102);
  assert.equal(records[1][3], 'S');
  assert.equal(records[101][3], 'XL');
  assert.equal(records[1][8], '');
  assert.equal(records[101][8], '');
});

for (const event of ['all', 'axolote-night-run', 'cascanueces-run', 'perrun-2027']) {
  test(`/api/data?action=admin-export-shirts&event=${event} reaches the real authenticated CSV handler`, async () => {
    const f = fixture([row(1), row(2, { event_slug: 'cascanueces-run' }), row(3, { event_slug: 'perrun-2027' })]);
    const url = new URL(`/api/data?action=admin-export-shirts&event=${event}`, 'https://example.invalid');
    const res = response();
    await dispatcher(f.exported)(f.request(Object.fromEntries(url.searchParams)), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(res.headers['Content-Disposition'], `attachment; filename="${event === 'all' ? 'todas-las-carreras' : event}-playeras.csv"`);
    assert.equal(parseCsv(res.body).length, event === 'all' ? 4 : 2);
    assert.deepEqual(f.state.authTokens, ['admin-token']);
  });
}

test('shirts action rejects unauthorized requests and non-GET methods without querying registrations', async () => {
  for (const [token, status] of [[null, 401], ['bad-token', 401], ['user-token', 403]]) {
    const f = fixture([row(1)]);
    const res = response();
    await dispatcher(f.exported)(f.request({ action: 'admin-export-shirts' }, token), res);
    assert.equal(res.statusCode, status);
    assert.equal(res.headers['Content-Type'], undefined);
    assert.equal(f.state.reads.length, 0);
  }
  const f = fixture([row(1)]);
  const res = response();
  await f.exported({ ...f.request(), method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(f.state.reads.length, 0);
});

test('shirts action returns JSON errors, never partial CSV, for invalid races and database failures', async () => {
  for (const options of [{ failOnPage: 2 }, { throwOnPage: 2 }]) {
    const f = fixture(Array.from({ length: 101 }, (_, i) => row(i + 1)), options);
    const res = response();
    await f.exported(f.request(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers['Content-Type'], undefined);
    assert.equal(res.headers['Content-Disposition'], undefined);
    assert.equal(typeof res.body.error, 'string');
  }
  const f = fixture();
  const res = response();
  await f.exported(f.request({ event: 'unknown' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(f.state.reads.length, 0);
});

test('shirts reader fails explicitly when pagination cannot advance or exceeds the export limit', async () => {
  const repeatedPage = fixture([], { ignoreFilters: true, pageFactory: () => Array.from({ length: 100 }, (_, i) => row(i + 1)) });
  const stuck = await repeatedPage.exported.readShirtRegistrations(repeatedPage.request());
  assert.equal(stuck.status, 500);
  assert.equal(stuck.rows, undefined);
  const huge = fixture([], { pageFactory: page => Array.from({ length: 100 }, (_, i) => row((page - 1) * 100 + i + 1)) });
  const tooLarge = await huge.exported.readShirtRegistrations(huge.request());
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.rows, undefined);
});
