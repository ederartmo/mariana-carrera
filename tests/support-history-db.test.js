const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const migration = name => readFileSync(require('node:path').join(__dirname, '../supabase/migrations/', name), 'utf8');

test('history paginates 151 tied timestamps and never resolves a foreign cursor or account', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(migration('20261117145659_support_phase_one.sql'));
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const hash = 'a'.repeat(64);
    const guest = 'b'.repeat(64);
    const ids = await db.query(`WITH c AS (
      INSERT INTO support_conversations(capability_hash,owner_user_id) VALUES ($1,$3),($2,NULL) RETURNING id
    ) INSERT INTO support_tickets(conversation_id,category) SELECT id,'general' FROM c RETURNING id`, [hash,guest,owner]);
    const [ticket, guestTicket] = ids.rows.map(r => r.id);
    await db.query(`INSERT INTO support_messages(ticket_id,author,body,request_id,created_at)
      SELECT $1,'visitor',n::text,gen_random_uuid(),'2026-11-18T00:00:00Z' FROM generate_series(1,151) n`,[ticket]);
    const otherMessage = (await db.query("INSERT INTO support_messages(ticket_id,author,body,request_id) VALUES ($1,'visitor','guest',gen_random_uuid()) RETURNING id",[guestTicket])).rows[0].id;
    const expected = (await db.query('SELECT id FROM support_messages WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC',[ticket])).rows.map(x=>x.id);
    await db.exec(migration('20261118160000_support_message_history.sql'));
    const call = async (sql,args) => (await db.query(sql,args)).rows[0].result;
    const visitor = 'SELECT public.support_visitor_message_history($1,$2,$3) result';
    const admin = 'SELECT public.support_admin_message_history($1,$2) result';
    for(const args of [[hash,other,null],[hash,null,null],[guest,owner,null],[hash,owner,otherMessage],[hash,owner,other]]) assert.deepEqual(await call(visitor,args),{error:'not_found'});
    assert.deepEqual(await call(admin,[ticket,otherMessage]),{error:'not_found'});
    assert.equal((await call(visitor,[guest,null,null])).messages[0].id,otherMessage);
    const found = []; let before = null;
    for(const size of [50,50,50,1]){
      const page=await call(visitor,[hash,owner,before]);
      assert.equal(page.messages.length,size);
      found.push(...page.messages.slice().reverse().map(m=>m.id));
      before=page.nextCursor;
    }
    assert.deepEqual(found,expected);
    assert.equal(before,null);
    assert.deepEqual(await call(admin,[ticket,null]), await call(visitor,[hash,owner,null]));
    for(const signature of ['support_visitor_message_history(text,uuid,uuid)','support_admin_message_history(uuid,uuid)']){
      const p=(await db.query(`SELECT has_function_privilege('anon',$1,'execute') anon, has_function_privilege('authenticated',$1,'execute') authenticated, has_function_privilege('service_role',$1,'execute') service`,[signature])).rows[0];
      assert.deepEqual(p,{anon:false,authenticated:false,service:true});
    }
    const unchanged=(await db.query('SELECT id FROM support_messages WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC',[ticket])).rows.map(x=>x.id);
    assert.deepEqual(unchanged,expected);
    await db.query('DELETE FROM support_messages WHERE ticket_id=$1 AND id NOT IN (SELECT id FROM support_messages WHERE ticket_id=$1 LIMIT 50)',[ticket]);
    const exact = await call(admin,[ticket,null]);
    assert.equal(exact.messages.length,50);
    assert.equal(exact.nextCursor,null);
    await db.query('DELETE FROM support_messages WHERE ticket_id=$1',[ticket]);
    assert.deepEqual(await call(admin,[ticket,null]),{ok:true,messages:[],nextCursor:null});
  } finally { await db.close(); }
});
