const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const migrations = fs.readdirSync(path.join(__dirname, '../supabase/migrations'))
  .filter((name) => name.endsWith('_admin_participant_changes.sql'));
const migrationPath = migrations.length ? path.join(__dirname, '../supabase/migrations', migrations[0]) : null;
const participantId = '11111111-1111-4111-8111-111111111111';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE inscripciones (
      id uuid NOT NULL, email text NOT NULL, event_slug text NOT NULL,
      payment_status text NOT NULL, full_name text NOT NULL, shirt_size text NOT NULL,
      distance text, birth_date date, whatsapp text, state text, borough text,
      bib_number text, buyer_email text, order_session_id text, amount_paid integer,
      payment_intent_id text, stripe_event_id text,
      PRIMARY KEY (id, email)
    );
    INSERT INTO inscripciones VALUES (
      '${participantId}', 'runner@example.com', 'cascanueces-run', 'paid', 'Runner Original', 'M', '5K',
      '1990-04-11', '+525512345678', 'Jalisco', NULL, '520', 'buyer@example.com', 'cs_order', 550, 'pi_keep', 'evt_keep'
    );
  `);
  if (!migrationPath) throw new Error('admin participant changes migration is missing');
  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  return db;
}

const args = (overrides = {}) => ({
  p_id: participantId, p_email: 'runner@example.com', p_event_slug: 'cascanueces-run',
  p_expected: { fullName: 'Runner Original', shirtSize: 'M', birthDate: '1990-04-11', whatsapp: '+525512345678', state: 'Jalisco', borough: null, distance: '5K' },
  p_changes: { full_name: 'Runner Updated', shirt_size: 'L', distance: '10K' },
  p_admin_email: 'admin@example.com', ...overrides,
});

test('atomic admin participant changes validate, audit, and preserve protected payment fields', async () => {
  const db = await fixture();
  const result = await db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6) AS result', Object.values(args()));
  assert.equal(result.rows[0].result.inscription.full_name, 'Runner Updated');
  assert.deepEqual(result.rows[0].result.audit.changed_fields.sort(), ['distance', 'full_name', 'shirt_size']);
  const row = (await db.query('SELECT * FROM inscripciones')).rows[0];
  for (const field of ['bib_number', 'buyer_email', 'payment_status', 'order_session_id', 'amount_paid', 'payment_intent_id', 'stripe_event_id']) {
    assert.equal(row[field], ({ bib_number: '520', buyer_email: 'buyer@example.com', payment_status: 'paid', order_session_id: 'cs_order', amount_paid: 550, payment_intent_id: 'pi_keep', stripe_event_id: 'evt_keep' })[field]);
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_participant_change_audit')).rows[0].n, 1);
  await db.close();
});

test('stale expected snapshot and unsupported distance leave row and audit unchanged', async () => {
  const db = await fixture();
  await assert.rejects(db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6)', Object.values(args({
    p_expected: { fullName: 'Stale Name', shirtSize: 'M', birthDate: '1990-04-11', whatsapp: '+525512345678', state: 'Jalisco', borough: null, distance: '5K' },
  }))), /stale|changed/i);
  await assert.rejects(db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6)', Object.values(args({
    p_changes: { full_name: 'Runner Updated', shirt_size: 'L', distance: '42K' },
  }))), /distance/i);
  const row = (await db.query('SELECT full_name, shirt_size, distance FROM inscripciones')).rows[0];
  assert.deepEqual(row, { full_name: 'Runner Original', shirt_size: 'M', distance: '5K' });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_participant_change_audit')).rows[0].n, 0);
  await db.close();
});

test('audit failure rolls back the participant update and RPC is service_role only', async () => {
  const db = await fixture();
  await db.exec(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
    CREATE TRIGGER fail_audit_before_insert BEFORE INSERT ON admin_participant_change_audit FOR EACH ROW EXECUTE FUNCTION fail_audit();`);
  await assert.rejects(db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6)', Object.values(args())), /audit unavailable/);
  const row = (await db.query('SELECT full_name, shirt_size, distance FROM inscripciones')).rows[0];
  assert.deepEqual(row, { full_name: 'Runner Original', shirt_size: 'M', distance: '5K' });
  const grants = await db.query(`SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name='admin_update_participant_change'`);
  assert.ok(grants.rows.some((r) => r.grantee === 'service_role'));
  assert.ok(!grants.rows.some((r) => ['anon', 'authenticated', 'PUBLIC'].includes(r.grantee)));
  await db.close();
});

test('repeated identical change is idempotent and concurrent stale edit loses safely', async () => {
  const db = await fixture();
  const run = (changes) => db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6)', Object.values(args({ p_changes: changes })));
  await run({ full_name: 'Runner Original', shirt_size: 'M', distance: '5K' });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_participant_change_audit')).rows[0].n, 0);
  const [first, second] = await Promise.all([
    run({ full_name: 'First Editor', shirt_size: 'M', distance: '5K' }),
    run({ full_name: 'Second Editor', shirt_size: 'M', distance: '5K' }),
  ].map((promise) => promise.then((value) => ({ value }), (error) => ({ error }))));
  assert.equal([first, second].filter((result) => result.value).length, 1);
  assert.equal([first, second].filter((result) => result.error).length, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_participant_change_audit')).rows[0].n, 1);
  await db.close();
});

test('legacy NULL distance is preserved for name edits and can be explicitly assigned', async () => {
  const db = await fixture();
  try {
    await db.exec('UPDATE inscripciones SET distance = NULL');
    const expected = { ...args().p_expected, distance: null };
    const original = (await db.query('SELECT * FROM inscripciones')).rows;
    await assert.rejects(db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6)', Object.values(args({ p_expected: expected, p_changes: { distance: null } }))), /distance/i);
    assert.deepEqual((await db.query('SELECT * FROM inscripciones')).rows, original);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_participant_change_audit')).rows[0].n, 0);
    const result = await db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6) AS result', Object.values(args({ p_expected: expected, p_changes: { full_name: 'Corrected Name' } })));
    assert.equal(result.rows[0].result.inscription.distance, null);
    assert.deepEqual(result.rows[0].result.audit.changed_fields, ['full_name']);
    const next = await db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6) AS result', Object.values(args({ p_expected: { ...expected, fullName: 'Corrected Name' }, p_changes: { distance: '10K' } })));
    assert.equal(next.rows[0].result.inscription.distance, '10K');
    const assigned = (await db.query('SELECT * FROM inscripciones')).rows;
    await assert.rejects(db.query('SELECT admin_update_participant_change($1,$2,$3,$4,$5,$6)', Object.values(args({ p_expected: { ...expected, fullName: 'Corrected Name', distance: '10K' }, p_changes: { distance: null } }))), /distance/i);
    assert.deepEqual((await db.query('SELECT * FROM inscripciones')).rows, assigned);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_participant_change_audit')).rows[0].n, 2);
  } finally { await db.close(); }
});
