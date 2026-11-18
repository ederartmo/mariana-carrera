const test = require('node:test');
const assert = require('node:assert/strict');
const { createRefreshGate, retryDelayMs } = require('../support-chat');

test('focus and interval share one visible flight and a cooldown without blocking writes', async () => {
  let now=0, visible=false, calls=0, finish, error;
  const tick=createRefreshGate({ isVisible:()=>visible, now:()=>now, minGapMs:1000,
    refresh:async()=>{calls++; await new Promise(resolve=>{finish=resolve;}); if(error)throw error;}, onError:()=>{} });
  await tick(); assert.equal(calls,0);
  visible=true;
  const run=tick(); await tick(); assert.equal(calls,1);
  error={status:429,retryDelayMs:5000}; finish(); await run;
  now=4999; await tick(); assert.equal(calls,1);
  now=5000; error=null; const next=tick(); assert.equal(calls,2); finish(); await next;
  now=5999; await tick(); assert.equal(calls,2);
});

test('Retry-After handles delta seconds, HTTP date and safe defaults', () => {
  assert.equal(retryDelayMs('3',0),3000);
  assert.equal(retryDelayMs('Thu, 01 Jan 1970 00:00:10 GMT',0),10000);
  assert.equal(retryDelayMs(null,0),60000);
});

test('participant can send during a quiet read and its late response cannot repaint', async () => {
  const {mountPublicSupportChat,TOKEN_KEY}=require('../support-chat');
  const nodes=new Map(); const el=()=>({value:'',dataset:{},children:[],addEventListener(type,fn){this[type]=fn;},append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;}});
  const find=key=>{if(!nodes.has(key)){const n=el();n.querySelector=find;nodes.set(key,n);}return nodes.get(key);};
  const values=new Map([[TOKEN_KEY,'fixture']]); const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const ticket={status:'pending',id:'ticket'}; const response=messages=>({ok:true,json:async()=>({ok:true,ticket,messages})});
  let reads=0, writes=0, resolve, active=true;
  const client=mountPublicSupportChat({
    root:{querySelector:find},document:{createElement:el, createDocumentFragment:el},storage,isActive:()=>active,
    fetch:async(_,opts)=>{
      const {action}=JSON.parse(opts.body);
      if(action==='read')return ++reads===1?response([]):new Promise(accept=>{resolve=accept;});
      writes++;return response([{id:'sent',author:'visitor',body:'Keep this send'}]);
    },
  });
  await new Promise(setImmediate);
  const quiet=client.refresh();
  const editor=find('[name="supportMessage"]'); editor.value='Keep this send';
  assert.equal(find('button[type="submit"]').disabled,false);
  find('[data-support-form]').submit({preventDefault(){}});
  await new Promise(setImmediate);
  assert.equal(writes,1);
  resolve(response([{id:'late',author:'admin',body:'late old snapshot'}])); await quiet;
  assert.equal(find('[data-support-messages]').children[0].children[0].dataset.messageAnchor,'sent');
  const sessionChange=client.refresh(); active=false; resolve(response([{id:'wrong-owner',body:'private'}]));
  await sessionChange;
  assert.equal(find('[data-support-messages]').children[0].children[0].dataset.messageAnchor,'sent');
});

test('a signed-in account can discover a conversation created elsewhere after initial 404', async () => {
  const {mountPublicSupportChat}=require('../support-chat');
  const nodes=new Map(); const el=()=>({value:'',dataset:{},children:[],addEventListener(type,fn){this[type]=fn;},append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;}});
  const find=key=>{if(!nodes.has(key)){const n=el();n.querySelector=find;nodes.set(key,n);}return nodes.get(key);};
  let reads=0;
  const client=mountPublicSupportChat({root:{querySelector:find},document:{createElement:el,createDocumentFragment:el},
    storage:{getItem:()=>null,setItem(){},removeItem(){}},account:true,
    fetch:async()=>{const first=++reads===1;return {ok:!first,status:first?404:200,json:async()=>first?{ok:false}:{ok:true,ticket:{status:'pending'},messages:[{id:'from-other-session',author:'admin',body:'fixture'}]}};}
  });
  await new Promise(setImmediate);
  await client.refresh();
  assert.equal(reads,2);
  assert.equal(find('[data-support-messages]').children[0].children[0].dataset.messageAnchor,'from-other-session');
});
