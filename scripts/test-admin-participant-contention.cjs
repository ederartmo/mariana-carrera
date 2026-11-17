// Run with: node scripts/test-admin-participant-contention.cjs [repository-path]
// Requires the existing postgres:17.11-bookworm Docker image; never pulls images.
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repository = path.resolve(process.argv[2] || process.cwd());
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-participant-contention-'));
const dockerConfig = path.join(artifacts, 'docker-config');
fs.mkdirSync(dockerConfig);
const container = `admin-participant-contention-${randomUUID()}`;
const processTimeout = 40000;
const records = [];
const sessions = [];
const participantId = '11111111-1111-4111-8111-111111111111';
const expected = {
  fullName: 'Runner Original', shirtSize: 'M', birthDate: '1990-04-11',
  whatsapp: '+525512345678', state: 'Jalisco', borough: null, distance: '5K',
};
const psqlArguments = [
  'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
];

function record(value) {
  records.push(value);
  console.log(JSON.stringify(value));
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(records, null, 2));
}

function docker(args, input) {
  return new Promise((resolve) => {
    const child = execFile('docker', ['--config', dockerConfig, ...args], {
      timeout: processTimeout, killSignal: 'SIGKILL', maxBuffer: 2e6,
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code || 1) : 0, stdout, stderr });
    });
    // A failed launch or early psql exit may close stdin before the write completes.
    child.stdin.on('error', () => {});
    if (input !== undefined) child.stdin.end(input);
  });
}

async function sql(query) {
  const result = await docker(psqlArguments, query);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createSession(label) {
  const child = spawn('docker', ['--config', dockerConfig, ...psqlArguments], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = { child, label, stdout: '', stderr: '', code: null, closed: false };
  const timer = setTimeout(() => {
    session.stderr += '\nDocker session exceeded its timeout';
    child.kill('SIGKILL');
  }, processTimeout);
  child.stdout.on('data', (chunk) => { session.stdout += chunk; });
  child.stderr.on('data', (chunk) => { session.stderr += chunk; });
  child.on('error', (error) => { session.stderr += error.message; });
  child.stdin.on('error', (error) => { session.stderr += error.message; });
  session.done = new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      session.closed = true;
      session.code = code;
      resolve(session);
    });
  });
  session.send = (query) => {
    assert.equal(session.closed, false, session.stderr);
    child.stdin.write(`${query}\n`);
  };
  sessions.push(session);
  return session;
}

async function openSession(label) {
  const session = createSession(label);
  session.send(`SET application_name='${label}'; SET statement_timeout='20s';
    SELECT 'PID:' || pg_backend_pid();`);
  await until(() => {
    assert.equal(session.closed, false, session.stderr);
    return session.stdout.includes('PID:');
  }, label);
  session.pid = Number(session.stdout.match(/PID:(\d+)/)[1]);
  return session;
}

function jsonArgument(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function rpc(fullName) {
  const changes = { full_name: fullName, shirt_size: 'L', distance: '10K' };
  return `SELECT admin_update_participant_change(
    '${participantId}', 'runner@example.com', 'cascanueces-run',
    ${jsonArgument(expected)}, ${jsonArgument(changes)}, 'admin@example.com');`;
}

function loadFixture() {
  const source = fs.readFileSync(path.join(repository, 'tests/admin-participant-changes.test.js'), 'utf8');
  const match = source.match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(match, 'Synthetic fixture was not found in the existing participant tests');
  const fixture = match[1].replaceAll('${participantId}', participantId);
  assert.ok(fixture.includes('INSERT INTO'), 'Synthetic fixture insert was not found');
  return { fixture, insert: fixture.slice(fixture.indexOf('INSERT INTO')) };
}

async function state() {
  return JSON.parse(await sql(`SELECT json_build_object(
    'row', (SELECT row_to_json(i) FROM inscripciones i),
    'audit', (SELECT coalesce(json_agg(a ORDER BY id), '[]')
      FROM admin_participant_change_audit a));`));
}

async function reset(insert) {
  await sql(`TRUNCATE inscripciones, admin_participant_change_audit RESTART IDENTITY; ${insert}`);
}

async function contention(insert, kind, finish = 'COMMIT') {
  await reset(insert);
  const before = await state();
  const editorA = await openSession(`${kind}_a`);
  const editorB = await openSession(`${kind}_b`);
  assert.notEqual(editorA.pid, editorB.pid);

  const firstOperation = kind === 'edit'
    ? rpc('First Editor')
    : "UPDATE inscripciones SET registration_status='cancelled';";
  editorA.send(`BEGIN; SELECT id FROM inscripciones FOR UPDATE;
    ${firstOperation} SELECT 'HOLD_READY';`);
  await until(() => {
    assert.equal(editorA.closed, false, editorA.stderr);
    return editorA.stdout.includes('HOLD_READY');
  }, 'editor A holding the row lock');

  editorB.send(`SET ROLE service_role; ${rpc('Second Editor')}`);
  editorB.child.stdin.end();
  // Observe a real wait and its blocker, rather than assuming a sleep proves contention.
  const lock = await until(async () => {
    const rows = JSON.parse(await sql(`SELECT coalesce(json_agg(json_build_object(
      'pid', pid, 'wait_event_type', wait_event_type, 'wait_event', wait_event,
      'blockers', pg_blocking_pids(pid))), '[]') FROM pg_stat_activity
      WHERE pid=${editorB.pid} AND wait_event_type='Lock'
        AND ${editorA.pid}=ANY(pg_blocking_pids(pid));`));
    return rows[0];
  }, 'editor B blocked by editor A');

  editorA.send(`${finish}; SELECT 'RELEASED';`);
  editorA.child.stdin.end();
  await Promise.all([editorA.done, editorB.done]);
  assert.equal(editorA.code, 0, editorA.stderr);
  const after = await state();
  if (finish === 'COMMIT') {
    assert.equal(editorB.code, 3, editorB.stderr);
    assert.match(editorB.stderr, kind === 'edit'
      ? /40001: registration changed/ : /22023: cancelled registrations/);
    assert.deepEqual(after.row, {
      ...before.row,
      ...(kind === 'edit'
        ? { full_name: 'First Editor', shirt_size: 'L', distance: '10K' }
        : { registration_status: 'cancelled' }),
    });
    assert.equal(after.audit.length, kind === 'edit' ? 1 : 0);
    if (kind === 'edit') {
      assert.equal(after.audit[0].inscription_id, participantId);
      assert.deepEqual(after.audit[0].changed_fields, ['full_name', 'shirt_size', 'distance']);
      assert.deepEqual(after.audit[0].before, {
        fullName: 'Runner Original', shirtSize: 'M', distance: '5K',
      });
      assert.deepEqual(after.audit[0].after, {
        fullName: 'First Editor', shirtSize: 'L', distance: '10K',
      });
    }
  } else {
    assert.equal(editorB.code, 0, editorB.stderr);
    assert.deepEqual(after.row, {
      ...before.row, full_name: 'Second Editor', shirt_size: 'L', distance: '10K',
    });
    assert.equal(after.audit.length, 1);
  }
  record({
    scenario: `${kind}_${finish}`, pidA: editorA.pid, pidB: editorB.pid, lock,
    exitA: editorA.code, exitB: editorB.code, error: editorB.stderr.trim(),
    row: after.row, auditCount: after.audit.length, allAssertionsPassed: true,
  });
}

async function main() {
  let creationAttempted = false;
  try {
    const { fixture, insert } = loadFixture();
    creationAttempted = true;
    const launched = await docker([
      'run', '--detach', '--name', container, '--network', 'none', '--pull', 'never', '--rm',
      '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17.11-bookworm',
    ]);
    assert.equal(launched.code, 0, launched.stderr);
    await until(async () => {
      // The entrypoint briefly runs an initialization server before its final exec.
      const result = await docker([
        'exec', container, 'sh', '-c',
        'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres',
      ]);
      return result.code === 0;
    }, 'PostgreSQL readiness');
    record({ container, artifacts, version: await sql('SELECT version();') });
    const migration = (name) => fs.readFileSync(path.join(repository, 'supabase/migrations', name), 'utf8');
    await sql(fixture
      + migration('20261110090000_admin_participant_changes.sql')
      + migration('20261115020000_admin_participant_cancellation_guard.sql'));
    await contention(insert, 'edit');
    await contention(insert, 'cancel');
    await contention(insert, 'cancel', 'ROLLBACK');

    await reset(insert);
    const before = await state();
    for (const role of ['anon', 'authenticated']) {
      const result = await docker(psqlArguments, `SET ROLE ${role}; ${rpc('Forbidden')}`);
      assert.equal(result.code, 3, result.stderr);
      assert.match(result.stderr, /42501: permission denied for function/);
      assert.deepEqual(await state(), before);
      record({ scenario: `grant_${role}`, exit: result.code, error: result.stderr.trim(), unchanged: true });
    }
    record({ result: 'PASS', scenarios: 5 });
  } catch (error) {
    record({ result: 'FAIL', error: error.stack });
    process.exitCode = 1;
  } finally {
    for (const session of sessions) {
      if (!session.closed) session.child.kill('SIGKILL');
    }
    await Promise.all(sessions.map((session) => session.done));
    if (creationAttempted) {
      // Only this run's random name is ever targeted, including ambiguous launch failures.
      const stopped = await docker(['stop', '--time', '1', container]);
      const inspected = await docker(['inspect', container]);
      const absent = inspected.code !== 0 && /no such (object|container)/i.test(inspected.stderr);
      record({ cleanup: { stopExit: stopped.code, inspectExit: inspected.code, absent } });
      if (!absent) process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
