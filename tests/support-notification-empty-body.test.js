'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../lib/support-notifications-worker');

const secret = 's'.repeat(48);
const env = {
  SUPPORT_NOTIFICATION_WORKER_SECRET: secret,
  SUPPORT_NOTIFICATION_TO: 'support@example.test',
  SUPPORT_NOTIFICATION_FROM: 'notify@example.test',
  SUPPORT_NOTIFICATION_START_AT: '2026-11-18T22:08:36.258Z',
  SUPPORT_NOTIFICATIONS_ENABLED: 'true',
  RESEND_API_KEY: 'fixture-only',
  SITE_URL: 'https://kinetichub.com.mx',
};
function response() {
  return {statusCode:200,body:null,headers:{},
    setHeader(k,v){this.headers[k]=v;return this;},
    status(n){this.statusCode=n;return this;},
    json(data){this.body=data;return this;}
  };
}
function request(body, query = {}, headers = {}) {
  return {method:'POST',body,query,headers:{authorization:'Bearer '+secret,...headers}};
}
function deps(calls) {
  return {env,rpc:async(name)=>{calls.push(name);return {data:[]};}};
}
test('accepts actual empty POST and Vercel-normalized zero-length body', async()=>{
  for(const body of [undefined,null,'',{}]){
    const calls=[];
    const res=response();
    await handler(request(body),res,deps(calls));
    assert.equal(res.statusCode,200);
    assert.deepEqual(res.body,{ok:true,sent:0,retry:0,permanent:0});
    assert.deepEqual(calls,['support_claim_notification_jobs']);
  }
});
test('still rejects supplied payloads and extra query before database work',async()=>{
  for(const [body,query] of [
    [{action:'send'},{}], ['{}',{}], [' ',{}], [[],{}], [[1],{}], [0,{}], [{},{extra:'yes'}]
  ]){
    const calls=[];
    const res=response();
    await handler(request(body,query),res,deps(calls));
    assert.equal(res.statusCode,400);
    assert.deepEqual(calls,[]);
  }
});
test('empty object does not weaken worker authentication or enabled flag',async()=>{
  const calls=[];
  let res=response();
  await handler(request({}, {}, {authorization:'Bearer invalid'}),res,deps(calls));
  assert.equal(res.statusCode,401);
  res=response();
  await handler(request({}),res,{...deps(calls),env:{...env,SUPPORT_NOTIFICATIONS_ENABLED:'false'}});
  assert.equal(res.statusCode,503);
  assert.deepEqual(calls,[]);
});
