'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const f = require('./helpers/perrun-production-fixture.cjs');

module.exports = async ({ admin, a, b, check, blockedBy, evidence }) => {
  await admin.query(fs.readFileSync(path.join(__dirname, '../supabase/migrations', f.migration), 'utf8'));
  await f.reset(admin);

  await check('production drafts assign no number before close', async () => {
    const p = await f.paid(admin, { bib: '003' });
    const draft = await f.save(admin, [p.human.id]);
    assert.equal(draft.batch.status, 'draft');
    assert.equal(draft.items[0].production_number, null);
    assert.equal(draft.items[0].snapshot, null);
  });

  await check('production close orders by numeric BIB and freezes snapshots', async () => {
    await f.reset(admin);
    const p1 = await f.paid(admin);
    const p2 = await f.paid(admin);
    const batch = await f.save(admin, [p1.human.id, p2.human.id]);
    const closed = await f.close(admin, batch.batch.id, batch.batch.revision);
    assert.equal(closed.batch.status, 'closed');
    assert.deepEqual(closed.items.map(x => Number(x.production_number)), [1, 2]);
    assert.deepEqual(closed.items.map(x => x.bib_number), ['001', '002']);
    assert.ok(closed.items.every(x => x.snapshot && x.snapshot.schema_version === 1));
    assert.deepEqual(await f.close(admin, batch.batch.id, 0), closed);
  });

  await check('two independent production closes serialize without duplicate numbers', async () => {
    await f.reset(admin);
    const p1 = await f.paid(admin, { bib: '001' });
    const p2 = await f.paid(admin, { bib: '002' });
    const d1 = await f.save(admin, [p1.human.id]);
    const d2 = await f.save(admin, [p2.human.id]);
    await a.query('begin');
    await a.query('select pg_advisory_xact_lock(123456790,hashtext($1))', ['perrun-2027']);
    const waiting = f.close(b, d2.batch.id, d2.batch.revision).then(value => ({ value }), error => ({ error }));
    await blockedBy(evidence.connections.B, evidence.connections.A);
    const one = await f.close(a, d1.batch.id, d1.batch.revision);
    await a.query('commit');
    const two = await waiting;
    if (two.error) throw two.error;
    assert.deepEqual([one.items[0].production_number, two.value.items[0].production_number].sort((x, y) => x - y), [1, 2]);
  });

  await check('close failure rolls back batch and numbers', async () => {
    await f.reset(admin);
    const p1 = await f.paid(admin, { bib: '001' });
    const batch = await f.save(admin, [p1.human.id]);
    await admin.query("create function public.perrun_test_close_failure() returns trigger language plpgsql as $$ begin raise exception 'native close rollback'; end $$");
    await admin.query("create constraint trigger perrun_test_close_failure after update on public.perrun_production_items deferrable initially deferred for each row execute function public.perrun_test_close_failure()");
    await assert.rejects(f.close(admin, batch.batch.id, batch.batch.revision), /native close rollback/);
    await admin.query('drop trigger perrun_test_close_failure on public.perrun_production_items; drop function public.perrun_test_close_failure()');
    const after = await f.read(admin, batch.batch.id);
    assert.equal(after.batch.status, 'draft');
    assert.equal(after.items[0].production_number, null);
  });

  await check('browser roles cannot invoke production RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      await admin.query('set role ' + role);
      try { await assert.rejects(f.save(admin, [], {}), /permission denied|not authorized/i); }
      finally { await admin.query('reset role'); }
    }
  });

  evidence.concurrency.push({ scenario: 'production batches independent close lock', result: 'PASS' });
};
