'use strict';

const {evaluatePrivately} = require('./private-evaluation');
const {resolveTenant} = require('./tenants');

// Internal composition only. Never mounted on a route or scheduled here.
async function runShadowOnce({env=process.env,rpc,fetchImpl,limits,now,diagnostic,resolveMessage,conversational,onGroundedResponse}={}) {
  const tenant=resolveTenant(env);
  if (env.SUPPORT_AI_SHADOW_ENABLED!=='true' || env.SUPPORT_AI_PRIVATE_ENABLED!=='true' ||
      !tenant || typeof rpc!=='function' || !env.SUPPORT_AI_MODEL || !env.SUPPORT_AI_OPENAI_API_KEY) {
    return {state:'disabled'};
  }
  const p_tenant=tenant.id;
  const call=async(name,args)=>{
    const r=await rpc(name,{...args,p_tenant});
    if (!r || r.error) throw Error('shadow_rpc_failed');
    return r.data;
  };
  const job=await call('claim_support_shadow_job',{});
  if (!job) return {state:'empty'};
  if(job.state!=='claimed')return {state:job.state==='uncertain'?'uncertain':'denied'};
  const fence={p_job:job.id,p_token:job.token};
  const gate=await call('gate_support_shadow_job',fence);
  const finish=(p_status,extra={})=>call('finish_support_shadow_job',{...fence,p_status,...extra});
  if(gate?.state!=='eligible' || typeof gate.body!=='string') {
    return {state:gate?.state==='obsolete'?await finish('skipped'):'denied'};
  }
  let reservationStarted=false, quotaRefused=false, transitionUncertain=false;
  const quota=async(name,args)=>{
    if(args.p_tenant!==p_tenant || args.p_attempt!==job.attempt_id) return {error:true};
    try {
      if(name==='reserve_support_ai_attempt' && !reservationStarted) {
        reservationStarted=true;
        const r=await call('gate_support_shadow_job',{...fence,p_model:args.p_model,p_input:args.p_input,p_output:args.p_output});
        quotaRefused=['rate_limit','budget_limit','disabled','obsolete','denied','invalid'].includes(r?.state);
        transitionUncertain=!quotaRefused && r?.state!=='reserved';
        return {data:r?.state};
      }
      if(name==='record_support_ai_usage' && reservationStarted && !quotaRefused && !transitionUncertain) {
        return {data:await call(name,{p_attempt:job.attempt_id,p_input:args.p_input,p_output:args.p_output})};
      }
    } catch { transitionUncertain=true; }
    return {error:true};
  };
  const input=resolveMessage ? resolveMessage(gate.body) : {message:gate.body};
  const result=await evaluatePrivately({env,rpc:quota,fetchImpl,limits,now,diagnostic,conversational,attemptId:job.attempt_id,
    input:{message:input.message,history:[],context:{tenantId:p_tenant,status:'pending',
      automationPausedAt:null,humanIntervened:false,historyVerified:true,allowEventClarification:input.allowEventClarification}}});
  if(transitionUncertain) return {state:'uncertain'}; // Let the ledger govern lease recovery.
  const safeReasons=new Set(['insufficient_information','needs_operator','unsafe_input','self_service_unavailable']);
  if(quotaRefused) return {state:await finish('skipped')};
  if(result.decision!=='respond' && !safeReasons.has(result.reason)) return {state:await finish('failed')};
  const source=result.decision==='respond'?result.sources?.[0]?.id:null;
  if(result.decision==='respond' && !tenant.knowledge.sources.some(s=>s.id===source)) return {state:await finish('failed')};
  if(result.decision==='respond')onGroundedResponse?.({source,body:result.response,sources:result.sources});
  return {state:await finish('proposal',{p_knowledge:tenant.knowledge.version,p_model:env.SUPPORT_AI_MODEL,
    p_decision:result.decision,p_source:source,p_reason:result.reason||null})};
}
module.exports={runShadowOnce};
