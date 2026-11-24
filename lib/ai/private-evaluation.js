'use strict';

const {createEvaluationService}=require('./openai-responses');
const {createPrivateResponsesProvider}=require('./private-responses-provider');
const {resolveTenant}=require('./tenants');
const {conversationTools,evaluateConversation}=require('./support-conversation');

// Internal composition only: not registered in an API, worker, or CLI.
// The caller owns authorization, the server-generated attempt ID and verified context.
async function evaluatePrivately({env=process.env,rpc,attemptId,fetchImpl,limits,now,input,diagnostic,conversational,conversationMessages}={}) {
  const tenant=resolveTenant(env);
  if (!tenant || (input?.history!==undefined && (!Array.isArray(input.history)||input.history.length))) {
    return {decision:'escalate',reason:'private_history_excluded'};
  }
  const withTools=Array.isArray(conversationMessages);
  if (withTools && (input?.context?.tenantId!==tenant.id || input.context.historyVerified!==true ||
      input.context.status!=='pending' || input.context.automationPausedAt!==null || input.context.humanIntervened!==false)) {
    return {decision:'escalate',reason:'unverified_history'};
  }
  const provider=createPrivateResponsesProvider({env,rpc,attemptId,fetchImpl,diagnostic,tools:withTools?conversationTools:[]});
  if (!provider) return {decision:'escalate',reason:'provider_disabled'};
  const startedAt=performance.now();
  const result=withTools
    ? await evaluateConversation({provider,model:env.SUPPORT_AI_MODEL,tenantId:tenant.id,message:input.message,
      messages:conversationMessages,now,timeoutMs:limits?.timeoutMs})
    : await createEvaluationService({env,provider,limits:{...limits,model:env.SUPPORT_AI_MODEL},now,conversational}).evaluate(input);
  const type=result.validationIssue||result.validationNotice||{provider_timeout:'timeout',invalid_usage:'invalid_response',invalid_provider_output:'invalid_response'}[result.reason];
  if(type)diagnostic?.({stage:'evaluation',durationMs:Math.round(performance.now()-startedAt),type});
  return result;
}

module.exports={evaluatePrivately};
