// Anula UNA inscripción sin borrar el historial financiero.
// Conserva payment_status/amount_paid/orden y libera el BIB operativo.
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

    const { inscriptionId, reason } = req.body || {};
    const cleanId = String(inscriptionId || '').trim();
    const cleanReason = String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 200);

    if (!cleanId || cleanId.length > 100) {
      return res.status(400).json({ error: 'Identificador de inscripción inválido.' });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('inscripciones')
      .select('id, full_name, event_slug, payment_status, registration_status, bib_number, order_session_id')
      .eq('id', cleanId)
      .single();

    if (lookupError || !existing) {
      return res.status(404).json({ error: 'No se encontró la inscripción.' });
    }

    const registrationStatus = String(existing.registration_status || 'active').trim().toLowerCase();
    if (registrationStatus === 'cancelled') {
      return res.status(409).json({ error: 'Esta inscripción ya está anulada.' });
    }

    const paymentStatus = String(existing.payment_status || '').trim().toLowerCase();
    if (!CANCELLABLE_PAYMENT_STATUSES.has(paymentStatus)) {
      return res.status(409).json({
        error: 'Solo se pueden anular inscripciones con pago registrado.',
      });
    }

    const releasedBibNumber = existing.bib_number ? String(existing.bib_number) : null;
    const cancelledAt = new Date().toISOString();

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
      .eq('registration_status', 'active')
      .select('id, registration_status, cancelled_at, cancelled_bib_number, bib_number, payment_status, event_slug, order_session_id');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updated || updated.length !== 1) {
      return res.status(409).json({
        error: 'La inscripción cambió mientras se procesaba. Recarga el panel y vuelve a intentar.',
      });
    }

    console.log(
      `admin_action=cancel_registration admin=${auth.email} target=${cleanId} result=cancelled released_bib=${releasedBibNumber || 'none'}`
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
