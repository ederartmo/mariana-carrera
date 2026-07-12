const { createClient } = require('@supabase/supabase-js');

let sendConfirmationEmail;
try {
  sendConfirmationEmail = require('./stripe-webhook').sendConfirmationEmail;
} catch (err) {
  console.error('Error al cargar stripe-webhook:', err.message);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || 'mariana@kinetichub.com.mx';
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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
  console.log(`📨 resend-single-confirmation llamado | method=${req.method}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUserFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ error: auth.error });
    }

    const { orderSessionId } = req.body || {};
    const cleanOrderId = String(orderSessionId || '').trim();

    if (!cleanOrderId) {
      return res.status(400).json({ error: 'Falta orderSessionId.' });
    }

    const { data: records, error: queryError } = await supabase
      .from('inscripciones')
      .select('*')
      .eq('order_session_id', cleanOrderId)
      .order('ticket_index', { ascending: true });

    if (queryError) {
      console.error(`Error consultando orden ${cleanOrderId}:`, queryError);
      return res.status(500).json({ error: 'Error al consultar la orden.' });
    }

    if (!records || records.length === 0) {
      return res.status(404).json({ error: 'No se encontró la orden.' });
    }

    if (!sendConfirmationEmail) {
      return res.status(500).json({ error: 'El módulo de email no está disponible.' });
    }

    const email = records[0]?.buyer_email || records[0]?.email;
    if (!email) {
      return res.status(400).json({ error: 'La orden no tiene email de comprador.' });
    }

    const safeParticipants = records.map(r => ({
      fullName: r.full_name,
      shirtSize: r.shirt_size,
    }));
    const participantDetails = records.map(r => ({
      fullName: r.full_name,
      shirtSize: r.shirt_size,
      bibNumber: r.bib_number,
    }));
    const primaryParticipant = {
      fullName: records[0].full_name,
      shirtSize: records[0].shirt_size,
    };
    const primaryBibNumber = records[0].bib_number;
    const amountTotal = records.reduce((sum, r) => sum + (r.amount_paid || 0), 0);
    const shirtSize = primaryParticipant.shirtSize;
    const fullName = records[0].full_name || 'Atleta';

    const emailResult = await sendConfirmationEmail({
      email,
      fullName,
      primaryBibNumber,
      primaryParticipant,
      amountTotal,
      safeParticipants,
      shirtSize,
      participantDetails,
    });

    if (emailResult.ok) {
      await supabase
        .from('inscripciones')
        .update({ email_sent: true })
        .eq('order_session_id', cleanOrderId);

      console.log(`Email reenviado a ${email} (orden ${cleanOrderId}) por admin ${auth.email}`);
      return res.status(200).json({ ok: true, email });
    }

    console.error(`Error reenviando email a ${email} (orden ${cleanOrderId}): ${emailResult.error}`);
    return res.status(500).json({ error: emailResult.error || 'Error al enviar el correo.' });

  } catch (error) {
    console.error('Error en resend-single-confirmation:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
