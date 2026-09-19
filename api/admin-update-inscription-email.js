// api/admin-update-inscription-email.js - Batch 4: auth central + pre-read + log.
// Mantiene: corrección de email por inscripción u orden completa,
// email_sent=false intencional (rearma reenvío). Protegidos: payment_status,
// amount_paid, bib_number, Stripe IDs, ticket_index/count (nunca se tocan).

const { createClient } = require('@supabase/supabase-js');
const { getAdminUser, normalizeEmail } = require('../lib/_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUser(req);
    if (auth.error) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }

    const { inscriptionId, orderSessionId, email } = req.body || {};
    const cleanInscriptionId = String(inscriptionId || '').trim();
    const cleanOrderSessionId = String(orderSessionId || '').trim();
    const cleanEmail = normalizeEmail(email);

    if (!cleanInscriptionId && !cleanOrderSessionId) {
      return res.status(400).json({ error: 'Debes indicar una inscripción o una orden.' });
    }
    if (cleanInscriptionId && cleanOrderSessionId) {
      return res.status(400).json({ error: 'Indica una inscripción O una orden, no ambas.' });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Correo inválido.' });
    }

    // Pre-read: el target debe existir antes de mutar.
    let lookup = supabase.from('inscripciones').select('id, order_session_id');
    lookup = cleanOrderSessionId
      ? lookup.eq('order_session_id', cleanOrderSessionId)
      : lookup.eq('id', cleanInscriptionId);

    const { data: existing, error: lookupError } = await lookup;
    if (lookupError) {
      throw new Error(lookupError.message);
    }
    if (!existing || existing.length === 0) {
      console.log(`admin_action=update_email admin=${auth.email} target=${cleanOrderSessionId || cleanInscriptionId} result=not_found rows=0`);
      return res.status(404).json({ error: 'No se encontraron registros para actualizar.' });
    }

    // Por orden: todas las filas deben pertenecer a la misma orden.
    if (cleanOrderSessionId && existing.some((row) => row.order_session_id !== cleanOrderSessionId)) {
      console.log(`admin_action=update_email admin=${auth.email} target=${cleanOrderSessionId} result=blocked_mismatch rows=${existing.length}`);
      return res.status(409).json({ error: 'La orden contiene registros inconsistentes; no se actualizó nada.' });
    }

    let updateQuery = supabase
      .from('inscripciones')
      .update({
        buyer_email: cleanEmail,
        email: cleanEmail,
        email_sent: false,
      });

    updateQuery = cleanOrderSessionId
      ? updateQuery.eq('order_session_id', cleanOrderSessionId)
      : updateQuery.eq('id', cleanInscriptionId);

    const { data, error } = await updateQuery
      .select('id, order_session_id, full_name, email, buyer_email, email_sent');
    if (error) {
      throw new Error(error.message);
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;
    if (updatedCount !== existing.length) {
      console.log(`admin_action=update_email admin=${auth.email} target=${cleanOrderSessionId || cleanInscriptionId} result=count_mismatch rows=${updatedCount}`);
      return res.status(500).json({ error: 'La actualización no coincidió con lo verificado; revisa manualmente.' });
    }

    console.log(`admin_action=update_email admin=${auth.email} target=${cleanOrderSessionId || cleanInscriptionId} result=updated rows=${updatedCount}`);

    return res.status(200).json({
      ok: true,
      updatedCount,
      orderSessionId: cleanOrderSessionId || data[0]?.order_session_id || null,
      email: cleanEmail,
      updatedIds: data.map((item) => item.id),
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-update-inscription-email:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
