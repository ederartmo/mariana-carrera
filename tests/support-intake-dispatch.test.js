'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {enabled,dispatch}=require('../lib/support-intake-dispatch');

const ticketId=randomUUID(), sourceId=randomUUID(), hash='c'.repeat(64);
const base={ok:true,ticket:{id:ticketId,category:'events',status:'pending',version:2},
  messages:[{id:sourceId,author:'visitor',body:'Consulta'}],hasMore:false};
const cutoff='2026-11-19T00:00:00.000Z';
const env={SUPPORT_INTAKE_ENABLED:'true',SUPPORT_INTAKE_START_AT:cutoff};
const now=()=>Date.parse('2026-11-19T00:01:00.000Z');
test('fails closed without activation or valid cutoff',()=>{
  for(const e of [
    {}, {SUPPORT_INTAKE_ENABLED:'false',SUPPORT_INTAKE_START_AT:cutoff},
    {SUPPORT_INTAKE_ENABLED:'true'},
    {SUPPORT_INTAKE_ENABLED:'true',SUPPORT_INTAKE_START_AT:'bad'},
    {SUPPORT_INTAKE_ENABLED:'true',SUPPORT_INTAKE_START_AT:'2026-12-01T00:00:00.000Z'}
  ]) assert.equal(enabled(e,now()),false);
  assert.equal(enabled(env,now()),true);

});
test('disabled flow never calls database and returns original transcript',async()=>{
  const result=await dispatch({data:base,capabilityHash:hash,env:{},rpc:async()=>assert.fail('unexpected rpc'),now});
  assert.equal(result,base);
});
test('enabled start writes once then reads same visitor conversation for the agent response',async()=>{
  const calls=[];
  const visible={...base,messages:[...base.messages,{id:randomUUID(),author:'agent',body:'Recibimos tu solicitud'}]};
  const result=await dispatch({data:base,capabilityHash:hash,env,now,ownerUserId:null,
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='support_agent_acknowledge_first')return {data:{ok:true,status:'created'}};
      if(name==='support_visitor_action')return {data:visible};
      throw Error('unexpected');
    }});
  assert.equal(result,visible);
  assert.deepEqual(calls.map(x=>x.name),['support_agent_acknowledge_first','support_visitor_action']);
  assert.equal(calls[0].args.p_source_message_id,sourceId);
  assert.equal(calls[0].args.p_not_before,cutoff);
  assert.equal(calls[0].args.p_body,'Recibimos tu solicitud #'+ticketId.slice(0,8).toUpperCase()+'.');
  assert.equal(base.ticket.category,'events');
  assert.equal(calls[1].args.p_capability_hash,hash);
  assert.equal(calls[1].args.p_action,'read');
});
test('failed or rejected acknowledgement cannot fail an already-saved visitor ticket',async()=>{
  for(const response of [{error:{message:'fixture'}},{data:{error:'source_not_eligible'}}]){
    const result=await dispatch({data:base,capabilityHash:hash,env,now,rpc:async()=>response});
    assert.equal(result,base);
  }
  const result=await dispatch({data:base,capabilityHash:hash,env,now,
    rpc:async()=>{throw Error('fixture database unavailable')}});
  assert.equal(result,base);
});
test('invalid result or capability never triggers privileged RPC',async()=>{
  for(const data of [null,{ok:false}, {...base,ticket:{id:'bad'}}, {...base,messages:[]}]) {
    assert.equal(await dispatch({data,capabilityHash:hash,env,now,
      rpc:async()=>assert.fail('unexpected rpc')}),data);
  }
  assert.equal(await dispatch({data:base,capabilityHash:'wrong',env,now,
    rpc:async()=>assert.fail('unexpected rpc')}),base);
});
