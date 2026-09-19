// api/admin-update-participant.js - PR5: editor de UN participante (paid only).
// Edita únicamente: full_name, shirt_size, birth_date, whatsapp, state, borough.
// Protegidos (cualquier intento => 400 sin UPDATE): id, email, buyer_email,
// payment_status, bib_number, order_session_id, payment_intent_id, stripe_event_id,
// amount_paid, ticket_index, ticket_count, event_slug, distance, processed_at,
// email_sent, confirmation_email_id, confirmation_email_sent_at, created_at.
// El cliente envía SIEMPRE los 6 campos (los no modificados con valores actuales).
// Auth: mismo patrón Bearer + allowlist que los demás endpoints admin.

const { createClient } = require('@supabase/supabase-js');
const { validateParticipant } = require('../lib/_participant-validation');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ROOT_KEYS = ['id', 'email', 'participant'];
const PARTICIPANT_KEYS = ['fullName', 'shirtSize', 'birthDate', 'whatsapp', 'state', 'borough'];

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || 'mariana@kinetichub.com.mx,gato.jijen01@gmail.com';
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
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

    const body = req.body || {};
    for (const key of Object.keys(body)) {
      if (!ROOT_KEYS.includes(key)) {
        return res.status(400).json({ error: `Campo no permitido: ${key}.` });
      }
    }

    const cleanId = String(body.id || '').trim();
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    if (!cleanId || cleanId.length > 100) {
      return res.status(400).json({ error: 'Identificador de inscripción inválido.' });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Correo identificador inválido.' });
    }

    const participant = body.participant;
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
      return res.status(400).json({ error: 'Faltan los datos del participante.' });
    }
    for (const key of Object.keys(participant)) {
      if (!PARTICIPANT_KEYS.includes(key)) {
        return res.status(400).json({ error: `Campo no permitido: ${key}.` });
      }
    }
    for (const key of PARTICIPANT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(participant, key)) {
        return res.status(400).json({ error: `Falta el campo del participante: ${key}.` });
      }
    }

    // Lookup exacto por PK (id + email). service_role evita RLS; el doble
    // filtro impide tocar una fila equivocada aunque el id colisione.
    const { data: existing, error: lookupError } = await supabase
      .from('inscripciones')
      .select('id, email, payment_status')
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .single();

    if (lookupError || !existing) {
      return res.status(404).json({ error: 'No se encontró la inscripción.' });
    }

    if (String(existing.payment_status || '').trim() !== 'paid') {
      return res.status(409).json({ error: 'Solo se pueden editar inscripciones pagadas.' });
    }

    // Validación + normalización total con reglas PR4 (canónicos, +52, NULL fuera de CDMX).
    let normalized;
    try {
      normalized = validateParticipant(
        {
          fullName: participant.fullName,
          shirtSize: participant.shirtSize,
          birthDate: participant.birthDate,
          whatsapp: participant.whatsapp,
          state: participant.state,
          borough: participant.borough,
        },
        0
      );
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const { data: updated, error: updateError } = await supabase
      .from('inscripciones')
      .update({
        full_name: normalized.fullName,
        shirt_size: normalized.shirtSize,
        birth_date: normalized.birthDate,
        whatsapp: normalized.whatsapp,
        state: normalized.state,
        borough: normalized.borough,
      })
      .eq('id', cleanId)
      .eq('email', cleanEmail)
      .select();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!updated || updated.length === 0) {
      return res.status(404).json({ error: 'El registro ya no existe.' });
    }

    if (updated.length !== 1) {
      console.error(`admin-update-participant afectó ${updated.length} filas para id=${cleanId}`);
      return res.status(500).json({ error: 'Actualización ambigua, no se aplicó de forma segura.' });
    }

    console.log(`✏️ Participante editado id=${cleanId} por admin ${auth.email}`);
    return res.status(200).json({ ok: true, inscription: updated[0], adminEmail: auth.email });
  } catch (error) {
    console.error('Error en admin-update-participant:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
