'use strict';

const {randomBytes, randomInt, createHmac, timingSafeEqual} = require('node:crypto');
const {getAuthenticatedUser} = require('./_auth');
const {enforceRateLimit} = require('./_rate-limit');
const {CAPABILITY, UUID, exactKeys, jsonBytes, hashCapability, writeOriginAllowed, rpcClient, safeError} = require('./_support');
const {deliverNotification} = require('./_support-notification-mail');
const {FROM} = require('./_transactional-email');

const emailPattern = /^[^\s,@<>]+@[^\s,@<>]+\.[^\s,@<>]+$/;
const guestCode = /^\d{6}$/;
const origin = 'https://www.kinetichub.com.mx';
const actions = {
  request: ['action', 'token', 'email'],
  verify: ['action', 'token', 'code'],
  resume: ['action', 'job', 'proof'],
};

function settings(env) {
  const secret = env.SUPPORT_VISITOR_EMAIL_SECRET;
  return env.VERCEL_ENV === 'production' && env.SUPPORT_VISITOR_EMAIL_ENABLED === 'true' &&
    /^[\x21-\x7e]{32,256}$/.test(secret || '') && env.RESEND_API_KEY
    ? {secret, key: env.RESEND_API_KEY} : null;
}

function resumeProof(job, config) {
  return createHmac('sha256', config.secret).update('support-visitor-resume:' + job).digest('hex');
}

function verificationProof(hash, code, config) {
  return createHmac('sha256', config.secret).update('support-visitor-email-code:' + hash + ':' + code).digest('hex');
}

async function followupStatus(rpc, hash, owner, env) {
  if (!settings(env)) return undefined;
  const result = await rpc('support_email_contact', {p_action:'status', p_hash:hash, p_owner:owner});
  return !result.error && ['eligible','code_pending','verified'].includes(result.data) ? result.data : undefined;
}

async function drainVisitorEmail({client, rpc = (name, args) => client.rpc(name, args), env = process.env,
  fetcher, ticket, requestId} = {}) {
  const config = settings(env);
  if (!config) return null;
  const result = await rpc('support_claim_visitor_email', {p_ticket:ticket || null, p_request:requestId || null});
  if (result.error || !Array.isArray(result.data) || result.data.length > 1) throw Error('Follow-up queue unavailable');
  const [job] = result.data;
  if (!job) return null;
  let outcome = 'permanent';
  if (job.owner_user_id) {
    const account = await client.auth.admin.getUserById(job.owner_user_id);
    const user = account.data?.user;
    if (account.error && account.error.status !== 404) outcome = 'retry';
    else if (user?.id === job.owner_user_id && user.email_confirmed_at && !user.is_anonymous &&
        user.email?.toLowerCase() === job.email) outcome = 'eligible';
  } else outcome = 'eligible';
  if (outcome === 'eligible') {
    const folio = '#' + job.ticket_id.slice(0,8).toUpperCase();
    const link = origin + (job.owner_user_id
      ? '/auth.html?mode=login&returnTo=%2Fatencion.html'
      : '/atencion.html#support-reply=' + job.id + '.' + resumeProof(job.id, config));
    outcome = await deliverNotification({from:FROM, to:[job.email], subject:'Kinetic Hub · Respuesta a tu solicitud ' + folio,
      text:'El equipo de Kinetic Hub respondió a tu solicitud ' + folio + '.\n\nContinúa en: ' + link +
        (job.owner_user_id ? '\nInicia sesión con tu cuenta para consultar la conversación.' : '\nEl enlace es personal, vence después de 7 días y se usa una sola vez.')},
    config.key, 'support-visitor-reply/' + job.id, fetcher);
  }
  const saved = await rpc('support_finish_visitor_email', {p_id:job.id, p_lease:job.lease, p_result:outcome});
  if (saved.error || saved.data !== true) throw Error('Follow-up result unavailable');
  return outcome;
}

async function handler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return safeError(res, 405);
  if (!writeOriginAllowed(req, {publicChat:true})) return safeError(res, 403);
  const config = settings(deps.env || process.env);
  if (!config) return safeError(res, 503);
  const body = req.body;
  if (!Object.hasOwn(actions, body?.action) || !exactKeys(body, actions[body.action]) ||
      jsonBytes(body) > 1024 || !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return safeError(res, 400);
  const {action} = body;
  const authorization = req.headers?.authorization ?? req.headers?.Authorization;
  const limit = deps.enforceRateLimit || enforceRateLimit;
  try {
    const blocked = await limit(req, res, {scope:'support-email-' + action, limit:10, windowSeconds:900});
    if (blocked) return blocked;
    const rpc = deps.rpc || ((name, args) => rpcClient(deps.client).rpc(name, args));
    if (action === 'resume') {
      if (authorization !== undefined || !UUID.test(body.job || '') || typeof body.proof !== 'string' ||
          !CAPABILITY.test(body.proof) || !timingSafeEqual(Buffer.from(body.proof), Buffer.from(resumeProof(body.job, config)))) return safeError(res,403);
      const token = randomBytes(32).toString('hex');
      const result = await rpc('support_resume_visitor_email', {p_job:body.job, p_next_hash:hashCapability(token)});
      return !result.error && result.data === true ? res.status(200).json({ok:true,token}) : safeError(res,403);
    }
    if (typeof body.token !== 'string' || !CAPABILITY.test(body.token)) return safeError(res, 400);
    let owner = null, accountEmail;
    if (authorization !== undefined) {
      const auth = await (deps.auth || getAuthenticatedUser)(req);
      if (auth.error || !UUID.test(auth.user?.id || '') || !auth.user.email_confirmed_at || auth.user.is_anonymous) return safeError(res,401);
      owner = auth.user.id.toLowerCase();
      accountEmail = auth.email;
    }
    const hash = hashCapability(owner ? 'support-owner:' + owner : body.token);
    if (action === 'verify') {
      const code = typeof body.code === 'string' && body.code.trim();
      if (owner || !guestCode.test(code || '')) return safeError(res,400);
      const result = await rpc('support_email_contact', {p_action:'verify',p_hash:hash,p_owner:null,p_proof:verificationProof(hash, code, config)});
      if (result.error) return safeError(res,503,'No pudimos verificar el correo en este momento. Intenta de nuevo.');
      if (result.data === 'verified') return res.status(200).json({ok:true,verified:true});
      if (result.data === 'code_expired') return safeError(res,403,'El código venció. Solicita uno nuevo.');
      if (result.data === 'code_locked') return safeError(res,429,'Demasiados intentos. Solicita un código nuevo.');
      if (result.data === 'code_invalid') return safeError(res,403,'El código es incorrecto. Revisa el correo e inténtalo de nuevo.');
      return safeError(res,403,'No se pudo verificar este código.');
    }
    const email = owner ? accountEmail : typeof body.email === 'string' && body.email.trim().toLowerCase();
    if ((owner && body.email !== undefined) || !email || email.length > 254 || !emailPattern.test(email)) return safeError(res,400);
    const ticketBlocked = await limit(req, res, {scope:'support-email-ticket',identity:hash,limit:4,windowSeconds:3600});
    if (ticketBlocked) return ticketBlocked;
    const emailBlocked = await limit(req, res, {scope:'support-email-recipient',identity:email,limit:4,windowSeconds:3600});
    if (emailBlocked) return emailBlocked;
    const code = owner ? null : String(randomInt(1_000_000)).padStart(6, '0');
    const proof = code ? verificationProof(hash, code, config) : null;
    const result = await rpc('support_email_contact', {p_action:'request',p_hash:hash,p_owner:owner,p_email:email,
      p_proof:proof});
    if (result.error) return safeError(res,503);
    if (result.data === 'send') {
      const sent = await deliverNotification({from:FROM,to:[email],subject:'Verifica tu correo para recibir avisos de Kinetic Hub',
        text:'Ingresa este código en el chat donde solicitaste recibir avisos: ' + code +
          '\nVence en 15 minutos. Si no lo solicitaste, ignora este correo.'},
      config.key, 'support-visitor-verification/' + proof, deps.fetch);
      if (sent !== 'sent') return res.status(503).json({ok:false,code:'send_failed',
        error:'No pudimos enviar el código. Espera un momento y vuelve a solicitarlo.'});
      return res.status(202).json({ok:true,codeSent:true});
    }
    return res.status(202).json({ok:true, ...(owner && result.data === 'verified' ? {verified:true} : {})});
  } catch { return safeError(res,503); }
}

module.exports = {handler, followupStatus, drainVisitorEmail, settings};
