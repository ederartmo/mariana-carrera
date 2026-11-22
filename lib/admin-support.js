const { createHash } = require('node:crypto');
const { withOwnerIdentity } = require('./_support-owner-identity');
const { getSupportOperator, getSupportAssignees } = require('./_support-operator');
const { privateProposal } = require('./ai/support-private-proposal');
const { rpcClient, rpcData, safeError, cacheNoStore, writeOriginAllowed, exactKeys, jsonBytes, LIMIT, UUID, CATEGORIES, STATUSES, validBody } = require('./_support');
const { drainVisitorEmail } = require('./support-visitor-email');
const UUID_RE = UUID;
function failAuth(res, result) { return safeError(res, result.status === 403 ? 403 : 401, result.status === 403 ? 'No autorizado.' : 'No autorizado.'); }
function withActivityLabels(data) {
  if (!Array.isArray(data.activity)) return data;
  return { ...data, activity: data.activity.map((entry) => {
    const actor = entry?.actor;
    if (typeof actor !== 'string' || !actor.startsWith('admin:') || !UUID_RE.test(actor.slice(6))) return entry;
    const label = createHash('sha256').update(actor.toLowerCase()).digest('hex').slice(0, 12).toUpperCase();
    return { ...entry, actor: 'Administrador · ' + label };
  }) };
}

function configuredAssigneeLabels(assignees) {
  let config;
  try { config = JSON.parse(process.env.SUPPORT_ASSIGNEE_LABELS || '{}'); } catch { return {}; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return Object.fromEntries(assignees.flatMap((email) => {
    if (!Object.hasOwn(config, email) || typeof config[email] !== 'string') return [];
    const name = config[email].trim();
    if (!name || name.length > 80 || /[@\p{Cc}\p{Cf}]/u.test(name) || UUID_RE.test(name)) return [];
    return [[email, name]];
  }));
}

// Two bounded keyset scans preserve the pending group across page boundaries.
async function listByAttention(client, { status, category, assignee, before, beforeId, beforePriority }) {
  const tickets=[];
  for(const priority of [1,0]){
    if((beforePriority!==undefined&&priority>Number(beforePriority))||
      (status!==undefined&&Number(status==='pending')!==priority)||tickets.length>=51)continue;
    let q=client.from('support_tickets').select('id,status,category,version,assigned_to,updated_at,created_at');
    q=priority?q.eq('status','pending'):status?q.eq('status',status):q.in('status',['in_progress','resolved']);
    if(category!==undefined)q=q.eq('category',category);
    if(assignee!==undefined)q=assignee===''?q.is('assigned_to',null):q.eq('assigned_to',assignee);
    if(before!==undefined&&priority===Number(beforePriority)){
      // Values already validated by the route; delimiters cannot be client controlled.
      q=q.or('updated_at.lt.'+before+',and(updated_at.eq.'+before+',id.lt.'+beforeId+')');
    }
    const { data,error }=await q.order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(51-tickets.length);
    if(error||!Array.isArray(data))return {error:true};
    tickets.push(...data);
  }
  const visible=tickets.slice(0,50),last=visible.at(-1);
  return {data:{ok:true,tickets:visible,nextCursor:tickets.length>50?{
    createdAt:last.updated_at,id:last.id,priority:Number(last.status==='pending')
  }:null}};
}

async function handler(req, res, deps = {}) {
  cacheNoStore(res);
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return safeError(res, 405); }
  if (req.method === 'POST' && !writeOriginAllowed(req, { supportOperator: true })) {
    return res.status(403).json({ ok:false, code:'origin_not_allowed', error:'Abre la bandeja desde el sitio oficial para guardar cambios.' });
  }
  if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return safeError(res, 400, 'Solicitud inválida.');
  if (req.method === 'POST' && jsonBytes(req.body) > LIMIT) return safeError(res, 400, 'Solicitud inválida.');
  try {
    const auth = await (deps.auth || getSupportOperator)(req, deps.authOptions || {});
    if (auth?.error) return failAuth(res, auth);
    const actorId = auth?.user?.id;
    if (req.method === 'POST' && (typeof actorId !== 'string' || !UUID_RE.test(actorId))) {
      return failAuth(res, { status: 401 });
    }
    const client = rpcClient(deps.client);
    let result;
    if (req.method === 'GET') {
      const id = req.query?.id;
      if (id !== undefined && (typeof id !== 'string' || !UUID_RE.test(id))) return safeError(res, 400, 'Solicitud inválida.');
      if (id !== undefined && !exactKeys(req.query, ['id'])) return safeError(res, 400);
      if (id) result = await client.rpc('support_admin_detail', { p_ticket_id: id });
      else {
        const q = req.query || {};
        const { status, category, assignee, before, beforeId, order, beforePriority } = q;
        const allowedAssignees = (deps.getSupportAssignees || getSupportAssignees)();
        if (!exactKeys(q, ['status','category','assignee','before','beforeId','order','beforePriority']) ||
          (order !== undefined && order !== 'attention') ||
          (order === 'attention' ? ((before === undefined) !== (beforePriority === undefined) || (beforePriority !== undefined && !['0','1'].includes(beforePriority))) : beforePriority !== undefined) ||
          (status !== undefined && !STATUSES.has(status)) ||
          (category !== undefined && !CATEGORIES.has(category)) ||
          (assignee !== undefined && assignee !== '' && !allowedAssignees.includes(assignee)) ||
          (before === undefined) !== (beforeId === undefined) ||
          (before !== undefined && (typeof before !== 'string' ||
            !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(before) ||
            !Number.isFinite(Date.parse(before)) || typeof beforeId !== 'string' || !UUID_RE.test(beforeId)))) {
          return safeError(res, 400, 'Filtros o cursor no validos.');
        }
        if(order==='attention')result=await listByAttention(client,{status,category,assignee,before,beforeId,beforePriority});
        else result = await client.rpc('support_admin_list', {
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
      const assignees = (deps.getSupportAssignees || getSupportAssignees)();
      if (body.assignTo !== undefined && (
        body.assignToMe !== undefined || typeof body.assignTo !== 'string' || !assignees.includes(body.assignTo)
      )) return safeError(res, 400, 'Responsable no autorizado.');
      result = await client.rpc('support_admin_action', { p_ticket_id: body.id, p_request_id: body.requestId, p_expected_version: body.expectedVersion, p_action: body.action, p_body: body.body || null, p_status: body.status || null, p_category: body.category || null, p_assign_to: body.assignTo ?? (body.assignToMe ? auth.email : null), p_assign_to_set: body.assignTo !== undefined || body.assignToMe !== undefined, p_actor: `admin:${actorId.toLowerCase()}` });
    }
    if (result.error) return safeError(res, 503, 'Servicio no disponible temporalmente.');
    const data = rpcData(result.data);
    if (!data || typeof data !== 'object') return safeError(res, 503, 'Servicio no disponible temporalmente.');
    if (data.error === 'not_found') return safeError(res, 404, 'No se encontró el ticket.');
    if (data.error === 'conflict') return safeError(res, 409, 'El ticket cambió. Actualiza la vista e inténtalo de nuevo.');
    if (data.error) return safeError(res, 400, 'Solicitud inválida.');
    if (req.method === 'GET') {
      const enriched = await withOwnerIdentity(client, data);
      const assignees = (deps.getSupportAssignees || getSupportAssignees)();
      let ai;
      if (req.query?.id && data.ticket?.id === req.query.id && typeof actorId === 'string' && UUID_RE.test(actorId)) {
        try { ai=await privateProposal(client,data.ticket,deps.proposalEnv); } catch { /* Keep the ticket detail available. */ }
      }
      return res.status(200).json({ ...withActivityLabels(enriched), assignees, assigneeLabels: configuredAssigneeLabels(assignees), ...(ai?{ ai }: {}) });
    }
    if (req.body.action === 'reply') {
      try {
        await drainVisitorEmail({client, env:deps.visitorEmailEnv || process.env, fetcher:deps.visitorEmailFetch,
          ticket:req.body.id, requestId:req.body.requestId});
      } catch { /* The durable job can be retried independently of the saved reply. */ }
    }
    return res.status(200).json(withActivityLabels(data));
  } catch { return safeError(res, 503, 'Servicio no disponible temporalmente.'); }
}
module.exports = handler;
