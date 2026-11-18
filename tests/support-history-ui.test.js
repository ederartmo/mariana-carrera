const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryPager, withScrollAnchor } = require('../support-chat.js');

test('pages once per click, recovers after a scoped 429, and discards late pages on reset', async () => {
  const requests = []; const rendered = []; const errors = []; let clock = 0;
  let resolve;
  const pager = createHistoryPager({
    fetchPage: before => { requests.push(before); return new Promise((ok, reject) => { resolve = { ok, reject }; }); },
    render: messages => rendered.push(messages.map(m=>m.id)), onError: error => errors.push(error.status),
    now: () => clock,
  });
  const first = pager.load();
  await pager.load();
  assert.deepEqual(requests,[null]);
  resolve.ok({messages:[{id:'b'},{id:'c'}],nextCursor:'b'});
  await first;
  const limited=pager.load();
  resolve.reject(Object.assign(Error(),{status:429,retryAfter:2}));
  await limited; await pager.load();
  assert.deepEqual(requests,[null,'b']);
  assert.deepEqual(errors,[429]);
  clock=2000;
  const second=pager.load();
  resolve.ok({messages:[{id:'a'},{id:'b'}],nextCursor:null});
  await second;
  assert.deepEqual(rendered.at(-1),['a','b','c']);
  pager.reset();
  const stale=pager.load(); pager.reset();
  resolve.ok({messages:[{id:'foreign'}],nextCursor:null}); await stale;
  assert.deepEqual(rendered.at(-1),['a','b','c']);
});
test('anchor adjustment preserves the visible message during a prepend', () => {
  let y=20;
  const anchor={dataset:{messageId:'id'}, getBoundingClientRect:()=>({top:y,bottom:y+50})};
  const scroller={scrollTop:100,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[anchor]};
  withScrollAnchor(scroller,()=>{y+=75;});
  assert.equal(scroller.scrollTop,175);
});
