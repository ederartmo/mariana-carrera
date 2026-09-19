// api/me/registrations.js - Batch 1A: "Mis carreras" sin SELECT directo desde browser.
//
// GET /api/me/registrations
// Auth: Authorization: Bearer <supabase access token>
//
// Ownership SIEMPRE derivado del JWT validado server-side
// (supabase.auth.getUser). Cualquier ?email= / body.email se ignora
// para autorización: un atacante no puede leer registros ajenos.
//
// Semántica histórica preservada (sin modelo comprador/participante todavía):
// "Mis carreras" = filas donde inscripciones.email == email autenticado.
// Columnas = exactamente las que consumía loadUserInscriptions() en
// script.js (id, created_at, stripe_session_id, email, full_name,
// event_slug, distance, amount_paid, payment_status, bib_number),
// mismo orden (created_at DESC).

const { getServiceClient, getAuthenticatedUser } = require('./_auth');

const PROFILE_COLUMNS =
  'id, created_at, stripe_session_id, email, full_name, event_slug, distance, amount_paid, payment_status, bib_number';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAuthenticatedUser(req);
    if (auth.error) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('inscripciones')
      .select(PROFILE_COLUMNS)
      .eq('email', auth.email)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`❌ Error consultando inscripciones propias de ${auth.email}:`, error);
      return res.status(500).json({ error: 'No se pudieron cargar tus carreras.' });
    }

    return res.status(200).json({ registrations: Array.isArray(data) ? data : [] });
  } catch (error) {
    console.error('❌ Error inesperado en me/registrations:', error);
    return res.status(500).json({ error: 'Error inesperado.' });
  }
};
