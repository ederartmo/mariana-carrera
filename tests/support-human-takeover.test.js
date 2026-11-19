'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const sql = name => readFileSync(join(__dirname,'../supabase/migrations',name),'utf8');
const base = '20261117145659_support_phase_one.sql';
const ack = '20261119021334_support_agent_atomic_ack.sql';
const migration = '20261119022000_support_human_takeover.sql';
const actor = 'admin:11111111-1111-4111-8111-111111111111';
const assignee = 'responsible@example.test';

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(sql(base));
  await db.exec(sql(ack));
  return db;
}
const call = async (db, query, args) => (await db.query(query,args)).rows[0].result;
const start = (db, hash) => call(db,"SELECT support_visitor_action('start',$1,$2,'Initial message','general') result",[hash,randomUUID()]);
const read = (db, hash) => call(db,"SELECT support_visitor_action('read',$1) result",[hash]);
const detail = (db, id) => call(db,"SELECT support_admin_detail($1) result",[id]);
const reply = (db, id, version, requestId = randomUUID()) =>
  call(db,"SELECT support_admin_action($1,$2,$3,'reply','Human reply',p_actor=>$4) result",[id,requestId,version,actor]);
const acknowledge = (db, id, msg) =>
  call(db,"SELECT support_agent_acknowledge_first($1,$2,'Automatic acknowledgment',now()-interval '1 hour') result",[id,msg]);
const events = data => data.activity.map(x=>x.action).sort();

test('pending, in-progress and resolved replies preserve assignment and set a durable human pause',async t=>{
 const db=await database(t);
 await db.exec(sql(migration));
 for(const [i,status] of ['pending','in_progress','resolved'].entries()){
  const hash=String(i+1).repeat(64);
  const {ticket}=await start(db,hash);
  await db.query('UPDATE support_tickets SET status=$2,assigned_to=$3 WHERE id=$1',[ticket.id,status,assignee]);
  const id=randomUUID();
  const result=await reply(db,ticket.id,ticket.version,id);
  assert.equal(result.ticket.status,status==='pending'?'in_progress':status);
  assert.equal(result.ticket.assigned_to,assignee);
  assert.equal(result.ticket.version,ticket.version+1);
  assert.ok(result.ticket.automation_paused_at);
  assert.deepEqual(events(result),status==='pending'?['admin_reply','automation_paused','status_changed']:['admin_reply','automation_paused']);
  assert.ok(result.activity.every(event=>event.actor===actor));
  assert.deepEqual(await reply(db,ticket.id,ticket.version,id),result);
  const next=await reply(db,ticket.id,result.ticket.version);
  assert.equal(next.ticket.automation_paused_at,result.ticket.automation_paused_at);
  assert.equal(next.activity.filter(x=>x.action==='automation_paused').length,1);
  const visitor=await read(db,hash);
  assert.equal(visitor.ticket.status,next.ticket.status);
  assert.equal(visitor.messages.filter(m=>m.provenance==='human_operator').length,2);
  assert.equal(visitor.messages.find(m=>m.author==='visitor').provenance,'visitor');
  assert.equal(Object.hasOwn(visitor.ticket,'automation_paused_at'),false);
  assert.equal(Object.hasOwn(visitor,'activity'),false);
 }
});

test('a failed message or audit insert rolls back the request, status, version and pause',async t=>{
 const db=await database(t);
 await db.exec(sql(migration));
 const {ticket}=await start(db,'a'.repeat(64));
 const snapshot=await detail(db,ticket.id);
 const id=randomUUID();
 for(const [table,condition] of [['support_messages',"NEW.author='admin'"],['support_activity',"NEW.action='automation_paused'"]]){
  await db.exec("CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF "+condition+" THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT ON "+table+" FOR EACH ROW EXECUTE FUNCTION fixture_fail();");
  await assert.rejects(reply(db,ticket.id,ticket.version,id),/fixture failure/);
  assert.deepEqual(await detail(db,ticket.id),snapshot);
  assert.equal((await db.query('SELECT count(*) AS n FROM support_requests WHERE request_id=$1',[id])).rows[0].n,0);
  await db.exec('DROP TRIGGER fixture_fail ON '+table+'; DROP FUNCTION fixture_fail()');
 }
 assert.equal((await reply(db,ticket.id,ticket.version,id)).ticket.status,'in_progress');
});

test('legacy rows and replay remain compatible, and the automatic acknowledgment honors the pause',async t=>{
 const db=await database(t);
 const hash='b'.repeat(64);
 const before=await start(db,hash);
 const id=randomUUID();
 await reply(db,before.ticket.id,before.ticket.version,id);
 await db.exec(sql(migration));
 const replay=await reply(db,before.ticket.id,before.ticket.version,id);
 assert.equal(replay.ticket.status,'pending');
 assert.equal(replay.ticket.automation_paused_at,null);
 assert.equal(replay.messages.find(m=>m.author==='admin').provenance,null);
 assert.equal((await acknowledge(db,before.ticket.id,before.messages[0].id)).error,'source_not_eligible');
 assert.deepEqual(await detail(db,before.ticket.id),replay);
 const after=await start(db,'c'.repeat(64));
 assert.equal((await acknowledge(db,after.ticket.id,after.messages[0].id)).status,'created');
 assert.equal((await detail(db,after.ticket.id)).messages.find(m=>m.author==='agent').provenance,'automatic_ack');
 const blocked=await start(db,'d'.repeat(64));
 await db.query('UPDATE support_tickets SET automation_paused_at=now() WHERE id=$1',[blocked.ticket.id]);
 assert.equal((await acknowledge(db,blocked.ticket.id,blocked.messages[0].id)).error,'source_not_eligible');
 const paused=await reply(db,after.ticket.id,3);
 const reopened=await db.query("UPDATE support_tickets SET status='resolved' WHERE id=$1",[after.ticket.id]);
 assert.equal(reopened.affectedRows,1);
 const visitor=await call(db,"SELECT support_visitor_action('send',$1,$2,'Follow-up') result",['c'.repeat(64),randomUUID()]);
 assert.equal(visitor.ticket.status,'pending');
 assert.equal((await detail(db,after.ticket.id)).ticket.automation_paused_at,paused.ticket.automation_paused_at);
 await db.exec('SET ROLE authenticated');
 await assert.rejects(reply(db,blocked.ticket.id,blocked.ticket.version),/permission denied/i);
});

test('simultaneous requests are deduplicated, and a competing operation with the same version conflicts',async t=>{
 const db=await database(t);
 await db.exec(sql(migration));
 const {ticket}=await start(db,'e'.repeat(64));
 const id=randomUUID();
 const results=await Promise.all([reply(db,ticket.id,ticket.version,id),reply(db,ticket.id,ticket.version,id),reply(db,ticket.id,ticket.version)]);
 assert.equal(results.filter(r=>r.ok).length,2);
 assert.equal(results.filter(r=>r.error==='conflict').length,1);
 const stored=await detail(db,ticket.id);
 assert.equal(stored.ticket.version,ticket.version+1);
 assert.equal(stored.messages.filter(m=>m.author==='admin').length,1);
 assert.deepEqual(events(stored),['admin_reply','automation_paused','status_changed']);
});

test('compensating RPC rollback leaves committed pause and provenance intact',async t=>{
 const db=await database(t);
 await db.exec(sql(migration));
 const oldBody=sql(base).match(/CREATE OR REPLACE FUNCTION public\.support_admin_action\([\s\S]+?(?=\r?\n\r?\nREVOKE ALL)/)[0];
 const first=await start(db,'f'.repeat(64));
 const paused=await reply(db,first.ticket.id,first.ticket.version);
 const second=await start(db,'0'.repeat(64));
 await db.exec(oldBody);
 assert.deepEqual(await detail(db,first.ticket.id),paused);
 const oldBehavior=await reply(db,second.ticket.id,second.ticket.version);
 assert.equal(oldBehavior.ticket.status,'pending');
 assert.equal(oldBehavior.ticket.automation_paused_at,null);
 assert.deepEqual(events(oldBehavior),['admin_reply']);
 assert.equal(oldBehavior.messages.find(m=>m.author==='admin').provenance,null);
});
