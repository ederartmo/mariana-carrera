// tests/storage-upload.test.js - Batch 6 (rev): buckets separados + signed uploads.
// Unit tests del helper puro + estructurales de script.js/HTMLs. Sin subidas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const helper = require('../storage-upload');

const file = (overrides = {}) => ({ name: 'foto.jpg', type: 'image/jpeg', size: 1000, ...overrides });

test('B6-buckets: perfil público vs contacto privado separados', () => {
  assert.equal(helper.PROFILE_MEDIA_BUCKET, 'contact-attachments');
  assert.equal(helper.CONTACT_PRIVATE_BUCKET, 'contact-private');
  assert.notEqual(helper.CONTACT_PRIVATE_BUCKET, helper.PROFILE_MEDIA_BUCKET);
  assert.equal(
    helper.buildProfileObjectPath({ type: 'avatar', userId: 'uid-123_ABC', ext: 'jpg' }),
    'avatars/uid-123_ABC/avatar.jpg'
  );
});

test('B6-contact-flow: frontend pide upload firmado, no sube directo', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  assert.ok(script.includes("action: \"create_attachment_upload\""), 'pide upload firmado');
  assert.ok(script.includes('uploadToSignedUrl'), 'usa upload firmado');
  assert.ok(script.includes('attachment_path: attachmentPath'), 'envía path, no URL');
  assert.ok(!script.includes('attachment_url: attachmentUrl'), 'ya no envía URL pública');
});

test('B6-contact-path: browser no controla el path', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  assert.ok(!script.includes('buildContactObjectPath'), 'sin builder de contact en frontend');
  assert.ok(!script.includes('newUploadId'), 'UUID solo server-side');
});

test('B6-no-direct-upload-private: sin .upload() a contact-private', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const callRe = /\.storage\s*\.from\s*\([^)]+\)/g;
  const windows = [];
  let match;
  while ((match = callRe.exec(script)) !== null) {
    windows.push(script.slice(match.index, match.index + 400));
  }
  assert.ok(windows.length >= 3, 'hay llamadas storage para auditar');
  let directUploads = 0;
  let signedUploads = 0;
  for (const window of windows) {
    if (/\.upload\(/.test(window)) {
      directUploads += 1;
      assert.ok(!window.includes('CONTACT_PRIVATE_BUCKET'), 'directo solo a perfil');
    }
    if (window.includes('uploadToSignedUrl')) {
      signedUploads += 1;
      assert.ok(window.includes('CONTACT_PRIVATE_BUCKET'), 'firmado solo a privado');
    }
    assert.ok(!/\.(remove|move|copy|download|list)\(/.test(window), 'sin mutación/listado extra');
    assert.ok(!/createSignedUrl/.test(window), 'sin signed urls en browser');
  }
  assert.ok(directUploads >= 1, 'profile conserva upload directo');
  assert.ok(signedUploads >= 1, 'contact usa upload firmado');
});

test('B6-contact-mime: solo jpg/png/webp/pdf y límites', () => {
  assert.equal(helper.extensionForMime('application/pdf', 'contact'), 'pdf');
  assert.equal(helper.extensionForMime('image/svg+xml', 'contact'), null);
  assert.equal(helper.extensionForMime('text/html', 'contact'), null);
  assert.equal(helper.extensionForMime('application/x-msdownload', 'contact'), null);
  assert.ok(helper.validateUploadFile(file({ type: 'application/pdf', size: 1000 }), 'contact') === '');
  assert.ok(helper.validateUploadFile(file({ size: 5 * 1024 * 1024 + 1 }), 'contact') !== '');
});

test('B6-profile-mime: solo imágenes, type enum, oversized, traversal', () => {
  assert.equal(helper.normalizeProfileMediaType('contact'), null);
  assert.equal(helper.normalizeProfileMediaType('../../etc'), null);
  assert.equal(helper.extensionForMime('image/svg+xml'), null);
  assert.ok(helper.validateUploadFile(file({ size: 2 * 1024 * 1024 + 1 }), 'avatar') !== '');
  assert.ok(helper.validateUploadFile(file({ size: 4 * 1024 * 1024 + 1 }), 'cover') !== '');
  assert.equal(helper.buildProfileObjectPath({ type: 'avatar', userId: '../otro', ext: 'jpg' }), null);
  assert.ok(helper.validateUploadFile(file({ type: 'text/html' }), 'avatar') !== '');
});

test('B6-randomness: sin generadores débiles en helper', () => {
  const raw = fs.readFileSync(path.join(projectRoot, 'storage-upload.js'), 'utf8');
  const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('Math.random'), 'sin Math.random en código');
  assert.ok(!code.includes('Date.now()'), 'sin Date.now() en código');
});

test('B6-profile-upsert: upsert=true propio preservado', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  const start = script.indexOf('buildProfileObjectPath');
  assert.ok(script.slice(start, start + 2000).includes('upsert: true'), 'profile upsert preserved');
});

test('B6-html: helper incluido en perfil/checkout/contacto + regen', () => {
  for (const page of ['perfil.html', 'checkout.html', 'contacto.html']) {
    const html = fs.readFileSync(path.join(projectRoot, page), 'utf8');
    assert.match(html, /<script src="storage-upload\.js\?v=__ASSET_VERSION__"><\/script>/);
  }
  assert.ok(fs.existsSync(path.join(projectRoot, 'storage-upload.js')));
});

test('B6-sql: drops de las 7 policies legacy', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc', 'sql-batch6-storage-hardening.sql'), 'utf8');
  for (const name of [
    'authenticated delete own avatars covers',
    'Allow public upload contact attachments',
    'authenticated upload own avatars covers',
    'contact_attachments_insert_anon',
    'contact_attachments_select_anon',
    'public read avatars covers',
    'authenticated update own avatars covers',
  ]) {
    const plain = `drop policy if exists ${name} on storage.objects;`;
    const quoted = `drop policy if exists "${name}" on storage.objects;`;
    assert.ok(sql.includes(plain) || sql.includes(quoted), `DROP ${name}`);
  }
});

test('B6-sql: sin DML a buckets ni INSERT anon en contact-private', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc', 'sql-batch6-storage-hardening.sql'), 'utf8');
  const executable = sql.split('\n').filter((line) => !line.trim().startsWith('--'));
  const body = executable.join('\n');
  assert.ok(!/insert\s+into\s+storage\.buckets/i.test(body), 'sin INSERT a buckets');
  assert.ok(!/update\s+storage\.buckets/i.test(body), 'sin UPDATE a buckets');
  assert.ok(!/contact-private[^;]*for\s+insert\s+to\s+(anon|authenticated)/i.test(body), 'sin INSERT anon/auth en privado');
});

test('B6-sql-select-exacto: sin paths cruzados avatar/cover', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc', 'sql-batch6-storage-hardening.sql'), 'utf8');
  const selectBlock = sql.slice(sql.indexOf('storage_profile_select_own'));
  assert.ok(selectBlock.includes("/avatar\\.(jpg|png|webp)$"), 'avatar exacto');
  assert.ok(selectBlock.includes("/cover\\.(jpg|png|webp)$"), 'cover exacto');
  assert.ok(!selectBlock.includes('(avatar|cover)'), 'sin alternancia cruzada');
});

test('B6-sql: profile con filename exacto + ALTER contact_messages', () => {
  const sql = fs.readFileSync(path.join(projectRoot, 'desc', 'sql-batch6-storage-hardening.sql'), 'utf8');
  assert.ok(sql.includes('/avatar\\.(jpg|png|webp)$'), 'regex exacta avatar');
  assert.ok(sql.includes('/cover\\.(jpg|png|webp)$'), 'regex exacta cover');
  assert.ok(!/create policy\s+\S+\s+on\s+storage\.objects\s+for\s+select\s+to\s+public/i.test(sql), 'sin SELECT público');
  assert.ok(/add column if not exists attachment_path/i.test(sql), 'ALTER propuesto');
});
