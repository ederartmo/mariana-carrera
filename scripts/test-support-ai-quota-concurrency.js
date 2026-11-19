'use strict';

// Disposable local Docker only; no ports, network, remote credentials or bound volumes.
const {spawn,execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const {setTimeout:wait}=require('node:timers/promises');
const name='support-ai-quota-qa-'+randomUUID();
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:15000}).trim();
const psql=['psql','-X','-Atq','-v','ON_ERROR_STOP=1','-U','postgres'];
const sql=body=>docker(['exec','-i',name,...psql],body);
function session(body) {
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',name,...psql],{stdio:['pipe','pipe','pipe']});
    let output='',error='';
    child.stdout.on('data',x=>output+=x);
    child.stderr.on('data',x=>error+=x);
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(output.trim()):reject(Error(error)));
    child.stdin.end(body);
  });
}
async function main() {
  docker(['run','--rm','--detach','--pull','never','--network','none','--name',name,
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.11-bookworm']);
  try {
    let ready=false;
    for(let i=0;i<40&&!ready;i++){
      try {ready=sql('show listen_addresses;')==='*';} catch {}
      if(!ready) await wait(250);
    }
    assert.ok(ready);
    sql('create role anon; create role authenticated; create role service_role;\n'+readFileSync(
      'supabase/migrations/20261119030000_support_ai_evaluation_quota.sql','utf8'));
    const probe=async (tenant,same,limit,budget,expected)=>{
      sql("insert into support_ai_limits values ('"+tenant+"',true,'fixture',"+limit+","+budget+",250000,2000000);");
      const id=randomUUID(), second=same?id:randomUUID();
      const reserve=x=>"select reserve_support_ai_attempt('"+tenant+"','"+x+"','fixture',600,96);";
      const writer=session("set application_name='quota-first'; begin; set local role service_role; "+reserve(id)+" select pg_sleep(5); commit;");
      let observed=false;
      for(let i=0;i<30&&!observed;i++){
        observed=sql("select exists(select 1 from pg_stat_activity where application_name='quota-first' and wait_event='PgSleep');")==='t';
        if(!observed)await wait(100);
      }
      assert.ok(observed);
      const contender=session("set application_name='quota-second'; set role service_role; "+reserve(second));
      let blocked=false;
      for(let i=0;i<20&&!blocked;i++){
        blocked=sql("select exists(select 1 from pg_stat_activity where application_name='quota-second' and wait_event_type='Lock');")==='t';
        if(!blocked)await wait(100);
      }
      const results=await Promise.all([writer,contender]);
      assert.ok(blocked,'second independent session must actually wait on a lock');
      assert.equal(results[0],'reserved');
      assert.equal(results[1],expected);
      assert.equal(sql("select count(*) from support_ai_attempts where tenant_id='"+tenant+"';"),'1');
    };
    await probe('dedupe',true,10,10000,'duplicate');
    await probe('requests',false,1,10000,'rate_limit');
    await probe('budget',false,10,342,'budget_limit');
    console.log('PASS: three independent session races (duplicate, request cap, budget cap)');
  } finally { docker(['stop','--time','1',name]); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
