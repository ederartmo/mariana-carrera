'use strict';

const {runShadowOnce}=require('./support-shadow-worker');
const {resolveTenant}=require('./tenants');
const {UUID,rpcData}=require('../_support');
const handoff='No tengo información aprobada suficiente para responder con confianza. El equipo de soporte revisará tu solicitud.';

async function dispatchAuto({data,requestId,env=process.env,rpc,now=Date.now,fetchImpl}){
  const tenant=resolveTenant(env);
  const start=env.SUPPORT_AI_AUTO_REPLY_START_AT || '';
  if(!tenant||env.SUPPORT_AI_AUTO_REPLY_ENABLED!=='true'||env.SUPPORT_AI_SHADOW_ENABLED!=='true'||
    env.SUPPORT_AI_PRIVATE_ENABLED!=='true'||!env.SUPPORT_AI_OPENAI_API_KEY||!env.SUPPORT_AI_MODEL||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(start)||
    !Number.isFinite(Date.parse(start))||Date.parse(start)>now()||
    !data?.ok||!UUID.test(data.ticket?.id||'')||!UUID.test(requestId||''))return false;
  let published=false;
  const limitedRpc=async(name,args)=>{
    if(args?.p_tenant!==tenant.id)throw Error('wrong_auto_tenant');
    if(name==='claim_support_shadow_job')return rpc('support_auto_claim',{
      p_tenant:tenant.id,p_ticket:data.ticket.id,p_request:requestId,p_not_before:start
    });
    if(name==='finish_support_shadow_job'){
      if(args.p_status!=='proposal')return rpc(name,args);
      let body=handoff;
      if(args.p_decision==='respond'){
        const source=tenant.knowledge.sources.find(s=>s.id===args.p_source);
        if(!source||args.p_knowledge!==tenant.knowledge.version||
          (source.expiresAt&&!(Date.parse(source.expiresAt)>now())))return rpc(name,{
            p_tenant:tenant.id,p_job:args.p_job,p_token:args.p_token,p_status:'failed',
          });
        body=source.text;
      }else if(args.p_decision!=='escalate'||args.p_knowledge!==tenant.knowledge.version){
        throw Error('invalid_auto_decision');
      }
      const outcome=await rpc('support_auto_finish',{...args,p_body:body});
      published=outcome?.error==null&&rpcData(outcome?.data)==='published';
      return outcome;
    }
    if(name!=='gate_support_shadow_job'&&name!=='record_support_ai_usage')throw Error('unknown_auto_operation');
    return rpc(name,args);
  };
  await runShadowOnce({env,rpc:limitedRpc,now,fetchImpl});
  return published;
}

module.exports={dispatchAuto};
