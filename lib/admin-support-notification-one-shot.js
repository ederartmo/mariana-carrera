'use strict';

// Temporary, opt-in Production-only test. No general notification worker activation.
const { getAdminUser } = require('./_auth');
const { main } = require('../scripts/support-notification-one-shot');
const ORIGINS = new Set(['https://kinetichub.com.mx', 'https://www.kinetichub.com.mx']);
const WINDOW_MS = 5 * 60 * 1000;

function configured(env, now = Date.now()) {
  const expiration = env.SUPPORT_NOTIFICATION_TEST_EXPIRES_AT || '';
  const expiresAt = Date.parse(expiration);
  return env.VERCEL_ENV === 'production' &&
    env.SUPPORT_NOTIFICATIONS_ENABLED === 'false' &&
    env.SUPABASE_URL === 'https://uycwzhlcnfijjyzkgkem.supabase.co' &&
    Number.isFinite(expiresAt) &&
    new Date(expiresAt).toISOString() === expiration &&
    expiresAt > now && expiresAt - now <= WINDOW_MS;
}

async function handler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (status) => res.status(status).json({ ok: false });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(405);
  }
  if (!ORIGINS.has(req.headers?.origin) ||
      !ORIGINS.has('https://' + (req.headers?.host || '')) ||
      (req.body !== undefined && req.body !== null && req.body !== '') ||
      Object.keys(req.query || {}).length) return fail(403);
  const env = deps.env || process.env;
  if (!configured(env, (deps.now || Date.now)())) return fail(503);
  try {
    const auth = await (deps.auth || getAdminUser)(req);
    if (auth?.error) return fail(auth.status === 403 ? 403 : 401);
    const run = deps.run || main;
    const outcome = await run(['--send-once'], env);
    return res.status(outcome === 'provider_accepted' ? 200 : 409)
      .json({ ok: outcome === 'provider_accepted', outcome });
  } catch {
    // No retry: the reservation might have been committed before an ambiguous failure.
    return fail(503);
  }
}
module.exports = handler;
module.exports.configured = configured;
