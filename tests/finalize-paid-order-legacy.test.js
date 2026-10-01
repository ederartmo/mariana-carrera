'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {installFixture}=require('./helpers/perrun-schema-fixture.cjs');
let db;
const modern={ticketIndex:1,fullName:'Modern Runner',shirtSize:'M',birthDate:'1990-01-01',whatsapp:'+525500000000',state:'Ciudad de México',borough:'Gustavo A. Madero'};
async function finalize(id,participants=[modern],event='cascanueces-run') {
  return db.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,event,'5K',450,'test@example.invalid','pi_'+id,'evt_'+id,JSON.stringify(participants)]);
}
async function readOrder(id){return (await db.query('select *,birth_date::text as birth_date from public.inscripciones where order_session_id=$1 order by ticket_index',[id])).rows;}
async function legacyPending(id,index=1,count=1){await db.query(`insert into public.inscripciones(stripe_session_id,email,full_name,event_slug,amount_paid,payment_status,
  shirt_size,buyer_email,order_session_id,ticket_index,ticket_count,distance)
  values($1,'test@example.invalid','Legacy Runner','cascanueces-run',450,'pending','M','test@example.invalid',$2,$3,$4,'5K')`,[id+(count>1?'::'+index:''),id,index,count]);}
test.before(async()=>{db=new PGlite();await installFixture(db);});
test.after(async()=>{if(db)await db.close();});

test('deployed finalizer: modern order retains birth date, phone, state and borough',async()=>{
  await finalize('cs_modern');const [row]=await readOrder('cs_modern');
  assert.equal(row.birth_date,modern.birthDate);assert.equal(row.whatsapp,modern.whatsapp);
  assert.equal(row.state,modern.state);assert.equal(row.borough,modern.borough);
  assert.equal(row.payment_status,'paid');assert.equal(row.ticket_index,1);assert.equal(row.ticket_count,1);assert.ok(row.bib_number);
});
test('deployed legacy hotfix: valid supplied PR4 fields are intentionally kept NULL',async()=>{
  await legacyPending('cs_legacy');await finalize('cs_legacy');const [row]=await readOrder('cs_legacy');
  for(const key of ['birth_date','whatsapp','state','borough'])assert.equal(row[key],null,key);
  assert.equal(row.payment_status,'paid');assert.ok(row.bib_number);
});
test('deployed legacy hotfix: missing PR4 values finalize an existing legacy order',async()=>{
  await legacyPending('cs_legacy_missing');await finalize('cs_legacy_missing',[{ticketIndex:1,fullName:'Legacy Runner',shirtSize:'M'}]);
  const [row]=await readOrder('cs_legacy_missing');assert.equal(row.payment_status,'paid');assert.equal(row.whatsapp,null);
});
test('deployed legacy hotfix: one NULL legacy row clears PR4 for the whole order',async()=>{
  await legacyPending('cs_mixed',1,2);
  await finalize('cs_mixed',[modern,{...modern,ticketIndex:2,fullName:'Second Runner'}]);
  const rows=await readOrder('cs_mixed');assert.equal(rows.length,2);
  for(const row of rows)for(const key of ['birth_date','whatsapp','state','borough'])assert.equal(row[key],null);
});
test('deployed finalizer: new orders without PR4 still fail and create no rows',async()=>{
  await assert.rejects(finalize('cs_invalid_new',[{ticketIndex:1,fullName:'New Runner',shirtSize:'M'}]),/birthDate obligatoria/);
  assert.equal((await readOrder('cs_invalid_new')).length,0);
});
test('deployed finalizer: repeated paid legacy and modern orders preserve every field',async()=>{
  for(const id of ['cs_modern','cs_legacy','cs_legacy_missing','cs_mixed']) {
    const before=await readOrder(id);
    await finalize(id,before.map((_,i)=>({...modern,ticketIndex:i+1,fullName:'Changed name',whatsapp:'+525511111111'})));
    assert.deepEqual(await readOrder(id),before);
  }
});
test('deployed finalizer: changed PaymentIntent fails without changing paid records',async()=>{
  const before=await readOrder('cs_modern');
  await assert.rejects(db.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',['cs_modern','cascanueces-run','5K',450,'test@example.invalid','pi_wrong','evt_retry',JSON.stringify([modern])]),/distinto|PaymentIntent|payment_intent/i);
  assert.deepEqual(await readOrder('cs_modern'),before);
});
test('deployed finalizer: Axolote and Cascanueces keep event-scoped BIBs and contract',async()=>{
  for(const event of ['axolote-night-run','cascanueces-run']) {
    const r=await finalize('cs_compat_'+event,[modern],event);assert.equal(r.rows.length,1);
    assert.equal(r.rows[0].event_slug,event);assert.equal(r.rows[0].distance,'5K');assert.equal(r.rows[0].ticket_count,1);
  }
  assert.equal((await db.query("select bib_number from public.inscripciones where order_session_id='cs_compat_axolote-night-run'")).rows[0].bib_number,'001');
});
