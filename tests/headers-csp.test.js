// tests/headers-csp.test.js - Batch 8: headers base + CSP report-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');

function loadVercelConfig() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
}

function globalHeaders() {
  const config = loadVercelConfig();
  const entry = (config.headers || []).find((h) => h.source === '/(.*)');
  assert.ok(entry, 'existen headers globales');
  const map = {};
  for (const h of entry.headers) map[h.key] = h.value;
  return { config, map };
}

test('B8-rewrites: rewrites existentes preservados', () => {
  const { config } = globalHeaders();
  assert.equal(config.buildCommand, 'node build.js');
  assert.equal(config.outputDirectory, 'public');
  const sources = (config.rewrites || []).map((r) => r.source);
  assert.ok(sources.includes('/api/me/registrations'));
  assert.ok(sources.includes('/api/admin-list-inscriptions'));
  assert.ok(sources.includes('/api/resend-emails-list'));
});

test('B8-headers: base de seguridad', () => {
  const { map } = globalHeaders();
  assert.equal(map['X-Content-Type-Options'], 'nosniff');
  assert.equal(map['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(map['X-Frame-Options'], 'DENY');
  assert.ok(map['Permissions-Policy'].includes('camera=()'));
  assert.ok(map['Permissions-Policy'].includes('microphone=()'));
  assert.ok(map['Permissions-Policy'].includes('geolocation=()'));
  assert.equal(map['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
  assert.ok(!('Cross-Origin-Embedder-Policy' in map), 'sin COEP global');
});

test('B8-hsts: max-age sin preload ni subdominios', () => {
  const { map } = globalHeaders();
  assert.equal(map['Strict-Transport-Security'], 'max-age=31536000');
  assert.ok(!map['Strict-Transport-Security'].includes('preload'));
  assert.ok(!map['Strict-Transport-Security'].includes('includeSubDomains'));
});

function reportOnlyPolicy() {
  const { map } = globalHeaders();
  const policy = map['Content-Security-Policy-Report-Only'];
  assert.ok(policy, 'existe CSP report-only');
  return policy;
}

test('B8-csp: report-only, sin enforced', () => {
  const { map } = globalHeaders();
  reportOnlyPolicy();
  assert.ok(!('Content-Security-Policy' in map), 'sin CSP enforced todavía');
});

test('B8-csp: directivas base estrictas', () => {
  const policy = reportOnlyPolicy();
  assert.ok(policy.includes("default-src 'self'"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("base-uri 'self'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("form-action 'self'"));
  assert.ok(policy.includes('upgrade-insecure-requests'));
});

test('B8-csp: sin comodines ni eval', () => {
  const policy = reportOnlyPolicy();
  assert.ok(!/(^|[\s;])\*(;|$)/.test(policy), 'sin wildcard *');
  const wildcards = policy.match(/\*\.[\w.-]+/g) || [];
  assert.deepEqual(wildcards, ['*.supabase.co'], 'único wildcard: subdominio supabase auditado');
  assert.ok(!/(^|[\s;])https:(;|$|\s)/.test(policy), 'sin esquema https: abierto como source');
  assert.ok(!policy.includes('unsafe-eval'), 'sin unsafe-eval');
});

test('B8-csp: orígenes auditados presentes', () => {
  const policy = reportOnlyPolicy();
  assert.ok(policy.includes('https://uycwzhlcnfijjyzkgkem.supabase.co'), 'Supabase API');
  assert.ok(policy.includes('https://connect.facebook.net'), 'Meta Pixel');
  assert.ok(policy.includes('https://cdn.jsdelivr.net'), 'Supabase SDK');
  assert.ok(policy.includes('https://unpkg.com'), 'Lucide en 3 páginas');
  assert.ok(policy.includes('https://fonts.googleapis.com'), 'fuentes');
  assert.ok(policy.includes('https://images.unsplash.com'), 'imágenes');
});

test('B8-csp: sin ruido report-only ni tooling de Preview', () => {
  const policy = reportOnlyPolicy();
  assert.ok(!policy.includes('upgrade-insecure-requests'), 'deferido hasta enforced');
  assert.ok(!policy.includes('vercel.live'), 'Preview tooling nunca allowlisteado');
  // Orígenes requeridos intactos.
  assert.ok(policy.includes('https://cdn.jsdelivr.net'));
  assert.ok(policy.includes('https://unpkg.com'));
  assert.ok(policy.includes('https://connect.facebook.net'));
  assert.ok(policy.includes('https://fonts.googleapis.com'));
  assert.ok(policy.includes('https://images.unsplash.com'));
  assert.ok(policy.includes('https://iframe.videodelivery.net'));
});

test('B8-csp: audit doc existe con blockers', () => {
  const doc = fs.readFileSync(path.join(projectRoot, 'desc', 'batch8-csp-audit.md'), 'utf8');
  assert.ok(doc.includes('iframe.videodelivery.net'), 'documenta hallazgo videodelivery');
  assert.ok(doc.includes('unsafe-inline'), 'documenta blockers inline');
});
