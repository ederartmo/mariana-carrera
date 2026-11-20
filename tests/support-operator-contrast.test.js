const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('standalone operator page opts into an isolated readable dark admin theme', () => {
  const root = join(__dirname, '..');
  const html = readFileSync(join(root, 'soporte.html'), 'utf8');
  const css = readFileSync(join(root, 'support.css'), 'utf8');
  assert.match(html, /<body class="support-operator-page">/);
  assert.match(html, /href="support\.css\?v=__ASSET_VERSION__"/);
  assert.match(css, /\.support-operator-page \.support-admin-panel\s*\{/);
  assert.match(css, /\.support-operator-page \.support-admin-panel \.admin-card-header h2/);
  assert.match(css, /\.support-operator-page \.support-admin-panel \.support-admin-controls label/);
  assert.match(css, /\.support-operator-page :is\(a,button,select,textarea,summary\):focus-visible/);
  assert.match(css, /\.support-operator-page \.support-admin-panel \[hidden\]/);
  assert.doesNotMatch(html, /ADMIN_EMAILS|SUPPORT_OPERATOR_EMAILS|data-support-test-email/);
});

test('served operator artifacts retain the theme hook and reply contrast correction', () => {
  const root = join(__dirname, '..');
  const html = readFileSync(join(root, 'public', 'soporte.html'), 'utf8');
  const css = readFileSync(join(root, 'public', 'support.css'), 'utf8');
  assert.match(html, /<body class="support-operator-page">/);
  assert.equal(css, readFileSync(join(root, 'support.css'), 'utf8'));
  assert.match(css, /\.support-operator-page \.support-admin-panel \.support-ticket-compose button\s*\{\s*background:#087454;/);
});
