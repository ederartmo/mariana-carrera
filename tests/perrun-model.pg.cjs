'use strict';
// Isolated PostgreSQL engine, never loads .env.local or connects to a server.
// Usage: node tests/perrun-model.pg.cjs <absolute path to @electric-sql/pglite>
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.argv[2] || '@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migrations=fs.readdirSync(path.join(root,'supabase','migrations')).filter(n=>n.endsWith('_perrun_phase1_model.sql'));
if(migrations.length!==1) throw new Error('Expected one Perrun model migration');
const db=new PGlite();
let pass=0;
const human={fullName:'Test Human',email:'test@example.invalid',shirtSize:'M',birthDate:'1990-01-01',whatsapp:'+525500000000',state:'Estado de México',ticketIndex:1};
const dogs=[{name:'Luna',weightKg:10,engravingRequested:true},{name:'Sol',weightKg:25,engravingRequested:true}];
async function prepare(id,list=dogs){return db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)',[id,'3K','test@example.invalid',JSON.stringify(human),JSON.stringify(list),'presale','2026-10-31T23:59:59-06:00']);}
async function finalize(id,amount=63000,intent='pi_'+id){return (await db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)',[id,intent,'evt_'+id,amount,'mxn'])).rows;}
async function check(name,run){await run();pass++; console.log('PASS '+name);}
(async()=>{
  await require('./helpers/perrun-schema-fixture.cjs').installFixture(db);

  await check('migration executes on isolated PostgreSQL',()=>db.exec(fs.readFileSync(path.join(root,'supabase','migrations',migrations[0]),'utf8')));
  await check('empty installation rollback works and migration reapplies',async()=>{
    await db.exec(fs.readFileSync(path.join(root,'desc','perrun-phase1-rollback.sql'),'utf8'));
    assert.equal((await db.query("select to_regclass('public.registration_dogs') as table_name")).rows[0].table_name,null);
    await db.exec(fs.readFileSync(path.join(root,'supabase','migrations',migrations[0]),'utf8'));
  });
  await check('drafts allocate zero positions',async()=>{await prepare('cs_first');const r=await db.query('select last_sequence from public.perrun_paid_dog_counter');assert.equal(Number(r.rows[0].last_sequence),0);assert.equal((await db.query('select * from public.registration_dogs')).rows.length,0);});
  await check('draft idempotency and payload conflict',async()=>{await prepare('cs_first');await assert.rejects(prepare('cs_first',[dogs[0]]),/conflict/);});
  await check('rollback refuses to delete any existing history',async()=>{
    await assert.rejects(db.exec(fs.readFileSync(path.join(root,'desc','perrun-phase1-rollback.sql'),'utf8')),/Rollback refused/);
    await db.exec('rollback');
    assert.equal((await db.query('select * from public.perrun_checkout_orders')).rows.length,1);
  });
  await check('SQL enforces stage calendar and exact closure',async()=>{
    for(const [stage,time] of [['presale','2026-11-01T00:00:00-06:00'],['general','2027-01-01T00:00:00-06:00'],['late','2027-01-25T16:00:00-06:00']]) {
      await assert.rejects(db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)',['cs_bad_stage','3K','test@example.invalid',JSON.stringify(human),JSON.stringify(dogs),stage,time]),/perrun_quote_time/);
    }
  });
  await check('database rejects two dogs including L',async()=>{await assert.rejects(prepare('cs_invalid',[dogs[0],{...dogs[1],weightKg:26}]),/Invalid Perrun dogs/);});
  await check('database rejects missing engraving choice',async()=>{await assert.rejects(prepare('cs_invalid',[{name:'Dog',weightKg:10}]),/Invalid Perrun dogs/);});
  await check('wrong confirmed amount rolls back without position',async()=>{await assert.rejects(finalize('cs_first',45000),/mismatch/);assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),0);});
  await db.exec('update public.perrun_paid_dog_counter set last_sequence=298');
  await check('298 plus two paid dogs yields 299/300 and one human/BIB',async()=>{const r=await finalize('cs_first');assert.deepEqual(r.map(d=>Number(d.engraving_sequence)),[299,300]);assert.ok(r.every(d=>d.engraving_free));const humans=(await db.query("select * from public.inscripciones where order_session_id='cs_first'")).rows;assert.equal(humans.length,1);assert.equal(humans[0].ticket_count,1);assert.ok(humans[0].bib_number);assert.equal(Number(humans[0].amount_paid),630);});
  await check('repeated webhook consumes no positions and preserves human edits',async()=>{await db.exec("update public.inscripciones set full_name='Admin edit' where order_session_id='cs_first'");assert.deepEqual((await finalize('cs_first')).map(d=>Number(d.engraving_sequence)),[299,300]);assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),300);assert.equal((await db.query("select full_name from public.inscripciones where order_session_id='cs_first'")).rows[0].full_name,'Admin edit');await assert.rejects(finalize('cs_first',63000,'pi_different'),/identity conflict/);});
  await check('301 requested requires separate 35 MXN',async()=>{await prepare('cs_next',[dogs[0]]);const r=await finalize('cs_next',45000);assert.equal(Number(r[0].engraving_sequence),301);assert.equal(r[0].engraving_payment_required,true);assert.equal(r[0].engraving_payment_amount_cents,3500);assert.equal((await db.query('select * from public.perrun_engraving_payments')).rows.length,0);});
  await check('refund/cancellation never returns historical position',async()=>{await db.exec("update public.inscripciones set payment_status='refunded',registration_status='cancelled' where order_session_id='cs_next'");await finalize('cs_next',45000);await prepare('cs_after',[{...dogs[0],engravingRequested:false}]);const r=await finalize('cs_after',45000);assert.equal(Number(r[0].engraving_sequence),302);assert.equal(r[0].engraving_payment_required,false);assert.equal(r[0].dog_name_for_plate,null);assert.equal(r[0].owner_phone_for_plate,null);});
  await check('crossing 300 uses dog_index deterministically',async()=>{await db.exec('truncate public.perrun_engraving_payments,public.registration_dogs,public.perrun_checkout_orders cascade; delete from public.inscripciones; update public.perrun_paid_dog_counter set last_sequence=299;');await prepare('cs_cross');const r=await finalize('cs_cross');assert.deepEqual(r.map(d=>[d.dog_index,Number(d.engraving_sequence),d.engraving_free]),[[1,300,true],[2,301,false]]);});
  await check('dog insert failure rolls back human and counter',async()=>{await prepare('cs_rollback',[dogs[0]]);await db.exec("create function public.test_fail_dogs() returns trigger language plpgsql as $$ begin raise exception 'injected dog failure'; end $$; create trigger test_fail_dogs before insert on public.registration_dogs for each row execute function public.test_fail_dogs();");await assert.rejects(finalize('cs_rollback',45000),/injected dog failure/);assert.equal((await db.query("select * from public.inscripciones where order_session_id='cs_rollback'")).rows.length,0);assert.equal(Number((await db.query('select last_sequence from public.perrun_paid_dog_counter')).rows[0].last_sequence),301);assert.equal((await db.query("select finalized_at from public.perrun_checkout_orders where order_session_id='cs_rollback'")).rows[0].finalized_at,null);await db.exec('drop trigger test_fail_dogs on public.registration_dogs; drop function public.test_fail_dogs();');});
  await check('RLS enabled, browser roles denied, service direct ledger writes denied',async()=>{const tables=['perrun_checkout_orders','perrun_paid_dog_counter','registration_dogs','perrun_engraving_payments'];for(const name of tables){assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+name])).rows[0].relrowsecurity,true);for(const role of ['anon','authenticated']){assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,'public.'+name,'SELECT'])).rows[0].allowed,false);}}assert.equal((await db.query("select has_table_privilege('service_role','public.perrun_paid_dog_counter','UPDATE') as allowed")).rows[0].allowed,false);assert.equal((await db.query("select has_function_privilege('anon','public.finalize_perrun_paid_order(text,text,text,integer,text)','EXECUTE') as allowed")).rows[0].allowed,false);await db.exec('set role anon');await assert.rejects(db.query("select * from public.finalize_perrun_paid_order('cs_cross','pi_cs_cross','evt_repeat',63000,'mxn')"),/permission denied/);await db.exec('reset role');});
  await check('service role can use protected wrapper but cannot delete history',async()=>{await db.exec('set role service_role');assert.equal((await finalize('cs_cross')).length,2);await assert.rejects(db.exec('delete from public.registration_dogs'),/permission denied/);await db.exec('reset role');});
  await check('existing finalizer stays usable for Axolote and Cascanueces',async()=>{for(const event of ['axolote-night-run','cascanueces-run']){const id='cs_'+event;await db.query('select * from public.finalize_paid_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,event,'5K',450,'test@example.invalid','pi_'+event,'evt_'+event,JSON.stringify([human])]);assert.equal((await db.query('select * from public.inscripciones where order_session_id=$1',[id])).rows.length,1);}});
  console.log('POSTGRES_LOCAL_PASS='+pass);
  console.log('CONCURRENT_MULTI_CONNECTION_TEST=NOT_RUN (embedded engine has one connection)');
  await db.close();
})().catch(async error=>{console.error(error.message);await db.close();process.exitCode=1;});
