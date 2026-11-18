const { getAuthenticatedUser } = require('../lib/_auth');
const { consumeRateLimit } = require('../lib/_rate-limit');
const { rpcClient, rpcData, safeError, cacheNoStore, writeOriginAllowed, exactKeys, jsonBytes, LIMIT, UUID, CAPABILITY, CATEGORIES, validBody, hashCapability } = require('../lib/_support');

const ACTION_KEYS = { start: ['action', 'token', 'requestId', 'body', 'category', 'website'], read: ['action', 'token'], send: ['action', 'token', 'requestId', 'body'] };
function isUuid(v) { return typeof v === 'string' && UUID.test(v); }
async function handler(req, res, deps = {}) {
  cacheNoStore(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return safeError(res, 405); }
  if (!writeOriginAllowed(req)) return safeError(res, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '') || Number(req.headers?.['content-length'] || 0) > LIMIT) return safeError(res, 400, 'Solicitud inválida.');
  const body = req.body;
  if (jsonBytes(body) > LIMIT || !body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string' || !ACTION_KEYS[body.action] || !exactKeys(body, ACTION_KEYS[body.action])) return safeError(res, 400, 'Solicitud inválida.');
  const { action, token } = body;
  if (typeof token !== 'string' || !CAPABILITY.test(token)) return safeError(res, 400, 'Solicitud inválida.');
  if (action !== 'read' && (!isUuid(body.requestId) || !validBody(body.body) || (action === 'start' && (!CATEGORIES.has(body.category) || body.website !== '')))) return safeError(res, 400, 'Solicitud inválida.');
  const limit = deps.rateLimit || consumeRateLimit;
  const ipLimit = await limit({ req, scope: `support_${action}`, limit: action === 'start' ? 5 : 60, windowSeconds: action === 'start' ? 3600 : 60 });
  if (ipLimit?.error) return safeError(res, 503, 'Servicio no disponible temporalmente.');
  if (ipLimit && !ipLimit.allowed) { res.setHeader('Retry-After', String(ipLimit.retryAfter || 60)); return safeError(res, 429, 'Demasiadas solicitudes.'); }
  let owner = null;
  const authorization = req.headers?.authorization ?? req.headers?.Authorization;
  if (authorization !== undefined) {
    try {
      const auth = await (deps.auth || getAuthenticatedUser)(req);
      if (auth?.error || !isUuid(auth?.user?.id) || !auth.user.email_confirmed_at || auth.user.is_anonymous) {
        return safeError(res, 401);
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
    return res.status(200).json({ ok: true, ticket: data.ticket, messages: data.messages || [], hasMore: Boolean(data.hasMore) });
  } catch { return safeError(res, 503, 'Servicio no disponible temporalmente.'); }
}
module.exports = handler;
