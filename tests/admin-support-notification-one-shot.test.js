'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../lib/admin-support-notification-one-shot');
const EXPIRES = '2030-01-01T00:03:00.000Z';
const NOW = Date.parse('2030-01-01T00:00:00.000Z');
const env = {
  VERCEL_ENV:'production',
  SUPPORT_NOTIFICATIONS_ENABLED:'false',
  SUPABASE_URL:'https://uycwzhlcnfijjyzkgkem.supabase.co',
  SUPPORT_NOTIFICATION_TEST_EXPIRES_AT:EXPIRES
};
function response() {
  return { statusCode:200, body:null, setHeader(){return this;}, status(n){this.statusCode=n;return this;}, json(v){this.body=v;return this;} };
}
function request(overrides={}) {
  return {method:'POST',query:{},body:undefined,headers:{
    host:'kinetichub.com.mx',origin:'https://kinetichub.com.mx'
  },...overrides};
}
test('handler fails closed without short lived Production-only flag',async()=>{
  let called=0;
  const deps={now:()=>NOW,auth:async()=>{called++;return {email:'admin@example.test'};},run:async()=>{called++;return 'provider_accepted';}};
  for(const [key,value] of [
    ['VERCEL_ENV','preview'],['SUPPORT_NOTIFICATIONS_ENABLED','true'],
    ['SUPABASE_URL','https://other.example.test'],
    ['SUPPORT_NOTIFICATION_TEST_EXPIRES_AT','2029-12-31T23:59:59.000Z'],
    ['SUPPORT_NOTIFICATION_TEST_EXPIRES_AT','2030-01-01T00:11:00.000Z']
  ]) {
    const res=response();
    await handler(request(),res,{...deps,env:{...env,[key]:value}});
    assert.equal(res.statusCode,503);
  }
  assert.equal(called,0);
});
test('reject bad origins, arbitrary query, nonempty body before auth or send',async()=>{
  let called=0;
  const deps={env,now:()=>NOW,auth:async()=>{called++;return {email:'admin@example.test'};},run:async()=>{called++;return 'provider_accepted';}};
  for(const req of [
    request({headers:{host:'preview.vercel.app',origin:'https://kinetichub.com.mx'}}),
    request({headers:{host:'kinetichub.com.mx',origin:'https://evil.test'}}),
    request({headers:{host:'kinetichub.com.mx'}}),
    request({query:{ticketId:'other'}}),
    request({body:{send:true}})
  ]) {
    const res=response();
    await handler(req,res,deps);
    assert.equal(res.statusCode,403);
  }
  assert.equal(called,0);
});
test('verified admin alone reaches the fixed one shot once',async()=>{
  let calls=0;
  const res=response();
  await handler(request(),res,{env,now:()=>NOW,auth:async()=>({email:'admin@example.test'}),
    run:async(args,e)=>{calls++;assert.deepEqual(args,['--send-once']);assert.equal(e,env);return 'provider_accepted';}
  });
  assert.equal(res.statusCode,200);assert.equal(calls,1);assert.equal(res.body.outcome,'provider_accepted');
});
test('non-admin identity never reaches send',async()=>{
  const res=response();
  await handler(request(),res,{env,now:()=>NOW,auth:async()=>({error:true,status:403}),run:async()=>assert.fail('sent')});
  assert.equal(res.statusCode,403);
});
test('ambiguous provider result never triggers a retry',async()=>{
  let calls=0;
  const res=response();
  await handler(request(),res,{env,now:()=>NOW,auth:async()=>({email:'admin@example.test'}),run:async()=>{calls++;return 'provider_unconfirmed';}});
  assert.equal(res.statusCode,409);assert.equal(calls,1);assert.equal(res.body.outcome,'provider_unconfirmed');
});
