// api/data.js - HOTFIX Vercel Hobby (límite 12 Serverless Functions).
// Consolida los 3 endpoints GET/read-only en UNA sola función; vercel.json
// reescribe las URLs públicas originales hacia ?action=... (query original
// preservada por Vercel). Sin cambios de lógica ni de auth: cada action
// delega a su handler en lib/, que conserva SU propia autorización.
// Mapa estático: un action no puede invocar la autorización de otro.

const ACTIONS = {
  'me-registrations': require('../lib/me-registrations'),
  'admin-list-inscriptions': require('../lib/admin-list-inscriptions'),
  'admin-cancel-registration': require('../lib/admin-cancel-registration'),
  'admin-update-manual-payment-status': require('../lib/admin-update-manual-payment-status'),
  'resend-emails-list': require('../lib/resend-emails-list'),
};

module.exports = async function handler(req, res) {
  const action = String(req.query.action || '').trim();
  const run = ACTIONS[action];

  if (typeof run !== 'function') {
    return res.status(404).json({ error: 'Acción no encontrada.' });
  }

  return run(req, res);
};
