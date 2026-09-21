// lib/admin-archive-attempt.js
// Archiva intentos LIVE de checkout que nunca se convirtieron en pago confirmado.
// No borra Stripe IDs, monto ni historial. Nunca archiva pagos confirmados ni registros con BIB.

const { createClient } = require('@supabase/supabase-js');
const { getAdminUser } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ARCHIVABLE_PAYMENT_STATUSES = new Set(['pending', 'payment_failed']);

function isLiveCheckout(row) {
  const orderId = String(row?.order_session_id || '').trim();
  const stripeId = String(row?.stripe_session_id || '').trim();
  return orderId.startsWith('cs_live_') && stripeId.startsWith('cs_live_');
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

    const { inscriptionId, email, reason } = req.body || {};
    const cleanId = String(inscriptionId || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanReason = String(reason || '').trim().slice(0, 300);

    if (!cleanId || !cleanEmail) {
      return res.status(400).json({ error: 'Faltan los datos del intento.' });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('inscripciones')
      .select('id, email, full_name, order_session_id, stripe_session_id, payment_status, registration_status, bib_number, event_slug, archived_at, archived_by, archive_reason')
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .single();

    if (lookupError || !existing) {
      return res.status(404).json({ error: 'No se encontró el intento.' });
    }

    if (existing.registration_status === 'archived') {
      return res.status(200).json({
        ok: true,
        alreadyArchived: true,
        inscriptionId: existing.id,
        paymentStatus: existing.payment_status || null,
      });
    }

    if (existing.registration_status !== 'active') {
      return res.status(409).json({ error: 'Solo se pueden archivar intentos activos.' });
    }

    if (!ARCHIVABLE_PAYMENT_STATUSES.has(String(existing.payment_status || '').trim())) {
      return res.status(409).json({
        error: 'Solo se pueden archivar intentos pendientes o con pago fallido.',
      });
    }

    if (existing.bib_number) {
      return res.status(409).json({
        error: 'Este registro tiene BIB asignado y no se puede archivar como intento incompleto.',
      });
    }

    if (!isLiveCheckout(existing)) {
      return res.status(409).json({
        error: 'Archivar intento solo aplica a checkouts Stripe LIVE. Los registros TEST se eliminan con “Eliminar prueba”.',
      });
    }

    const archivedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('inscripciones')
      .update({
        registration_status: 'archived',
        archived_at: archivedAt,
        archived_by: auth.email,
        archive_reason: cleanReason || null,
      })
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .eq('registration_status', 'active')
      .eq('payment_status', existing.payment_status)
      .is('bib_number', null)
      .select('id, email, full_name, payment_status, registration_status, archived_at, archived_by, archive_reason, event_slug, order_session_id');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updated || updated.length !== 1) {
      return res.status(409).json({
        error: 'El intento cambió mientras se procesaba. Recarga el panel e inténtalo de nuevo.',
      });
    }

    console.log(
      `admin_action=archive_attempt admin=${auth.email} target=${cleanId} event=${existing.event_slug || ''} payment_status=${existing.payment_status || ''} result=archived rows=1`
    );

    return res.status(200).json({
      ok: true,
      inscription: updated[0],
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-archive-attempt:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
