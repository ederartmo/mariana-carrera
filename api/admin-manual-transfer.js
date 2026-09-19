const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { sendConfirmationEmail } = require('./stripe-webhook');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { SHIRT_SIZES: ALLOWED_SHIRT_SIZES, normalizeShirtSize, isValidShirtSize } = require('../lib/_shirt-sizes');
const { validateParticipant, MAX_TICKETS_PER_ORDER } = require('../lib/_participant-validation');
const { getAdminUser } = require('../lib/_auth');
const DEFAULT_EVENT_SLUG = 'axolote-night-run';
const ALLOWED_EVENT_SLUGS = ['axolote-night-run', 'cascanueces-run'];
const EVENT_DISTANCES = {
  'axolote-night-run': ['5K'],
  'cascanueces-run': ['5K', '10K'],
};

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function parseAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function splitAmountInCents(totalAmount, ticketCount) {
  const totalCents = Math.round(totalAmount * 100);
  const base = Math.floor(totalCents / ticketCount);
  let remainder = totalCents - (base * ticketCount);
  const parts = [];

  for (let i = 0; i < ticketCount; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    parts.push(base + extra);
    if (remainder > 0) remainder -= 1;
  }

  return parts.map((cents) => Number((cents / 100).toFixed(2)));
}

async function generateNextBibNumber(eventSlug) {
  const { data, error } = await supabase.rpc('get_next_event_bib_number', {
    p_event_slug: eventSlug,
  });
  if (error) {
    throw new Error(`No se pudo generar bib_number: ${error.message}`);
  }
  return String(data).padStart(3, '0');
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

    const {
      buyerEmail,
      tickets,
      totalAmount,
      eventSlug,
      distance,
      transferReference,
      paidAt,
    } = req.body || {};

    const cleanBuyerEmail = String(buyerEmail || '').trim().toLowerCase();
    if (!cleanBuyerEmail || !cleanBuyerEmail.includes('@')) {
      return res.status(400).json({ error: 'Correo principal inválido.' });
    }

    if (!Array.isArray(tickets) || tickets.length < 1) {
      return res.status(400).json({ error: 'Debes agregar al menos un ticket.' });
    }

    if (tickets.length > MAX_TICKETS_PER_ORDER) {
      return res.status(400).json({
        error: `Máximo ${MAX_TICKETS_PER_ORDER} tickets por operación manual.`,
      });
    }

    let normalizedTickets;
    try {
      normalizedTickets = tickets.map((ticket, index) => {
        // PR4: validación compartida (birthDate/whatsapp/state/borough).
        // Acepta fullName o full_name legacy del panel admin.
        const source = {
          fullName: ticket?.fullName ?? ticket?.full_name ?? ticket?.name,
          shirtSize: ticket?.shirtSize ?? ticket?.shirt_size,
          birthDate: ticket?.birthDate ?? ticket?.birth_date,
          whatsapp: ticket?.whatsapp ?? ticket?.phone,
          state: ticket?.state,
          borough: ticket?.borough,
        };
        const v = validateParticipant(source, index);
        return { fullName: v.fullName, shirtSize: v.shirtSize, birthDate: v.birthDate, whatsapp: v.whatsapp, state: v.state, borough: v.borough };
      });
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const cleanEventSlug = String(eventSlug || DEFAULT_EVENT_SLUG).trim() || DEFAULT_EVENT_SLUG;
    if (!ALLOWED_EVENT_SLUGS.includes(cleanEventSlug)) {
      return res.status(400).json({ error: 'Carrera inválida.' });
    }
    const cleanDistance = String(distance || '5K').trim().toUpperCase();
    if (!EVENT_DISTANCES[cleanEventSlug].includes(cleanDistance)) {
      return res.status(400).json({ error: 'Distancia inválida para la carrera.' });
    }
    const cleanReference = String(transferReference || '').trim().slice(0, 80);
    const amount = parseAmount(totalAmount);

    if (amount === null) {
      return res.status(400).json({ error: 'Monto total inválido.' });
    }

    const amountParts = splitAmountInCents(amount, normalizedTickets.length);
    const orderSessionId = `manual_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();

    const inserted = [];

    for (let i = 0; i < normalizedTickets.length; i += 1) {
      const ticket = normalizedTickets[i];
      const bibNumber = await generateNextBibNumber(cleanEventSlug);
      const stripeSessionId = i === 0 ? orderSessionId : `${orderSessionId}::${i + 1}`;

      const { data, error } = await supabase
        .from('inscripciones')
        .insert({
          stripe_session_id: stripeSessionId,
          order_session_id: orderSessionId,
          buyer_email: cleanBuyerEmail,
          email: cleanBuyerEmail,
          full_name: ticket.fullName,
          event_slug: cleanEventSlug,
          distance: cleanDistance,
          amount_paid: amountParts[i],
          payment_status: 'paid',
          shirt_size: ticket.shirtSize,
          birth_date: ticket.birthDate || null,
          whatsapp: ticket.whatsapp || null,
          state: ticket.state || null,
          borough: ticket.borough || null,
          bib_number: bibNumber,
          ticket_index: i + 1,
          ticket_count: normalizedTickets.length,
          created_at: createdAt,
        })
        .select('id, full_name, shirt_size, bib_number, ticket_index')
        .single();

      if (error) {
        throw new Error(`Error guardando ticket ${i + 1}: ${error.message}`);
      }

      inserted.push(data);
    }

    // Enviar email de confirmación al comprador
    const safeParticipants = inserted.map(r => ({
      fullName: r.full_name,
      shirtSize: r.shirt_size,
    }));
    const participantDetails = inserted.map(r => ({
      fullName: r.full_name,
      shirtSize: r.shirt_size,
      bibNumber: r.bib_number,
    }));
    const emailResult = await sendConfirmationEmail({
      email: cleanBuyerEmail,
      fullName: inserted[0].full_name,
      primaryBibNumber: inserted[0].bib_number,
      primaryParticipant: inserted[0],
      amountTotal: amount,
      safeParticipants,
      shirtSize: inserted[0].shirt_size,
      participantDetails,
      eventSlug: cleanEventSlug,
      distance: cleanDistance,
    });

    if (emailResult.ok) {
      await supabase
        .from('inscripciones')
        .update({ email_sent: true })
        .eq('order_session_id', orderSessionId);
      console.log(`✅ Email de confirmación enviado a ${cleanBuyerEmail} (orden manual ${orderSessionId})`);
    } else {
      console.error(`❌ Email NO enviado a ${cleanBuyerEmail} (orden manual ${orderSessionId}): ${emailResult.error}`);
    }

    console.log(`admin_action=manual_transfer admin=${auth.email} target=${orderSessionId} event=${cleanEventSlug} result=created rows=${inserted.length}`);

    return res.status(200).json({
      ok: true,
      orderSessionId,
      buyerEmail: cleanBuyerEmail,
      eventSlug: cleanEventSlug,
      transferReference: cleanReference,
      adminEmail: auth.email,
      ticketsCreated: inserted.length,
      tickets: inserted,
      totalAmount: amount,
      emailSent: emailResult.ok,
    });
  } catch (error) {
    console.error('Error en admin-manual-transfer:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
