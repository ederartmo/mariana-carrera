// api/data.js - HOTFIX Vercel Hobby (límite 12 Serverless Functions).
// Consolida los 3 endpoints GET/read-only en UNA sola función; vercel.json
// reescribe las URLs públicas originales hacia ?action=... (query original
// preservada por Vercel). Sin cambios de lógica ni de auth: cada action
// delega a su handler en lib/, que conserva SU propia autorización.
// Mapa estático: un action no puede invocar la autorización de otro.

const ACTIONS = {
  'support-chat': require('../lib/support-chat'),
  'admin-support': require('../lib/admin-support'),
  'support-notification-worker': require('../lib/support-notifications-worker'),
  'admin-perrun-production': require('../lib/admin-perrun-production'),
  'admin-perrun-annul': require('../lib/admin-perrun-annul'),
  'admin-perrun-registration': require('../lib/admin-perrun-registration'),
  'admin-export-perrun': require('../lib/admin-export-perrun'),
  'admin-export-shirts': require('../lib/admin-export-shirts'),
  'me-registrations': require('../lib/me-registrations'),
  'admin-list-inscriptions': require('../lib/admin-list-inscriptions'),
  'admin-list-available-bibs': require('../lib/admin-list-available-bibs'),
  'admin-cancel-registration': require('../lib/admin-cancel-registration'),
  'admin-archive-attempt': require('../lib/admin-archive-attempt'),
  'resend-emails-list': require('../lib/resend-emails-list'),
};

module.exports = async function handler(req, res) {
  const { action: selector, ...query } = req.query || {};
  const action = typeof selector === 'string' ? selector.trim() : '';
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;

  if (typeof run !== 'function') {
    return res.status(404).json({ error: 'Acción no encontrada.' });
  }

  if (action === 'support-chat' || action === 'admin-support' || action === 'support-notification-worker') {
    // The rewrite selector is transport metadata, not a support API filter.
    const routed = Object.create(req);
    Object.defineProperty(routed, 'query', { value: query });
    return run(routed, res);
  }
  return run(req, res);
};
