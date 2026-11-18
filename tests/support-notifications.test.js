const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../lib/support-notifications-worker');
const token='fixture-worker-token-123456789abcdef';
const config={SUPPORT_NOTIFICATIONS_ENABLED:'true',SUPPORT_NOTIFICATION_WORKER_SECRET:token,
  SUPPORT_NOTIFICATION_TO:'admin@example.test',SUPPORT_NOTIFICATION_FROM:'Support <sender@example.test>',
  SUPPORT_NOTIFICATION_START_AT:'2026-11-18T18:00:00Z',SITE_URL:'https://example.test',RESEND_API_KEY:'fixture'};
const response=()=>({status(n){this.statusCode=n;return this},json(body){this.body=body;return this},setHeader(){},end(){}});
const request=(authorization='Bearer '+token)=>({method:'POST',headers:{authorization},query:{},body:null});
const job={id:'11111111-1111-4111-8111-111111111111',ticket_id:'22222222-2222-4222-8222-222222222222',
  lease_token:'33333333-3333-4333-8333-333333333333',kind:'reopened',occurred_at:'2026-11-18T18:30:00Z',
  body:'private message must never appear',email:'private@example.test'};
test('worker fails closed on missing configuration, auth or injected recipient',async()=>{
 for(const [req,env,status] of [[request('Bearer incorrect'),config,401],[request(),{},503],[{...request(),body:{to:'attacker@example.test'}},config,400]]){
  const res=response();await handler(req,res,{env,rpc:()=>assert.fail('queue touched'),fetch:()=>assert.fail('Resend contacted')});
  assert.equal(res.statusCode,status);
 }
});
test('Resend retries reuse the event key, keep private data out and do not produce a reply-to',async()=>{
 const sent=[],outcomes=[];
 const rpc=async(name,args)=>name==='support_claim_notification_jobs'?{data:[job]}:(outcomes.push(args.p_outcome),{data:true});
 const fetch=async(url,opt)=>{sent.push({url,opt});return sent.length===1?{ok:false,status:503}:{ok:true,status:200}};
 for(let i=0;i<2;i++){const res=response();await handler(request(),res,{env:config,rpc,fetch});assert.equal(res.statusCode,200);}
 assert.deepEqual(outcomes,['retry','sent']);
 const [one,two]=sent;
 assert.equal(one.opt.headers['Idempotency-Key'],two.opt.headers['Idempotency-Key']);
 assert.equal(one.opt.body,two.opt.body);
 const message=JSON.parse(one.opt.body);
 assert.deepEqual(message.to,['admin@example.test']);
 assert.match(message.text,/22222222/);assert.match(message.text,/Reabierto/);assert.match(message.text,/Pendiente/);
 assert.match(message.text,/https:\/\/example\.test\/admin-inscripciones\.html/);
 assert.doesNotMatch(JSON.stringify(message),/private|33333333|reply_to|access_token/);
});

test('provider network failure is retryable, permanent rejection stops, empty polling sends nothing',async()=>{
 const statuses=[];
 for(const [jobs,fetcher] of [
  [[job],async()=>{throw Error('fixture timeout')}],
  [[job],async()=>({ok:false,status:400})],
  [[],async()=>assert.fail('nothing to send')],
 ]){
  const rpc=async(name,args)=>name==='support_claim_notification_jobs'?{data:jobs}:(statuses.push(args.p_outcome),{data:true});
  const res=response();await handler(request(),res,{env:config,rpc,fetch:fetcher});
  assert.equal(res.statusCode,200);
 }
 assert.deepEqual(statuses,['retry','permanent']);
});

test('failed database acknowledgement cannot claim delivery success',async()=>{
 const res=response();
 await handler(request(),res,{env:config,
   rpc:async name=>name==='support_claim_notification_jobs'?{data:[job]}:{error:{code:'transient'}},
   fetch:async()=>({ok:true,status:200}),
 });
 assert.equal(res.statusCode,503);
 assert.deepEqual(res.body,{ok:false});
});
