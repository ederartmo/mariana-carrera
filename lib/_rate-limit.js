// lib/_rate-limit.js - Batch 7: rate limiting persistente (Supabase/Postgres).
// NUNCA in-memory: las instancias serverless no comparten estado.
// Clave privada por hash HMAC-SHA256 (RATE_LIMIT_SECRET, >=32 chars):
// en DB solo viajan scope + key_hash. IP/email crudos jamás se persisten
// ni se loguean. Fail closed: sin secreto o sin DB → 503/429, nunca bypass.
// Webhook Stripe y endpoints autenticados/admin NO usan este helper.

const crypto = require('crypto');
const { getServiceClient } = require('./_auth');

const MIN_SECRET_LENGTH = 32;

function getRateLimitSecret() {
  const secret = process.env.RATE_LIMIT_SECRET || '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

// IP de cliente: prefiere x-vercel-forwarded-for (Vercel la conserva),
// luego x-forwarded-for (Vercel la sobrescribe con la IP pública del
// cliente), luego x-real-ip. Solo primer valor ante listas. Nunca body/query.
function getClientIp(req) {
  const headers = (req && req.headers) || {};
  const candidates = [
    headers['x-vercel-forwarded-for'],
    headers['x-forwarded-for'],
    headers['x-real-ip'],
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const first = raw.split(',')[0].trim();
    if (first) return first;
  }
  return 'local';
}

function hashRateLimitKey(material, secret) {
  const key = secret !== undefined ? secret : getRateLimitSecret();
  if (!key || key.length < MIN_SECRET_LENGTH) return null;
  return crypto.createHmac('sha256', key).update(String(material)).digest('hex');
}

// Consume 1 unidad del bucket (scope,key) vía RPC atómica.
// identity (opcional): material extra (p. ej. email normalizado) para scopes
// por-identidad. Devuelve { allowed, remaining, retryAfter } o { error }.
async function consumeRateLimit({ req, scope, limit, windowSeconds, identity } = {}) {
  const secret = getRateLimitSecret();
  if (!secret) {
    return { error: 'missing_secret' };
  }

  const material = identity !== undefined && identity !== null
    ? `${scope}:id:${identity}`
    : `${scope}:ip:${getClientIp(req)}`;
  const keyHash = hashRateLimitKey(material, secret);

  let rpc;
  try {
    rpc = await getServiceClient().rpc('consume_api_rate_limit', {
      p_scope: scope,
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
  } catch (error) {
    return { error: 'limiter_error', detail: error?.message || String(error) };
  }

  if (rpc.error) {
    return { error: 'limiter_error', detail: rpc.error.message || String(rpc.error) };
  }

  const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  if (!row || typeof row.allowed !== 'boolean') {
    return { error: 'limiter_error', detail: 'bad_contract' };
  }

  return {
    allowed: row.allowed,
    remaining: typeof row.remaining === 'number' ? row.remaining : 0,
    retryAfter: typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : 0,
  };
}

// Aplica el límite y responde 429/503 cuando corresponde.
// Retorna null si el request puede continuar, o `res` ya respondido.
async function enforceRateLimit(req, res, { scope, limit, windowSeconds, identity } = {}) {
  const result = await consumeRateLimit({ req, scope, limit, windowSeconds, identity });

  if (result.error) {
    return res.status(503).json({ error: 'Servicio no disponible temporalmente. Intenta de nuevo.' });
  }

  if (!result.allowed) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', String(result.retryAfter));
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
    }
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' });
  }

  return null;
}

module.exports = {
  MIN_SECRET_LENGTH,
  getRateLimitSecret,
  getClientIp,
  hashRateLimitKey,
  consumeRateLimit,
  enforceRateLimit,
};
