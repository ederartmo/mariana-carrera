'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const prior = require('./perrun-admin-edit-cases.cjs');
const { human, dog } = require('./perrun-manual-fixture.cjs');
const migration = '20261002232521_perrun_payment_v2.sql';
const args = {
 reserve_perrun_checkout_v2: ['p_attempt_id','p_payload','p_source'],
 begin_perrun_checkout_v2: ['p_reservation_id','p_payload'],
 attach_perrun_checkout_v2: ['p_reservation_id','p_session_id','p_expires_at'],
 record_perrun_reservation_v2: ['p_reservation_id','p_state','p_session_id','p_voucher_expires_at'],
 finalize_perrun_reservation_v2: ['p_reservation_id','p_session_id','p_payment_intent_id','p_stripe_event_id','p_amount_cents','p_currency','p_transfer_reference','p_admin_user_id','p_admin_email'],
};
async function install(db) { await prior.install(db); await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration),'utf8')); }
const payload = (weights=[10], requested=weights.map(()=>true)) => ({eventSlug:'perrun-2027',distance:'3K',email:'qa@example.invalid',participant:{...human},dogs:weights.map((w,i)=>({...dog(w,requested[i]),name:'Dog '+(i+1)}))});
async function reserve(db, {attempt=crypto.randomUUID(),data=payload(),source='stripe'}={}) { return (await db.query('select public.reserve_perrun_checkout_v2($1,$2::jsonb,$3) as result',[attempt,JSON.stringify(data),source])).rows[0].result; }
async function attach(db,r,id='cs_test_'+r.attempt_id.replaceAll('-','')) {
 const creating=(await db.query('select * from public.begin_perrun_checkout_v2($1,$2::jsonb)',[r.id,JSON.stringify(r.payload)])).rows[0];
 return (await db.query('select * from public.attach_perrun_checkout_v2($1,$2,$3)',[r.id,id,creating.checkout_expires_at])).rows[0];
}
async function finalize(db,r,{amount=r.amount_cents,currency='mxn',pi='pi_'+r.attempt_id.replaceAll('-',''),event='evt_v2',reference='QA-REF'}={}) {
 return (await db.query('select * from public.finalize_perrun_reservation_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',[r.id,r.source==='stripe'?r.stripe_session_id:null,r.source==='stripe'?pi:null,r.source==='stripe'?event:null,amount,currency,r.source==='manual_transfer'?reference:null,r.source==='manual_transfer'?'00000000-0000-4000-8000-000000000001':null,r.source==='manual_transfer'?'admin@example.invalid':null])).rows;
}
async function seed(db,n) {
 // Isolated synthetic fixture only. Never called by application/QA launcher.
 await db.query("update public.perrun_promo_slots set status='consumed',legacy_sequence=slot where slot<=$1 and status='available'",[Math.min(n,300)]);
 await db.query('update public.perrun_paid_dog_counter set last_sequence=$1',[n]);
}
function adapter(db,calls=[]) {
 const base=require('./perrun-payment-sql-adapter.cjs').sqlAdapter(db,calls);
 return {
  async rpc(name,input) {
   if(!args[name])return base.rpc(name,input);
   calls.push({name,args:input});
   try {
    const values=args[name].map(k=>input[k]&&typeof input[k]==='object'?JSON.stringify(input[k]):input[k]);
    const result=await db.query('select * from public.'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+')',values);
    return {data:name==='reserve_perrun_checkout_v2'?result.rows[0][name]:name==='finalize_perrun_reservation_v2'?result.rows:result.rows[0],error:null};
   }catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  },
  from(table) {
   if(table!=='perrun_checkout_reservations')return base.from(table);
   let id,column;const q={select(){return q;},eq(k,v){if(!['id','attempt_id'].includes(k))throw Error('Unexpected fixture filter');column=k;id=v;return q;},async maybeSingle(){try{return {data:(await db.query('select * from public.perrun_checkout_reservations where '+column+'=$1',[id])).rows[0]||null,error:null};}catch(e){return {data:null,error:e};}}};return q;
  },
 };
}
module.exports={install,payload,reserve,attach,finalize,seed,adapter,migration,args};
