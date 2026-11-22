const { getAuthenticatedUser } = require('./_auth');
const { consumeRateLimit } = require('./_rate-limit');
const { dispatch: dispatchIntake } = require('./support-intake-dispatch');
const { dispatchAuto } = require('./ai/support-auto-dispatch');
const { followupStatus } = require('./support-visitor-email');
const { rpcClient, rpcData, safeError, cacheNoStore, writeOriginAllowed, exactKeys, jsonBytes, LIMIT, UUID, CAPABILITY, CATEGORIES, validBody, hashCapability } = require('./_support');

const ACTION_KEYS = { start: ['action', 'token', 'requestId', 'body', 'category', 'website'], read: ['action', 'token'], send: ['action', 'token', 'requestId', 'body'] };
function isUuid(v) { return typeof v === 'string' && UUID.test(v); }
async function handler(req, res, deps = {}) {
  cacheNoStore(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return safeError(res, 405); }
  if (!writeOriginAllowed(req, { publicChat: true })) return res.status(403).json({ ok:false, code:'origin_not_allowed', error:'Abre el chat desde el sitio oficial.' });
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '') || Number(req.headers?.['content-length'] || 0) > LIMIT) return safeError(res, 400, 'Solicitud inválida.');
  const body = req.body;
  if (jsonBytes(body) > LIMIT || !body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string' || !ACTION_KEYS[body.action] || !exactKeys(body, ACTION_KEYS[body.action])) return safeError(res, 400, 'Solicitud inválida.');
  const { action, token } = body;
  if (typeof token !== 'string' || !CAPABILITY.test(token)) return safeError(res, 400, 'Solicitud inválida.');
  if (action !== 'read' && (!isUuid(body.requestId) || !validBody(body.body) || (action === 'start' && (!CATEGORIES.has(body.category) || body.website !== '')))) return safeError(res, 400, 'Solicitud inválida.');
  const authorization = req.headers?.authorization ?? req.headers?.Authorization;
  const invalidSession = () => res.status(401).json({ ok:false, code:'invalid_session',
    error:'No pudimos verificar tu sesión. Vuelve a iniciar sesión.' });
  if (authorization !== undefined && (typeof authorization !== 'string' || !/^Bearer [^\s]+$/.test(authorization))) {
    return invalidSession();
  }
  const limit = deps.rateLimit || consumeRateLimit;
  const ipLimit = await limit({ req, scope: `support_${action}`, limit: action === 'start' ? 5 : 60, windowSeconds: action === 'start' ? 3600 : 60 });
  if (ipLimit?.error) return safeError(res, 503, 'Servicio no disponible temporalmente.');
  if (ipLimit && !ipLimit.allowed) { res.setHeader('Retry-After', String(ipLimit.retryAfter || 60)); return safeError(res, 429, 'Demasiadas solicitudes.'); }
  let owner = null;
  if (authorization !== undefined) {
    try {
      const auth = await (deps.auth || getAuthenticatedUser)(req);
      if (auth?.error || !isUuid(auth?.user?.id) || !auth.user.email_confirmed_at || auth.user.is_anonymous) {
        return invalidSession();
      }
      owner = auth.user.id.toLowerCase();
    } catch { return safeError(res, 503); }
  }
  const capabilityHash = hashCapability(owner ? 'support-owner:' + owner : token);
  const capLimit = await limit({ req, scope: 'support_capability', identity: capabilityHash, limit: 100, windowSeconds: 3600 });
  if (capLimit?.error) return safeError(res, 503, 'Servicio no disponible temporalmente.');
  if (capLimit && !capLimit.allowed) return safeError(res, 429, 'Demasiadas solicitudes.');
  try {
    const args = {
      p_action: action, p_capability_hash: capabilityHash, p_owner_user_id: owner, p_request_id: body.requestId || null,
      p_body: action === 'read' ? null : body.body, p_category: action === 'start' ? body.category : null,
    };
    const result = deps.rpc ? await deps.rpc('support_visitor_action', args) : await rpcClient(deps.client).rpc('support_visitor_action', args);
    if (result.error) return safeError(res, 503, 'Servicio no disponible temporalmente.');
    const data = rpcData(result.data);
    if (!data || typeof data !== 'object') return safeError(res, 503, 'Servicio no disponible temporalmente.');
    if (data.error === 'not_found') return safeError(res, 404, 'No se encontró la conversación.');
    if (data.error === 'conflict') return safeError(res, 409, 'La solicitud entra en conflicto con un cambio anterior.');
    if (data.error) return safeError(res, 400, 'Solicitud inválida.');
    let visible = data;
    if (action === 'start') {
      try {
        visible = await (deps.dispatchIntake || dispatchIntake)({
          data, capabilityHash, ownerUserId:owner,
          env:deps.env || process.env,
          rpc:deps.rpc || ((name, params) => rpcClient(deps.client).rpc(name, params))
        });
      } catch {
        // An optional acknowledgment must never fail an already saved ticket.
        visible = data;
      }
    }
    if (action !== 'read') {
      try {
        const rpc = deps.rpc || ((name, params) => rpcClient(deps.client).rpc(name, params));
        const published = await dispatchAuto({data, requestId:body.requestId, env:deps.env || process.env, rpc, fetchImpl:deps.autoFetch});
        if (published) {
          const refreshed = await rpc('support_visitor_action', {...args,p_action:'read',p_request_id:null,p_body:null,p_category:null});
          if (!refreshed.error && rpcData(refreshed.data)?.ok) visible = rpcData(refreshed.data);
        }
      } catch { /* The visitor message was already saved. */ }
    }
    let followup;
    try {
      followup = await followupStatus(deps.rpc || ((name, params) => rpcClient(deps.client).rpc(name, params)),
        capabilityHash, owner, deps.env || process.env);
    } catch { /* Email availability must not block chat. */ }
    return res.status(200).json({ ok: true, ticket: visible.ticket, messages: visible.messages || [], hasMore: Boolean(visible.hasMore),
      ...(followup ? {followup} : {}) });
  } catch { return safeError(res, 503, 'Servicio no disponible temporalmente.'); }
}
module.exports = handler;
