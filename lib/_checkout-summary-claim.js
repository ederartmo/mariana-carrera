// lib/_checkout-summary-claim.js - Batch 3: prueba de posesión para checkout-summary.
//
// El session_id de Stripe viaja en la URL y no debe bastar para leer PII.
// Al crear el checkout, el servidor firma sessionId+expiración con HMAC-SHA256
// (CHECKOUT_SUMMARY_SECRET, solo env server-side) y lo entrega ÚNICAMENTE
// como cookie HttpOnly. checkout-summary verifica firma+expiración+session
// ANTES de tocar Supabase/Stripe. Sin DB en este módulo.
// Fail closed: sin secreto válido (>=32 chars) no se emite ni se acepta nada.

const crypto = require('crypto');

const COOKIE_NAME = 'kh_checkout_claim';
const CLAIM_TTL_SECONDS = 72 * 3600; // 259200 = 72h
const MIN_SECRET_LENGTH = 32;

function getSecret() {
  const secret = process.env.CHECKOUT_SUMMARY_SECRET || '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input) {
  const raw = String(input || '');
  if (!/^[A-Za-z0-9\-_]+$/.test(raw) || raw.length === 0 || raw.length > 512) {
    return null;
  }
  const padded = raw.replaceAll('-', '+').replaceAll('_', '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64');
}

function parseCookies(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || out[name] !== undefined) continue;
    out[name] = part.slice(index + 1).trim();
  }
  return out;
}

function createCheckoutSummaryClaim(sessionId, options = {}) {
  const secret = options.secret !== undefined ? options.secret : getSecret();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return { error: 'missing_secret' };
  }

  const sid = String(sessionId || '').trim();
  if (!sid || sid.length > 200) {
    return { error: 'invalid_session' };
  }

  const nowSeconds = Number.isInteger(options.nowSeconds)
    ? options.nowSeconds
    : Math.floor(Date.now() / 1000);
  const ttlSeconds = Number.isInteger(options.ttlSeconds) ? options.ttlSeconds : CLAIM_TTL_SECONDS;
  const exp = nowSeconds + ttlSeconds;
  const payload = `${base64urlEncode(sid)}.${exp}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest();

  return {
    claim: `${payload}.${base64urlEncode(signature)}`,
    expiresAt: exp,
  };
}

function verifyCheckoutSummaryClaim(cookieHeader, sessionId, options = {}) {
  const secret = options.secret !== undefined ? options.secret : getSecret();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: 'missing_secret' };
  }

  const raw = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!raw) {
    return { ok: false, reason: 'missing_claim' };
  }

  const parts = String(raw).split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'bad_format' };
  }

  const [sidB64, expStr, sigB64] = parts;
  const sidBuffer = base64urlDecode(sidB64);
  const sigBuffer = base64urlDecode(sigB64);
  const exp = Number(expStr);

  if (!sidBuffer || !sigBuffer || !Number.isInteger(exp)) {
    return { ok: false, reason: 'bad_format' };
  }

  const nowSeconds = Number.isInteger(options.nowSeconds)
    ? options.nowSeconds
    : Math.floor(Date.now() / 1000);
  if (exp <= nowSeconds) {
    return { ok: false, reason: 'expired' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${sidB64}.${expStr}`)
    .digest();

  if (sigBuffer.length !== expected.length || !crypto.timingSafeEqual(sigBuffer, expected)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (sidBuffer.toString('utf8') !== String(sessionId || '').trim()) {
    return { ok: false, reason: 'session_mismatch' };
  }

  return { ok: true };
}

function buildCheckoutSummaryCookie(claim, options = {}) {
  const parts = [
    `${COOKIE_NAME}=${claim}`,
    'HttpOnly',
    'Path=/api/checkout-summary',
    `Max-Age=${CLAIM_TTL_SECONDS}`,
    'SameSite=Lax',
  ];
  if (options.secure !== false) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

// Secure siempre, salvo localhost (desarrollo). Sin host → Secure (producción).
function shouldSecureCheckoutCookie(req) {
  const host = String(
    req?.headers?.host || req?.headers?.['x-forwarded-host'] || ''
  ).trim().toLowerCase();
  return !(host.startsWith('localhost') || host.startsWith('127.0.0.1'));
}

module.exports = {
  COOKIE_NAME,
  CLAIM_TTL_SECONDS,
  MIN_SECRET_LENGTH,
  getSecret,
  createCheckoutSummaryClaim,
  verifyCheckoutSummaryClaim,
  buildCheckoutSummaryCookie,
  shouldSecureCheckoutCookie,
  parseCookies,
};
