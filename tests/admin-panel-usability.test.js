// tests/admin-panel-usability.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of ['admin-inscripciones.html', 'public/admin-inscripciones.html']) {
  test(`${file}: mantiene una barra horizontal accesible mientras recorres la tabla`, () => {
    const source = read(file);
    assert.ok(source.includes('class="table-scroll"'));
    assert.ok(!source.includes('table-scroll-top'));
    assert.ok(source.includes('class="table-scroll-follower"'));
    assert.ok(source.includes('function setupTableScrollFollower'));
    assert.ok(source.includes("position: fixed"));
    assert.ok(source.includes("const nativeBottomVisible = rect.bottom <= viewportHeight - 4"));
    assert.ok(source.includes('La barra horizontal te seguirá mientras recorres la tabla'));
  });

  test(`${file}: permite minimizar inscripciones y Resend`, () => {
    const source = read(file);
    assert.ok(source.includes('id="inscriptionsSection"'));
    assert.ok(source.includes('id="toggleInscriptionsBtn"'));
    assert.ok(source.includes('id="toggleResendEmailsBtn"'));
    assert.ok(source.includes("classList.toggle('is-collapsed')"));
  });


  test(`${file}: transferencias manuales usa el mismo control Mostrar/Minimizar de las tarjetas`, () => {
    const source = read(file);
    const manualCard = source.indexOf('id="manualTransferCard"');
    const manualToggle = source.indexOf('id="toggleManualPanelBtn"');
    assert.ok(manualCard >= 0);
    assert.ok(manualToggle > manualCard, 'el botón Mostrar vive dentro de la tarjeta de transferencias');
    assert.ok(source.includes("toggleManualPanelBtn.textContent = isCollapsed ? 'Mostrar' : 'Minimizar'"));
    assert.ok(!source.includes('Mostrar transferencias manuales'));
  });

  test(`${file}: borrar solo aparece para registros Stripe TEST verificados`, () => {
    const source = read(file);
    assert.ok(!source.includes('dangerModeToggle'));
    assert.ok(!source.includes('Activar opción de borrar'));
    assert.ok(source.includes("orderId.startsWith('cs_test_') && stripeId.startsWith('cs_test_')"));
    assert.ok(source.includes('Eliminar prueba'));
    assert.ok(source.includes('data-delete-bib'));
    assert.ok(source.includes('quedará disponible para reasignarse'));
  });


  test(`${file}: transferencias manuales permiten usar cualquier BIB disponible por participante`, () => {
    const source = read(file);
    assert.ok(source.includes('Automático — siguiente disponible'));
    assert.ok(source.includes('Usar un BIB disponible'));
    assert.ok(source.includes('data-manual-field="bibMode"'));
    assert.ok(source.includes('data-manual-field="releasedBib"'));
    assert.ok(source.includes('/api/admin-list-available-bibs?event='));
    assert.ok(source.includes("item?.source === 'released'"));
    assert.ok(source.includes('BIBs disponibles · incluye liberados y huecos históricos libres'));
  });


  test(`${file}: intentos live no pagados se archivan y no ofrecen acciones de email`, () => {
    const source = read(file);
    assert.ok(source.includes('<option value="archived">Archivadas</option>'));
    assert.ok(source.includes('data-archive-attempt-id'));
    assert.ok(source.includes('Archivar intento'));
    assert.ok(source.includes("['pending', 'payment_failed'].includes(paymentStatus)"));
    assert.ok(source.includes("if (!['paid', 'paid_no_email'].includes(paymentStatus)) return '';"));
    assert.ok(source.includes('No aplica'));
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
