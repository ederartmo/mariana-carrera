const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { sendOnce, TICKET } = require('../scripts/support-notification-one-shot');

const fixtureTime = '2026-11-18T20:00:00.000Z';
const options = { now: () => Date.parse(fixtureTime), expires: Date.parse(fixtureTime) + 60000, key: 'fixture-only', from: 'test@example.test' };
const other = '11111111-1111-4111-8111-111111111111';
const migration = name => readFileSync(join(__dirname, '..', 'supabase', 'migrations', name), 'utf8');

test('concurrent callers and ambiguous provider failure consume one permanent fence', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(migration('20261117145659_support_phase_one.sql'));
    await db.exec(migration('20261118192617_support_internal_notifications.sql'));
    await db.query("INSERT INTO public.support_conversations(id,capability_hash) VALUES ($1,repeat('a',64)),($2,repeat('b',64))",[other,TICKET]);
    await db.query("INSERT INTO public.support_tickets(id,conversation_id,category,created_at) VALUES ($1,$1,'general',$3),($2,$2,'general',$3)",[other,TICKET,fixtureTime]);
    await db.exec('SET ROLE service_role');
    let posts = 0;
    const deps = {
      ...options,
      fetcher: async (url, req) => {
        assert.equal(url, 'https://api.resend.com/emails');
        assert.equal(req.redirect, 'error');
        const payload = JSON.parse(req.body);
        assert.deepEqual(payload.to, ['soporte@kinetichub.com.mx']);
        assert.match(payload.subject, /C1AF3583/);
        posts++;
        throw new Error('ambiguous provider timeout');
      },
      lookup: async id => { assert.equal(id, TICKET); return {id, status:'pending', created_at:fixtureTime}; },
      reserve: async row => {
        const result = await db.query(
          'INSERT INTO public.support_notification_jobs(ticket_id,kind,source_id,occurred_at,state,attempts) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (kind,source_id) DO NOTHING RETURNING id',
          [row.ticket_id,row.kind,row.source_id,row.occurred_at,row.state,row.attempts]);
        return result.rows[0]?.id;
      },
      accepted: async () => assert.fail('ambiguous acceptance must not be marked sent')
    };
    await db.query("INSERT INTO public.support_notification_jobs(ticket_id,kind,source_id,occurred_at) VALUES ($1,'new',$1,$2)",[other,fixtureTime]);
    const outcomes = await Promise.all(Array.from({length:12}, () => sendOnce(deps)));
    assert.equal(posts, 1);
    assert.equal(outcomes.filter(x=>x === 'provider_unconfirmed').length, 1);
    assert.equal(await sendOnce(deps), 'already_reserved');
    assert.deepEqual((await db.query('SELECT ticket_id,state,attempts FROM public.support_notification_jobs ORDER BY ticket_id')).rows,
      [{ticket_id:other,state:'pending',attempts:0},{ticket_id:TICKET,state:'stopped',attempts:1}]);
  } finally { await db.close(); }
});

test('expiry and uncertain or missing reservation prevent every POST', async () => {
  const base = {...options, lookup:async()=>({id:TICKET,status:'pending',created_at:fixtureTime}), fetcher:async()=>assert.fail('POST attempted')};
  assert.equal(await sendOnce({...base,expires:options.now(),lookup:async()=>assert.fail('DB called')}), 'expired');
  await assert.rejects(sendOnce({...base,reserve:async()=>{throw Error('commit unknown');}}), /commit unknown/);
  let elapsed = options.now();
  assert.equal(await sendOnce({...base,now:()=>elapsed,reserve:async()=>{elapsed=options.expires;return TICKET;}}), 'expired_after_reservation');
  assert.equal(await sendOnce({...base,lookup:async()=>({id:other,status:'pending'}),reserve:async()=>assert.fail('reserved')}), 'ticket_not_pending');
});

test('accepted provider response marks only the reserved job', async () => {
  const job = '22222222-2222-4222-8222-222222222222';
  assert.equal(await sendOnce({...options,lookup:async()=>({id:TICKET,status:'pending',created_at:fixtureTime}),reserve:async()=>job,
    fetcher:async(_, req)=>{assert.equal(req.headers['Idempotency-Key'],'support-notification/'+job);return {ok:true};},
    accepted:async id=>assert.equal(id,job)}),'provider_accepted');
});

test('server entry requires an explicit command, exact project, disabled worker and a short deadline', () => {
  const { settings } = require('../scripts/support-notification-one-shot');
  const env = {SUPABASE_URL:'https://uycwzhlcnfijjyzkgkem.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',RESEND_API_KEY:'fixture',
    SUPPORT_NOTIFICATION_FROM:'test@example.test',SUPPORT_NOTIFICATIONS_ENABLED:'false',SUPPORT_NOTIFICATION_TEST_EXPIRES_AT:'2026-11-18T20:01:00.000Z'};
  const args = ['--send-once'];
  const now = options.now;
  settings(args, env, now);
  for (const [name,value] of Object.entries({SUPABASE_URL:'https://other.supabase.co',SUPPORT_NOTIFICATIONS_ENABLED:'true',SUPPORT_NOTIFICATION_TEST_EXPIRES_AT:'2026-11-18T20:15:00.000Z'})) {
    assert.throws(()=>settings(args,{...env,[name]:value},now));
  }
  assert.throws(()=>settings([...args,other],env,now));
});
