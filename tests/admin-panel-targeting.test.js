const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

for (const file of ['admin-inscripciones.html', 'public/admin-inscripciones.html']) {
  test(`${file}: delete envía exactamente un target`, () => {
    const source = read(file);
    assert.ok(
      source.includes("inscriptionId: deleteMode === 'row' ? inscriptionId : ''"),
      'delete debe vaciar inscriptionId cuando elimina por orden'
    );
    assert.ok(
      source.includes("orderSessionId: deleteMode === 'order' ? orderSessionId : ''"),
      'delete debe vaciar orderSessionId cuando elimina por inscripción'
    );
  });

  test(`${file}: corregir correo envía exactamente un target`, () => {
    const source = read(file);
    assert.ok(
      source.includes("inscriptionId: orderSessionId ? '' : inscriptionId"),
      'update-email debe usar inscriptionId solo cuando no hay orderSessionId'
    );
    assert.ok(
      source.includes("orderSessionId: orderSessionId || ''"),
      'update-email debe usar la orden cuando existe'
    );
  });

  test(`${file}: eliminar ya no obliga a teclear el identificador completo`, () => {
    const source = read(file);
    assert.ok(
      !source.includes('Confirma escribiendo el identificador exacto a eliminar'),
      'la confirmación no debe pedir copiar un ID largo'
    );
    assert.ok(
      source.includes('Confirmación final: vas a eliminar'),
      'se conserva una segunda confirmación explícita'
    );
  });
}
