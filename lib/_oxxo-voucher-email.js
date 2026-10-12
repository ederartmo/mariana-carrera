'use strict';
const { sendTransactionalEmail } = require('./_transactional-email');
const SUBJECT = 'Tu referencia de pago OXXO está lista';
const MARKER = 'oxxo_voucher_email_id';
const EVENTS = { 'axolote-night-run': 'Axolote Night Run 2026', 'cascanueces-run': 'Cascanueces Run 2026', 'perrun-2027': 'Perrun 2027' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const idOf = value => typeof value === 'string' ? value : value?.id;
function renderVoucherEmail({ name, email, eventName, distance, amount, currency }) {
  const label = eventName + (distance ? ' · ' + distance : '');
  const price = new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount / 100) + ' ' + currency.toUpperCase();
  const intro = 'Generaste correctamente tu referencia para pagar tu inscripción en OXXO.';
  const notice = 'Si ya realizaste tu pago en tienda, la confirmación puede tardar hasta 24 horas en reflejarse en nuestro sistema.';
  const confirmation = 'Cuando recibamos la confirmación del pago, te enviaremos otro correo confirmando tu inscripción.';
  const ticket = 'Conserva tu ticket de OXXO hasta recibir esa confirmación.';
  const support = 'Si después de 24 horas tu pago aún no aparece confirmado, contáctanos y adjunta una fotografía de tu comprobante.';
  return { subject: SUBJECT,
    text: [`Hola, ${name}.`, intro, label, `Importe: ${price}`, `Correo: ${email}`, 'IMPORTANTE SOBRE PAGOS EN OXXO', notice, confirmation, ticket, support, 'Kinetic Hub'].join('\n\n'),
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${SUBJECT}</title></head><body style="margin:0;padding:0;background-color:#edf3ee;color:#243d30;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edf3ee;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:16px;"><tr><td style="padding:24px;background-color:#246342;color:#ffffff;border-radius:16px 16px 0 0;font-size:26px;font-weight:bold;">Kinetic Hub</td></tr><tr><td style="padding:24px;font-size:16px;line-height:1.6;"><h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;">${SUBJECT}</h1><p>Hola, ${escape(name)}.</p><p>${intro}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f6f2;border-radius:10px;"><tr><td style="padding:18px;word-break:break-word;"><strong>${escape(label)}</strong><br>Importe: ${escape(price)}<br>Correo: ${escape(email)}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background-color:#fff3cd;border-radius:10px;color:#604800;"><tr><td style="padding:18px;"><strong>IMPORTANTE SOBRE PAGOS EN OXXO</strong><p style="margin:12px 0 0;">${notice}</p></td></tr></table><p>${confirmation}</p><p><strong>${ticket}</strong></p><p>${support}</p><p style="margin-bottom:0;color:#246342;font-weight:bold;">Kinetic Hub</p></td></tr></table></td></tr></table></body></html>` };
}

// Called only after Stripe signature verification. No registration/DB writes.
async function sendOxxoVoucherEmail({ stripe, resend, event, mockProvider, now = Date.now(), logger = console }) {
  const snapshot = event.data?.object;
  if (event.type !== 'checkout.session.completed' || snapshot?.payment_status !== 'unpaid' || !idOf(snapshot.payment_intent)) return { skipped: true };
  if (!EVENTS[snapshot.metadata?.event_slug] || snapshot.metadata?.flow === 'perrun-engraving-v1') return { skipped: true };
  try {
    // Fresh provider state supplies a durable receipt and prevents sending after payment.
    const session = await stripe.checkout.sessions.retrieve(snapshot.id);
    if (session.metadata?.[MARKER]) return { skipped: true };
    if (session.payment_status !== 'unpaid' || session.status !== 'complete' || idOf(session.payment_intent) !== idOf(snapshot.payment_intent)) return { skipped: true };
    // Resend keys expire after 24h. Fail closed for late replay even if receipt
    // persistence failed after a successful send. Never use session.created here.
    const age = now / 1000 - event.created;
    if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600) {
      logger.warn('oxxo_voucher_email_skipped', { sessionId: snapshot.id, reason: 'outside_idempotency_window' });
      return { skipped: true };
    }
    const pi = await stripe.paymentIntents.retrieve(idOf(session.payment_intent), { expand: ['payment_method'] });
    const details = pi.next_action?.oxxo_display_details;
    if (pi.id !== idOf(session.payment_intent) || pi.status !== 'requires_action' || pi.payment_method?.type !== 'oxxo' || pi.next_action?.type !== 'oxxo_display_details' || !details?.number || !details?.hosted_voucher_url) return { skipped: true };
    const metadata = session.metadata || {};
    const email = session.customer_details?.email || session.customer_email || metadata.buyer_email;
    if (!email || !EVENTS[metadata.event_slug] || !Number.isInteger(session.amount_total) || session.amount_total < 0 || session.currency !== 'mxn') throw Error('Voucher email data unavailable');
    let distance = metadata.distance;
    if (!distance && metadata.event_slug === 'perrun-2027') {
      const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
      distance = items.data?.map(item => item.description || '').join(' ').match(/\b(?:1|3|5|10)K\b/i)?.[0];
    }
    const payload = { to: email, ...renderVoucherEmail({ name: metadata.participant_1_name || metadata.full_name || session.customer_details?.name || 'Atleta', email, eventName: EVENTS[metadata.event_slug], distance, amount: session.amount_total, currency: session.currency }) };
    const result = await sendTransactionalEmail({ resend, mockProvider, payload, idempotencyKey: 'oxxo-voucher/' + pi.id });
    if (result.error || !result.data?.id) throw Error('Resend did not accept voucher email');
    await stripe.checkout.sessions.update(session.id, { metadata: { [MARKER]: result.data.id } });
    return { ok: true, resendId: result.data.id };
  } catch (error) {
    // Email and receipt failures must never invalidate the voucher or fulfillment.
    logger.error('oxxo_voucher_email_failed', { sessionId: snapshot.id, reason: error.name || 'Error' });
    return { ok: false };
  }
}
module.exports = { sendOxxoVoucherEmail, renderVoucherEmail, MARKER };
