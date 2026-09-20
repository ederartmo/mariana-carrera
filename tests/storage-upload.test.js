// tests/storage-upload.test.js - Batch 6 (rev): buckets separados.
// Unit tests del helper puro + estructurales de script.js/HTMLs. Sin subidas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const helper = require('../storage-upload');

const file = (overrides = {}) => ({ name: 'foto.jpg', type: 'image/jpeg', size: 1000, ...overrides });

test('B6-profile-bucket: perfil usa contact-attachments', () => {
  assert.equal(helper.PROFILE_MEDIA_BUCKET, 'contact-attachments');
  assert.equal(
    helper.buildProfileObjectPath({ type: 'avatar', userId: 'uid-123_ABC', ext: 'jpg' }),
    'avatars/uid-123_ABC/avatar.jpg'
  );
  assert.equal(
    helper.buildProfileObjectPath({ type: 'cover', userId: 'uid-123_ABC', ext: 'webp' }),
    'covers/uid-123_ABC/cover.webp'
  );
});

test('B6-contact-bucket: contacto usa contact-private', () => {
  assert.equal(helper.CONTACT_PRIVATE_BUCKET, 'contact-private');
  assert.notEqual(helper.CONTACT_PRIVATE_BUCKET, helper.PROFILE_MEDIA_BUCKET);
});

test('B6-contact-path: UUID y filename sin control', () => {
  const id = helper.newUploadId();
  assert.ok(typeof id === 'string' && id.length >= 8);
  const built = helper.buildContactObjectPath({ uploadId: id, ext: 'pdf' });
  assert.equal(built, `contact/${id}.pdf`);
  assert.ok(!built.includes('factura') && !built.includes('..'));
});

test('B6-randomness: UUID seguro sin generadores débiles', () => {
  const raw = fs.readFileSync(path.join(projectRoot, 'storage-upload.js'), 'utf8');
  const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('Math.random'), 'sin Math.random en código');
  assert.ok(!code.includes('Date.now()'), 'sin Date.now() en código');
  assert.ok(code.includes('crypto.randomUUID'), 'usa randomUUID');
  assert.ok(code.includes('getRandomValues'), 'fallback getRandomValues');
  const id = helper.newUploadId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('B6-contact-mime: solo jpg/png/webp/pdf', () => {
  assert.equal(helper.extensionForMime('application/pdf', 'contact'), 'pdf');
  assert.equal(helper.extensionForMime('image/svg+xml', 'contact'), null);
  assert.equal(helper.extensionForMime('text/html', 'contact'), null);
  assert.equal(helper.extensionForMime('application/x-msdownload', 'contact'), null);
  assert.ok(helper.validateUploadFile(file({ type: 'application/pdf', size: 1000 }), 'contact') === '');
  assert.ok(helper.validateUploadFile(file({ size: 5 * 1024 * 1024 + 1 }), 'contact') !== '');
});

test('B6-profile-mime: solo imágenes, type enum, oversized', () => {
  assert.equal(helper.normalizeProfileMediaType('contact'), null);
  assert.equal(helper.normalizeProfileMediaType('../../etc'), null);
  assert.equal(helper.extensionForMime('image/svg+xml'), null);
  assert.ok(helper.validateUploadFile(file({ size: 2 * 1024 * 1024 + 1 }), 'avatar') !== '');
  assert.ok(helper.validateUploadFile(file({ size: 4 * 1024 * 1024 + 1 }), 'cover') !== '');
  assert.equal(helper.buildProfileObjectPath({ type: 'avatar', userId: '../otro', ext: 'jpg' }), null);
});

test('B6-script: contacto a bucket privado con attachment_path', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  assert.ok(script.includes('CONTACT_PRIVATE_BUCKET'), 'usa bucket privado');
  assert.ok(script.includes('attachment_path: attachmentPath'), 'envía path, no URL');
  assert.ok(!script.includes('attachment_url: attachmentUrl'), 'ya no envía URL pública');
});

test('B6-script: perfil a bucket público propio con upsert', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  assert.ok(script.includes('PROFILE_MEDIA_BUCKET'), 'usa bucket de perfil');
  const start = script.indexOf('buildProfileObjectPath');
  assert.ok(script.slice(start, start + 2000).includes('upsert: true'), 'profile upsert preserved');
  const contactStart = script.indexOf('buildContactObjectPath');
  assert.ok(script.slice(contactStart, contactStart + 2000).includes('upsert: false'), 'contact sin overwrite');
});

test('B6-noremove: no browser remove/move/copy/list/download en storage', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const callRe = /\.storage\s*\.from\s*\([^)]+\)/g;
  const windows = [];
  let match;
  while ((match = callRe.exec(script)) !== null) {
    windows.push(script.slice(match.index, match.index + 400));
  }
  assert.ok(windows.length >= 3, 'hay llamadas storage para auditar (2 upload + 1 getPublicUrl de perfil)');
  for (const window of windows) {
    assert.ok(!/\.(remove|move|copy|download|list)\(/.test(window), 'sin mutación/listado extra');
    assert.ok(!/createSignedUrl/.test(window), 'sin signed urls en browser');
  }
});

test('B6-html: helper incluido en perfil/checkout/contacto + regen', () => {
  for (const page of ['perfil.html', 'checkout.html', 'contacto.html']) {
    const html = fs.readFileSync(path.join(projectRoot, page), 'utf8');
    assert.match(html, /<script src="storage-upload\.js\?v=__ASSET_VERSION__"><\/script>/);
  }
  assert.ok(fs.existsSync(path.join(projectRoot, 'storage-upload.js')));
});
