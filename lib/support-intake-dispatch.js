'use strict';
// Explicitly disabled by default. Called only for a successful visitor "start".
// The SQL RPC makes the agent message + audit atomic; this wrapper preserves the
// visitor's successful ticket creation if the optional acknowledgement fails.
const { intake } = require('./support-intake-policy');
const { UUID, rpcData } = require('./_support');

function enabled(env, now = Date.now()) {
  if (env.SUPPORT_INTAKE_ENABLED !== 'true') return false;
  const start = env.SUPPORT_INTAKE_START_AT || '';
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(start)) return false;
  const at = Date.parse(start);
  return Number.isFinite(at) && at <= now;
}
function policy(env) {
  const schedule = typeof env.SUPPORT_INTAKE_SCHEDULE === 'string' ?
    env.SUPPORT_INTAKE_SCHEDULE.trim() : '';
  const target = Number(env.SUPPORT_INTAKE_RESPONSE_BUSINESS_HOURS);
  return {
    channel:'chat',
    schedule: schedule.length > 0 && schedule.length <= 160 ? schedule : '',
    firstResponseBusinessHours: schedule && Number.isSafeInteger(target) &&
      target > 0 && target <= 168 ? target : null
  };
}
async function dispatch({ data, capabilityHash, ownerUserId = null, env = process.env, rpc, now = Date.now }) {
  if (!enabled(env, now())) return data;
  if (!data?.ok || typeof capabilityHash !== 'string' || !/^[a-f0-9]{64}$/.test(capabilityHash) || !UUID.test(data.ticket?.id || '') ||
      !Array.isArray(data.messages)) return data;
  const source = data.messages.find(m => m?.author === 'visitor' && UUID.test(m?.id || ''));
  if (!source) return data;
  const folio = '#' + data.ticket.id.slice(0,8).toUpperCase();
  const ack = intake({category:data.ticket.category,folio,policy:policy(env)});
  try {
    const { data: result, error } = await rpc('support_agent_acknowledge_first', {
      p_ticket_id: data.ticket.id, p_source_message_id: source.id,
      p_body: ack.body, p_not_before: env.SUPPORT_INTAKE_START_AT
    });
    if (error || rpcData(result)?.ok !== true) return data;
    // A replay remains idempotent. Request a fresh transcript, never synthesize IDs.
    const updated = await rpc('support_visitor_action', {
      p_action:'read',p_capability_hash:capabilityHash,
      p_owner_user_id:ownerUserId,p_request_id:null,p_body:null,p_category:null
    });
    if (!updated.error && rpcData(updated.data)?.ok) return rpcData(updated.data);
  } catch {
    // Failed automation must never make the visitor's saved ticket look failed.
  }
  return data;
}
module.exports = { enabled, policy, dispatch };
