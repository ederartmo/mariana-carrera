const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

const operator = 'operator@example.test';
const admin = 'general@example.test';
const ids = { operator: randomUUID(), admin: randomUUID(), unverified: randomUUID(), outsider: randomUUID() };
const response = () => ({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
const request = (action, token, method='GET', body) => ({method,body,query:{action},headers:{
  host:'fixture.test',origin:'https://fixture.test','content-type':'application/json',authorization:'Bearer '+token
}});

test('support-only verified account can read and reply but cannot reach unrelated admin resources', async (t) => {
  const env={SITE_URL:'https://fixture.test',SUPABASE_URL:'https://fake.supabase.example',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'sk_test_fixture_only',RESEND_API_KEY:'re_fixture_only',
    SUPPORT_OPERATOR_EMAILS:'  OPERATOR@example.test, '+admin, ADMIN_EMAILS:admin};
  const saved = {};
  for(const [key,value] of Object.entries(env)){saved[key]=process.env[key];process.env[key]=value;}
  const oldFetch=global.fetch;
  t.after(()=>{global.fetch=oldFetch;for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const calls=[];
  global.fetch=async (input, init)=>{
    const url=new URL(input);
    const bearer=new Headers(init.headers).get('authorization');
    assert.equal(url.origin,env.SUPABASE_URL);
    if(url.pathname==='/auth/v1/user'){
      const key=bearer?.split(' ')[1];
      if(!ids[key])return Response.json({message:'invalid'},{status:401});
      return Response.json({id:ids[key],email:key==='admin'?admin:key==='outsider'?'outside@example.test':operator,
        email_confirmed_at:key==='unverified'?null:'fixture'});
    }
    assert.match(url.pathname,/^\/rest\/v1\/rpc\/support_admin_(list|action)$/);
    calls.push(JSON.parse(init.body));
    return Response.json({ok:true,tickets:[]});
  };
  const router=require('../api/data');
  for(const [token,status] of [['operator',200],['admin',200],['unverified',403],['outsider',403],['expired',401]]){
    const res=response(); await router(request('admin-support',token),res);
    assert.equal(res.statusCode,status,token);
    if(status===200)assert.deepEqual(res.body.assignees,[admin,operator]);
  }
  const write=response();
  await router(request('admin-support','operator','POST',{id:randomUUID(),requestId:randomUUID(),expectedVersion:1,action:'reply',body:'fixture'}),write);
  assert.equal(write.statusCode,200);
  assert.equal(calls.at(-1).p_actor,'admin:'+ids.operator);
  for(const action of ['admin-list-inscriptions','admin-list-available-bibs','admin-export-shirts','resend-emails-list','admin-perrun-production']){
    const denied=response(); await router(request(action,'operator'),denied);
    assert.equal(denied.statusCode,403,action);
  }
  for(const action of ['admin-cancel-registration','admin-archive-attempt','admin-perrun-annul','admin-perrun-registration']){
    const denied=response(); await router(request(action,'operator','POST',{}),denied);
    assert.equal(denied.statusCode,403,action);
  }
  const transfer=response();
  await require('../api/admin-manual-transfer')(request(undefined,'operator','POST',{}),transfer);
  assert.equal(transfer.statusCode,403);
  assert.equal(calls.length,3);
  delete process.env.SUPPORT_OPERATOR_EMAILS;
  const revoked=response();
  await router(request('admin-support','operator'),revoked);
  assert.equal(revoked.statusCode,403);
  const preserved=response();
  await router(request('admin-support','admin'),preserved);
  assert.equal(preserved.statusCode,200);
  assert.deepEqual(preserved.body.assignees,[admin]);
});

test('standalone support only mounts the shared inbox and has no general-admin or email-test tooling',()=>{
  const html=readFileSync(require.resolve('../soporte.html'),'utf8');
  assert.match(html,/data-admin-support\b/);
  assert.match(html,/admin-support\.js/);
  assert.doesNotMatch(html,/ADMIN_EMAILS|data-support-test-email|manualTransferForm|exportPerrunCsv|admin-inscripciones\.html/);
});
