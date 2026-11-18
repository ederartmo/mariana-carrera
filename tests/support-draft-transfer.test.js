const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraftHandoff } = require('../support-chat');
const fixture = () => {
  const map = new Map();
  return { map, storage: { getItem: k => map.get(k), setItem:(k,v)=>map.set(k,v), removeItem:k=>map.delete(k) } };
};

test('same-tab draft carries text/category once without including tokens', () => {
  const {storage,map} = fixture();
  const compact = createDraftHandoff({storage,ownerId:'account-a'});
  assert.equal(compact.save('  A draft  ','registration'),true);
  const expanded = createDraftHandoff({storage,ownerId:'account-a'});
  assert.deepEqual(expanded.take(),{body:'  A draft  ',category:'registration'});
  assert.equal(expanded.take(),null);
  assert.equal(map.size,0);
});

test('guest and account drafts never cross identity, and expired handoff is consumed', () => {
  const {storage,map} = fixture();
  let now = 100;
  const scoped = ownerId => createDraftHandoff({storage,ownerId,now:()=>now});
  scoped(null).save('guest','general');
  assert.equal(scoped('account-a').take(), null);
  scoped('account-a').save('private','events');
  assert.equal(scoped('account-b').take(),null);
  scoped('account-a').save('private','events');
  assert.equal(scoped(null).take(),null);
  scoped(null).save('expired','other');
  now+=120001;
  assert.equal(scoped(null).take(),null);
  assert.equal(map.size,0);
});

test('blocked storage fails closed and empty transfer clears stale data', () => {
  const deny=()=>{throw new Error('denied');};
  const denied=createDraftHandoff({storage:{getItem:deny,setItem:deny,removeItem:deny},ownerId:null});
  assert.equal(denied.save('keep in composer','general'),false);
  assert.equal(denied.take(),null);
  const {storage}=fixture();
  const page=createDraftHandoff({storage,ownerId:null});
  page.save('old','general');
  assert.equal(page.save('  ','general'),true);
  assert.equal(page.take(),null);
});

test('retry success does not clear a newer draft after an uncertain send', async () => {
  const { mountPublicSupportChat, PENDING_KEY } = require('../support-chat');
  const {storage} = fixture();
  storage.setItem(PENDING_KEY,JSON.stringify({action:'send',operation:{body:'older message',requestId:'fixture'}}));
  const nodes=new Map();
  const make=()=>({ value:'',textContent:'',addEventListener(type,fn){this[type]=fn;},replaceChildren(){} });
  const find=id=>{if(!nodes.has(id)) nodes.set(id,make()); return nodes.get(id);};
  find('[data-support-form]').querySelector=find;
  const composer=find('[name="supportMessage"]');
  composer.value='new draft';
  mountPublicSupportChat({document:{createDocumentFragment:make},root:{querySelector:find},storage,
    fetch:async()=>({ok:true,json:async()=>({ok:true,messages:[]})}) });
  find('[data-support-retry]').click();
  await new Promise(setImmediate);
  assert.equal(composer.value,'new draft');
});
