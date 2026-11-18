const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const file=name=>readFileSync(path.join(__dirname,'../supabase/migrations/',name),'utf8');

test('queue is derived once per pending event and stale leases cannot acknowledge',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(file('20261117145659_support_phase_one.sql'));
  const sql=file('20261118192617_support_internal_notifications.sql');
  await db.exec(sql);
  const A='a'.repeat(64), fingerprint='b'.repeat(64), since='2026-11-18T00:00:00Z';
  const start='SELECT public.support_visitor_action($1,$2,$3,$4,$5) result';
  const call=async(query,params)=> (await db.query(query,params)).rows;
  const claim=() =>call('SELECT * FROM public.support_claim_notification_jobs($1,$2)',[since,fingerprint]);
  const done=(job,outcome)=>call('SELECT public.support_finish_notification_job($1,$2,$3) result',[job.id,job.lease_token,outcome]);
  const [[initial]]=[await call(start,['start',A,'11111111-1111-4111-8111-111111111111','fixture start','general'])];
  const ticket=initial.result.ticket.id;
  await db.query("UPDATE support_tickets SET created_at='2026-11-18T18:00:00Z',updated_at=now() WHERE id=$1",[ticket]);
  const [one]=await claim();
  assert.equal(one.kind,'new');assert.equal(one.ticket_id,ticket);assert.deepEqual(await claim(),[]);
  assert.equal((await done(one,'retry'))[0].result,true);
  assert.deepEqual(await claim(),[]);
  await db.query("UPDATE support_notification_jobs SET next_attempt_at=now() WHERE id=$1",[one.id]);
  const [retried]=await claim(); assert.equal(retried.id,one.id);assert.notEqual(retried.lease_token,one.lease_token);
  assert.equal((await done(one,'sent'))[0].result,false);
  assert.equal((await done(retried,'sent'))[0].result,true);
  await call(start,['send',A,'22222222-2222-4222-8222-222222222222','ordinary message',null]);
  await call(start,['read',A,null,null,null]);
  assert.deepEqual(await claim(),[]);
  await db.query("UPDATE support_tickets SET status='resolved' WHERE id=$1",[ticket]);
  const reopenArgs=['send',A,'33333333-3333-4333-8333-333333333333','visitor reopened',null];
  const reopened=await call(start,reopenArgs);
  assert.equal(reopened[0].result.ticket.status,'pending');
  await call(start,reopenArgs);
  const [two]=await claim();assert.equal(two.kind,'reopened');assert.notEqual(two.id,one.id);assert.deepEqual(await claim(),[]);
  await db.query("UPDATE support_notification_jobs SET first_attempt_at=now()-interval '24 hours',lease_until=now()-interval '1 second' WHERE id=$1",[two.id]);
  assert.deepEqual(await claim(),[]);
  const [job]=await call('SELECT state FROM support_notification_jobs WHERE id=$1',[two.id]);
  assert.equal(job.state,'stopped');
  const [auth]=await call("SELECT has_function_privilege('anon','public.support_claim_notification_jobs(timestamptz,text)','execute') anon,has_function_privilege('authenticated','public.support_finish_notification_job(uuid,uuid,text)','execute') authenticated,has_function_privilege('service_role','public.support_claim_notification_jobs(timestamptz,text)','execute') service",[]);
  assert.deepEqual(auth,{anon:false,authenticated:false,service:true});
  // Existing chat writes do not call or depend on the optional delivery queue.
  await db.exec('DROP TABLE public.support_notification_jobs');
  const after=await call(start,['send',A,'44444444-4444-4444-8444-444444444444','saved without queue',null]);
  assert.ok(after[0].result.messages.some(m=>m.body==='saved without queue'));
 }finally{await db.close();}
});
