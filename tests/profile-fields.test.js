// tests/profile-fields.test.js - Batch 5: allowlist de escritura user_profiles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const { PROFILE_WRITABLE_FIELDS, pickProfileWritableFields } = require('../profile-fields');

const SENSITIVE = [
  'bib_number',
  'payment_status',
  'amount_paid',
  'stripe_session_id',
  'order_session_id',
  'payment_intent_id',
  'stripe_event_id',
  'event_slug',
  'distance',
  'ticket_index',
  'ticket_count',
];

test('B5-1: allowlist acepta campos legítimos de perfil', () => {
  const input = {
    user_id: 'u1',
    email: 'a@example.com',
    first_name: 'Ana',
    last_name: 'Pérez',
    maternal_last_name: 'López',
    full_name: 'Ana Pérez López',
    birth_date: '1990-05-14',
    gender: 'mujer',
    phone: '5512345678',
    weight_kg: 60,
    height_cm: 165,
    country: 'mx',
    state: 'Jalisco',
    avatar_url: 'https://x/y.webp',
    cover_url: 'https://x/z.webp',
    cover_position_y: 12,
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.deepEqual(pickProfileWritableFields(input), input);
});

for (const field of SENSITIVE) {
  test(`B5-descarta campo sensible: ${field}`, () => {
    const out = pickProfileWritableFields({ first_name: 'Ana', [field]: 'VALOR' });
    assert.deepEqual(out, { first_name: 'Ana' });
  });
}

test('B5-8: unknown_field descartado', () => {
  assert.deepEqual(pickProfileWritableFields({ first_name: 'Ana', unknown_field: 1, isAdmin: true }), { first_name: 'Ana' });
});

test('B5-9: user_id de input no sobrevive al patrón de sesión', () => {
  const sessionId = 'uid-sesion-real';
  const row = {
    ...pickProfileWritableFields({ user_id: 'uid-atacante', first_name: 'Ana' }),
    user_id: sessionId,
    email: 'a@example.com',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.equal(row.user_id, sessionId);
});

test('B5-10: contacto de emergencia se preserva', () => {
  const out = pickProfileWritableFields({
    emergency_name: 'Mamá',
    emergency_phone: '5512345678',
    emergency_relation: 'madre',
    emergency_email: 'mama@example.com',
  });
  assert.equal(out.emergency_name, 'Mamá');
  assert.equal(out.emergency_phone, '5512345678');
  assert.equal(out.emergency_relation, 'madre');
  assert.equal(out.emergency_email, 'mama@example.com');
});

test('B5-11/12/13: avatar_url, cover_url y cover_position_y se preservan', () => {
  const out = pickProfileWritableFields({
    avatar_url: 'https://x/a.webp',
    cover_url: 'https://x/c.webp',
    cover_position_y: 42,
  });
  assert.equal(out.avatar_url, 'https://x/a.webp');
  assert.equal(out.cover_url, 'https://x/c.webp');
  assert.equal(out.cover_position_y, 42);
});

test('B5-14: el dorsal sigue viniendo de /api/me/registrations', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  assert.ok(script.includes('fetchMyRegistrations'), 'perfil usa API para carreras');
  const meRegistrations = fs.readFileSync(path.join(projectRoot, 'lib', 'me-registrations.js'), 'utf8');
  assert.ok(meRegistrations.includes('bib_number'), 'la API expone el dorsal oficial');
});

test('B5-15: ningún upsert vivo a user_profiles escribe bib_number', () => {
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
  // Todos los upsert a PROFILE_TABLE pasan por buildProfileRow (allowlist).
  const upsertSites = [];
  let index = script.indexOf('from(PROFILE_TABLE).upsert');
  while (index !== -1) {
    upsertSites.push(index);
    index = script.indexOf('from(PROFILE_TABLE).upsert', index + 1);
  }
  assert.equal(upsertSites.length, 4);
  for (const site of upsertSites) {
    const window = script.slice(Math.max(0, site - 600), site);
    assert.ok(window.includes('buildProfileRow'), 'upsert precedido por buildProfileRow');
    assert.ok(!window.includes('bib_number'), 'sin bib_number cerca del upsert');
  }
  // El picker se aplica en los 4 sitios a través de buildProfileRow.
  assert.ok(script.includes('pickProfileWritableFields'));
  assert.ok(script.includes('window.KineticHubProfileFields'));
});

test('B5-helper: perfil.html y checkout.html cargan profile-fields.js', () => {
  for (const page of ['perfil.html', 'checkout.html']) {
    const html = fs.readFileSync(path.join(projectRoot, page), 'utf8');
    assert.match(html, /<script src="profile-fields\.js\?v=__ASSET_VERSION__"><\/script>/);
  }
});
