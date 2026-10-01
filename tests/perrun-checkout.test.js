'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const { installFixture } = require('./helpers/perrun-schema-fixture.cjs');
const helper = require('../lib/_perrun-checkout');
const { createCheckoutSummaryClaim } = require('../lib/_checkout-summary-claim');
// Deterministic test credentials only. No client below performs network requests.
process.env.STRIPE_SECRET_KEY = 'sk_test_perrun_fixture';
process.env.CHECKOUT_SUMMARY_SECRET = 'perrun-unit-test-secret-at-least-thirty-two-characters';
delete process.env.VERCEL_ENV;
const now = new Date('2026-10-01T12:00:00-06:00');
function body(weights = [10]) {
  return { eventSlug: 'perrun-2027', distance: '3K', buyerEmail: 'Owner@example.invalid',
    tickets: [{ fullName: 'Perrun Owner', shirtSize: 'M', birthDate: '1990-01-01', whatsapp: '5500000000', state: 'Ciudad de México', borough: 'Gustavo A. Madero' }],
    dogs: weights.map((weight, index) => ({ dog_name: index ? 'Sol' : 'Luna', dog_weight_kg: weight, engraving_requested: !index })) };
}
function response() { return { code: null, headers: {}, body: null, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, setHeader(name, value) { this.headers[name] = value; } }; }
function fixture() {
  const state = { creates: [], expires: [], rpc: [], drafts: new Map() };
  const stripe = { checkout: { sessions: {
    async create(params, options) {
      state.creates.push({ params, options });
      if (state.createError) throw state.createError;
      return { id: 'cs_test_perrun', url: 'https://checkout.stripe.com/test_fixture', livemode: false, status: 'open', currency: 'mxn',
        amount_total: params.line_items.reduce((sum, item) => sum + item.quantity * item.price_data.unit_amount, 0), ...state.sessionOverride };
    },
    async expire(id) { state.expires.push(id); },
  } } };
  const supabase = {
    async rpc(name, args) {
      state.rpc.push({ name, args });
      assert.equal(name, 'prepare_perrun_order'); // Any fulfillment RPC is forbidden in Phase 3.
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (state.realRpc) return state.realRpc(name, args);
      const draft = { order_session_id: args.p_order_session_id, event_slug: 'perrun-2027', distance: args.p_distance, buyer_email: args.p_buyer_email,
        participant: args.p_participant, dogs: args.p_dogs, base_amount_cents: { presale: 45000, general: 50000, late: 55000 }[args.p_price_stage], finalized_at: null };
      draft.amount_cents = draft.base_amount_cents + (draft.dogs.length === 2 ? 18000 : 0);
      state.drafts.set(draft.order_session_id, draft);
      return { data: { ...draft, ...state.draftOverride }, error: null };
    },
    from(table) {
      assert.equal(table, 'perrun_checkout_orders');
      let id;
      const query = { select() { return query; }, eq(column, value) { assert.equal(column, 'order_session_id'); id = value; return query; },
        async maybeSingle() { return { data: state.drafts.get(id) || null, error: null }; } };
      return query;
    },
  };
  async function run(input = body(), at = now) {
    const res = response();
    await helper.handlePerrunCheckout({ req: { body: input, headers: { host: 'localhost:3000' } }, res, stripe, supabase, origin: 'http://localhost:3000', now: at });
    return res;
  }
  return { state, stripe, supabase, run };
}
function withQuote(input, at = now) { return { ...input, action: 'create', quoteToken: helper.issueQuote(helper.normalizePerrunPayload(input), at).quoteToken }; }

for (const [at, amount] of [['2026-10-31T23:59:59-06:00',450], ['2026-11-01T00:00:00-06:00',500], ['2027-01-01T00:00:00-06:00',550]]) {
  for (const weights of [[10], [10,25]]) test(`Server price ${at}, ${weights.length} dogs; no engraving line`, async () => {
    const f = fixture(), input = body(weights), time = new Date(at);
    input.amount = 1; input.stage = 'free'; input.free_engraving = true;
    const res = await f.run(withQuote(input, time), time);
    assert.equal(res.code,200); assert.equal(res.body.total,amount+(weights.length===2?180:0));
    const items=f.state.creates[0].params.line_items;
    assert.equal(items.length,weights.length); assert.equal(items[0].price_data.unit_amount,amount*100);
    assert.equal(items.some(item=>item.price_data.unit_amount===3500),false);
    assert.deepEqual(f.state.creates[0].params.payment_method_types,['card','oxxo']);
    assert.equal(f.state.rpc.length,1); assert.equal(f.state.rpc[0].args.p_quoted_at,time.toISOString());
  });
}
for (const [weight, category] of [[3,'S'],[10,'S'],[10.001,'M'],[25,'M'],[25.001,'L'],[50,'L'],[50.001,'XL'],[80,'XL']]) {
  test(`Server derives ${category} from ${weight} kg and ignores claimed category/free/sequence`,()=>{
    const input=body([weight]);Object.assign(input.dogs[0],{category:'S',engraving_free:true,engraving_sequence:1});
    const dog=helper.normalizePerrunPayload(input).dogs[0];
    assert.deepEqual(dog,{name:'Luna',weightKg:weight,category,engravingRequested:true});
  });
}
for (const weight of [undefined,null,'10',true,NaN,Infinity,-1,2.99,80.01]) test(`Reject invalid or omitted dog weight ${String(weight)}`,async()=>{
  const f=fixture();const res=await f.run({...body([weight]),action:'quote'});assert.equal(res.code,400);assert.equal(f.state.creates.length,0);assert.equal(f.state.rpc.length,0);
});
for (const weights of [[],[10,10,10],[26,10],[10,26],[80,25],[25,80]]) test('Reject dog group '+JSON.stringify(weights),()=>assert.throws(()=>helper.normalizePerrunPayload(body(weights))));
for (const distance of ['1K','3K','5K']) test('Checkout preserves Perrun distance '+distance,async()=>{
  const f=fixture(),input=body();input.distance=distance;const res=await f.run(withQuote(input));
  assert.equal(res.code,200);assert.equal(f.state.rpc[0].args.p_distance,distance);assert.match(f.state.creates[0].params.line_items[0].price_data.product_data.name,new RegExp(distance));
});
for(const field of ['fullName','shirtSize','birthDate','whatsapp','state','borough'])test('Human field mandatory: '+field,async()=>{
  const f=fixture(),input=body();delete input.tickets[0][field];const res=await f.run({...input,action:'quote'});assert.equal(res.code,400);assert.equal(f.state.creates.length,0);
});
test('Reject extra humans, missing distance, bad name/email and nonboolean intention before Stripe',async()=>{
  const variants=[];let value=body();value.tickets.push({...value.tickets[0]});variants.push(value);
  value=body();delete value.distance;variants.push(value);
  value=body();value.dogs[0].dog_name=' ';variants.push(value);
  value=body();value.buyerEmail='invalid';variants.push(value);
  value=body();value.dogs[0].engraving_requested='true';variants.push(value);
  value=body();value.promoCode='FREE';variants.push(value);
  for(const input of variants){const f=fixture();assert.equal((await f.run({...input,action:'quote'})).code,400);assert.equal(f.state.rpc.length,0);assert.equal(f.state.creates.length,0);}
});
test('Quote has no remote writes or PII and uses no-store',async()=>{
  const f=fixture(),res=await f.run({...body(),action:'quote'});assert.equal(res.code,200);assert.equal(f.state.creates.length,0);assert.equal(f.state.rpc.length,0);
  assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(JSON.stringify(res.body).includes('Owner'),false);assert.equal(JSON.stringify(res.body).includes('5500000000'),false);
});
test('No unsigned/missing quote can create a session',async()=>{const f=fixture();assert.equal((await f.run(body())).code,409);assert.equal(f.state.creates.length,0);});
test('Tampering signature or human/dog/distance payload invalidates quote',async()=>{
  const input=withQuote(body());const variants=[{...input,quoteToken:input.quoteToken+'x'},{...input,distance:'1K'}, {...input,buyerEmail:'other@example.invalid'}];
  const changed=structuredClone(input);changed.dogs[0].engraving_requested=false;variants.push(changed);
  for(const variant of variants){const f=fixture();assert.equal((await f.run(variant)).code,409);assert.equal(f.state.creates.length,0);}
});
test('Quote expires at fifteen minutes and cannot survive a stage boundary',async()=>{
  const input=withQuote(body());assert.equal((await fixture().run(input,new Date(now.getTime()+15*60*1000))).code,409);
  const at=new Date('2026-10-31T23:59:59-06:00');assert.equal((await fixture().run(withQuote(body(),at),new Date('2026-11-01T00:00:00-06:00'))).code,409);
});
test('Exact sales close cannot quote or create',async()=>{
  const f=fixture(),close=new Date('2027-01-25T16:00:00-06:00');assert.equal((await f.run({...body(),action:'quote'},close)).code,400);
  const at=new Date(close.getTime()-1000);assert.equal((await f.run(withQuote(body(),at),close)).code,400);assert.equal(f.state.creates.length,0);
});
for(const [key,env] of [['sk_live_fixture',undefined],['',undefined],['sk_test_fixture','production']])test('Fail closed on local Stripe mode/environment '+key.slice(0,7)+'/'+env,async()=>{
  const original=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY=key;if(env)process.env.VERCEL_ENV=env;
  try{const f=fixture();assert.equal((await f.run({...body(),action:'quote'})).code,503);assert.equal(f.state.creates.length,0);assert.equal(f.state.rpc.length,0);}
  finally{process.env.STRIPE_SECRET_KEY=original;delete process.env.VERCEL_ENV;}
});
test('Unexpected LIVE response is refused without operating on LIVE session',async()=>{
  const f=fixture();f.state.sessionOverride={livemode:true};const res=await f.run(withQuote(body()));assert.equal(res.code,503);assert.equal(f.state.rpc.length,0);assert.equal(f.state.expires.length,0);assert.equal(res.headers['Set-Cookie'],undefined);
});
test('Unexpected Stripe total is refused before draft write',async()=>{
  const f=fixture();f.state.sessionOverride={amount_total:1};assert.equal((await f.run(withQuote(body()))).code,503);assert.equal(f.state.rpc.length,0);assert.deepEqual(f.state.expires,['cs_test_perrun']);
});
test('Retry/network uncertainty reuses Stripe idempotency key and immutable quote',async()=>{
  const f=fixture(),input=withQuote(body([10,25]));f.state.createError=new Error('private Stripe diagnostic');const failed=await f.run(input);
  assert.equal(failed.code,503);assert.equal(failed.body.error.includes('private'),false);assert.equal(f.state.rpc.length,0);
  f.state.createError=null;assert.equal((await f.run(input)).code,200);assert.equal((await f.run(input)).code,200);
  assert.equal(new Set(f.state.creates.map(call=>call.options.idempotencyKey)).size,1);
  assert.deepEqual(f.state.rpc[0],f.state.rpc[1]);assert.equal(f.state.drafts.size,1);
});
test('Prepare failure expires TEST checkout, returns no URL and no cookie',async()=>{
  const f=fixture();f.state.rpcError={message:'fixture failure'};const res=await f.run(withQuote(body()));assert.equal(res.code,503);assert.equal(res.body.url,undefined);assert.equal(res.headers['Set-Cookie'],undefined);assert.deepEqual(f.state.expires,['cs_test_perrun']);
});
test('Draft amount or finalized state mismatch cannot redirect',async()=>{
  for(const override of [{amount_cents:1},{finalized_at:'2026-10-01T00:00:00Z'}]){const f=fixture();f.state.draftOverride=override;const res=await f.run(withQuote(body()));assert.equal(res.code,503);assert.equal(res.body.url,undefined);}
});
test('Minimum metadata, one ticket and normalized owner phone; no human metadata leakage',async()=>{
  const f=fixture(),res=await f.run(withQuote(body([10,25])));assert.equal(res.code,200);
  const params=f.state.creates[0].params;assert.deepEqual(Object.keys(params.metadata).sort(),['event_slug','flow_version','order_ref','ticket_count']);assert.equal(params.metadata.ticket_count,'1');
  assert.equal(f.state.rpc[0].args.p_participant.whatsapp,'+525500000000');assert.equal(res.body.ticketCount,1);assert.equal(res.body.dogCount,2);
  assert.match(res.headers['Set-Cookie'],/HttpOnly/);assert.match(params.success_url,/event=perrun-2027/);
});
test('Summary is pending, no bib/free/position and no phone; includes two dogs and intention',async()=>{
  const f=fixture();await f.run(withQuote(body([10,25])));const summary=await helper.getPerrunSummary(f.supabase,'cs_test_perrun');assert.equal(summary.total,630);assert.equal(summary.ticketCount,1);assert.equal(summary.payment_status,'pending');assert.equal(summary.bib_number,null);
  assert.equal(summary.dogs.length,2);assert.equal(summary.dogs[0].engravingRequested,true);assert.equal(summary.dogs[1].engravingRequested,false);
  for(const forbidden of ['engraving_free','engraving_sequence','weightKg','whatsapp','owner_phone'])assert.equal(JSON.stringify(summary).includes(forbidden),false);
});
function summaryApi(db) {
  const file=path.join(__dirname,'../api/checkout-summary.js'),localRequire=createRequire(file);
  const context={module:{exports:{}},process,console:{log(){},warn(){},error(){}},require:id=>id==='@supabase/supabase-js'?{createClient:()=>db}:id==='stripe'?()=>({checkout:{sessions:{retrieve(){throw Error('No Stripe calls');}}}}):localRequire(id)};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return context.module.exports;
}
test('Perrun summary rejects missing/wrong session claim before database access',async()=>{
  const api=summaryApi({from(){throw Error('Unauthorized database access');}});
  for(const cookie of ['', 'kh_checkout_claim='+createCheckoutSummaryClaim('cs_test_other').claim]){const res=response();await api({method:'GET',headers:{cookie},query:{event:'perrun-2027',session_id:'cs_test_perrun'}},res);assert.equal(res.code,403);}
});
test('Perrun summary API only reads authorized draft and never queries legacy inscriptions/Stripe',async()=>{
  const f=fixture();await f.run(withQuote(body()));const api=summaryApi(f.supabase),res=response();
  await api({method:'GET',headers:{cookie:'kh_checkout_claim='+createCheckoutSummaryClaim('cs_test_perrun').claim},query:{event:'perrun-2027',session_id:'cs_test_perrun'}},res);
  assert.equal(res.code,200);assert.equal(res.body.eventSlug,'perrun-2027');assert.equal(res.body.bib_number,null);
});
test('Checkout adapter uses real isolated SQL RPC: retry gives one draft, zero finalizations and positions',async()=>{
  const db=new PGlite();
  try{
    await installFixture(db);await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001055227_perrun_phase1_model.sql'),'utf8'));
    const f=fixture();f.state.realRpc=async(name,args)=>{
      const result=await db.query('select (public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)).*',[args.p_order_session_id,args.p_distance,args.p_buyer_email,JSON.stringify(args.p_participant),JSON.stringify(args.p_dogs),args.p_price_stage,args.p_quoted_at]);return {data:result.rows[0],error:null};
    };
    const input=withQuote(body([10,25]));assert.equal((await f.run(input)).code,200);assert.equal((await f.run(input)).code,200);
    const orders=(await db.query('select * from public.perrun_checkout_orders')).rows;assert.equal(orders.length,1);assert.equal(orders[0].owner_phone,'+525500000000');assert.equal(orders[0].participant.whatsapp,undefined);assert.equal(orders[0].finalized_at,null);assert.equal(orders[0].amount_cents,63000);
    for(const table of ['inscripciones','registration_dogs','perrun_engraving_payments'])assert.equal((await db.query('select count(*)::int n from public.'+table)).rows[0].n,0);
    assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),0);
  }finally{await db.close();}
});

function browserFixture(confirmValue=true) {
  const nodes=new Map(),handlers=new Map();
  function node(id){if(!nodes.has(id))nodes.set(id,{value:'',checked:false,hidden:false,disabled:false,textContent:'',addEventListener(type,fn){handlers.set(id+':'+type,fn);},querySelectorAll(){return [node('perrunDogName2'),node('perrunDogWeight2'),node('perrunEngraving2')];}});return nodes.get(id);}
  const calls=[];const context={KineticHubPerrunEvent:require('../perrun-event-data'),document:{getElementById:node},confirm:()=>confirmValue,fetch:async(url,opts)=>{const input=JSON.parse(opts.body);calls.push(input);return {ok:true,status:200,json:async()=>input.action==='quote'?{quoteToken:'fixture_quote',total:630}:{url:'https://checkout.stripe.com/test'}};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../perrun-checkout.js'),'utf8'),context);
  const api=context.KineticHubPerrunCheckout.create({form:{addEventListener(type,fn){handlers.set('form:'+type,fn);}},onChange(){}});
  node('perrunDogName1').value='Luna';node('perrunDogWeight1').value='10';handlers.get('perrunDogWeight1:change')();
  return {node,handlers,api,calls};
}
test('Browser requires weight, derives category and enables second dog only for S/M',()=>{
  const f=browserFixture();assert.equal(f.node('perrunDogCategory1').textContent,'S');assert.equal(f.node('perrunAddDog').disabled,false);
  f.node('perrunDogWeight1').value='26';f.handlers.get('perrunDogWeight1:change')();assert.equal(f.node('perrunAddDog').disabled,true);assert.equal(f.node('perrunDogCategory1').textContent,'L');
});
test('Browser removing second dog clears stale name/weight/engraving and disables fields',()=>{
  const f=browserFixture();f.node('perrunAddDog').checked=true;f.handlers.get('perrunAddDog:change')();f.node('perrunDogName2').value='Sol';f.node('perrunDogWeight2').value='25';f.node('perrunEngraving2').checked=true;
  f.node('perrunDogWeight1').value='30';f.handlers.get('perrunDogWeight1:change')();assert.equal(f.node('perrunAddDog').checked,false);assert.equal(f.node('perrunDogName2').value,'');assert.equal(f.node('perrunDogWeight2').value,'');assert.equal(f.node('perrunEngraving2').checked,false);assert.equal(f.node('perrunDogName2').disabled,true);assert.equal(f.api.secondDogFee(),0);
});
test('Browser keeps second dog and restores previous weight when removal is declined',()=>{
  const f=browserFixture(false);f.node('perrunAddDog').checked=true;f.handlers.get('perrunAddDog:change')();f.node('perrunDogWeight1').value='30';f.handlers.get('perrunDogWeight1:change')();assert.equal(f.node('perrunDogWeight1').value,'10');assert.equal(f.node('perrunAddDog').checked,true);assert.equal(f.api.secondDogFee(),180);
});
test('Browser retries identical payload with same quote, invalidates quote after input edits',async()=>{
  const f=browserFixture(),input=body();await f.api.submit(input);await f.api.submit(input);assert.deepEqual(f.calls.map(x=>x.action),['quote','create','create']);assert.equal(f.calls[1].quoteToken,f.calls[2].quoteToken);
  f.handlers.get('form:input')();await f.api.submit(input);assert.equal(f.calls[3].action,'quote');
});

for(const weights of [[3,10],[3,25],[25,3],[11,25]])test('Valid S/M pair '+weights.join('+')+' remains one human',()=>{
  const payload=helper.normalizePerrunPayload(body(weights));assert.equal(payload.dogs.length,2);assert.equal(helper.priceFor(payload,now).total,630);
});
test('All forged browser monetary fields are ignored, including second dog fee and engraving prices',async()=>{
  const input=body([10,25]);Object.assign(input,{amount:1,price:1,stagePrice:1,secondDogFee:0,engravingPrice:35,engraving_price:0,total:1,stage:'late'});
  const f=fixture();const res=await f.run(withQuote(input));assert.equal(res.code,200);assert.equal(res.body.total,630);assert.equal(f.state.creates[0].params.line_items[1].price_data.unit_amount,18000);
});
test('Invalid event slug and distance cannot issue a Perrun quote',async()=>{
  for(const input of [{...body(),eventSlug:'unknown'},{...body(),distance:'10K'}]){const f=fixture();assert.equal((await f.run({...input,action:'quote'})).code,400);assert.equal(f.state.creates.length,0);}
});
test('Actual checkout page preserves all Perrun distances and explicitly asks when missing',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../checkout.html'),'utf8');
  const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const checkoutParams'));
  for(const distance of ['1K','3K','5K','']){
    const nodes=new Map(),listeners=[];
    function node(id){if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,style:{},textContent:'',children:[],replaceChildren(...children){this.children=children;},addEventListener(){}});return nodes.get(id);}
    const context={Date,URLSearchParams,location:{search:'?event=perrun-2027'+(distance?'&distance='+distance:'')},document:{getElementById:node,createElement:()=>({}),querySelector:()=>node('submit'),addEventListener(type,fn){listeners.push(fn);}}};context.window=context;
    vm.createContext(context);
    for(const file of ['axolote-stage-config.js','cascanueces-stage-config.js','perrun-stage-config.js','perrun-event-data.js','event-catalog.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
    vm.runInContext(inline,context);listeners.forEach(fn=>fn());
    assert.equal(context.KineticHubCheckoutSelection.eventSlug,'perrun-2027');assert.equal(context.KineticHubCheckoutSelection.distance,distance);
    assert.equal(node('eventDistance').required,true);assert.equal(node('distanceField').hidden,false);
    assert.deepEqual(node('eventDistance').children.map(child=>child.value),['','1K','3K','5K']);assert.equal(node('checkoutEventName').textContent,'Perrun 2027');
    assert.equal(node('stagePrice').textContent,'$450 MXN');
  }
});
test('Actual checkout form limits Perrun to one human and hides promo/add-ticket controls',()=>{
  const nodes=new Map(),handlers=new Map();
  function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:id==='stagePrice'?'$450 MXN':'',style:{},hidden:false,disabled:false,innerHTML:'',addEventListener(type,fn){handlers.set(id+':'+type,fn);},closest(){return node('promoGroup');},querySelectorAll(){return [node('perrunDogName1'),node('perrunDogWeight1'),node('perrunEngraving1')];}});return nodes.get(id);}
  const context={Date,HTMLElement:class {},window:{KineticHubCheckoutSelection:{eventSlug:'perrun-2027',distance:'1K'},KineticHubPerrunCheckout:{create({onChange}){return {secondDogFee:()=>0,refresh:onChange};}}},document:{getElementById:node}};
  const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8'),start=source.indexOf('\nfunction setupCheckoutForm() {')+1,end=source.indexOf('// NOTA Batch 1A:',start);
  vm.runInNewContext(source.slice(start,end)+'setupCheckoutForm();',context);
  assert.equal(node('addTicketBtn').hidden,true);assert.equal(node('promoCode').disabled,true);assert.equal(node('promoGroup').hidden,true);
  assert.equal(node('ticketCountLabel').textContent,'1 ticket');handlers.get('addTicketBtn:click')();assert.equal(node('ticketCountLabel').textContent,'1 ticket');assert.equal((node('ticketsList').innerHTML.match(/class="ticket-card"/g)||[]).length,1);
});
test('Summary removes only session id from URL, preserving Perrun routing on refresh',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../succes.html'),'utf8');
  const statement=html.split(/\r?\n/).find(line=>line.includes("window.history.replaceState({}, '', window.location.pathname"));
  let url;vm.runInNewContext(statement,{summary:{eventSlug:'perrun-2027'},window:{location:{pathname:'/succes.html'},history:{replaceState(a,b,value){url=value;}}}});assert.equal(url,'/succes.html?event=perrun-2027');
  assert.ok(html.includes('Total principal: $'));assert.ok(html.includes('escapeHtml(dog.name)'));
});

test('Checkout and success inline scripts parse; dog names are escaped and zero second fee remains visible',()=>{
  for(const file of ['checkout.html','succes.html']){
    const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
  }
  const html=fs.readFileSync(path.join(__dirname,'../succes.html'),'utf8');
  const branch=html.match(/if \(summary.eventSlug === 'perrun-2027' && Array.isArray\(summary.dogs\)\) \{([\s\S]*?)\n\s*\}/)[1];
  const escaped=html.match(/function escapeHtml\(value\) \{([\s\S]*?)\n\s*\}/)[0];
  let rendered='';
  vm.runInNewContext(escaped+branch,{summary:{baseAmount:450,secondDogFee:0,total:450,dogs:[{name:'<script>alert(1)</script>',category:'S',engravingStatus:'Pendiente'}]},document:{getElementById(){return {insertAdjacentHTML(where,value){rendered+=value;}}}}});
  assert.ok(rendered.includes('Segundo perro: $0 MXN'));assert.ok(rendered.includes('&lt;script&gt;'));assert.equal(rendered.includes('<script>'),false);
});
