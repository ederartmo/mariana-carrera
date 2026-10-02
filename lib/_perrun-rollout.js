'use strict';

// Opt-in applies only to new quotes. Persisted reservations/orders survive flag changes.
const enabled = () => process.env.PERRUN_PAYMENT_V2 === '1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function reservationVersion(supabase, column, id) {
  const result = await supabase.from('perrun_checkout_reservations').select('pricing_model_version')
    .eq(column, id).maybeSingle();
  // Before schema rollout, an absent V2 table means there cannot be a V2 reservation.
  if (result.error?.code === '42P01') return null;
  if (result.error) throw new Error('No se pudo verificar la versión de la reserva.');
  if (!result.data) return null;
  if (result.data.pricing_model_version !== 2) throw new Error('Versión de reserva inválida.');
  return 2;
}
async function useV2({ body = {}, supabase, manual = false }) {
  if (body.reservationId !== undefined) {
    if (!UUID.test(body.reservationId) || await reservationVersion(supabase, 'id', body.reservationId) !== 2) {
      throw new Error('Reserva inválida.');
    }
    return true;
  }
  if (!manual && body.action !== 'quote' && typeof body.quoteToken === 'string' && body.quoteToken.includes('.')) {
    // V1 verifies the signed quote before creating anything, even after V2 activation.
    return false;
  }
  if (manual && UUID.test(body.manualPaymentId || '')) {
    const existing = await supabase.from('perrun_checkout_orders').select('*')
      .eq('order_session_id', 'manual_perrun_' + body.manualPaymentId.toLowerCase()).maybeSingle();
    if (existing.error) throw new Error('No se pudo verificar la versión de la orden.');
    if (existing.data) {
      const version = existing.data.pricing_model_version ?? 1;
      if (version === 1) return false;
      if (version !== 2) throw new Error('Versión de orden inválida.');
      // V2 needs its signed reservation, never the legacy manual finalizer.
      throw new Error('Reintenta con la reserva original de la orden V2.');
    }
  }
  const attempt = manual ? body.manualPaymentId : body.attemptId;
  if (UUID.test(attempt || '') && await reservationVersion(supabase, 'attempt_id', attempt) === 2) return true;
  return enabled();
}
module.exports = { enabled, useV2 };
