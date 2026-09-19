const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyCheckoutSummaryClaim } = require('../lib/_checkout-summary-claim');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeSessionId(value) {
  return String(value || '').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store');
  }

  try {
    const sessionId = normalizeSessionId(req.query.session_id || req.query.sessionId);

    if (!sessionId) {
      return res.status(400).json({ error: 'Falta session_id' });
    }

    // Batch 3: autorización ANTES de consultar/armar PII. Sin claim válido
    // para ESTA sesión → 403 genérico (sin distinguir el motivo al cliente).
    const claimCheck = verifyCheckoutSummaryClaim(req.headers?.cookie, sessionId);
    if (!claimCheck.ok) {
      console.warn(`⛔ checkout-summary no autorizado | session_id=${sessionId} | reason=${claimCheck.reason || 'unknown'}`);
      return res.status(403).json({ error: 'No autorizado para consultar este resumen.' });
    }

    const { data, error } = await supabase
      .from('inscripciones')
      .select('id, full_name, email, buyer_email, order_session_id, ticket_index, ticket_count, event_slug, distance, amount_paid, payment_status, bib_number, shirt_size, created_at, stripe_session_id')
      .eq('order_session_id', sessionId)
      .order('ticket_index', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`❌ Error consultando resumen para ${sessionId}:`, error);
      return res.status(500).json({ error: 'No se pudo obtener el resumen' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No se encontró la compra' });
    }

    let sessionMetadata = {};
    try {
      const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
      sessionMetadata = stripeSession.metadata || {};
    } catch (stripeError) {
      console.warn(`No se pudo recuperar metadata Stripe para ${sessionId}:`, stripeError.message);
    }

    const eventSlug = data[0].event_slug || sessionMetadata.event_slug || 'axolote-night-run';
    const eventName = sessionMetadata.event_name
      || (eventSlug === 'cascanueces-run' ? 'Cascanueces Run 2026' : 'Axolote Night Run 2026');
    const distance = String(data[0].distance || sessionMetadata.distance || '5K').toUpperCase();
    const paymentStatus = String(data[0].payment_status || 'pending').toLowerCase().trim();
    const primaryBibNumber = data[0].bib_number || null;

    const participants = data.map((row) => ({
      fullName: row.full_name,
      bibNumber: row.bib_number || null,
      shirtSize: row.shirt_size,
      ticketIndex: row.ticket_index,
    }));

    const totalAmount = data.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);

    return res.status(200).json({
      sessionId,
      orderSessionId: data[0].order_session_id || sessionId,
      email: data[0].buyer_email || data[0].email || '',
      ticketCount: data[0].ticket_count || data.length,
      amountPaid: Number(totalAmount.toFixed(2)),
      payment_status: paymentStatus,
      bib_number: primaryBibNumber,
      eventSlug,
      eventName,
      distance,
      participants,
    });
  } catch (error) {
    console.error('❌ Error inesperado obteniendo resumen de compra:', error);
    return res.status(500).json({ error: 'Error inesperado' });
  }
};
