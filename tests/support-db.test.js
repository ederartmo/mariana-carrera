const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('support migration creates private service-role RPC surface', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
    const file = fs.readdirSync(path.join(__dirname, '../supabase/migrations')).find((name) => name.endsWith('_support_phase_one.sql'));
    assert.ok(file, 'generated support migration exists');
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'));
    const tables = await db.query(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'support_%' ORDER BY tablename`);
    assert.deepEqual(tables.rows.map((r) => r.tablename), ['support_activity', 'support_conversations', 'support_messages', 'support_requests', 'support_tickets']);
    assert.ok(tables.rows.every((r) => r.rowsecurity));
    const grants = await db.query(`SELECT has_table_privilege('anon','public.support_tickets','SELECT') AS anon_read, has_table_privilege('service_role','public.support_tickets','SELECT') AS service_read`);
    assert.equal(grants.rows[0].anon_read, false);
    assert.equal(grants.rows[0].service_read, true);
    const functions = await db.query(`SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname LIKE 'support_%'`);
    assert.ok(functions.rows.some((r) => r.proname === 'support_visitor_action'));
    assert.ok(functions.rows.some((r) => r.proname === 'support_admin_action'));
    const functionGrants = await db.query(`SELECT has_function_privilege('anon','public.support_visitor_action(text,text,uuid,text,text,uuid)','EXECUTE') AS anon_exec, has_function_privilege('service_role','public.support_visitor_action(text,text,uuid,text,text,uuid)','EXECUTE') AS service_exec`);
    assert.equal(functionGrants.rows[0].anon_exec, false);
    assert.equal(functionGrants.rows[0].service_exec, true);

    await db.exec("INSERT INTO support_conversations(capability_hash) SELECT lpad(to_hex(n),64,'0') FROM generate_series(1,125) n; INSERT INTO support_tickets(conversation_id,category) SELECT id,'events' FROM support_conversations;");
    const firstPage = (await db.query("SELECT support_admin_list(50,'pending','events',NULL,NULL,NULL) result")).rows[0].result;
    assert.equal(firstPage.tickets.length,50);
    let ids = firstPage.tickets.map(t=>t.id), cursor=firstPage.nextCursor;
    while(cursor && ids.length<200) {
      const page=(await db.query("SELECT support_admin_list(50,'pending','events',NULL,$1,$2) result",[cursor.createdAt,cursor.id])).rows[0].result;
      ids.push(...page.tickets.map(t=>t.id)); cursor=page.nextCursor;
    }
    assert.equal(ids.length,125);
    assert.equal(new Set(ids).size,125);
    assert.equal(cursor,null);
    await db.query("UPDATE support_tickets SET status='resolved', assigned_to='one@example.test' WHERE id=$1",[ids[115]]);
    const filtered=(await db.query("SELECT support_admin_list(50,'resolved','events','one@example.test') result")).rows[0].result;
    assert.deepEqual(filtered.tickets.map(x=>x.id),[ids[115]]);
    const unassigned=(await db.query("SELECT support_admin_list(50,'resolved','events','') result")).rows[0].result;
    assert.equal(unassigned.tickets.length,0);
    const access=(await db.query("SELECT has_function_privilege('authenticated','public.support_admin_list(integer,text,text,text,timestamptz,uuid)','EXECUTE') client, has_function_privilege('service_role','public.support_admin_list(integer,text,text,text,timestamptz,uuid)','EXECUTE') server")).rows[0];
    assert.deepEqual(access,{client:false,server:true});
    const hash = 'b'.repeat(64);
    const first = await db.query(`SELECT support_visitor_action('start',$1,$2,'Need help','general') AS result`, [hash, '11111111-1111-4111-8111-111111111111']);
    assert.equal(first.rows[0].result.ok, true);
    assert.equal(first.rows[0].result.ticket.version, 2);
    const ticketId = first.rows[0].result.ticket.id;
    const replay = await db.query(`SELECT support_visitor_action('start',$1,$2,'Need help','general') AS result`, [hash, '11111111-1111-4111-8111-111111111111']);
    assert.equal(replay.rows[0].result.messages.length, 1);
    const changed = await db.query(`SELECT support_visitor_action('start',$1,$2,'Changed','general') AS result`, [hash, '11111111-1111-4111-8111-111111111111']);
    assert.equal(changed.rows[0].result.error, 'conflict');
    const updateArgs = [ticketId, '22222222-2222-4222-8222-222222222222', 2, 'update', null, 'in_progress', null, null, false, 'admin@example.test'];
    const update = await db.query(`SELECT support_admin_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`, updateArgs);
    assert.equal(update.rows[0].result.ticket.status, 'in_progress');
    assert.equal(update.rows[0].result.ticket.version, 3);
    const adminReplay = await db.query(`SELECT support_admin_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`, updateArgs);
    assert.equal(adminReplay.rows[0].result.ticket.version, 3);
    const stale = await db.query(`SELECT support_admin_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`, [ticketId, '33333333-3333-4333-8333-333333333333', 2, 'update', null, 'resolved', null, null, false, 'admin@example.test']);
    assert.equal(stale.rows[0].result.error, 'conflict');
    const visitor = await db.query("SELECT support_visitor_action('read',$1) AS result", [hash]);
    assert.equal(Object.hasOwn(visitor.rows[0].result.ticket, 'assigned_to'), false);
    const unknown = await db.query("SELECT support_visitor_action('read',$1) AS result", ['c'.repeat(64)]);
    assert.equal(unknown.rows[0].result.error, 'not_found');
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const h = 'd'.repeat(64);
    const owned = await db.query("SELECT support_visitor_action('start',$1,$2,'Private','general',$3) result", [h, '44444444-4444-4444-8444-444444444444', owner]);
    assert.equal(owned.rows[0].result.ok,true);
    for(const who of [other,null,owner]) {
      const read = await db.query("SELECT support_visitor_action('read',$1,NULL,NULL,NULL,$2) result",[h,who]);
      assert.equal(read.rows[0].result.ok ?? false, who === owner);
    }
    const verify = await db.query(`SELECT status,version FROM support_tickets WHERE id=$1`, [ticketId]);
    assert.deepEqual(verify.rows[0], { status: 'in_progress', version: 3 });
    const assignment = [ticketId,'55555555-5555-4555-8555-555555555555',3,'update',null,'resolved',null,'other@example.test',true,'admin@example.test'];
    const assigned = await db.query('SELECT support_admin_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',assignment);
    assert.equal(assigned.rows[0].result.ticket.assigned_to,'other@example.test');
    assert.equal(assigned.rows[0].result.ticket.status,'resolved');
    assert.ok(assigned.rows[0].result.activity.some(x=>x.action==='assigned'));
    const readAfterAssignment = await db.query("SELECT support_visitor_action('read',$1) result",[hash]);
    assert.equal(JSON.stringify(readAfterAssignment.rows[0].result).includes('other@example.test'),false);

  } finally { await db.close(); }
});
