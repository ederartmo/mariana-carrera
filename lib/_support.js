const crypto = require('crypto');
const { getServiceClient } = require('./_auth');

const CATEGORIES = new Set(['general', 'events', 'registration', 'other']);
const STATUSES = new Set(['pending', 'in_progress', 'resolved']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[a-f0-9]{64}$/;
const LIMIT = 16 * 1024;

function jsonBytes(value) { try { return Buffer.byteLength(JSON.stringify(value)); } catch { return LIMIT + 1; } }
function hashCapability(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function validBody(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000; }
function safeError(res, status, message = 'No se pudo procesar la solicitud.') { return res.status(status).json({ ok: false, error: message }); }
function cacheNoStore(res) { res.setHeader('Cache-Control', 'no-store'); }
const PUBLIC_CHAT_ORIGINS = new Set(['https://kinetichub.com.mx', 'https://www.kinetichub.com.mx']);

function writeOriginAllowed(req, { publicChat = false, supportOperator = false } = {}) {
  const origin = req.headers?.origin;
  if (publicChat) {
    if (PUBLIC_CHAT_ORIGINS.has(origin)) return true;
    return process.env.VERCEL_ENV === 'development' &&
      process.env.SUPABASE_URL === 'https://lpujenjnxzszfbcjfrrb.supabase.co' &&
      origin === 'http://localhost:3142' && req.headers?.host === 'localhost:3142';
  }
  if (supportOperator && PUBLIC_CHAT_ORIGINS.has(origin)) return true;
  const allowed = [process.env.SITE_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`]
    .filter(Boolean).map((value) => { try { return new URL(value.includes('://') ? value : `https://${value}`).origin; } catch { return ''; } }).filter(Boolean);
  if (!origin) return !supportOperator && req.headers?.['sec-fetch-site'] === 'same-origin';
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol)) return false;
    return allowed.includes(parsed.origin) && req.headers?.host === parsed.host;
  } catch { return false; }
}
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key)); }
function rpcClient(injected) { return injected || getServiceClient(); }
function rpcData(data) { return Array.isArray(data) ? data[0] : data; }
module.exports = { CATEGORIES, STATUSES, UUID, CAPABILITY, LIMIT, jsonBytes, hashCapability, validBody, safeError, cacheNoStore, writeOriginAllowed, exactKeys, rpcClient, rpcData };
