// lib/admin-update-manual-payment-status.js
// Corrige el estado económico de UNA inscripción manual sin borrar historial.
// Solo aplica a manual_*; nunca modifica Stripe ni amount_paid.

const { createClient } = require('@supabase/supabase-js');
const { getAdminUser } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_PAYMENT_STATUSES = new Set(['paid', 'refunded', 'duplicate']);

function isManualRecord(row) {
  const orderId = String(row?.order_session_id || '').trim();
  const stripeId = String(row?.stripe_session_id || '').trim();
  return orderId.startsWith('manual_') || stripeId.startsWith('manual_');
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

    const { inscriptionId, email, paymentStatus } = req.body || {};
    const cleanId = String(inscriptionId || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanStatus = String(paymentStatus || '').trim().toLowerCase();

    if (!cleanId || !cleanEmail) {
      return res.status(400).json({ error: 'Faltan los datos de la inscripción.' });
    }

    if (!ALLOWED_PAYMENT_STATUSES.has(cleanStatus)) {
      return res.status(400).json({
        error: 'Estado de pago inválido. Usa paid, refunded o duplicate.',
      });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('inscripciones')
      .select('id, email, full_name, order_session_id, stripe_session_id, payment_status, registration_status, amount_paid')
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .single();

    if (lookupError || !existing) {
      return res.status(404).json({ error: 'No se encontró la inscripción.' });
    }

    if (!isManualRecord(existing)) {
      return res.status(409).json({
        error: 'El estado de pago solo se puede corregir manualmente en registros manual_*.',
      });
    }

    if (cleanStatus !== 'paid' && existing.registration_status !== 'cancelled') {
      return res.status(409).json({
        error: 'Primero anula la inscripción. Una inscripción activa no puede quedar como reembolsada o duplicada.',
      });
    }

    if (String(existing.payment_status || '').trim() === cleanStatus) {
      return res.status(200).json({
        ok: true,
        unchanged: true,
        inscription: existing,
        adminEmail: auth.email,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('inscripciones')
      .update({ payment_status: cleanStatus })
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .select('id, email, full_name, order_session_id, payment_status, registration_status, amount_paid');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updated || updated.length !== 1) {
      return res.status(409).json({
        error: 'La inscripción cambió mientras se procesaba. Recarga el panel e inténtalo de nuevo.',
      });
    }

    console.log(
      `admin_action=update_manual_payment_status admin=${auth.email} target=${cleanId} from=${existing.payment_status || ''} to=${cleanStatus} amount=${existing.amount_paid || ''} result=updated rows=1`
    );

    return res.status(200).json({
      ok: true,
      inscription: updated[0],
      previousPaymentStatus: existing.payment_status || null,
      paymentStatus: cleanStatus,
      amountPreserved: true,
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-update-manual-payment-status:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
