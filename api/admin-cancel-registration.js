// api/admin-cancel-registration.js
// Anula UNA inscripción sin borrar el historial del pago.
// Conserva payment_status/amount_paid/Stripe IDs y libera el BIB activo.

const { createClient } = require('@supabase/supabase-js');
const { getAdminUser } = require('../lib/_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CANCELLABLE_PAYMENT_STATUSES = new Set(['paid', 'paid_no_email']);

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
      return res.status(400).json({ error: 'Faltan los datos de la inscripción.' });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('inscripciones')
      .select('id, email, full_name, order_session_id, stripe_session_id, payment_status, registration_status, bib_number, cancelled_bib_number, event_slug, amount_paid')
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .single();

    if (lookupError || !existing) {
      return res.status(404).json({ error: 'No se encontró la inscripción.' });
    }

    if (existing.registration_status === 'cancelled') {
      return res.status(200).json({
        ok: true,
        alreadyCancelled: true,
        inscriptionId: existing.id,
        releasedBibNumber: existing.cancelled_bib_number || null,
      });
    }

    if (!CANCELLABLE_PAYMENT_STATUSES.has(String(existing.payment_status || '').trim())) {
      return res.status(409).json({
        error: 'Solo se pueden anular inscripciones con pago confirmado.',
      });
    }

    const cancelledAt = new Date().toISOString();
    const releasedBibNumber = existing.bib_number || null;

    const { data: updated, error: updateError } = await supabase
      .from('inscripciones')
      .update({
        registration_status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: auth.email,
        cancellation_reason: cleanReason || null,
        cancelled_bib_number: releasedBibNumber,
        bib_number: null,
      })
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .eq('registration_status', 'active')
      .select('id, email, full_name, payment_status, registration_status, bib_number, cancelled_bib_number, cancelled_at, cancelled_by, cancellation_reason, event_slug, order_session_id');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updated || updated.length !== 1) {
      return res.status(409).json({
        error: 'La inscripción cambió mientras se procesaba. Recarga el panel e inténtalo de nuevo.',
      });
    }

    console.log(
      `admin_action=cancel_registration admin=${auth.email} target=${cleanId} event=${existing.event_slug || ''} released_bib=${releasedBibNumber || ''} result=cancelled rows=1`
    );

    return res.status(200).json({
      ok: true,
      inscription: updated[0],
      releasedBibNumber,
      paymentPreserved: true,
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-cancel-registration:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
