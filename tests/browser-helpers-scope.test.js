// tests/browser-helpers-scope.test.js - HOTFIX: colisión de scope global.
// profile-fields.js, storage-upload.js y location-catalog.js declaraban
// `const catalog` a nivel top-level: en classic scripts eso rompía la carga
// (SyntaxError: already declared). Ahora van en IIFE: se cargan en el MISMO
// contexto VM sin colisionar y exponen sus namespaces en window.
// require() por archivo sigue funcionando (compat Node/tests).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');

function loadInSharedContext(files) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    vm.runInContext(source, sandbox, { filename: file });
  }
  return sandbox;
}

test('helpers coexisten en un mismo contexto sin SyntaxError', () => {
  const sandbox = loadInSharedContext([
    'profile-fields.js',
    'storage-upload.js',
    'location-catalog.js',
  ]);

  assert.ok(sandbox.window.KineticHubProfileFields, 'existe KineticHubProfileFields');
  assert.ok(sandbox.window.KineticHubStorageUpload, 'existe KineticHubStorageUpload');
  assert.ok(sandbox.window.KineticHubLocationCatalog, 'existe KineticHubLocationCatalog');
  // deepEqual cruzando contextos VM falla por prototipos: comparar serializado.
  assert.equal(
    JSON.stringify(sandbox.window.KineticHubProfileFields.pickProfileWritableFields({ first_name: 'Ana', bib_number: '001' })),
    JSON.stringify({ first_name: 'Ana' })
  );
  assert.equal(
    sandbox.window.KineticHubStorageUpload.buildProfileObjectPath({ type: 'avatar', userId: 'u1', ext: 'jpg' }),
    'avatars/u1/avatar.jpg'
  );
});

test('ningún helper filtra bindings al scope compartido', () => {
  const sandbox = loadInSharedContext([
    'profile-fields.js',
    'storage-upload.js',
    'location-catalog.js',
  ]);

  for (const name of ['catalog', 'STATES', 'PROFILE_WRITABLE_FIELDS', 'STORAGE_BUCKET', 'PROFILE_MEDIA_BUCKET']) {
    assert.equal(sandbox[name], undefined, `${name} no debe ser global`);
  }
});

test('require() por helper sigue funcionando', () => {
  const profile = require('../profile-fields');
  const storage = require('../storage-upload');
  const catalog = require('../location-catalog');

  assert.ok(Array.isArray(profile.PROFILE_WRITABLE_FIELDS));
  assert.equal(storage.PROFILE_MEDIA_BUCKET, 'contact-attachments');
  assert.equal(typeof catalog.normalizeState, 'function');
});
