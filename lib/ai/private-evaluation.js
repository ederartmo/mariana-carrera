'use strict';

const {createEvaluationService}=require('./openai-responses');
const {createPrivateResponsesProvider}=require('./private-responses-provider');
const {resolveTenant}=require('./tenants');

// Internal composition only: not registered in an API, worker, or CLI.
// The caller owns authorization, the server-generated attempt ID and verified context.
async function evaluatePrivately({env=process.env,rpc,attemptId,fetchImpl,limits,now,input}={}) {
  const tenant=resolveTenant(env);
  if (!tenant || (input?.history!==undefined && (!Array.isArray(input.history)||input.history.length))) {
    return {decision:'escalate',reason:'private_history_excluded'};
  }
  const provider=createPrivateResponsesProvider({env,rpc,attemptId,fetchImpl});
  if (!provider) return {decision:'escalate',reason:'provider_disabled'};
  const service=createEvaluationService({env,provider,limits:{...limits,model:env.SUPPORT_AI_MODEL},now});
  return service.evaluate(input);
}

module.exports={evaluatePrivately};
