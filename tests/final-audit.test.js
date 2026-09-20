// tests/final-audit.test.js - Batch 10: invariantes de cierre Hardening v1.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const readSource = (p) => fs.readFileSync(path.join(projectRoot, p), 'utf8');

function frontendFiles() {
  return fs.readdirSync(projectRoot)
    .filter((f) => f.endsWith('.html') || (f.endsWith('.js') && !['build.js'].includes(f)));
}

test('B10-boundary: cero lecturas browser a inscripciones', () => {
  for (const file of frontendFiles()) {
    if (file.startsWith('public')) continue;
    const source = readSource(file);
    assert.ok(!/\.from\(["']inscripciones["']\)/.test(source), `${file} sin SELECT directo`);
  }
});

test('B10-boundary: sin service_role ni bib writes en browser', () => {
  for (const file of frontendFiles()) {
    const source = readSource(file);
    assert.ok(!source.includes('service_role') && !source.includes('SERVICE_ROLE'), `${file} sin service_role`);
  }
  const script = readSource('script.js');
  assert.ok(!/upsert\([^)]*bib_number/.test(script), 'sin bib en upserts');
});

test('B10-auth: admin server-side autoritativo, sin flags browser', () => {
  const admin = readSource('admin-inscripciones.html');
  assert.ok(!admin.includes('isAdmin = true') && !admin.includes('window.isAdmin'), 'sin flag admin browser');
  for (const file of ['api/admin-delete-inscription.js', 'api/admin-manual-transfer.js', 'api/admin-update-participant.js', 'api/admin-update-inscription-email.js', 'api/resend-confirmations.js', 'api/resend-single-confirmation.js', 'lib/resend-emails-list.js']) {
    assert.ok(readSource(file).includes('getAdminUser(req)'), `${file} usa auth central`);
  }
});

test('B10-api: checkout-summary con claim, webhook con firma y sin limiter', () => {
  assert.ok(readSource('api/checkout-summary.js').includes('verifyCheckoutSummaryClaim'), 'claim exigido');
  const webhook = readSource('api/stripe-webhook.js');
  assert.ok(webhook.includes('constructEvent'), 'firma verificada');
  assert.ok(!webhook.includes('_rate-limit'), 'webhook sin rate limit');
  for (const scope of ['contact-upload-ip', 'contact-submit-ip', 'contact-submit-email', 'promo-ip', 'checkout-ip']) {
    const hits = ['api/contact-notify.js', 'api/validate-promo-code.js', 'api/create-checkout-session.js']
      .filter((f) => readSource(f).includes(`'${scope}'`));
    assert.ok(hits.length >= 1, `scope ${scope} cableado`);
  }
});

test('B10-storage: privado sin getPublicUrl ni URLs persistidas', () => {
  const script = readSource('script.js');
  assert.ok(!script.includes('getPublicUrl(contactPath') && !script.includes('attachment_url: attachmentUrl'), 'contact sin URL pública');
  const notify = readSource('api/contact-notify.js');
  assert.ok(notify.includes("createSignedUploadUrl"), 'upload firmado server-side');
  assert.ok(notify.includes('attachment_url: null'), 'URL legacy en null');
});

test('B10-headers: CSP sigue report-only', () => {
  const config = JSON.parse(readSource('vercel.json'));
  const headers = config.headers.find((h) => h.source === '/(.*)').headers;
  const map = Object.fromEntries(headers.map((h) => [h.key, h.value]));
  assert.ok(map['Content-Security-Policy-Report-Only'], 'report-only presente');
  assert.ok(!('Content-Security-Policy' in map), 'sin enforced');
  assert.equal(map['X-Frame-Options'], 'DENY');
});

test('B10-functions: api/*.js <= 12', () => {
  const files = fs.readdirSync(path.join(projectRoot, 'api')).filter((f) => f.endsWith('.js'));
  assert.ok(files.length <= 12, `api/*.js = ${files.length}`);
});

test('B10-docs: artefactos de cierre existen', () => {
  for (const doc of ['desc/security-hardening-v1-final.md', 'desc/sql-final-security-verification.sql', 'desc/batch8-csp-audit.md', 'desc/batch9-runtime-audit.md']) {
    assert.ok(fs.existsSync(path.join(projectRoot, doc)), doc);
  }
});
