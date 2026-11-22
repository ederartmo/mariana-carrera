const { createHash, timingSafeEqual } = require('node:crypto');
const { UUID, rpcClient } = require('./_support');
const { deliverNotification } = require('./_support-notification-mail');
const { drainVisitorEmail, settings: visitorSettings } = require('./support-visitor-email');

const digest = value => createHash('sha256').update(value).digest();
const isUuid = value => typeof value === 'string' && UUID.test(value);
const mail = /^[^\s,@<>]+@[^\s,@<>]+\.[^\s,@<>]+$/;
function config(env) {
  const secret = env.SUPPORT_NOTIFICATION_WORKER_SECRET || '';
  const to = (env.SUPPORT_NOTIFICATION_TO || '').trim();
  const from = (env.SUPPORT_NOTIFICATION_FROM || '').trim();
  const since = (env.SUPPORT_NOTIFICATION_START_AT || '').trim();
  const key = env.RESEND_API_KEY;
  if (env.SUPPORT_NOTIFICATIONS_ENABLED !== 'true' || !/^[\x21-\x7e]{32,256}$/.test(secret) || !mail.test(to) ||
      !from || /[\r\n]/.test(from) || !key || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(since) || !Number.isFinite(Date.parse(since))) return null;
  let site;
  try { site = new URL(env.SITE_URL); } catch { return null; }
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) return null;
  const link = new URL('/admin-inscripciones.html', site).href;
  return { secret,to,from,since,key,link,fingerprint:digest(JSON.stringify([to,from,link])).toString('hex') };
}

function message(job, settings) {
  if (!isUuid(job?.id) || !isUuid(job?.ticket_id) || !isUuid(job?.lease_token) ||
      !['new','reopened'].includes(job.kind) || !Number.isFinite(Date.parse(job.occurred_at))) return null;
  const folio = '#' + job.ticket_id.slice(0,8).toUpperCase();
  const date = new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(job.occurred_at));
  return { from:settings.from, to:[settings.to], subject:'Kinetic Hub · Atención requerida ' + folio,
    text:'Folio: ' + folio + '\nMotivo: ' + (job.kind === 'new' ? 'Nuevo' : 'Reabierto') +
    '\nFecha: ' + date + ' (Ciudad de México)\nEstado al detectar: Pendiente\nBandeja: ' + settings.link +
    '\nResponde únicamente desde la bandeja administrativa.' };
}

async function deliver(job, settings, fetcher) {
  const payload = message(job, settings);
  if (!payload) return 'permanent';
  return deliverNotification(payload, settings.key, 'support-notification/' + job.id, fetcher);
}

async function handler(req,res,deps={}) {
  res.setHeader('Cache-Control','no-store');
  const reject=status=>res.status(status).json({ok:false});
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return reject(405); }
  const env = deps.env || process.env;
  const settings = config(env);
  const visitorEnabled = visitorSettings(env) && /^[\x21-\x7e]{32,256}$/.test(env.SUPPORT_NOTIFICATION_WORKER_SECRET || '');
  if (!settings && !visitorEnabled) return reject(503);
  const supplied=req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof supplied !== 'string' || supplied.length > 263 ||
      !timingSafeEqual(digest(supplied),digest('Bearer ' + env.SUPPORT_NOTIFICATION_WORKER_SECRET))) return reject(401);
  // Vercel may normalize a zero-length POST body to an empty object. Accept only
  // truly empty body representations; keep rejecting any supplied payload.
  const emptyBody = req.body == null || req.body === '' ||
    (typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 0);
  if (Object.keys(req.query || {}).length || !emptyBody) return reject(400);
  try {
    const rpc = deps.rpc || ((name,args)=>rpcClient(deps.client).rpc(name,args));
    const visitor = () => drainVisitorEmail({rpc, env, fetcher:deps.fetch,
      client: {get auth() { return rpcClient(deps.client).auth; }}});
    if (!settings) return res.status(200).json({ok:true,visitor:await visitor()});
    const jobs = await rpc('support_claim_notification_jobs',{p_since:settings.since,p_config:settings.fingerprint});
    if (jobs.error || !Array.isArray(jobs.data) || jobs.data.length > 3) return reject(503);
    const count = { sent:0, retry:0, permanent:0 };
    for(const job of jobs.data) {
      const outcome = await deliver(job,settings,deps.fetch || fetch);
      const saved = await rpc('support_finish_notification_job',{p_id:job.id,p_lease_token:job.lease_token,p_outcome:outcome});
      if (saved.error || saved.data !== true) return reject(503);
      count[outcome]++;
    }
    let visitorOutcome;
    if (visitorEnabled) {
      try { visitorOutcome = await visitor(); } catch { visitorOutcome = 'unavailable'; }
    }
    return res.status(200).json({ok:true,...count,...(visitorEnabled ? {visitor:visitorOutcome} : {})});
  } catch { return reject(503); }
}
module.exports = handler;
