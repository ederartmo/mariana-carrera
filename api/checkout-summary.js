const { createClient } = require('@supabase/supabase-js');

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

  try {
    const sessionId = normalizeSessionId(req.query.session_id || req.query.sessionId);

    if (!sessionId) {
      return res.status(400).json({ error: 'Falta session_id' });
    }

    const { data, error } = await supabase
      .from('inscripciones')
      .select('id, full_name, email, buyer_email, order_session_id, ticket_index, ticket_count, event_slug, amount_paid, payment_status, bib_number, shirt_size, created_at, stripe_session_id')
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

    const participants = data.map((row) => ({
      fullName: row.full_name,
      bibNumber: row.bib_number,
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
      participants,
    });
  } catch (error) {
    console.error('❌ Error inesperado obteniendo resumen de compra:', error);
    return res.status(500).json({ error: 'Error inesperado' });
  }
};