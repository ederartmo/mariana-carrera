'use strict';
// Test-only adapter. Every call targets the supplied isolated PostgreSQL connection.
const assert=require('node:assert/strict');
function sqlAdapter(db, calls=[]) {
  const ident=s=>{assert.match(s,/^[a-z_][a-z0-9_]*$/);return '"'+s+'"';};
  return {
    async rpc(name,args){
      calls.push({name,args});
      const keys={record_perrun_payment_state:['p_order_session_id','p_stripe_event_id','p_payment_status'],finalize_perrun_paid_order:['p_order_session_id','p_payment_intent_id','p_stripe_event_id','p_confirmed_amount_cents','p_confirmed_currency']}[name];
      assert.ok(keys,'Unexpected RPC '+name);assert.deepEqual(Object.keys(args).sort(),[...keys].sort());
      try{return {data:(await db.query('select * from public.'+ident(name)+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>args[k]))).rows,error:null};}
      catch(error){return {data:null,error:{code:error.code,message:error.message}};}
    },
    from(table){
      assert.ok(['perrun_checkout_orders','registration_dogs','inscripciones','perrun_engraving_payments'].includes(table));
      let fields='*',payload=null,pendingEmail=false;const filters=[];
      const q={
        select(s){fields=s;return q;},update(p){payload=p;return q;},
        or(expr){assert.equal(expr,'email_sent.is.false,email_sent.is.null');pendingEmail=true;return q;},
        eq(k,v){filters.push([k,v,false]);return q;},in(k,v){filters.push([k,v,true]);return q;},order(){return q;},
        async maybeSingle(){const r=await run();return r.error?r:r.data.length>1?{data:null,error:{code:'MULTIPLE'}}:{data:r.data[0]||null,error:null};},
        then(resolve,reject){return run().then(resolve,reject);}
      };
      async function run(){
        const values=[];const add=v=>{values.push(v);return '$'+values.length;};
        const set=payload?Object.entries(payload).map(([k,v])=>ident(k)+'='+add(v)).join(','):'';
        let where=filters.map(([k,v,many])=>ident(k)+(many?' in ('+v.map(add).join(',')+')':'='+add(v))).join(' and ');
        if(pendingEmail)where+=(where?' and ':'')+'(email_sent is false or email_sent is null)';
        const cols=fields==='*'?'*':fields.split(',').map(x=>ident(x.trim())).join(',');
        const sql=payload?'update public.'+ident(table)+' set '+set+(where?' where '+where:'')+' returning '+cols:'select '+cols+' from public.'+ident(table)+(where?' where '+where:'');
        try{return {data:(await db.query(sql,values)).rows,error:null};}catch(error){return {data:null,error:{code:error.code,message:error.message}};}
      }
      return q;
    }
  };
}
module.exports={sqlAdapter};
