// tests/admin-panel-usability.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of ['admin-inscripciones.html', 'public/admin-inscripciones.html']) {
  test(`${file}: usa una sola barra horizontal inferior`, () => {
    const source = read(file);
    assert.ok(source.includes('class="table-scroll"'));
    assert.ok(!source.includes('table-scroll-top'));
    assert.ok(source.includes('barra horizontal inferior'));
  });

  test(`${file}: permite minimizar inscripciones y Resend`, () => {
    const source = read(file);
    assert.ok(source.includes('id="inscriptionsSection"'));
    assert.ok(source.includes('id="toggleInscriptionsBtn"'));
    assert.ok(source.includes('id="toggleResendEmailsBtn"'));
    assert.ok(source.includes("classList.toggle('is-collapsed')"));
  });

  test(`${file}: selector de filas ofrece 10, 30, 50 y todos`, () => {
    const source = read(file);
    assert.ok(source.includes('id="rowsPerPage"'));
    for (const value of ['10', '30', '50', 'all']) {
      assert.ok(source.includes(`<option value="${value}"`));
    }
    assert.ok(source.includes("rowLimit: 30"));
    assert.ok(source.includes("visibleRows.forEach"));
  });
}
