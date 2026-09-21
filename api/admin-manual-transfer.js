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

function normalizeReleasedBib(value) {
  const raw = String(value || '').trim();
  if (!/^\d{1,6}$/.test(raw)) return null;
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isInteger(numeric) || numeric < 1) return null;
  return String(numeric).padStart(3, '0');
}

async function assertReleasedBibAvailable(eventSlug, bibNumber) {
  const { data: releasedRows, error: releasedError } = await supabase
    .from('inscripciones')
    .select('id')
    .eq('event_slug', eventSlug)
    .eq('registration_status', 'cancelled')
    .eq('cancelled_bib_number', bibNumber)
    .limit(1);

  if (releasedError) {
    throw new Error(`No se pudo validar el BIB #${bibNumber}: ${releasedError.message}`);
  }

  if (!Array.isArray(releasedRows) || releasedRows.length === 0) {
    const err = new Error(`El BIB #${bibNumber} no aparece como liberado para esta carrera.`);
    err.statusCode = 409;
    throw err;
  }

  const { data: activeRows, error: activeError } = await supabase
    .from('inscripciones')
    .select('id')
    .eq('event_slug', eventSlug)
    .eq('registration_status', 'active')
    .eq('bib_number', bibNumber)
    .limit(1);

  if (activeError) {
    throw new Error(`No se pudo comprobar el BIB #${bibNumber}: ${activeError.message}`);
  }

  if (Array.isArray(activeRows) && activeRows.length > 0) {
    const err = new Error(`El BIB #${bibNumber} ya fue asignado a otra inscripción activa.`);
    err.statusCode = 409;
    throw err;
  }
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
        const bibMode = String(ticket?.bibMode || 'auto').trim().toLowerCase() === 'released'
          ? 'released'
          : 'auto';
        const releasedBib = bibMode === 'released'
          ? normalizeReleasedBib(ticket?.releasedBib)
          : null;

        if (bibMode === 'released' && !releasedBib) {
          throw new Error(`Ticket ${index + 1}: selecciona un BIB liberado válido.`);
        }

        return {
          fullName: v.fullName,
          shirtSize: v.shirtSize,
          birthDate: v.birthDate,
          whatsapp: v.whatsapp,
          state: v.state,
          borough: v.borough,
          bibMode,
          releasedBib,
        };
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

    const requestedReleasedBibs = normalizedTickets
      .filter((ticket) => ticket.bibMode === 'released')
      .map((ticket) => ticket.releasedBib);

    if (new Set(requestedReleasedBibs).size !== requestedReleasedBibs.length) {
      return res.status(400).json({
        error: 'No puedes asignar el mismo BIB liberado a dos participantes de la misma operación.',
      });
    }

    for (const bibNumber of requestedReleasedBibs) {
      await assertReleasedBibAvailable(cleanEventSlug, bibNumber);
    }

    const amountParts = splitAmountInCents(amount, normalizedTickets.length);
    const orderSessionId = `manual_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();

    const inserted = [];

    for (let i = 0; i < normalizedTickets.length; i += 1) {
      const ticket = normalizedTickets[i];
      const bibNumber = ticket.bibMode === 'released'
        ? ticket.releasedBib
        : await generateNextBibNumber(cleanEventSlug);
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
        const insertError = new Error(
          error.code === '23505' && ticket.bibMode === 'released'
            ? `El BIB #${bibNumber} dejó de estar disponible. Recarga la lista de BIBs liberados e inténtalo de nuevo.`
            : `Error guardando ticket ${i + 1}: ${error.message}`
        );
        if (error.code === '23505' && ticket.bibMode === 'released') {
          insertError.statusCode = 409;
        }
        throw insertError;
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
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({ error: error.message || 'Error interno del servidor.' });
  }
};
