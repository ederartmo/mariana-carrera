// lib/admin-list-available-bibs.js
// Lista BIBs disponibles por carrera. Incluye:
// - liberados explícitamente (cancelación / test eliminado)
// - huecos históricos dentro del rango ya usado
// Excluye cualquier BIB actualmente ocupado por una inscripción activa.

const { getServiceClient, getAdminUser } = require('./_auth');

const ALLOWED_EVENTS = new Set(['axolote-night-run', 'cascanueces-run']);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUser(req);
    if (auth.error) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }

    const eventSlug = String(req.query.event || '').trim().toLowerCase();
    if (!ALLOWED_EVENTS.has(eventSlug)) {
      return res.status(400).json({ error: 'Carrera inválida.' });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('get_available_event_bibs', {
      p_event_slug: eventSlug,
    });

    if (error) {
      console.error(`Error listando BIBs disponibles para ${eventSlug}:`, error);
      return res.status(500).json({ error: 'No se pudieron cargar los BIBs disponibles.' });
    }

    const bibs = (Array.isArray(data) ? data : []).map((row) => ({
      bib: row.bib_number,
      source: row.availability_source,
      releasedAt: row.released_at || null,
      reason: row.reason || null,
    }));

    return res.status(200).json({
      eventSlug,
      count: bibs.length,
      bibs,
    });
  } catch (error) {
    console.error('Error en admin-list-available-bibs:', error);
    return res.status(500).json({ error: 'Error inesperado.' });
  }
};
