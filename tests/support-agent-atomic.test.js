'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migrations = path.join(__dirname, '..', 'supabase', 'migrations');

async function database() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const file of [
    '20261117145659_support_phase_one.sql',
    '20261119021334_support_agent_atomic_ack.sql',
  ]) await db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'));
  return db;
}
async function createTicket(db, hash) {
  const rid = '11111111-1111-4111-8111-111111111111';
  const result = await db.query(
    "SELECT support_visitor_action('start',$1,$2,'Consulta inicial','general') AS data", [hash,rid]);
  assert.equal(result.rows[0].data.ok, true);
  return { ticketId:result.rows[0].data.ticket.id, sourceId:result.rows[0].data.messages[0].id };
}
const acknowledge = (db, t, body='Recibimos tu solicitud.') =>
  db.query("SELECT support_agent_acknowledge_first($1,$2,$3,now()-interval '1 hour') AS data",
    [t.ticketId,t.sourceId,body]).then(x=>x.rows[0].data);

test('agent acknowledgment is one atomic ticket-scoped message+audit+link',async()=>{
  const db=await database();
  try {
    const t=await createTicket(db,'a'.repeat(64));
    const result=await acknowledge(db,t);
    assert.equal(result.status,'created');
    const again=await acknowledge(db,t);
    assert.equal(again.status,'already_created');
    assert.equal(again.message_id,result.message_id);
    assert.equal(again.activity_id,result.activity_id);
    const counts=await db.query(`SELECT
      (SELECT count(*) FROM support_messages WHERE ticket_id=$1 AND author='agent') AS messages,
      (SELECT count(*) FROM support_activity WHERE ticket_id=$1 AND action='agent_acknowledged') AS events,
      (SELECT count(*) FROM support_agent_acknowledgments WHERE ticket_id=$1) AS links`,[t.ticketId]);
    assert.deepEqual(counts.rows[0],{messages:1,events:1,links:1});
    const relation=await db.query(`SELECT a.source_message_id,a.message_id,a.activity_id,
      m.author,m.request_id,v.actor,t.status,t.version
      FROM support_agent_acknowledgments a
      JOIN support_messages m ON m.id=a.message_id
      JOIN support_activity v ON v.id=a.activity_id
      JOIN support_tickets t ON t.id=a.ticket_id
      WHERE a.ticket_id=$1`,[t.ticketId]);
    assert.equal(relation.rows[0].source_message_id,t.sourceId);
    assert.equal(relation.rows[0].author,'agent');
    assert.equal(relation.rows[0].actor,'agent:intake-v1');
    assert.equal(relation.rows[0].request_id,t.sourceId);
    assert.equal(relation.rows[0].status,'pending');
    assert.equal(relation.rows[0].version,3);
    const read=await db.query("SELECT support_visitor_action('read',$1) AS data",['a'.repeat(64)]);
    assert.ok(read.rows[0].data.messages.some(m=>m.author==='agent'));
    const denied=await db.query(`SELECT
      has_function_privilege('anon','public.support_agent_acknowledge_first(uuid,uuid,text,timestamptz)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.support_agent_acknowledge_first(uuid,uuid,text,timestamptz)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.support_agent_acknowledge_first(uuid,uuid,text,timestamptz)','EXECUTE') AS service`);
    assert.deepEqual(denied.rows[0],{anon:false,authenticated:false,service:true});
  } finally {await db.close();}
});
test('no double acknowledgment from concurrent retries and different content conflicts',async()=>{
  const db=await database();
  try {
    const t=await createTicket(db,'b'.repeat(64));
    const replies=await Promise.all(Array.from({length:8},()=>acknowledge(db,t)));
    assert.equal(replies.filter(x=>x.status==='created').length,1);
    assert.equal(replies.filter(x=>x.status==='already_created').length,7);
    assert.equal((await acknowledge(db,t,'Texto diferente')).error,'conflict');
    const c=await db.query("SELECT count(*) n FROM support_messages WHERE ticket_id=$1 AND author='agent'",[t.ticketId]);
    assert.equal(c.rows[0].n,1);
  } finally {await db.close();}
});
test('rejects other source, earlier ticket, resolved ticket and manual reply',async()=>{
  const db=await database();
  try {
    const a=await createTicket(db,'c'.repeat(64));
    const b=await createTicket(db,'d'.repeat(64));
    const wrong=await acknowledge(db,{ticketId:a.ticketId,sourceId:b.sourceId});
    assert.equal(wrong.error,'source_not_eligible');
    const old=await db.query("SELECT support_agent_acknowledge_first($1,$2,$3,now()+interval '1 hour') data",[a.ticketId,a.sourceId,'Acknowledged']);
    assert.equal(old.rows[0].data.error,'invalid');
    await db.query("UPDATE support_tickets SET status='resolved' WHERE id=$1",[a.ticketId]);
    assert.equal((await acknowledge(db,a)).error,'source_not_eligible');
    await db.query("INSERT INTO support_messages(ticket_id,author,body,request_id) VALUES ($1,'admin','Atendido',$2)",[b.ticketId,'22222222-2222-4222-8222-222222222222']);
    assert.equal((await acknowledge(db,b)).error,'source_not_eligible');
  } finally {await db.close();}
});
test('failed ledger insert rolls back the message and activity in same transaction',async()=>{
  const db=await database();
  try {
    const t=await createTicket(db,'e'.repeat(64));
    await db.exec(`CREATE FUNCTION public.reject_ack_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture abort'; END $$;
      CREATE TRIGGER reject_ack_test BEFORE INSERT ON public.support_agent_acknowledgments
      FOR EACH ROW EXECUTE FUNCTION public.reject_ack_test();`);
    await assert.rejects(acknowledge(db,t),/fixture abort/);
    const rows=await db.query(`SELECT
      (SELECT count(*) FROM support_messages WHERE ticket_id=$1 AND author='agent') AS messages,
      (SELECT count(*) FROM support_activity WHERE ticket_id=$1 AND action='agent_acknowledged') AS events,
      (SELECT version FROM support_tickets WHERE id=$1) AS version`,[t.ticketId]);
    assert.deepEqual(rows.rows[0],{messages:0,events:0,version:2});
    await db.exec('DROP TRIGGER reject_ack_test ON public.support_agent_acknowledgments;');
    assert.equal((await acknowledge(db,t)).status,'created');
  } finally {await db.close();}
});

test('activation cutoff excludes existing old tickets even if the first visitor message is recent',async()=>{
  const db=await database();
  try {
    const t=await createTicket(db,'f'.repeat(64));
    await db.query("UPDATE support_tickets SET created_at=now()-interval '2 hours' WHERE id=$1",[t.ticketId]);
    const result=await db.query("SELECT support_agent_acknowledge_first($1,$2,$3,now()-interval '1 hour') data",[t.ticketId,t.sourceId,'Confirmación']);
    assert.equal(result.rows[0].data.error,'source_not_eligible');
    const rows=await db.query("SELECT count(*) AS n FROM support_messages WHERE ticket_id=$1 AND author='agent'",[t.ticketId]);
    assert.equal(rows.rows[0].n,0);
  } finally {await db.close();}
});
