'use strict';
// Extension of the isolated localhost-only native PostgreSQL runner. Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const f=require('./helpers/perrun-manual-fixture.cjs');
module.exports=async({admin,a,b,check,blockedBy,evidence})=>{
  const root=path.resolve(__dirname,'..');
  const apply=async name=>admin.query(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  if(!(await admin.query("select 1 from information_schema.columns where table_name='perrun_checkout_orders' and column_name='payment_status'")).rowCount)await apply('20261001113351_perrun_payment_state.sql');
  if(!(await admin.query("select 1 from information_schema.columns where table_name='perrun_engraving_payments' and column_name='confirmation_email_id'")).rowCount)await apply('20261001162118_perrun_engraving_payment_persistence.sql');
  await apply(f.migration);
  const reset=async n=>{await admin.query('truncate public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders,public.inscripciones');await admin.query('update public.perrun_paid_dog_counter set last_sequence=$1',[n]);};
  async function race(first,second,{fail=false}={}){
    await a.query('begin');await b.query('begin');
    await a.query("select pg_advisory_xact_lock(123456789,hashtext('perrun-2027'))");
    const pending=second(b).then(value=>({value}),error=>({error}));
    await blockedBy(evidence.connections.B,evidence.connections.A);
    let left;
    try { left=await first(a); if(fail)throw Error('Expected injected failure'); await a.query('commit'); }
    catch(error){await a.query('rollback');if(!fail)throw error;assert.match(error.message,/second dog failure/);}
    const right=await pending;
    if(right.error){await b.query('rollback');throw right.error;}
    await b.query('commit');return [left,right.value];
  }
  async function verify(initial,total,humans){
    const d=(await admin.query('select * from public.registration_dogs order by engraving_sequence')).rows;
    assert.deepEqual(d.map(x=>Number(x.engraving_sequence)),Array.from({length:total},(_,i)=>initial+i+1));
    for(const dog of d){assert.equal(dog.engraving_free,Number(dog.engraving_sequence)<=300);assert.equal(dog.engraving_payment_required,Number(dog.engraving_sequence)>300&&dog.engraving_requested);}
    assert.equal(Number((await admin.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),initial+total);
    const h=(await admin.query('select * from public.inscripciones order by bib_number')).rows;
    assert.equal(h.length,humans);assert.equal(new Set(h.map(x=>x.bib_number)).size,humans);
    assert.equal((await admin.query('select * from public.perrun_engraving_payments')).rowCount,0);
  }
  await check('Manual native: same ID concurrent creates one human/BIB and two positions',async()=>{
    await reset(299);const values=f.args({dogs:[f.dog(3),f.dog(25)]});
    const [left,right]=await race(c=>f.manual(c,values),c=>f.manual(c,values));assert.deepEqual(left,right);await verify(299,2,1);
  });
  await check('Manual native: separate manual payments serialize BIBs and 299/300/301',async()=>{
    await reset(298);const first=f.args({dogs:[f.dog(3,false),f.dog(25)]}),second=f.args();
    await race(c=>f.manual(c,first),c=>f.manual(c,second));await verify(298,3,2);
  });
  for(const manualFirst of [true,false])await check('Manual native: manual vs Stripe, '+(manualFirst?'manual':'Stripe')+' first',async()=>{
    await reset(299);const values=f.args({dogs:[f.dog(3),f.dog(25)]}),s=f.args(),id='cs_real_native_manual_mix';
    await admin.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',[id,...s.slice(1,7)]);
    const stripe=c=>c.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[id,'pi_native_mix','evt_native_mix',s[7],'mxn']);
    const manual=c=>f.manual(c,values);
    await race(manualFirst?manual:stripe,manualFirst?stripe:manual);await verify(299,3,2);
  });
  await check('Manual native: second dog rollback lets waiting payment consume original sequence/BIB',async()=>{
    await reset(299);const failed=f.args({dogs:[f.dog(),f.dog()]}),good=f.args();
    await admin.query("create function public.fail_manual_second() returns trigger language plpgsql as $$ begin if new.order_session_id='manual_perrun_"+failed[0]+"' and new.dog_index=2 then raise exception 'second dog failure'; end if; return new; end $$; create trigger fail_manual_second before insert on public.registration_dogs for each row execute function public.fail_manual_second()");
    try { const [,right]=await race(c=>f.manual(c,failed),c=>f.manual(c,good),{fail:true});assert.equal(right[0].bib_number,'001');await verify(299,1,1);assert.equal((await admin.query('select * from public.perrun_checkout_orders where manual_payment_id=$1',[failed[0]])).rowCount,0); }
    finally { await admin.query('drop trigger fail_manual_second on public.registration_dogs; drop function public.fail_manual_second()'); }
  });
  await check('Manual native: refund of highest historical BIB followed by concurrent Stripe/manual',async()=>{
    await reset(0);const [h]=await f.manual(admin);await admin.query("update public.inscripciones set payment_status='refunded',registration_status='cancelled' where id=$1",[h.id]);
    const manual=f.args(),s=f.args(),id='cs_native_after_refund';
    await admin.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',[id,...s.slice(1,7)]);
    await race(c=>f.manual(c,manual),c=>c.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[id,'pi_native_after_refund','evt_native_after_refund',s[7],'mxn']));
    await verify(0,3,3);assert.deepEqual((await admin.query('select bib_number from public.inscripciones order by bib_number')).rows.map(x=>x.bib_number),['001','002','003']);
  });
};
