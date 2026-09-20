// tests/contact-form-status.test.js - stale validation message en contacto.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');

function contactSubmissionSection() {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const start = script.indexOf('let statusNode = form.querySelector(".contact-form-status")');
  assert.ok(start !== -1, 'existe statusNode de contacto');
  return script.slice(start, start + 9000);
}

test('B9-contact-1: status node vive dentro del form', () => {
  const section = contactSubmissionSection();
  assert.ok(section.includes('submitBtn.insertAdjacentElement("afterend", statusNode)'), 'inserción tras submit');
  assert.ok(!section.includes('submitBtn.parentElement.insertAdjacentElement'), 'sin inserción fuera del form');
});

test('B9-contact-2: helper limpia texto y color', () => {
  const section = contactSubmissionSection();
  assert.ok(section.includes('const clearContactStatus'), 'helper existe');
  assert.ok(section.includes('statusNode.textContent = ""'), 'limpia texto');
});

test('B9-contact-3: input/change limpian feedback stale', () => {
  const section = contactSubmissionSection();
  assert.ok(section.includes('form.addEventListener("input"'), 'escucha input');
  assert.ok(section.includes('form.addEventListener("change"'), 'escucha change');
  assert.ok(section.includes('clearStaleContactStatus'), 'limpieza condicional');
});

test('B9-contact-4: submit válido limpia antes de enviar', () => {
  const section = contactSubmissionSection();
  const clearPos = section.indexOf('clearContactStatus();');
  const sendingPos = section.indexOf('submitBtn.textContent = "Enviando..."');
  assert.ok(clearPos !== -1 && sendingPos !== -1 && clearPos < sendingPos, 'limpia antes de enviar');
});

test('B9-contact-5: success reemplaza form completo (sin stale fuera)', () => {
  const section = contactSubmissionSection();
  assert.ok(section.includes('form.innerHTML = `'), 'success reemplaza innerHTML del form');
});

test('B9-contact-6: errores actuales se siguen mostrando', () => {
  const section = contactSubmissionSection();
  assert.ok(section.includes('Completa todos los campos obligatorios'), 'error requeridos');
  assert.ok(section.includes('Hay campos con formato inválido'), 'error formato');
  assert.ok(section.includes('No se pudo subir el archivo'), 'error upload');
});
