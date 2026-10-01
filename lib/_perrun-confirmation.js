'use strict';
const { createHash } = require('node:crypto');
const event = require('../perrun-event-data');
const { SLUG, enrichRegistrations, engravingStatus } = require('./_perrun-operations');
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function renderConfirmation(row) {
  if (row.event_slug !== SLUG || !['paid', 'paid_no_email'].includes(row.payment_status) || row.registration_status !== 'active' || !row.bib_number || !row.dogs?.length) throw new Error('Confirmación requiere inscripción Perrun pagada y activa.');
  const bib = String(row.bib_number).padStart(3, '0');
  const lines = [event.name, row.full_name, 'Distancia: ' + row.distance, event.date.label, event.location.name, 'BIB #' + bib, 'Talla: ' + row.shirt_size, ...row.dogs.map(dog => 'Perro ' + dog.dog_index + ': ' + dog.dog_name + ' · ' + dog.dog_size + ' · ' + engravingStatus(dog)), 'Entrega de kit: 12 de febrero de 2027, 10:00–16:00, ' + event.pickup.location];
  return { subject: 'Inscripción confirmada — ' + event.name + ' · ' + row.distance, text: lines.join('\n'), html: '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Confirmación Perrun</title></head><body style="font-family:Arial,sans-serif;color:#20252b;background:#f5f7f9;padding:24px"><main style="max-width:600px;margin:auto;background:white;padding:24px"><h1>' + escape(event.name) + '</h1>' + lines.slice(1).map(line => '<p style="line-height:1.6">' + escape(line) + '</p>').join('') + '<p>Guarda esta confirmación. ¿Necesitas ayuda? hola@kinetichub.com.mx</p></main></body></html>' };
}
async function sendPerrunConfirmation({ supabase, resend, sessionId, qa = process.env.PERRUN_QA_LOCAL === '1' }) {
  // Local QA never reaches the mail provider and never marks a simulated email as sent.
  if (qa) return { ok: true, skipped: true, qa: true };
  try {
    const result = await supabase.from('inscripciones').select('id,email,buyer_email,order_session_id,event_slug,distance,full_name,shirt_size,bib_number,payment_status,registration_status,email_sent')
      .eq('order_session_id', sessionId).eq('event_slug', SLUG);
    if (result.error || result.data?.length !== 1) throw new Error('Inscripción Perrun no disponible para email.');
    const row = result.data[0];
    if (row.email_sent) return { ok: true, skipped: true };
    if (row.registration_status !== 'active' || !['paid', 'paid_no_email'].includes(row.payment_status)) return { ok: true, skipped: true };
    const [confirmed] = await enrichRegistrations(supabase, [row]);
    const payload = renderConfirmation(confirmed);
    // Same key for webhook retries, simultaneous deliveries and admin retries.
    const idempotencyKey = 'perrun-confirmation/' + createHash('sha256').update(sessionId).digest('hex');
    const sent = await resend.emails.send({ from: 'Kinetic Hub <no-reply@kinetichub.com.mx>', to: row.buyer_email || row.email, ...payload }, { idempotencyKey });
    if (sent.error || !sent.data?.id) throw new Error('Resend no confirmó la entrega.');
    const marked = await supabase.from('inscripciones').update({ email_sent: true, confirmation_email_id: sent.data.id, confirmation_email_sent_at: new Date().toISOString() })
      .eq('order_session_id', sessionId).eq('event_slug', SLUG).eq('registration_status', 'active').in('payment_status', ['paid', 'paid_no_email']).or('email_sent.is.false,email_sent.is.null');
    if (marked.error) throw new Error('Email enviado; pendiente persistir confirmación.');
    return { ok: true, resendId: sent.data.id };
  } catch (error) { return { ok: false, error: error.message }; }
}
module.exports = { renderConfirmation, sendPerrunConfirmation };
