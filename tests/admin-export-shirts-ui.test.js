'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function panel(file, { event = 'all', token = 'admin-token', response, networkError } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('function setupDashboardControls(client) {');
  const end = source.indexOf("const statusFilter = document.getElementById('statusFilter');", start);
  assert.ok(start >= 0 && end > start);
  const state = { requests: [], downloads: [], alerts: [], revoked: [], timers: [] };
  const button = {
    textContent: 'Exportar playeras CSV', disabled: false,
    addEventListener(type, listener) { assert.equal(type, 'click'); this.listener = listener; },
  };
  const filter = { value: event };
  const context = vm.createContext({
    document: {
      getElementById(id) { return id === 'exportShirtsCsv' ? button : id === 'eventFilter' ? filter : null; },
      body: { appendChild(link) { link.attached = true; } },
      createElement(tag) {
        assert.equal(tag, 'a');
        return {
          click() { assert.ok(this.attached); state.downloads.push({ href: this.href, filename: this.download }); },
          remove() { this.attached = false; },
        };
      },
    },
    URLSearchParams,
    URL: {
      createObjectURL(blob) { assert.equal(blob, 'csv-blob'); return 'blob:shirts'; },
      revokeObjectURL(url) { state.revoked.push(url); },
    },
    async fetch(url, options) {
      state.requests.push({ url, options });
      assert.equal(button.disabled, true);
      assert.equal(button.textContent, 'Exportando...');
      if (networkError) throw networkError;
      return response || { ok: true, async blob() { return 'csv-blob'; } };
    },
    alert(message) { state.alerts.push(message); },
    setTimeout(callback) { state.timers.push(callback); },
    // Unrelated visual filters must never affect the export request.
    adminUiState: { searchTerm: 'nothing-matches', rowLimit: '10', eventSlug: 'wrong-stale-event' },
  });
  vm.runInContext(source.slice(start, end) + '\n}', context);
  context.setupDashboardControls({ auth: { async getSession() {
    return { data: { session: token ? { access_token: token } : null } };
  } } });
  return { state, button, filter, click: () => button.listener.call(button), source };
}

for (const file of ['admin-inscripciones.html', 'public/admin-inscripciones.html']) {
  for (const event of ['all', 'axolote-night-run', 'cascanueces-run', 'perrun-2027']) {
    test(`${file}: shirts download uses only current race ${event} and authenticated session`, async () => {
      const p = panel(file);
      p.filter.value = event;
      await p.click();
      assert.equal(p.state.requests.length, 1);
      const request = p.state.requests[0];
      const url = new URL(request.url, 'https://example.invalid');
      assert.equal(url.pathname, '/api/data');
      assert.deepEqual([...url.searchParams], [['action', 'admin-export-shirts'], ['event', event]]);
      assert.equal(request.options.headers.Authorization, 'Bearer admin-token');
      assert.deepEqual(p.state.downloads, [{ href: 'blob:shirts', filename: `${event === 'all' ? 'todas-las-carreras' : event}-playeras.csv` }]);
      assert.equal(p.button.disabled, false);
      assert.equal(p.button.textContent, 'Exportar playeras CSV');
      p.state.timers.forEach(callback => callback());
      assert.deepEqual(p.state.revoked, ['blob:shirts']);
      assert.deepEqual(p.state.alerts, []);
    });
  }

  test(`${file}: missing session never requests or downloads shirts`, async () => {
    const p = panel(file, { token: null });
    await p.click();
    assert.deepEqual(p.state.requests, []);
    assert.deepEqual(p.state.downloads, []);
    assert.deepEqual(p.state.alerts, ['Sesión no válida.']);
    assert.equal(p.button.disabled, false);
  });

  test(`${file}: API and network errors restore the button without downloading`, async () => {
    for (const options of [
      { response: { ok: false, async json() { return { error: 'Sin permisos.' }; } }, expected: 'Sin permisos.' },
      { response: { ok: false, async json() { throw new Error('not JSON'); } }, expected: 'No se pudieron exportar las playeras.' },
      { networkError: new Error('Sin conexión.'), expected: 'Sin conexión.' },
    ]) {
      const p = panel(file, options);
      await p.click();
      assert.deepEqual(p.state.downloads, []);
      assert.deepEqual(p.state.alerts, [options.expected]);
      assert.equal(p.button.disabled, false);
      assert.equal(p.button.textContent, 'Exportar playeras CSV');
    }
  });

  test(`${file}: shirts control explains scope and all inline scripts parse`, () => {
    const { source } = panel(file);
    assert.match(source, /id="exportShirtsCsv"[^>]*title="[^"]*sin aplicar búsqueda, estado ni filas visibles[^"]*">Exportar playeras CSV<\/button>/);
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/src\s*=/.test(match[1])) new vm.Script(match[2]);
    }
  });
}

test('generated public admin matches the source with asset versions and every local script exists', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'admin-inscripciones.html'), 'utf8');
  const generated = fs.readFileSync(path.join(root, 'public/admin-inscripciones.html'), 'utf8');
  const version = generated.match(/location-catalog\.js\?v=([^"\s]+)/)?.[1];
  assert.ok(version && version !== '__ASSET_VERSION__');
  assert.equal(generated, source.replaceAll('__ASSET_VERSION__', version));
  for (const [, script] of generated.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    if (/^(?:https?:)?\/\//.test(script)) continue;
    const filename = script.split('?')[0];
    assert.equal(fs.readFileSync(path.join(root, 'public', filename), 'utf8'),
      fs.readFileSync(path.join(root, filename), 'utf8').replaceAll('__ASSET_VERSION__', version));
  }
});
