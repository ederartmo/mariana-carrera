'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { enrichRegistrations, engravingStatus, perrunCsv, CSV_COLUMNS, csvCell } = require('../lib/_perrun-operations');
const { renderConfirmation, sendPerrunConfirmation } = require('../lib/_perrun-confirmation');
function fixture(count = 1, start = 1) {
  const human = { id: 'human-1', email: 'owner@example.invalid', buyer_email: 'buyer@example.invalid', full_name: 'Owner <safe>', order_session_id: 'cs_test_ops', event_slug: 'perrun-2027', distance: '3K', bib_number: '002', shirt_size: 'M', amount_paid: count === 2 ? 630 : 450, payment_status: 'paid', registration_status: 'active', email_sent: false };
  const dogs = Array.from({ length: count }, (_, i) => ({ id: 'dog-' + i, registration_id: human.id, registration_email: human.email, order_session_id: human.order_session_id, dog_index: i + 1, dog_name: i ? 'Sol' : 'Luna', weight_kg: i ? 20 : 8, category: i ? 'M' : 'S', engraving_sequence: start + i, engraving_requested: true, engraving_free: start + i <= 300, engraving_payment_required: start + i > 300, engraving_payment_amount_cents: start + i > 300 ? 3500 : 0, plate_status: 'not_started', plate_started_at: null, dog_name_for_plate: null, owner_phone_for_plate: null }));
  const tables = { inscripciones: [human], registration_dogs: dogs, perrun_checkout_orders: [{ order_session_id: human.order_session_id, owner_phone: '+525500000001', finalized_at: '2026-10-01', payment_status: 'paid', dogs }], perrun_engraving_payments: [] };
  const state = { tables, calls: [], writes: [], sends: [], delivered: new Map(), readError: null, markError: false, providerError: false };
  const client = { from(table) {
    state.calls.push(table); const filters = []; let update;
    const chain = {
      select() { return chain; }, eq(k,v) { filters.push(r => r[k] === v); return chain; }, neq(k,v) { filters.push(r => r[k] !== v); return chain; },
      in(k,v) { filters.push(r => v.includes(r[k])); return chain; }, order() { return chain; },
      or(value) { if (value.startsWith('email_sent.')) filters.push(r => !r.email_sent); return chain; },
      update(p) { update = p; return chain; },
      range(from,to) { return run().then(result => ({ ...result, count: result.data?.length, data: result.data?.slice(from,to+1) })); },
      then(resolve,reject) { return run().then(resolve,reject); }
    };
    async function run() {
      if (state.readError === table) return { data: null, error: { message: 'read failure' } };
      const rows = tables[table].filter(r => filters.every(f => f(r)));
      if (update) {
        if (state.markError) return { data: null, error: { message: 'mark failure' } };
        state.writes.push({ table, update }); rows.forEach(r => Object.assign(r, update));
      }
      return { data: structuredClone(rows), error: null };
    }
    return chain;
  } };
  const resend = { emails: { async send(payload, options) {
    state.sends.push({ payload, options });
    if (state.providerError) return { error: { message: 'provider failed' } };
    if (!state.delivered.has(options.idempotencyKey)) state.delivered.set(options.idempotencyKey, payload);
    return { data: { id: 'resend-fixture' } };
  } } };
  const send = () => sendPerrunConfirmation({ supabase: client, resend, sessionId: human.order_session_id, qa: false });
  return { human, dogs, state, client, resend, send };
}
for (const count of [1,2]) test('Admin: ' + count + ' dogs, one human/BIB, authoritative owner phone', async () => {
  const f=fixture(count);const [row]=await enrichRegistrations(f.client,[f.human]);
  assert.equal(row.dogs.length,count);assert.equal(row.owner_phone,f.state.tables.perrun_checkout_orders[0].owner_phone);assert.equal(row.bib_number,'002');assert.equal(row.dogs[0].dog_size,'S');if(count===2)assert.equal(row.dogs[1].dog_size,'M');assert.equal(f.state.writes.length,0);
});
for (const sequence of [299,300,301]) test('Confirmed email engraving sequence ' + sequence, async () => {
  const f=fixture(1,sequence);const [row]=await enrichRegistrations(f.client,[f.human]);const mail=renderConfirmation(row);
  assert.match(mail.text,sequence<=300?/Grabado gratuito confirmado/:/pago de \$35 pendiente/);
  assert.match(mail.text,/14 de febrero de 2027/);assert.match(mail.text,/12 de febrero de 2027, 10:00–16:00/);assert.match(mail.text,/Bosque de San Juan de Aragón/);assert.match(mail.text,/BIB #002/);assert.match(mail.text,/Talla: M/);assert.ok(!mail.html.includes('Owner <safe>'));assert.ok(mail.html.includes('Owner &lt;safe&gt;'));
});
for(const count of [1,2]) test('Email contains exactly ' + count + ' confirmed dogs',async()=>{const f=fixture(count);assert.equal((await f.send()).ok,true);const payload=f.state.sends[0].payload;assert.equal((payload.text.match(/Perro \d:/g)||[]).length,count);assert.equal(payload.to,f.human.buyer_email);assert.equal(f.human.email_sent,true);assert.equal(f.human.confirmation_email_id,'resend-fixture');assert.ok(f.human.confirmation_email_sent_at);});
test('Email: engraving not requested never promises free',async()=>{const f=fixture();f.dogs[0].engraving_requested=false;const [row]=await enrichRegistrations(f.client,[f.human]);const mail=renderConfirmation(row);assert.match(mail.text,/Grabado no solicitado/);assert.ok(!mail.text.includes('gratuito'));});
test('Email sequential duplicates persist once',async()=>{const f=fixture();await f.send();const repeat=await f.send();assert.equal(repeat.skipped,true);assert.equal(f.state.sends.length,1);assert.equal(f.state.writes.length,1);});
test('Email concurrent duplicate deliveries use same provider key',async()=>{const f=fixture(2);const results=await Promise.all([f.send(),f.send()]);assert.ok(results.every(r=>r.ok));assert.equal(f.state.delivered.size,1);assert.equal(new Set(f.state.sends.map(s=>s.options.idempotencyKey)).size,1);});
test('Email failed DB mark retries the same provider key',async()=>{const f=fixture();f.state.markError=true;assert.equal((await f.send()).ok,false);assert.equal(f.human.email_sent,false);f.state.markError=false;assert.equal((await f.send()).ok,true);assert.equal(f.state.delivered.size,1);assert.equal(f.state.sends[0].options.idempotencyKey,f.state.sends[1].options.idempotencyKey);});
test('Email provider failure leaves persisted email flag unchanged',async()=>{const f=fixture();f.state.providerError=true;assert.equal((await f.send()).ok,false);assert.equal(f.state.writes.length,0);assert.equal(f.human.email_sent,false);});
test('QA mail guard makes zero provider calls and zero DB writes',async()=>{const f=fixture();const r=await sendPerrunConfirmation({supabase:f.client,resend:f.resend,sessionId:f.human.order_session_id,qa:true});assert.equal(r.qa,true);assert.equal(f.state.calls.length,0);assert.equal(f.state.sends.length,0);assert.equal(f.state.writes.length,0);});
for(const status of ['pending','payment_failed','refunded'])test('No confirmation for payment '+status,async()=>{const f=fixture();f.human.payment_status=status;assert.equal((await f.send()).skipped,true);assert.equal(f.state.sends.length,0);});
test('No confirmation for cancelled paid human',async()=>{const f=fixture();f.human.registration_status='cancelled';assert.equal((await f.send()).skipped,true);assert.equal(f.state.sends.length,0);});
test('Missing finalization or dogs fails closed before email',async()=>{const f=fixture();f.state.tables.perrun_checkout_orders[0].finalized_at=null;assert.equal((await f.send()).ok,false);assert.equal(f.state.sends.length,0);});
for(const table of ['registration_dogs','perrun_checkout_orders','perrun_engraving_payments'])test('Ledger read failure '+table+' cannot send',async()=>{const f=fixture();f.state.readError=table;assert.equal((await f.send()).ok,false);assert.equal(f.state.sends.length,0);});
for(const count of [1,2])test('CSV '+count+' dogs equals '+count+' rows repeating human/BIB',async()=>{const f=fixture(count,299);const rows=await enrichRegistrations(f.client,[f.human]);const csv=perrunCsv(rows);const lines=csv.trim().split('\r\n');assert.equal(lines.length,count+1);assert.ok(lines[0].includes('owner_phone'));assert.equal((csv.match(/"002"/g)||[]).length,count);assert.equal((csv.match(/owner@example.invalid/g)||[]).length,count);assert.match(csv,/299/);if(count===2)assert.match(csv,/300/);assert.match(csv,/525500000001/);});
test('CSV pending $35 uses minor units and retains historical 301',async()=>{const f=fixture(1,301);const csv=perrunCsv(await enrichRegistrations(f.client,[f.human]));assert.match(csv,/"301"/);assert.match(csv,/"3500"/);assert.match(csv,/"false","true","3500","pending"/);});
test('CSV refunded/cancelled human preserves dogs and historical sequence',async()=>{const f=fixture(2,299);f.human.payment_status='refunded';f.human.registration_status='cancelled';const csv=perrunCsv(await enrichRegistrations(f.client,[f.human]));assert.equal(csv.trim().split('\r\n').length,3);assert.match(csv,/"refunded","cancelled"/);assert.match(csv,/"299"/);assert.match(csv,/"300"/);});
test('CSV quotes multiline/commas and neutralizes spreadsheet formulas',()=>{assert.equal(csvCell('=HYPERLINK("evil")'), '"' + "'" + '=HYPERLINK(""evil"")"');assert.equal(csvCell('Luna, Sol\nDog'),'"Luna, Sol\nDog"');assert.equal(csvCell('+525500000001'),'"' + "'" + '+525500000001"');assert.ok(CSV_COLUMNS.includes('dog_name_for_plate'));});
test('Existing plate snapshot is exported without substituting current owner/name',async()=>{const f=fixture();f.dogs[0].dog_name_for_plate='Original Luna';f.dogs[0].owner_phone_for_plate='+525599999999';f.dogs[0].plate_status='preparing';f.dogs[0].plate_started_at='2026-10-01';const csv=perrunCsv(await enrichRegistrations(f.client,[f.human]));assert.match(csv,/Original Luna/);assert.match(csv,/525599999999/);assert.equal(f.state.writes.length,0);});
test('Profile dogs are owned by composite registration identity; internal details stripped',async()=>{const f=fixture(2);f.state.tables.registration_dogs.push({...f.dogs[0],id:'other',registration_email:'other@example.invalid',dog_name:'Private other dog'});const [row]=await enrichRegistrations(f.client,[f.human],{profile:true});assert.equal(row.dogs.length,2);assert.deepEqual(Object.keys(row.dogs[0]).sort(),['dog_category','dog_index','dog_name','engraving_status']);assert.ok(!('owner_phone' in row));assert.ok(!f.state.calls.includes('perrun_checkout_orders'));});
for(const event_slug of ['axolote-night-run','cascanueces-run'])test(event_slug+' legacy enrichment performs no Perrun query and preserves rows',async()=>{const f=fixture();f.human.event_slug=event_slug;assert.deepEqual(await enrichRegistrations(f.client,[f.human]),[f.human]);assert.equal(f.state.calls.length,0);assert.equal(perrunCsv([f.human]).trim().split('\r\n').length,1);});
test('Settled add-on states are read without creating a payment',async()=>{const f=fixture(1,301);f.state.tables.perrun_engraving_payments=[{dog_id:f.dogs[0].id,status:'paid'}];const [row]=await enrichRegistrations(f.client,[f.human]);assert.equal(row.dogs[0].engraving_status,'Grabado pagado confirmado');assert.equal(f.state.writes.length,0);});
function installAuth(client, auth) {
  const filename=require.resolve('../lib/_auth');const previous=require.cache[filename];require.cache[filename]={id:filename,filename,loaded:true,exports:{getServiceClient:()=>client,getAdminUser:async()=>auth,getAuthenticatedUser:async()=>auth}};
  return()=>{if(previous)require.cache[filename]=previous;else delete require.cache[filename];for(const file of ['../lib/admin-list-inscriptions','../lib/admin-export-perrun','../lib/me-registrations'])delete require.cache[require.resolve(file)];};
}
const response=()=>({statusCode:200,headers:{},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;},setHeader(k,v){this.headers[k]=v;}});
test('Admin event filter Perrun returns enriched dogs via authenticated handler',async()=>{const f=fixture(2);const restore=installAuth(f.client,{email:'admin@example.invalid'});try{delete require.cache[require.resolve('../lib/admin-list-inscriptions')];const res=response();await require('../lib/admin-list-inscriptions')({method:'GET',query:{event:'perrun-2027',status:'paid'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.rows.length,1);assert.equal(res.body.rows[0].dogs.length,2);}finally{restore();}});
for(const status of [401,403])test('CSV rejects unauthorized '+status+' before reading DB',async()=>{const f=fixture();const restore=installAuth(f.client,{error:'Denied',status});try{delete require.cache[require.resolve('../lib/admin-list-inscriptions')];delete require.cache[require.resolve('../lib/admin-export-perrun')];const res=response();await require('../lib/admin-export-perrun')({method:'GET',query:{}},res);assert.equal(res.statusCode,status);assert.equal(f.state.calls.length,0);assert.ok(!res.headers['Content-Type']);}finally{restore();}});
test('Admin CSV action exports filtered real ledger rows, no-store attachment',async()=>{const f=fixture(2);const restore=installAuth(f.client,{email:'admin@example.invalid'});try{delete require.cache[require.resolve('../lib/admin-list-inscriptions')];delete require.cache[require.resolve('../lib/admin-export-perrun')];const res=response();await require('../lib/admin-export-perrun')({method:'GET',query:{status:'paid',event:'axolote-night-run'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.trim().split('\r\n').length,3);assert.equal(res.headers['Cache-Control'],'no-store');assert.match(res.headers['Content-Disposition'],/attachment/);}finally{restore();}});

test('Admin inline scripts parse successfully',()=>{const fs=require('fs'),vm=require('vm');const html=fs.readFileSync(require('path').join(__dirname,'../admin-inscripciones.html'),'utf8');for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!/src\s*=/.test(match[1]))new vm.Script(match[2]);}});
test('Profile handler ignores foreign query email and enriches only the JWT owner',async()=>{const f=fixture(2);const restore=installAuth(f.client,{email:f.human.email});try{delete require.cache[require.resolve('../lib/me-registrations')];const res=response();await require('../lib/me-registrations')({method:'GET',query:{email:'foreign@example.invalid'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.registrations[0].dogs.length,2);assert.ok(!('owner_phone' in res.body.registrations[0]));}finally{restore();}});
test('CSV fetches every page before download and never silently truncates',async()=>{const file=require.resolve('../lib/admin-list-inscriptions'),previous=require.cache[file];let pages=[];const f=fixture();const [row]=await enrichRegistrations(f.client,[f.human]);require.cache[file]={id:file,filename:file,loaded:true,exports:async(req,res)=>{pages.push(req.query.page);assert.equal(req.query.event,'perrun-2027');res.status(200).json({rows:[row],hasMore:req.query.page===1});}};try{delete require.cache[require.resolve('../lib/admin-export-perrun')];const res=response();await require('../lib/admin-export-perrun')({method:'GET',query:{}},res);assert.deepEqual(pages,[1,2]);assert.equal(res.body.trim().split('\r\n').length,3);}finally{if(previous)require.cache[file]=previous;else delete require.cache[file];delete require.cache[require.resolve('../lib/admin-export-perrun')];}});
for(const [file,body] of [
  ['../lib/admin-cancel-registration',{inscriptionId:'human-1',email:'owner@example.invalid'}],
  ['../api/admin-delete-inscription',{inscriptionId:'human-1',confirmTarget:'human-1'}],
  ['../api/admin-update-inscription-email',{inscriptionId:'human-1',email:'new@example.invalid'}],
  ['../api/admin-update-participant',{id:'human-1',email:'owner@example.invalid',participant:{fullName:'Owner',shirtSize:'M',birthDate:'1990-01-01',whatsapp:'+525500000001',state:'Jalisco',borough:null}}]
])test('Legacy mutation blocked for Perrun: '+file,async()=>{
 const fs=require('fs'),vm=require('vm'),{createRequire}=require('module'),filename=require.resolve(file),realRequire=createRequire(filename),module={exports:{}};let writes=0;
 const f=fixture();const chain={select(){return chain;},eq(){return chain;},single:async()=>({data:f.human,error:null}),then(resolve,reject){return Promise.resolve({data:[f.human],error:null}).then(resolve,reject);}};
 const client={from:()=>({...chain,update(){writes++;throw Error('Unexpected mutation');},delete(){writes++;throw Error('Unexpected mutation');}})};
 const mocked=name=>name==='@supabase/supabase-js'?{createClient:()=>client}:name.includes('_auth')?{getAdminUser:async()=>({email:'admin@example.invalid'}),normalizeEmail:v=>String(v||'').trim().toLowerCase()}:realRequire(name);
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:mocked,module,exports:module.exports,process,console:{log(){},error(){}},Date},{filename});const res=response();await module.exports({method:'POST',body},res);assert.equal(res.statusCode,409);assert.equal(writes,0);
});
