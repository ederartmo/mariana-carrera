// api/stripe-webhook.js - Versión mejorada y robusta para Vercel
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const { trackMetaEvent } = require('../lib/_meta-capi');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const { SHIRT_SIZES: ALLOWED_SHIRT_SIZES, normalizeShirtSize, isValidShirtSize } = require('../lib/_shirt-sizes');
const {
  normalizeBirthDate,
  normalizeWhatsapp,
  normalizeState,
  normalizeBoroughForState,
} = require('../lib/_participant-validation');
const EVENT_CATALOG = {
  'axolote-night-run': {
    slug: 'axolote-night-run',
    name: 'Axolote Night Run 2026',
    defaultDistance: '5K',
    distances: ['5K'],
    kitDelivery: 'viernes 30 de octubre de 11:00 a 17:30 hrs frente al gimnasio de la Pista de Remo y Canotaje Virgilio Uribe, CDMX',
    waiverUrl: 'https://www.kinetichub.com.mx/exoneracion.pdf',
  },
  'cascanueces-run': {
    slug: 'cascanueces-run',
    name: 'Cascanueces Run 2026',
    defaultDistance: '5K',
    distances: ['5K', '10K'],
    kitDelivery: 'viernes 4 de diciembre de 11:00 a 17:30 hrs en el Huerto Educativo del Bosque de San Juan de Aragón, CDMX',
    waiverUrl: 'https://www.kinetichub.com.mx/assets/events/cascanueces-run/legal/Cascanueces%20Run1.pdf',
  },
};

function resolveEventFromMetadata(metadata = {}) {
  const event = EVENT_CATALOG[metadata.event_slug] || EVENT_CATALOG['axolote-night-run'];
  const rawDistance = metadata.distance == null ? '' : String(metadata.distance).trim().toUpperCase();
  const distances = Array.isArray(event.distances) && event.distances.length > 0
    ? event.distances
    : [event.defaultDistance];

  if (!rawDistance && distances.length === 1) {
    return { ...event, distance: event.defaultDistance };
  }

  if (!distances.includes(rawDistance)) {
    throw new Error(`Distancia inválida o ausente para ${event.slug}: ${rawDistance || 'sin distance'}`);
  }

  const distance = rawDistance;
  return { ...event, distance };
}

function normalizeParticipantName(value, fallbackLabel) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length >= 3) return normalized.slice(0, 80);
  return fallbackLabel;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderParticipantCard(participant, index) {
  const bibNumber = String(participant.bibNumber || '').padStart(3, '0');
  const shirtSize = participant.shirtSize || 'Por confirmar';
  const displayName = escapeHtml(participant.fullName);
  const displayShirt = escapeHtml(shirtSize);

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;background-color:#141428;border:1px solid #2c2c52;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #2c2c52;color:#00f5ff;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Participante ${index + 1}</td>
      </tr>
      <tr>
        <td style="padding:14px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:4px 0;color:#aaaaaa;font-size:13px;">Nombre</td>
              <td style="padding:4px 0;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${displayName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#aaaaaa;font-size:13px;">Número de corredor</td>
              <td style="padding:4px 0;color:#00f5ff;font-size:13px;font-weight:700;text-align:right;">#${bibNumber}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#aaaaaa;font-size:13px;">Talla de playera</td>
              <td style="padding:4px 0;color:#ffffff;font-size:13px;font-weight:600;text-align:right;">${displayShirt}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function readParticipantsFromMetadata(metadata) {
  const rawCount = Number.parseInt(String(metadata?.ticket_count || '1'), 10);
  const ticketCount = Number.isInteger(rawCount) && rawCount > 0 ? Math.min(rawCount, 10) : 1;
  const participants = [];

  for (let i = 1; i <= ticketCount; i += 1) {
    const rawName = metadata?.[`participant_${i}_name`] || '';
    const rawShirt = normalizeShirtSize(metadata?.[`participant_${i}_shirt`]);
    // PR4: nuevos campos por participante. Históricos sin metadata -> null (no rompe idempotencia).
    // Correo sin birth_date/whatsapp: solo se usan para DB/RPC, nunca para el template.
    const rawBirth = normalizeBirthDate(metadata?.[`participant_${i}_birth`]);
    const rawWa = normalizeWhatsapp(metadata?.[`participant_${i}_wa`]);
    const rawState = normalizeState(metadata?.[`participant_${i}_state`]);
    const rawBoro = rawState ? normalizeBoroughForState(metadata?.[`participant_${i}_boro`], rawState) : null;
    participants.push({
      fullName: normalizeParticipantName(rawName, `Participante ${i}`),
      shirtSize: isValidShirtSize(rawShirt) ? rawShirt : null,
      birthDate: rawBirth || null,
      whatsapp: rawWa || null,
      state: rawState || null,
      borough: rawBoro || null,
    });
  }

  if (participants.length === 0) {
    const legacyShirt = normalizeShirtSize(metadata?.shirt_size);
    const legacyName = normalizeParticipantName(metadata?.full_name || '', 'Participante 1');
    participants.push({
      fullName: legacyName,
      shirtSize: isValidShirtSize(legacyShirt) ? legacyShirt : null,
      birthDate: normalizeBirthDate(metadata?.participant_1_birth) || null,
      whatsapp: normalizeWhatsapp(metadata?.participant_1_wa) || null,
      state: normalizeState(metadata?.participant_1_state) || null,
      borough: null,
    });
  }

  return participants;
}

// Función para obtener el raw body (necesario para verificar la firma de Stripe)
const getRawBody = (req) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
};

function resolveStripeObjectId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.id) return value.id;
  return null;
}

function buildRpcParticipants(participants, buyerEmail) {
  // email/buyer_email intactos: cada participante hereda buyerEmail (comportamiento histórico).
  // bib/amount no se tocan aquí: los asigna finalize_paid_order en DB.
  return participants.map((participant, index) => ({
    ticketIndex: index + 1,
    fullName: participant.fullName,
    email: buyerEmail,
    shirtSize: participant.shirtSize,
    birthDate: participant.birthDate || null,
    whatsapp: participant.whatsapp || null,
    state: participant.state || null,
    borough: participant.borough || null,
  }));
}

async function finalizePaidOrder({ session, event, selectedEvent, cleanEmail, amountTotal, participants, fullName }) {
  const safeParticipants = participants.length > 0
    ? participants.map((p) => ({
      fullName: p.fullName,
      shirtSize: p.shirtSize || null,
      birthDate: p.birthDate || null,
      whatsapp: p.whatsapp || null,
      state: p.state || null,
      borough: p.borough || null,
    }))
    : [{ fullName: normalizeParticipantName(fullName, 'Participante 1'), shirtSize: null, birthDate: null, whatsapp: null, state: null, borough: null }];
  const amountPerTicket = Number((amountTotal / safeParticipants.length).toFixed(2));
  const paymentIntentId = resolveStripeObjectId(session.payment_intent);

  const { data, error } = await supabase.rpc('finalize_paid_order', {
    p_order_session_id: session.id,
    p_event_slug: selectedEvent.slug,
    p_distance: selectedEvent.distance,
    p_amount_paid: amountPerTicket,
    p_buyer_email: cleanEmail,
    p_payment_intent_id: paymentIntentId,
    p_stripe_event_id: event.id,
    p_participants: buildRpcParticipants(safeParticipants, cleanEmail),
  });

  if (error) {
    const wrappedError = new Error(`finalize_paid_order failed: ${error.message || 'unknown error'}`);
    wrappedError.cause = error;
    throw wrappedError;
  }

  const finalizedRows = Array.isArray(data) ? data : [];
  if (finalizedRows.length !== safeParticipants.length) {
    throw new Error(`finalize_paid_order returned ${finalizedRows.length} rows, expected ${safeParticipants.length}`);
  }

  return {
    safeParticipants,
    finalizedRows: finalizedRows.sort((a, b) => (a.ticket_index || 0) - (b.ticket_index || 0)),
  };
}

async function markConfirmationEmailSent(orderSessionId, resendId) {
  const payload = {
    email_sent: true,
    confirmation_email_id: resendId,
    confirmation_email_sent_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('inscripciones')
    .update(payload)
    .eq('order_session_id', orderSessionId)
    .or('email_sent.is.false,email_sent.is.null');

  if (error) {
    console.error(`❌ Error marcando email_sent para orden ${orderSessionId}:`, error);
    return { ok: false, error: error.message || String(error) };
  }

  return { ok: true };
}

async function updateRegistrationBySessionId(sessionId, payload) {
  if (!sessionId) {
    return { ok: false, reason: 'missing_session_id' };
  }

  // Usamos update (no upsert) para no violar índices únicos parciales en inscripciones.
  const { data, error } = await supabase
    .from('inscripciones')
    .update(payload)
    .eq('stripe_session_id', sessionId)
    .select('id')
    .limit(1);

  if (error) {
    console.error(`❌ Error actualizando inscripción para sesión ${sessionId}:`, error);
    return { ok: false, error };
  }

  if (!data || data.length === 0) {
    console.warn(`⚠️ No se encontró inscripción para sesión ${sessionId} al intentar actualizar.`);
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true };
}

async function updateRegistrationsByCheckoutSessionId(sessionId, payload) {
  if (!sessionId) {
    return { ok: false, reason: 'missing_session_id' };
  }

  let updatedCount = 0;

  const { data: primaryData, error: primaryError } = await supabase
    .from('inscripciones')
    .update(payload)
    .eq('stripe_session_id', sessionId)
    .select('id');

  if (primaryError) {
    console.error(`❌ Error actualizando inscripción principal para sesión ${sessionId}:`, primaryError);
    return { ok: false, error: primaryError };
  }

  updatedCount += primaryData?.length || 0;

  const { data: childData, error: childError } = await supabase
    .from('inscripciones')
    .update(payload)
    .like('stripe_session_id', `${sessionId}::%`)
    .select('id');

  if (childError) {
    console.error(`❌ Error actualizando inscripciones hijas para sesión ${sessionId}:`, childError);
    return { ok: false, error: childError };
  }

  updatedCount += childData?.length || 0;

  if (updatedCount === 0) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, updatedCount };
}

// ==================== BATCH 2: REFUNDS DETERMINISTAS ====================
// Regla: un refund solo muta la orden identificada por IDs autoritativos
// (payment_intent_id en DB, o checkout session vía Stripe API).
// NUNCA por email, monto, fecha o "última inscripción".
// Si la orden no se resuelve con certeza: DB mutation = ZERO + log
// estructurado (solo IDs Stripe + motivo, sin PII). Ack 200 preservado.
//
// payment_status='refunded' = reembolso TOTAL de la orden. Un refund parcial
// NO muta nada (no existe ledger de parciales; ver markOrderRefunded).
// Multi-ticket: las N filas comparten payment_intent_id/order_session_id,
// por lo que un refund total las marca a todas (nunca una sola arbitraria).

const REFUNDABLE_STATUSES = ['paid', 'paid_no_email'];

function logRefundEvent(outcome) {
  const parts = [
    `result=${outcome.result}`,
    `event=${outcome.stripeEventId || 'N/A'}`,
    `src=${outcome.sourceEventType || 'N/A'}`,
  ];
  if (outcome.refundId) parts.push(`refund=${outcome.refundId}`);
  if (outcome.chargeId) parts.push(`charge=${outcome.chargeId}`);
  if (outcome.paymentIntentId) parts.push(`pi=${outcome.paymentIntentId}`);
  if (outcome.orderSessionId) parts.push(`order=${outcome.orderSessionId}`);
  if (typeof outcome.updatedCount === 'number') parts.push(`rows=${outcome.updatedCount}`);
  if (outcome.reason) parts.push(`reason=${outcome.reason}`);
  if (outcome.via) parts.push(`via=${outcome.via}`);
  console.warn(`↩️ refund ${parts.join(' ')}`);
}

function distinctOrderSessionIds(rows) {
  return [...new Set((rows || []).map((row) => row.order_session_id))];
}

// Capa 1: filas cuyo payment_intent_id coincide con el pago reembolsado.
// Cubre multi-ticket de forma natural (N filas, 1 orden).
async function findRefundRowsByPaymentIntent(paymentIntentId) {
  const { data, error } = await supabase
    .from('inscripciones')
    .select('id, order_session_id, payment_status')
    .eq('payment_intent_id', paymentIntentId);

  if (error) {
    return { error };
  }

  return { rows: Array.isArray(data) ? data : [] };
}

// Capa 2: filas de la orden creada por un checkout session (convención
// stripe_session_id = session en ticket 1, session::N en el resto,
// order_session_id = session). Solo para pagos Stripe con checkout.
async function findRefundRowsBySession(sessionId) {
  const { data, error } = await supabase
    .from('inscripciones')
    .select('id, order_session_id, payment_status')
    .or(`stripe_session_id.eq.${sessionId},order_session_id.eq.${sessionId},stripe_session_id.like.${sessionId}::%`);

  if (error) {
    return { error };
  }

  return { rows: Array.isArray(data) ? data : [] };
}

async function resolveRefundOrder({ paymentIntentId }) {
  if (paymentIntentId) {
    const byPi = await findRefundRowsByPaymentIntent(paymentIntentId);
    if (byPi.error) {
      return { error: byPi.error, step: 'db_by_payment_intent' };
    }
    if (byPi.rows.length > 0) {
      const orders = distinctOrderSessionIds(byPi.rows);
      if (orders.length !== 1 || !orders[0]) {
        return { ambiguous: true, step: 'db_by_payment_intent', orderCount: orders.length };
      }
      return { orderSessionId: orders[0], via: 'payment_intent_id', rowCount: byPi.rows.length };
    }
  }

  const checkoutSession = await findCheckoutSessionByPaymentIntent(paymentIntentId);
  if (!checkoutSession?.id) {
    return { unresolved: true, step: 'stripe_session_lookup' };
  }

  const bySession = await findRefundRowsBySession(checkoutSession.id);
  if (bySession.error) {
    return { error: bySession.error, step: 'db_by_session' };
  }
  if (bySession.rows.length === 0) {
    return { unresolved: true, step: 'db_by_session' };
  }

  const orders = distinctOrderSessionIds(bySession.rows);
  if (orders.length !== 1 || !orders[0]) {
    return { ambiguous: true, step: 'db_by_session', orderCount: orders.length };
  }

  return { orderSessionId: orders[0], via: 'checkout_session', rowCount: bySession.rows.length };
}

// Marca TODA la orden como refunded, solo desde estados pagados.
// Idempotente: un evento repetido encuentra 0 filas pagadas y no muta nada.
async function markOrderRefunded(orderSessionId) {
  const { data, error } = await supabase
    .from('inscripciones')
    .update({ payment_status: 'refunded' })
    .eq('order_session_id', orderSessionId)
    .in('payment_status', REFUNDABLE_STATUSES)
    .select('id');

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, updatedCount: Array.isArray(data) ? data.length : 0 };
}

// Totalidad sin llamadas extra: charge.amount_refunded es acumulativo.
function isFullChargeRefund(charge) {
  const amount = typeof charge?.amount === 'number' ? charge.amount : null;
  const refunded = typeof charge?.amount_refunded === 'number' ? charge.amount_refunded : null;
  if (amount === null || refunded === null) {
    return false;
  }
  return refunded >= amount;
}

async function applyDeterministicRefund({ stripeEventId, refundId, chargeId, paymentIntentId, sourceEventType }) {
  const base = { stripeEventId, refundId, chargeId, paymentIntentId, sourceEventType };

  if (!paymentIntentId) {
    logRefundEvent({ ...base, result: 'skipped', reason: 'missing_payment_intent' });
    return false;
  }

  const resolved = await resolveRefundOrder({ paymentIntentId });

  if (resolved.error) {
    logRefundEvent({ ...base, result: 'skipped', reason: `db_error:${resolved.step}` });
    return false;
  }

  if (resolved.ambiguous) {
    logRefundEvent({ ...base, result: 'skipped', reason: `ambiguous_orders:${resolved.step}` });
    return false;
  }

  if (resolved.unresolved || !resolved.orderSessionId) {
    logRefundEvent({ ...base, result: 'skipped', reason: `order_not_found:${resolved.step}` });
    return false;
  }

  const marked = await markOrderRefunded(resolved.orderSessionId);
  if (!marked.ok) {
    logRefundEvent({ ...base, orderSessionId: resolved.orderSessionId, result: 'skipped', reason: 'update_error' });
    return false;
  }

  logRefundEvent({
    ...base,
    orderSessionId: resolved.orderSessionId,
    result: 'applied',
    updatedCount: marked.updatedCount,
    via: resolved.via,
  });
  return true;
}

async function findCheckoutSessionByPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null;

  try {
    const { data } = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1
    });
    return data?.[0] || null;
  } catch (error) {
    console.error(`❌ Error buscando checkout session por payment_intent ${paymentIntentId}:`, error);
    return null;
  }
}

async function resolvePaymentIntentId(input) {
  if (!input) return null;
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && input.id) return input.id;
  return null;
}

// (Eliminada en Batch 2: findCheckoutSessionByRefund resolvía por charge
// hacia un update por sesión, y su ruta alterna caía al fallback por email.
// Reemplazada por resolveRefundOrder: payment_intent_id en DB primero,
// checkout session vía Stripe API después, sin heurísticas.)

async function sendConfirmationEmail({
  email,
  fullName,
  primaryBibNumber,
  primaryParticipant,
  amountTotal,
  safeParticipants,
  shirtSize,
  participantDetails,
  eventSlug,
  distance,
}) {
  const selectedEvent = resolveEventFromMetadata({ event_slug: eventSlug, distance });
  const bibStr = String(primaryBibNumber || '').padStart(3, '0');
  const displayShirt = isValidShirtSize(shirtSize) ? shirtSize : 'Por confirmar';
  try {
    const result = await resend.emails.send({
      from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
      to: email,
      subject: `\u00a1${fullName}, ya est\u00e1s inscrito en ${selectedEvent.name}! \ud83c\udf89`,
      html: `
            <!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmaci\u00f3n de Inscripci\u00f3n</title>
    <style>
        @media only screen and (max-width: 600px) {
            .outer { padding: 0 !important; }
            .bib-num { font-size: 36px !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;" class="outer">
        <tr>
            <td align="center" style="padding:30px 16px;">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">

                    <!-- HEADER -->
                    <tr>
                        <td style="background-color:#0d0d1a;padding:40px 20px;text-align:center;">
                            <img src="https://www.kinetichub.com.mx/assets/brand/logo-kinect.png" alt="Kinetic Hub" width="150" style="display:block;margin:0 auto 20px auto;max-width:150px;">
                            <h1 style="margin:8px 0;font-size:26px;font-weight:bold;color:#00f5ff;">\u00a1FELICIDADES ${fullName.toUpperCase()}!</h1>
                            <p style="margin:4px 0;font-size:18px;color:#ffffff;">YA EST\u00c1S INSCRITO \ud83c\udf89</p>
                        </td>
                    </tr>

                    <!-- DORSAL -->
                    <tr>
                        <td style="padding:30px 25px 0 25px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a2e;border:2px solid #00f5ff;border-radius:12px;">
                                <tr>
                                    <td style="padding:20px;text-align:center;">
                                    <p style="margin:0 0 8px 0;color:#00f5ff;font-size:16px;">${safeParticipants.length > 1 ? 'Tu n\u00famero principal de corredor es:' : 'Tu n\u00famero de corredor es:'}</p>
                                  <p class="bib-num" style="margin:0;font-size:52px;font-weight:bold;color:#00f5ff;letter-spacing:6px;">${bibStr}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- RESUMEN -->
                    <tr>
                        <td style="padding:20px 25px 10px 25px;">
                            <h2 style="text-align:center;color:#ffffff;font-size:18px;margin:0 0 16px 0;">Resumen de tu inscripci\u00f3n</h2>

                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Evento</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${escapeHtml(selectedEvent.name)}</td>
                                  </tr>
                                  <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Distancia</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${escapeHtml(selectedEvent.distance)}</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Nombre</td>
                                  <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${escapeHtml(primaryParticipant.fullName)}</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Monto pagado</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">$${amountTotal} MXN</td>
                                </tr>
                                <tr>
                                  <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Tickets</td>
                                  <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${safeParticipants.length}</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Talla de playera</td>
                                  <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${displayShirt}</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;color:#aaaaaa;font-size:14px;">Estado</td>
                                    <td style="padding:10px 0;color:#00ff9d;font-weight:600;font-size:14px;text-align:right;">\u2705 Pago confirmado</td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                            ${participantDetails.length > 1 ? `
                            <tr>
                              <td style="padding:10px 25px 0 25px;">
                                <h2 style="text-align:center;color:#ffffff;font-size:18px;margin:0 0 16px 0;">Participantes registrados</h2>
                                ${participantDetails.map((p, i) => renderParticipantCard(p, i)).join('')}
                              </td>
                            </tr>
                            ` : ''}

                    <!-- NOTA -->
                    <tr>
                        <td style="padding:24px 25px;text-align:center;color:#cccccc;font-size:14px;line-height:1.6;">
                            <strong style="color:#ffffff;">Guarda este correo.</strong><br>
                            La entrega de kit ser&aacute; el <strong style="color:#ffffff;">${escapeHtml(selectedEvent.kitDelivery)}</strong>.<br>
                            Lleva tu identificaci&oacute;n oficial y exoneraci&oacute;n firmada ese d&iacute;a.
                        </td>
                    </tr>

                    <!-- BOT\u00d3N -->
                    <tr>
                        <td style="padding:0 25px 30px 25px;text-align:center;">
                            <a href="${selectedEvent.waiverUrl}"
                               style="display:inline-block;background-color:#19c88b;color:#000000;padding:13px 28px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:14px;">
                                \ud83d\udcc4 Hoja 1 - Exoneraci\u00f3n
                            </a>
                        </td>
                    </tr>

                    <!-- FOOTER -->
                    <tr>
                        <td style="background-color:#0a0a0a;padding:25px;text-align:center;font-size:13px;color:#777777;">
                            <p style="margin:0 0 6px 0;">Kinetic Hub \u2022 ${escapeHtml(selectedEvent.name)}</p>
                            <p style="margin:0;">Si tienes alguna duda, responde este correo o escr\u00edbenos a <a href="mailto:hola@kinetichub.com.mx" style="color:#00f5ff;text-decoration:none;">hola@kinetichub.com.mx</a></p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
          `
    });

    if (result?.error || !result?.data?.id) {
      const errorMessage = result?.error?.message || result?.error || 'Resend no devolvió data.id';
      console.error("❌ Resend rechazó el email:", result?.error || result);
      return { ok: false, error: errorMessage, resendResponse: result };
    }

    console.log(`\u{1F4E7} Email enviado a ${email}`);
    return { ok: true, resendId: result.data.id, resendResponse: result };
  } catch (emailError) {
    console.error("\u274C Error al enviar email con Resend:", emailError);
    return { ok: false, error: emailError.message || String(emailError) };
  }
}

async function sendConfirmationForFinalizedOrder({
  sessionId,
  email,
  fullName,
  amountTotal,
  safeParticipants,
  finalizedRows,
  eventSlug,
  distance,
}) {
  if (finalizedRows.length > 0 && finalizedRows.every(row => row.email_sent === true)) {
    console.log(`ℹ️ Confirmación ya enviada previamente | session_id=${sessionId}`);
    return { ok: true, skipped: true };
  }

  const participantDetails = finalizedRows.map((row, index) => ({
    fullName: row.full_name || safeParticipants[index]?.fullName || `Participante ${index + 1}`,
    shirtSize: row.shirt_size || safeParticipants[index]?.shirtSize || null,
    bibNumber: row.bib_number,
  }));
  const primaryParticipant = participantDetails[0] || safeParticipants[0] || { fullName, shirtSize: null };
  const primaryBibNumber = primaryParticipant.bibNumber;
  const shirtSize = (primaryParticipant.shirtSize || '').trim().toUpperCase();

  const emailResult = await sendConfirmationEmail({
    email,
    fullName,
    primaryBibNumber,
    primaryParticipant,
    amountTotal,
    safeParticipants,
    shirtSize,
    participantDetails,
    eventSlug,
    distance,
  });

  if (!emailResult.ok) {
    return emailResult;
  }

  const markResult = await markConfirmationEmailSent(sessionId, emailResult.resendId);
  if (!markResult.ok) {
    return { ok: false, error: markResult.error, resendId: emailResult.resendId, emailSentButNotMarked: true };
  }

  return emailResult;
}

async function markRefundedFromCharge(charge, sourceEventType, stripeEventId) {
  // Batch 2: sin fallback por email/monto. Solo IDs autoritativos.
  const paymentIntentId = typeof charge?.payment_intent === 'string'
    ? charge.payment_intent
    : charge?.payment_intent?.id;

  return applyDeterministicRefund({
    stripeEventId: stripeEventId || null,
    refundId: null,
    chargeId: resolveStripeObjectId(charge?.id),
    paymentIntentId,
    sourceEventType,
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Error de firma Stripe:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🪝 Evento recibido: ${event.type}`);

  // ==================== CHECKOUT SESSION COMPLETED ====================
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session.id;
    const paymentStatus = String(session.payment_status || '').trim().toLowerCase();

    if (paymentStatus !== 'paid') {
      console.log(`⏳ Fulfillment diferido para checkout.session.completed | session_id=${sessionId} | payment_status=${paymentStatus || 'unknown'}`);
      return res.status(200).json({ received: true, deferred: true });
    }

    const selectedEvent = resolveEventFromMetadata(session.metadata);

    const email = session.customer_email || session.customer_details?.email;
    const fullName = session.customer_details?.name || "Atleta";
    const amountTotal = (session.amount_total || 0) / 100;
    const participants = readParticipantsFromMetadata(session.metadata || {});
    const primaryParticipant = participants[0] || { fullName, shirtSize: null };
    const shirtSize = (primaryParticipant.shirtSize || '').trim().toUpperCase();
    const metaFbp = (session.metadata?.meta_fbp || '').trim();
    const metaFbc = (session.metadata?.meta_fbc || '').trim();
    const metaExternalId = (session.metadata?.meta_external_id || '').trim();
    const purchaseEventId = `purchase_${sessionId}`;
    const registrationEventId = `complete_registration_${sessionId}`;

    if (!email) {
      console.error(`❌ PAGO SIN EMAIL: session_id=${sessionId} amount=${amountTotal}`);
      // Guardar el pago en DB sin email para no perder el registro
      const { error: noEmailError } = await supabase.from('inscripciones').upsert({
        stripe_session_id: sessionId,
        order_session_id: sessionId,
        buyer_email: null,
        email: null,
        full_name: primaryParticipant.fullName || fullName.trim(),
        event_slug: selectedEvent.slug,
        distance: selectedEvent.distance,
        amount_paid: amountTotal,
        payment_status: 'paid_no_email',
        shirt_size: null,
        bib_number: null,
        ticket_index: 1,
        ticket_count: participants.length || 1,
        created_at: new Date().toISOString()
      }, { onConflict: 'stripe_session_id' });
      if (noEmailError) {
        console.error(`❌ Error guardando pago sin email | session_id=${sessionId}:`, noEmailError);
        return res.status(500).json({ received: false, error: 'db_processing_failed' });
      }
      // Alertar al admin
      await resend.emails.send({
        from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
        to: 'hola@kinetichub.com.mx',
        subject: `⚠️ Pago recibido sin email — sesión ${sessionId}`,
        html: `<p>Se recibió un pago de <strong>$${amountTotal} MXN</strong> pero no se pudo obtener el email del comprador.</p><p>Session ID: <code>${sessionId}</code></p><p>Nombre: ${fullName}</p><p>Revisar en el dashboard de Stripe y completar la inscripción manualmente.</p>`
      }).catch(e => console.error("Error enviando alerta admin:", e));
      return res.status(200).json({ received: true });
    }

    const cleanEmail = email.toLowerCase().trim();
    console.log(`✅ Pago confirmado: ${fullName} (${cleanEmail}) - ${sessionId} | tickets=${participants.length}`);

    try {
      const { safeParticipants, finalizedRows } = await finalizePaidOrder({
        session,
        event,
        selectedEvent,
        cleanEmail,
        amountTotal,
        participants,
        fullName,
      });
      const primaryBibNumber = finalizedRows[0]?.bib_number;
      console.log(`✅ Orden finalizada por RPC | total=${finalizedRows.length} | bib_inicio=${primaryBibNumber}`);

      const emailResult = await sendConfirmationForFinalizedOrder({
        sessionId,
        email: cleanEmail,
        fullName,
        amountTotal,
        safeParticipants,
        finalizedRows,
        eventSlug: selectedEvent.slug,
        distance: selectedEvent.distance,
      });

      if (!emailResult.ok) {
        console.error(`❌ Correo NO enviado a ${email} (session ${sessionId}): ${emailResult.error}`);
      }

      const purchaseTrack = await trackMetaEvent({
        req,
        eventName: 'Purchase',
        eventId: purchaseEventId,
        userData: {
          email: cleanEmail,
          externalId: metaExternalId || cleanEmail,
          fbp: metaFbp,
          fbc: metaFbc,
        },
        customData: {
          currency: 'MXN',
          value: amountTotal,
          content_name: `${selectedEvent.name} - ${selectedEvent.distance}`,
          content_type: 'product',
        },
        eventSourceUrl: 'https://www.kinetichub.com.mx/succes.html',
        testEventCode: process.env.META_TEST_EVENT_CODE,
      });

      if (!purchaseTrack.ok && !purchaseTrack.skipped) {
        console.error('Error enviando Purchase a Meta CAPI:', purchaseTrack.error || purchaseTrack);
      }

      const completeRegistrationTrack = await trackMetaEvent({
        req,
        eventName: 'CompleteRegistration',
        eventId: registrationEventId,
        userData: {
          email: cleanEmail,
          externalId: metaExternalId || cleanEmail,
          fbp: metaFbp,
          fbc: metaFbc,
        },
        customData: {
          status: 'completed',
          shirt_size: isValidShirtSize(shirtSize) ? shirtSize : 'unknown',
        },
        eventSourceUrl: 'https://www.kinetichub.com.mx/succes.html',
        testEventCode: process.env.META_TEST_EVENT_CODE,
      });

      if (!completeRegistrationTrack.ok && !completeRegistrationTrack.skipped) {
        console.error('Error enviando CompleteRegistration a Meta CAPI:', completeRegistrationTrack.error || completeRegistrationTrack);
      }

    } catch (dbError) {
      console.error("❌ Error general en procesamiento del webhook:", dbError);
      return res.status(500).json({ received: false, error: 'db_processing_failed' });
    }
  }

  // ==================== CHECKOUT SESSION ASYNC PAYMENT FAILED ====================
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    const sessionId = session.id;
    const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim() || null;
    const fullName = session.customer_details?.name || 'Atleta';
    const amountTotal = (session.amount_total || 0) / 100;
    const shirtSize = normalizeShirtSize(session.metadata?.shirt_size);

    await updateRegistrationsByCheckoutSessionId(sessionId, {
      email,
      full_name: fullName,
      event_slug: session.metadata?.event_slug || 'axolote-night-run',
      distance: String(session.metadata?.distance || '5K').toUpperCase(),
      amount_paid: amountTotal,
      payment_status: 'payment_failed',
      shirt_size: isValidShirtSize(shirtSize) ? shirtSize : null,
      created_at: new Date().toISOString()
    });

    console.warn(`⚠️ Pago fallido (async) registrado | session_id=${sessionId}`);
  }

  // ==================== CHECKOUT SESSION ASYNC PAYMENT SUCCEEDED ====================
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const selectedEvent = resolveEventFromMetadata(session.metadata);
    const email = session.customer_email || session.customer_details?.email;
    const fullName = session.customer_details?.name || 'Atleta';
    const sessionId = session.id;
    const amountTotal = (session.amount_total || 0) / 100;
    const participants = readParticipantsFromMetadata(session.metadata || {});
    const primaryParticipant = participants[0] || { fullName, shirtSize: null };
    const shirtSize = (primaryParticipant.shirtSize || '').trim().toUpperCase();
    const metaFbp = (session.metadata?.meta_fbp || '').trim();
    const metaFbc = (session.metadata?.meta_fbc || '').trim();
    const metaExternalId = (session.metadata?.meta_external_id || '').trim();
    const purchaseEventId = `purchase_async_${sessionId}`;
    const registrationEventId = `complete_registration_async_${sessionId}`;

    if (!email) {
      console.error(`❌ Pago asíncrono SIN EMAIL: session_id=${sessionId} amount=${amountTotal}`);
      const { error: noEmailError } = await supabase.from('inscripciones').upsert({
        stripe_session_id: sessionId,
        order_session_id: sessionId,
        buyer_email: null,
        email: null,
        full_name: primaryParticipant.fullName || fullName.trim(),
        event_slug: selectedEvent.slug,
        distance: selectedEvent.distance,
        amount_paid: amountTotal,
        payment_status: 'paid_no_email',
        shirt_size: null,
        bib_number: null,
        ticket_index: 1,
        ticket_count: participants.length || 1,
        created_at: new Date().toISOString()
      }, { onConflict: 'stripe_session_id' });
      if (noEmailError) {
        console.error(`❌ Error guardando pago asíncrono sin email | session_id=${sessionId}:`, noEmailError);
        return res.status(500).json({ received: false, error: 'db_processing_failed' });
      }
      await resend.emails.send({
        from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
        to: 'hola@kinetichub.com.mx',
        subject: `⚠️ Pago asíncrono recibido sin email — sesión ${sessionId}`,
        html: `<p>Se recibió un pago asíncrono de <strong>$${amountTotal} MXN</strong> pero no se pudo obtener el email del comprador.</p><p>Session ID: <code>${sessionId}</code></p><p>Nombre: ${fullName}</p><p>Revisar en el dashboard de Stripe y completar la inscripción manualmente.</p>`
      }).catch(e => console.error("Error enviando alerta admin:", e));
      return res.status(200).json({ received: true });
    }

    const cleanEmail = email.toLowerCase().trim();
    console.log(`✅ Pago asíncrono confirmado: ${fullName} (${cleanEmail}) - ${sessionId} | tickets=${participants.length}`);

    try {
      const { safeParticipants, finalizedRows } = await finalizePaidOrder({
        session,
        event,
        selectedEvent,
        cleanEmail,
        amountTotal,
        participants,
        fullName,
      });
      const primaryBibNumber = finalizedRows[0]?.bib_number;
      console.log(`✅ Orden asíncrona finalizada por RPC | total=${finalizedRows.length} | bib_inicio=${primaryBibNumber}`);

      const emailResult = await sendConfirmationForFinalizedOrder({
        sessionId,
        email: cleanEmail,
        fullName,
        amountTotal,
        safeParticipants,
        finalizedRows,
        eventSlug: selectedEvent.slug,
        distance: selectedEvent.distance,
      });

      if (!emailResult.ok) {
        console.error(`❌ Correo NO enviado a ${email} (session asíncrona ${sessionId}): ${emailResult.error}`);
      }

      const purchaseTrack = await trackMetaEvent({
        req,
        eventName: 'Purchase',
        eventId: purchaseEventId,
        userData: {
          email: cleanEmail,
          externalId: metaExternalId || cleanEmail,
          fbp: metaFbp,
          fbc: metaFbc,
        },
        customData: {
          currency: 'MXN',
          value: amountTotal,
          content_name: `${selectedEvent.name} - ${selectedEvent.distance}`,
          content_type: 'product',
        },
        eventSourceUrl: 'https://www.kinetichub.com.mx/succes.html',
        testEventCode: process.env.META_TEST_EVENT_CODE,
      });

      if (!purchaseTrack.ok && !purchaseTrack.skipped) {
        console.error('Error enviando Purchase a Meta CAPI (async):', purchaseTrack.error || purchaseTrack);
      }

      const completeRegistrationTrack = await trackMetaEvent({
        req,
        eventName: 'CompleteRegistration',
        eventId: registrationEventId,
        userData: {
          email: cleanEmail,
          externalId: metaExternalId || cleanEmail,
          fbp: metaFbp,
          fbc: metaFbc,
        },
        customData: {
          status: 'completed',
          async_payment: 'true',
        },
        eventSourceUrl: 'https://www.kinetichub.com.mx/succes.html',
        testEventCode: process.env.META_TEST_EVENT_CODE,
      });

      if (!completeRegistrationTrack.ok && !completeRegistrationTrack.skipped) {
        console.error('Error enviando CompleteRegistration a Meta CAPI (async):', completeRegistrationTrack.error || completeRegistrationTrack);
      }

    } catch (dbError) {
      console.error("❌ Error general en procesamiento del webhook async_payment_succeeded:", dbError);
      return res.status(500).json({ received: false, error: 'db_processing_failed' });
    }
  }

  // ==================== PAYMENT INTENT FAILED ====================
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    const checkoutSession = await findCheckoutSessionByPaymentIntent(paymentIntent.id);

    if (checkoutSession?.id) {
      const email = (checkoutSession.customer_email || checkoutSession.customer_details?.email || '').toLowerCase().trim() || null;
      const fullName = checkoutSession.customer_details?.name || 'Atleta';
      const amountTotal = (checkoutSession.amount_total || paymentIntent.amount || 0) / 100;
      const shirtSize = normalizeShirtSize(checkoutSession.metadata?.shirt_size);

      await updateRegistrationsByCheckoutSessionId(checkoutSession.id, {
        email,
        full_name: fullName,
        event_slug: checkoutSession.metadata?.event_slug || 'axolote-night-run',
        distance: String(checkoutSession.metadata?.distance || '5K').toUpperCase(),
        amount_paid: amountTotal,
        payment_status: 'payment_failed',
        shirt_size: isValidShirtSize(shirtSize) ? shirtSize : null,
        created_at: new Date().toISOString()
      });

      console.warn(`⚠️ PaymentIntent fallido actualizado | session_id=${checkoutSession.id}`);
    } else {
      console.warn(`⚠️ PaymentIntent fallido sin sesión relacionada | payment_intent=${paymentIntent.id}`);
    }
  }

  // ==================== CHARGE REFUNDED ====================
  // Batch 2: solo reembolsos TOTALES mutan (amount_refunded acumulativo).
  // Un refund parcial se registra en log y NO toca inscripciones.
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;

    if (!isFullChargeRefund(charge)) {
      logRefundEvent({
        stripeEventId: event.id,
        refundId: null,
        chargeId: resolveStripeObjectId(charge?.id),
        paymentIntentId: resolvePaymentIntentId(charge?.payment_intent),
        sourceEventType: event.type,
        result: 'skipped',
        reason: 'partial_refund',
      });
      return res.status(200).json({ received: true });
    }

    await markRefundedFromCharge(charge, event.type, event.id);
    return res.status(200).json({ received: true });
  }

  // ==================== REFUND EVENTS (deterministas) ====================
  // Batch 2: solo refunds con status succeeded; totalidad verificada contra
  // el charge (refund.amount >= charge.amount). Sin fallback por email.
  if (event.type === 'refund.created' || event.type === 'refund.updated') {
    const refund = event.data.object;

    if (refund.status !== 'succeeded') {
      logRefundEvent({
        stripeEventId: event.id,
        refundId: refund?.id || null,
        chargeId: resolveStripeObjectId(refund?.charge),
        paymentIntentId: resolvePaymentIntentId(refund?.payment_intent),
        sourceEventType: event.type,
        result: 'skipped',
        reason: `refund_status:${refund?.status || 'unknown'}`,
      });
      return res.status(200).json({ received: true });
    }

    const chargeId = resolveStripeObjectId(refund?.charge);
    let charge = (refund?.charge && typeof refund.charge === 'object') ? refund.charge : null;

    if (!charge && chargeId) {
      try {
        charge = await stripe.charges.retrieve(chargeId);
      } catch (error) {
        logRefundEvent({
          stripeEventId: event.id,
          refundId: refund?.id || null,
          chargeId,
          paymentIntentId: resolvePaymentIntentId(refund?.payment_intent),
          sourceEventType: event.type,
          result: 'skipped',
          reason: 'charge_lookup_failed',
        });
        return res.status(200).json({ received: true });
      }
    }

    if (!charge) {
      logRefundEvent({
        stripeEventId: event.id,
        refundId: refund?.id || null,
        chargeId,
        paymentIntentId: resolvePaymentIntentId(refund?.payment_intent),
        sourceEventType: event.type,
        result: 'skipped',
        reason: 'missing_charge',
      });
      return res.status(200).json({ received: true });
    }

    const refundAmount = typeof refund?.amount === 'number' ? refund.amount : null;
    const chargeAmount = typeof charge?.amount === 'number' ? charge.amount : null;

    if (refundAmount === null || chargeAmount === null || refundAmount < chargeAmount) {
      logRefundEvent({
        stripeEventId: event.id,
        refundId: refund?.id || null,
        chargeId: resolveStripeObjectId(charge?.id) || chargeId,
        paymentIntentId: resolvePaymentIntentId(refund?.payment_intent) || resolvePaymentIntentId(charge?.payment_intent),
        sourceEventType: event.type,
        result: 'skipped',
        reason: 'partial_refund',
      });
      return res.status(200).json({ received: true });
    }

    await applyDeterministicRefund({
      stripeEventId: event.id,
      refundId: refund?.id || null,
      chargeId: resolveStripeObjectId(charge?.id) || chargeId,
      paymentIntentId: resolvePaymentIntentId(refund?.payment_intent) || resolvePaymentIntentId(charge?.payment_intent),
      sourceEventType: event.type,
    });
    return res.status(200).json({ received: true });
  }

  // Responder siempre con 200 para que Stripe no reintente
  return res.status(200).json({ received: true });
};

module.exports.sendConfirmationEmail = sendConfirmationEmail;
