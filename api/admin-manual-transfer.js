const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_SHIRT_SIZES = ['S', 'M', 'L'];
const MAX_TICKETS_PER_ORDER = 5;
const DEFAULT_EVENT_SLUG = 'axolote-night-run';

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || 'mariana@kinetichub.com.mx';
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

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

async function generateNextBibNumber() {
  const { data, error } = await supabase.rpc('get_next_bib_number');
  if (error) {
    throw new Error(`No se pudo generar bib_number: ${error.message}`);
  }
  return String(data).padStart(3, '0');
}

async function getAdminUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return { error: 'No autorizado: falta token de sesión.' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) {
    return { error: 'No autorizado: sesión inválida.' };
  }

  const email = String(data.user.email).trim().toLowerCase();
  const admins = getAdminEmails();

  if (!admins.includes(email)) {
    return { error: 'No autorizado: este usuario no es admin.' };
  }

  return { email };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUserFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ error: auth.error });
    }

    const {
      buyerEmail,
      tickets,
      totalAmount,
      eventSlug,
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

    const normalizedTickets = tickets.map((ticket, index) => {
      const fullName = normalizeName(ticket?.fullName);
      const shirtSize = String(ticket?.shirtSize || '').trim().toUpperCase();

      if (fullName.length < 3) {
        throw new Error(`Nombre inválido en ticket ${index + 1}.`);
      }

      if (!ALLOWED_SHIRT_SIZES.includes(shirtSize)) {
        throw new Error(`Talla inválida en ticket ${index + 1}. Usa S, M o L.`);
      }

      return { fullName, shirtSize };
    });

    const cleanEventSlug = String(eventSlug || DEFAULT_EVENT_SLUG).trim() || DEFAULT_EVENT_SLUG;
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
      const bibNumber = await generateNextBibNumber();
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
          amount_paid: amountParts[i],
          payment_status: 'paid',
          shirt_size: ticket.shirtSize,
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
    });
  } catch (error) {
    console.error('Error en admin-manual-transfer:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
