const { consumeRateLimit } = require('./_rate-limit');
const { getAdminUser, getAdminEmails } = require('./_auth');
const { rpcClient, rpcData, safeError, cacheNoStore, writeOriginAllowed, exactKeys, jsonBytes, LIMIT, UUID, CATEGORIES, STATUSES, validBody } = require('./_support');
const UUID_RE = UUID;
function failAuth(res, result) { return safeError(res, result.status === 403 ? 403 : 401, result.status === 403 ? 'No autorizado.' : 'No autorizado.'); }
async function handler(req, res, deps = {}) {
  cacheNoStore(res);
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return safeError(res, 405); }
  if (req.method === 'POST' && !writeOriginAllowed(req)) return safeError(res, 403);
  if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return safeError(res, 400, 'Solicitud inválida.');
  if (req.method === 'POST' && jsonBytes(req.body) > LIMIT) return safeError(res, 400, 'Solicitud inválida.');
  try {
    const auth = await (deps.auth || getAdminUser)(req, deps.authOptions || {});
    if (auth?.error) return failAuth(res, auth);
    const client = rpcClient(deps.client);
    let result;
    if (req.method === 'GET') {
      const id = req.query?.id;
      if (id !== undefined && (typeof id !== 'string' || !UUID_RE.test(id))) return safeError(res, 400, 'Solicitud inválida.');
      if (req.query?.view !== undefined) {
        const { view, before } = req.query;
        if (view !== 'messages' || !id || !exactKeys(req.query, ['id','view','before']) ||
            (before !== undefined && (typeof before !== 'string' || !UUID_RE.test(before)))) return safeError(res, 400);
        const limit = await (deps.rateLimit || consumeRateLimit)({
          req, scope: 'support_admin_history', identity: auth.email, limit: 60, windowSeconds: 60,
        });
        if (limit?.error) return safeError(res, 503);
        if (limit && !limit.allowed) {
          res.setHeader('Retry-After', String(limit.retryAfter || 60)); return safeError(res, 429);
        }
        result = await client.rpc('support_admin_message_history', { p_ticket_id: id, p_before: before ?? null });
      } else if (id) result = await client.rpc('support_admin_detail', { p_ticket_id: id });
      else {
        const q = req.query || {};
        const { status, category, assignee, before, beforeId } = q;
        const allowedAssignees = (deps.getAdminEmails || getAdminEmails)();
        if (!exactKeys(q, ['status','category','assignee','before','beforeId']) ||
          (status !== undefined && !STATUSES.has(status)) ||
          (category !== undefined && !CATEGORIES.has(category)) ||
          (assignee !== undefined && assignee !== '' && !allowedAssignees.includes(assignee)) ||
          (before === undefined) !== (beforeId === undefined) ||
          (before !== undefined && (typeof before !== 'string' ||
            !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(before) ||
            !Number.isFinite(Date.parse(before)) || typeof beforeId !== 'string' || !UUID_RE.test(beforeId)))) {
          return safeError(res, 400, 'Filtros o cursor no validos.');
        }
        result = await client.rpc('support_admin_list', {
          p_limit:50, p_status:status ?? null, p_category:category ?? null, p_assignee:assignee ?? null,
          p_before:before ?? null, p_before_id:beforeId ?? null,
        });
      }
    } else {
      const body = req.body;
      const allowed = ['id', 'requestId', 'expectedVersion', 'action', 'body', 'status', 'category', 'assignToMe', 'assignTo'];
      if (!exactKeys(body, allowed) || !UUID_RE.test(body.id || '') || !UUID_RE.test(body.requestId || '') || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 || !['reply', 'update'].includes(body.action)) return safeError(res, 400, 'Solicitud inválida.');
      if (body.action === 'reply' && (!validBody(body.body) || Object.keys(body).some((k) => !['id', 'requestId', 'expectedVersion', 'action', 'body'].includes(k)))) return safeError(res, 400, 'Solicitud inválida.');
      if (body.action === 'update' && (body.body !== undefined || (body.status !== undefined && !STATUSES.has(body.status)) || (body.category !== undefined && !CATEGORIES.has(body.category)) || (body.assignToMe !== undefined && typeof body.assignToMe !== 'boolean') || !['status', 'category', 'assignToMe', 'assignTo'].some((k) => body[k] !== undefined))) return safeError(res, 400, 'Solicitud inválida.');
      const assignees = (deps.getAdminEmails || getAdminEmails)();
      if (body.assignTo !== undefined && (
        body.assignToMe !== undefined || typeof body.assignTo !== 'string' || !assignees.includes(body.assignTo)
      )) return safeError(res, 400, 'Responsable no autorizado.');
      result = await client.rpc('support_admin_action', { p_ticket_id: body.id, p_request_id: body.requestId, p_expected_version: body.expectedVersion, p_action: body.action, p_body: body.body || null, p_status: body.status || null, p_category: body.category || null, p_assign_to: body.assignTo ?? (body.assignToMe ? auth.email : null), p_assign_to_set: body.assignTo !== undefined || body.assignToMe !== undefined, p_actor: auth.email });
    }
    if (result.error) return safeError(res, 503, 'Servicio no disponible temporalmente.');
    const data = rpcData(result.data);
    if (!data || typeof data !== 'object') return safeError(res, 503, 'Servicio no disponible temporalmente.');
    if (data.error === 'not_found') return safeError(res, 404, 'No se encontró el ticket.');
    if (data.error === 'conflict') return safeError(res, 409, 'El ticket cambió. Actualiza la vista e inténtalo de nuevo.');
    if (data.error) return safeError(res, 400, 'Solicitud inválida.');
    if (req.method === 'GET' && req.query?.view === 'messages') return res.status(200).json({ ok: true, messages: data.messages, nextCursor: data.nextCursor });
    return res.status(200).json(req.method === 'GET' ? { ...data, assignees: (deps.getAdminEmails || getAdminEmails)() } : data);
  } catch { return safeError(res, 503, 'Servicio no disponible temporalmente.'); }
}
module.exports = handler;
