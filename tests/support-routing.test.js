const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { rewrites } = require('../vercel.json');
process.env.SUPABASE_URL='https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-key';
process.env.SITE_URL='https://example.invalid';

test('Hobby support URLs resolve to the one existing data function', () => {
  assert.equal(fs.readdirSync('api').filter(f=>f.endsWith('.js')).length,12);
  for(const action of ['support-chat','admin-support']) {
    assert.equal(rewrites.find(r=>r.source==='/api/'+action)?.destination,'/api/data?action='+action);
  }
});

test('support dispatcher preserves each endpoint method and cache contract', async()=>{
  const handler = require('../api/data');
  for(const [action,method,allow] of [['support-chat','GET','POST'],['admin-support','DELETE','GET, POST']]){
    const res={headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.statusCode=v;return this},json(x){this.body=x;return this}};
    await handler({query:{action},headers:{},method},res);
    assert.equal(res.statusCode,405);
    assert.equal(res.headers.Allow,allow);
    assert.equal(res.headers['Cache-Control'],'no-store');
  }
});

test('guest support capability never grants admin access through the shared dispatcher', async()=>{
 const handler=require('../api/data');
 const res={headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.statusCode=v;return this},json(x){this.body=x;return this}};
 await handler({query:{action:'admin-support',status:'pending'},headers:{},method:'GET',body:{token:'a'.repeat(64)}},res);
 assert.equal(res.statusCode,401);
 assert.equal(res.headers['Cache-Control'],'no-store');
 for(const action of [['admin-support','support-chat'],'constructor']){
   await handler({query:{action},headers:{},method:'GET'},res);
   assert.equal(res.statusCode,404);
 }
});
