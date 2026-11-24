'use strict';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const {resolveTenant} = require('./tenants');

function createPrivateResponsesProvider({env=process.env, rpc, attemptId, fetchImpl=globalThis.fetch,diagnostic,tools=[]}={}) {
  const tenant=resolveTenant(env);
  const model=env.SUPPORT_AI_MODEL;
  const key=env.SUPPORT_AI_OPENAI_API_KEY;
  if (!tenant || env.SUPPORT_AI_PRIVATE_ENABLED!=='true' ||
      !/^[a-z0-9][a-z0-9.-]{0,99}$/.test(model || '') ||
      typeof key!=='string' || !key.trim() || typeof rpc!=='function' ||
      typeof fetchImpl!=='function' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(attemptId || '')) return undefined;
  let started=false;

  return async (payload,{tenantId,signal}) => {
    if (started || tenantId!==tenant.id || payload.model!==model || !(signal instanceof AbortSignal) || signal.aborted ||
        env.SUPPORT_AI_PRIVATE_ENABLED!=='true') throw Error('private_provider_blocked');
    started=true;
    const inputCap=Buffer.byteLength(JSON.stringify(payload),'utf8')+512;
    const outputCap=payload.max_output_tokens;
    const identity={p_tenant:tenant.id,p_attempt:attemptId};
    let answer, stage='reservation', startedAt=performance.now(), errorType;
    const report=(type)=>diagnostic?.({stage,durationMs:Math.round(performance.now()-startedAt),type});
    const next=(name)=>{report('ok');stage=name;startedAt=performance.now();};
    try {
      const reservation=await rpc('reserve_support_ai_attempt',
        {...identity,p_model:model,p_input:inputCap,p_output:outputCap});
      if (reservation?.error || reservation?.data!=='reserved' || signal?.aborted ||
          env.SUPPORT_AI_PRIVATE_ENABLED!=='true') throw Error();
      next('provider');
      const response=await fetchImpl(ENDPOINT,{
        method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify({model,store:false,tools,...(tools.length ? {parallel_tool_calls:false} : {}),
          instructions:payload.instructions,input:payload.input,
          text:payload.text,max_output_tokens:outputCap}),
      });
      if (!response.ok || signal.aborted){errorType='http';throw Error();}
      next('response');
      answer=await response.json();
      const usage=answer?.usage;
      if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens)) {
        next('usage');
        const saved=await rpc('record_support_ai_usage',
          {...identity,p_input:usage.input_tokens,p_output:usage.output_tokens});
        if (saved?.error || saved?.data!==true) throw Error();
      } else {errorType='invalid_response';throw Error();}
      next('validation');
      if(answer.model!==model || !Array.isArray(answer.output))throw Error();
      report('ok');
    } catch {
      // Never release the reservation or include provider errors/HTTP bodies in diagnostics.
      report(signal.aborted?'timeout':errorType||({provider:'transport',response:'invalid_response',usage:'usage_record_failed',reservation:'reservation_failed'}[stage]||'invalid_response'));
      throw Error('private_provider_failed');
    }
    // Responses can include reasoning metadata ahead of the assistant message.
    return {...answer,output:answer.output.filter(item=>item?.type!=='reasoning')};
  };
}

module.exports={createPrivateResponsesProvider};
