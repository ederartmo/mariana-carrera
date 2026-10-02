'use strict';
const { createHash } = require('node:crypto');
const event = require('../perrun-event-data');
const { sendTransactionalEmail } = require('./_transactional-email');
const { SLUG, enrichRegistrations, engravingStatus } = require('./_perrun-operations');
const WAIVER_URL = 'https://www.kinetichub.com.mx/assets/events/perrun-2027/docs/exoneracion-perrun-2027.pdf';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function renderConfirmation(row) {
  if (row.event_slug !== SLUG || !['paid', 'paid_no_email'].includes(row.payment_status) || row.registration_status !== 'active' || !row.bib_number || !row.dogs?.length) throw new Error('Confirmación requiere inscripción Perrun pagada y activa.');
  const amount = Number(row.amount_paid);
  if (row.amount_paid == null || !Number.isFinite(amount) || amount < 0) throw new Error('Total pagado no disponible.');

  const bib = String(row.bib_number).padStart(3, '0');
  const engravingLine = dog => {
    const status = engravingStatus(dog);
    return 'Perro ' + dog.dog_index + ': ' + dog.dog_name + ' · ' + dog.dog_size + ' · ' + dog.dog_weight_kg + ' kg · ' + status
      + (status.includes('Pago pendiente') ? '. El grabado opcional de $' + event.dogRules.engravingPaidPrice + ' MXN se paga posteriormente; no fue cobrado en la inscripción.' : '');
  };
  const lines = [
    event.name,
    row.full_name,
    'Distancia: ' + row.distance,
    event.date.label,
    event.location.name,
    'Documento de exoneración',
    'Es necesario presentar este documento firmado el día del evento.',
    'Descárgalo, imprímelo y llévalo firmado.',
    'Descargar exoneración: ' + WAIVER_URL,
    'BIB #' + bib,
    'Talla: ' + row.shirt_size,
    'Total principal pagado: $' + amount.toFixed(2) + ' MXN',
    ...row.dogs.map(engravingLine),
    'Entrega de kit: 12 de febrero de 2027, 10:00–16:00, ' + event.pickup.location,
  ];

  const dogCards = row.dogs.map(dog => {
    const status = engravingStatus(dog);
    const statusTone = dog.engraving_free || dog.engraving_payment_status === 'paid' ? '#2d6a47' : status.includes('Pago pendiente') ? '#8a5a18' : '#5f655f';
    const plateName = dog.dog_name_for_plate ? '<div style="margin-top:6px;color:#736d62;font-size:12px;">Placa: ' + escape(dog.dog_name_for_plate) + '</div>' : '';
    return '<tr><td style="padding:0 0 12px 0;">'
      + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8f2e7;border:1px solid #e6dcc9;border-radius:14px;">'
      + '<tr><td style="padding:16px 18px;">'
      + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>'
      + '<td style="vertical-align:top;"><div style="font-size:12px;font-weight:800;letter-spacing:.9px;color:#9b6d25;text-transform:uppercase;">Perro ' + escape(dog.dog_index) + '</div>'
      + '<div style="margin-top:4px;font-size:19px;font-weight:800;color:#24362a;">' + escape(dog.dog_name) + '</div></td>'
      + '<td align="right" style="vertical-align:top;font-size:13px;color:#675f55;">' + escape(dog.dog_size) + ' · ' + escape(dog.dog_weight_kg) + ' kg</td>'
      + '</tr></table>'
      + '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e3d9c6;color:' + statusTone + ';font-size:13px;font-weight:700;line-height:1.5;">' + escape(status) + '</div>'
      + plateName
      + '</td></tr></table></td></tr>';
  }).join('');

  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmación Perrun 2027</title></head>'
    + '<body style="margin:0;padding:0;background:#f3eee4;font-family:Arial,Helvetica,sans-serif;color:#203126;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3eee4;"><tr><td align="center" style="padding:28px 14px;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fffaf1;border-radius:22px;overflow:hidden;border:1px solid #e5dccb;">'
    + '<tr><td style="background:#6e1828;padding:34px 28px 30px;text-align:center;">'
    + '<img src="https://www.kinetichub.com.mx/assets/brand/logo-kinect.png" width="132" alt="Kinetic Hub" style="display:block;margin:0 auto 18px;max-width:132px;">'
    + '<div style="display:inline-block;background:#d6b36a;color:#4a1620;font-size:12px;font-weight:800;letter-spacing:1.4px;padding:7px 12px;border-radius:999px;">INSCRIPCIÓN CONFIRMADA</div>'
    + '<h1 style="margin:18px 0 8px;color:#fff8ea;font-size:34px;line-height:1.05;">' + escape(event.name) + '</h1>'
    + '<p style="margin:0;color:#f4dfb8;font-size:16px;">' + escape(event.date.label) + ' · ' + escape(event.location.name) + ' · ' + escape(row.distance) + '</p>'
    + '</td></tr>'
    + '<tr><td style="padding:28px;">'
    + '<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:1.2px;color:#9b6d25;text-transform:uppercase;">Pago confirmado</p>'
    + '<h2 style="margin:0 0 8px;font-size:26px;color:#22372a;">¡Nos vemos en Perrun, ' + escape(row.full_name) + '!</h2>'
    + '<p style="margin:0 0 22px;color:#5e6b61;font-size:15px;line-height:1.7;">Tu inscripción quedó registrada correctamente. Guarda este correo para tener a la mano los datos de tu carrera y de tus perros.</p>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#21382a;border-radius:16px;"><tr><td style="padding:22px;text-align:center;">'
    + '<p style="margin:0 0 7px;color:#d7c08c;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Número de corredor</p>'
    + '<p style="margin:0;color:#fff9e9;font-size:52px;font-weight:900;letter-spacing:6px;">' + escape(bib) + '</p>'
    + '</td></tr></table>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;">'
    + '<tr><td style="padding:10px 0;border-bottom:1px solid #e9e1d3;color:#7c7a70;font-size:14px;">Participante</td><td align="right" style="padding:10px 0;border-bottom:1px solid #e9e1d3;font-weight:700;">' + escape(row.full_name) + '</td></tr>'
    + '<tr><td style="padding:10px 0;border-bottom:1px solid #e9e1d3;color:#7c7a70;font-size:14px;">Distancia</td><td align="right" style="padding:10px 0;border-bottom:1px solid #e9e1d3;font-weight:700;">' + escape(row.distance) + '</td></tr>'
    + '<tr><td style="padding:10px 0;border-bottom:1px solid #e9e1d3;color:#7c7a70;font-size:14px;">Talla</td><td align="right" style="padding:10px 0;border-bottom:1px solid #e9e1d3;font-weight:700;">' + escape(row.shirt_size) + '</td></tr>'
    + '<tr><td style="padding:10px 0;color:#7c7a70;font-size:14px;">Total principal pagado</td><td align="right" style="padding:10px 0;font-weight:800;color:#24362a;">$' + escape(amount.toFixed(2)) + ' MXN</td></tr>'
    + '</table>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;background:#f1eadc;border-radius:14px;"><tr><td style="padding:20px;">'
    + '<h3 style="margin:0 0 10px;color:#24362a;font-size:18px;">Documento de exoneración</h3>'
    + '<p style="margin:0 0 8px;line-height:1.7;">Es necesario presentar este documento firmado el día del evento.</p>'
    + '<p style="margin:0 0 16px;line-height:1.7;">Descárgalo, imprímelo y llévalo firmado.</p>'
    + '<a href="' + WAIVER_URL + '" style="display:inline-block;padding:14px 20px;background:#6e1828;color:#ffffff;font-weight:700;text-decoration:none;border-radius:8px;">Descargar exoneración</a>'
    + '</td></tr></table>'
    + '<h3 style="margin:26px 0 12px;color:#24362a;font-size:18px;">Tus perros</h3>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">' + dogCards + '</table>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;background:#f1eadc;border-radius:14px;"><tr><td style="padding:18px;">'
    + '<p style="margin:0;color:#5f655f;font-size:14px;line-height:1.7;"><strong style="color:#24362a;">Entrega de kit:</strong> 12 de febrero de 2027, 10:00–16:00<br><strong style="color:#24362a;">Lugar:</strong> ' + escape(event.pickup.location) + '</p>'
    + '</td></tr></table>'
    + '<p style="margin:24px 0 0;color:#5f655f;font-size:13px;line-height:1.7;text-align:center;">Guarda esta confirmación. ¿Necesitas ayuda? <a href="mailto:hola@kinetichub.com.mx" style="color:#6e1828;font-weight:700;text-decoration:none;">hola@kinetichub.com.mx</a></p>'
    + '</td></tr></table></td></tr></table></body></html>';

  return {
    subject: 'Inscripción confirmada — ' + event.name + ' · ' + row.distance,
    text: lines.join('\n'),
    html,
  };
}
async function sendPerrunConfirmation({ supabase, resend, mockProvider, sessionId, resendRequestId, qa = process.env.PERRUN_QA_LOCAL === '1' }) {
  // Local QA never reaches the mail provider and never marks a simulated email as sent.
  if ((qa || process.env.PERRUN_QA_LOCAL === '1') && !mockProvider) return { ok: true, skipped: true, qa: true };
  try {
    const result = await supabase.from('inscripciones').select('id,email,buyer_email,order_session_id,event_slug,distance,full_name,shirt_size,bib_number,amount_paid,payment_status,registration_status,email_sent')
      .eq('order_session_id', sessionId).eq('event_slug', SLUG);
    if (result.error || result.data?.length !== 1) throw new Error('Inscripción Perrun no disponible para email.');
    const row = result.data[0];
    if (resendRequestId && !/^(?:[a-f0-9-]{36}|perrun-waiver-2027-v1)$/.test(resendRequestId)) throw new Error('Reenvío inválido.');
    if (row.email_sent && !resendRequestId) return { ok: true, skipped: true };
    if (row.registration_status !== 'active' || !['paid', 'paid_no_email'].includes(row.payment_status)) return { ok: true, skipped: true };
    const [confirmed] = await enrichRegistrations(supabase, [row]);
    const payload = renderConfirmation(confirmed);
    // Same key for webhook retries, simultaneous deliveries and admin retries.
    const idempotencyKey = (resendRequestId ? 'perrun-confirmation-resend/' + resendRequestId + '/' : 'perrun-confirmation/') + createHash('sha256').update(sessionId).digest('hex');
    const sent = await sendTransactionalEmail({resend, mockProvider, payload: {to: row.buyer_email || row.email, ...payload}, idempotencyKey});
    if (sent.error || !sent.data?.id) throw new Error('Resend no confirmó la entrega.');
    let marking = supabase.from('inscripciones').update({ email_sent: true, confirmation_email_id: sent.data.id, confirmation_email_sent_at: new Date().toISOString() })
      .eq('order_session_id', sessionId).eq('event_slug', SLUG).eq('registration_status', 'active').in('payment_status', ['paid', 'paid_no_email']);
    if (!resendRequestId) marking = marking.or('email_sent.is.false,email_sent.is.null');
    const marked = await marking;
    if (marked.error) throw new Error('Email enviado; pendiente persistir confirmación.');
    return { ok: true, resendId: sent.data.id };
  } catch (error) { return { ok: false, error: error.message }; }
}
module.exports = { WAIVER_URL, renderConfirmation, sendPerrunConfirmation };
