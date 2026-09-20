// tests/storage-upload.test.js - Batch 6: endurecimiento de subidas Storage.
// Unit tests del helper puro (storage-upload.js) + tests estructurales de
// script.js y HTMLs. Sin subidas reales.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const helper = require('../storage-upload');

const file = (overrides = {}) => ({ name: 'foto.jpg', type: 'image/jpeg', size: 1000, ...overrides });

test('B6-01/02: paths de avatar/cover usan auth user id', () => {
  assert.equal(
    helper.buildProfileObjectPath({ type: 'avatar', userId: 'uid-123_ABC', ext: 'jpg' }),
    'avatars/uid-123_ABC/avatar.jpg'
  );
  assert.equal(
    helper.buildProfileObjectPath({ type: 'cover', userId: 'uid-123_ABC', ext: 'webp' }),
    'covers/uid-123_ABC/cover.webp'
  );
});

test('B6-03: type arbitrario rechazado', () => {
  assert.equal(helper.normalizeProfileMediaType('contact'), null);
  assert.equal(helper.normalizeProfileMediaType('../../etc'), null);
  assert.equal(helper.normalizeProfileMediaType(''), null);
  assert.equal(helper.buildProfileObjectPath({ type: 'contact', userId: 'u1', ext: 'jpg' }), null);
  assert.equal(helper.validateUploadFile(file(), 'weird'), '');
});

test('B6-04/05: SVG y HTML rechazados', () => {
  assert.equal(helper.extensionForMime('image/svg+xml'), null);
  assert.equal(helper.extensionForMime('text/html'), null);
  assert.equal(helper.extensionForMime('image/svg+xml', 'contact'), null);
  assert.equal(helper.extensionForMime('text/html', 'contact'), null);
  assert.ok(helper.validateUploadFile(file({ type: 'image/svg+xml' }), 'avatar') !== '');
  assert.ok(helper.validateUploadFile(file({ type: 'text/html' }), 'contact') !== '');
});

test('B6-06/07: oversized avatar y cover rechazados', () => {
  assert.ok(helper.validateUploadFile(file({ size: 2 * 1024 * 1024 + 1 }), 'avatar') !== '');
  assert.ok(helper.validateUploadFile(file({ size: 4 * 1024 * 1024 + 1 }), 'cover') !== '');
  assert.equal(helper.validateUploadFile(file({ size: 2 * 1024 * 1024 }), 'avatar'), '');
});

test('B6-08: original filename no controla profile path', () => {
  const evil = helper.buildProfileObjectPath({ type: 'avatar', userId: 'u1', ext: helper.extensionForMime('image/jpeg') });
  assert.equal(evil, 'avatars/u1/avatar.jpg');
  assert.ok(!evil.includes('../') && !evil.includes('evil'));
  assert.equal(helper.buildProfileObjectPath({ type: 'avatar', userId: '../otro', ext: 'jpg' }), null);
  assert.equal(helper.buildProfileObjectPath({ type: 'avatar', userId: '', ext: 'jpg' }), null);
});

test('B6-09/10: contact usa UUID y filename original no controla path', () => {
  const id = helper.newUploadId();
  assert.ok(typeof id === 'string' && id.length >= 8);
  const built = helper.buildContactObjectPath({ uploadId: id, ext: 'pdf' });
  assert.equal(built, `contact/${id}.pdf`);
  assert.ok(!built.includes('factura') && !built.includes('..'));
});

test('B6-11/12: contact MIME no permitido y oversized rechazados', () => {
  assert.equal(helper.extensionForMime('application/x-msdownload', 'contact'), null);
  assert.equal(helper.extensionForMime('application/pdf', 'contact'), 'pdf');
  assert.ok(helper.validateUploadFile(file({ type: 'application/x-javascript' }), 'contact') !== '');
  assert.ok(helper.validateUploadFile(file({ size: 5 * 1024 * 1024 + 1 }), 'contact') !== '');
  assert.equal(helper.validateUploadFile(file({ type: 'application/pdf', size: 1000 }), 'contact'), '');
});

test('B6-13/14: upsert flags preservados en script.js', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const contactBlock = script.slice(script.indexOf('buildContactObjectPath'), script.indexOf('buildContactObjectPath') + 2000);
  assert.ok(contactBlock.includes('upsert: false'), 'contact sin overwrite');
  const profileBlock = script.slice(script.indexOf('buildProfileObjectPath'), script.indexOf('buildProfileObjectPath') + 2000);
  assert.ok(profileBlock.includes('upsert: true'), 'profile requiere upsert para avatar/cover');
});

test('B6-15: no browser remove/move/copy/list/download en storage', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const callRe = /\.storage\s*\.from\s*\([^)]+\)/g;
  const windows = [];
  let match;
  while ((match = callRe.exec(script)) !== null) {
    windows.push(script.slice(match.index, match.index + 400));
  }
  assert.ok(windows.length >= 4, 'hay llamadas storage para auditar');
  for (const window of windows) {
    assert.ok(!/\.(remove|move|copy|download|list)\(/.test(window), 'sin mutación/listado extra');
    assert.ok(!/createSignedUrl/.test(window), 'sin signed urls en browser');
  }
});

test('B6-16: bucket name centralizado', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const literals = (script.match(/from\("contact-attachments"\)|from\('contact-attachments'\)/g) || []).length;
  assert.equal(literals, 0, 'sin literales; usar STORAGE_BUCKET del helper');
  assert.ok(script.includes('storageHelper.STORAGE_BUCKET'));
  assert.equal(helper.STORAGE_BUCKET, 'contact-attachments');
});

test('B6-17: public/ se regenera por build + helper incluido en páginas', () => {
  for (const page of ['perfil.html', 'checkout.html', 'contacto.html']) {
    const html = fs.readFileSync(path.join(projectRoot, page), 'utf8');
    assert.match(html, /<script src="storage-upload\.js\?v=__ASSET_VERSION__"><\/script>/);
  }
  assert.ok(fs.existsSync(path.join(projectRoot, 'storage-upload.js')));
});
