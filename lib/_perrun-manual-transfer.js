'use strict';
const { normalizePerrunPayload, priceFor } = require('./_perrun-checkout');
const { sendPerrunConfirmation } = require('./_perrun-confirmation');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function handlePerrunManualTransfer({ req, res, supabase, auth, now = new Date(), sendConfirmation = sendPerrunConfirmation, resend }) {
  res.setHeader?.('Cache-Control', 'no-store');
  try {
    const body = req.body || {};
    if (!UUID.test(body.manualPaymentId || '')) return res.status(400).json({ error: 'Identidad manual inválida.' });
    if (body.paidAt !== undefined) return res.status(400).json({ error: 'Perrun no admite fecha de pago retroactiva.' });
    if (body.tickets?.some(ticket => (ticket.bibMode && ticket.bibMode !== 'auto') || ticket.releasedBib)) {
      return res.status(400).json({ error: 'Perrun asigna el BIB automáticamente.' });
    }
    const payload = normalizePerrunPayload(body);
    const manualPaymentId = body.manualPaymentId.toLowerCase();
    const orderSessionId = 'manual_perrun_' + manualPaymentId;
    const reference = String(body.transferReference || '').trim();
    if (reference.length > 80) return res.status(400).json({ error: 'Referencia demasiado larga.' });
    // Read-only retry lookup: tariff is fixed by the first committed registration.
    const previous = await supabase.from('perrun_checkout_orders').select('amount_cents,price_stage,quoted_at')
      .eq('order_session_id', orderSessionId).maybeSingle();
    if (previous.error) throw new Error('No se pudo consultar la operación manual.');
    const price = previous.data ? null : priceFor(payload, now);
    const amountCents = previous.data?.amount_cents ?? Math.round(price.total * 100);
    if (body.totalAmount !== undefined && (typeof body.totalAmount !== 'number'
      || !Number.isFinite(body.totalAmount) || body.totalAmount * 100 !== amountCents)) {
      return res.status(409).json({ error: 'El monto no coincide con la tarifa de Perrun. Revisa el precio vigente.', totalAmount: amountCents / 100 });
    }
    const result = await supabase.rpc('register_perrun_manual_paid_order', {
      p_manual_payment_id: manualPaymentId, p_distance: payload.distance, p_buyer_email: payload.email,
      p_participant: payload.participant, p_dogs: payload.dogs,
      p_price_stage: previous.data?.price_stage ?? price.stage.key,
      p_quoted_at: previous.data?.quoted_at ?? now.toISOString(), p_confirmed_amount_cents: amountCents,
      p_transfer_reference: reference || null, p_admin_user_id: auth.user.id, p_admin_email: auth.email,
    });
    if (result.error) {
      const conflict = ['23505', '23514', 'P0001'].includes(result.error.code);
      return res.status(conflict ? 409 : result.error.code === '22023' ? 400 : 503)
        .json({ error: conflict ? 'La operación manual ya existe con otros datos o cambió la tarifa.' : 'No se pudo registrar Perrun. Reintenta la misma operación.' });
    }
    const registered = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!registered || registered.order_session_id !== orderSessionId) throw new Error('Respuesta de registro incompleta. Reintenta la misma operación.');
    // Fulfillment is already committed. Mail failure must never turn into another registration.
    let email;
    try {
      if (!resend && sendConfirmation === sendPerrunConfirmation) {
        const { Resend } = require('resend');
        resend = new Resend(process.env.RESEND_API_KEY);
      }
      email = await sendConfirmation({ supabase, resend, sessionId: orderSessionId });
    } catch { email = { ok: false }; }
    return res.status(200).json({ ok: true, registrationSaved: true, orderSessionId, manualPaymentId,
      eventSlug: payload.eventSlug, buyerEmail: payload.email, totalAmount: Number(registered.amount_paid),
      ticketsCreated: 1, tickets: [registered], emailSent: email.ok && !email.skipped,
      emailPending: !email.ok, transferReference: reference });
  } catch (error) {
    return res.status(error.status || (error instanceof RangeError ? 400 : 503)).json({ error: error.message || 'No se pudo registrar Perrun.' });
  }
}
module.exports = { handlePerrunManualTransfer };
