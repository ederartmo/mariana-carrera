// api/admin-list-inscriptions.js - Batch 1A: lectura admin sin SELECT directo desde browser.
//
// GET /api/admin-list-inscriptions?status=&event=&search=&page=&limit=
// Auth: Authorization: Bearer <supabase access token>
//   → supabase.auth.getUser(token) + allowlist ADMIN_EMAILS server-side.
//   Sin token o token inválido → 401. Usuario normal → 403.
//
// Columnas = exactamente las 18 que el panel ya seleccionaba
// (nada más: p. ej. NO payment_intent_id / stripe_event_id).
// Paginación server-side: limit 1..100 (default 100), page >= 1.
// Filtros: status (allowlist, 'all' = sin filtro), event (allowlist,
// 'all' = sin filtro), search (ilike en full_name/email/buyer_email/
// order_session_id, escapado, máx 80 chars). Los filtros del navegador
// siguen existiendo como UX pero ya NO son la capa de seguridad.

const { getServiceClient, getAdminUser } = require('./_auth');

const ADMIN_COLUMNS =
  'id, full_name, email, buyer_email, order_session_id, ticket_index, ticket_count, event_slug, distance, amount_paid, payment_status, bib_number, shirt_size, birth_date, whatsapp, state, borough, email_sent, created_at';

const ALLOWED_STATUSES = new Set([
  'all',
  'paid',
  'pending',
  'paid_no_email',
  'payment_failed',
  'refunded',
  'duplicate',
]);

const ALLOWED_EVENTS = new Set(['all', 'axolote-night-run', 'cascanueces-run']);

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 100;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

// Escapa %, _ (comodines LIKE), comas y paréntesis (sintaxis .or()) para
// usar el término dentro de un patrón ilike.%...% seguro.
function escapeIlikeTerm(value) {
  return String(value || '')
    .trim()
    .slice(0, 80)
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll(',', '\\,')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUser(req);
    if (auth.error) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }

    const status = String(req.query.status ?? 'paid').trim().toLowerCase() || 'paid';
    const event = String(req.query.event ?? 'all').trim().toLowerCase() || 'all';
    const search = escapeIlikeTerm(req.query.search ?? req.query.q ?? '');

    if (!ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Filtro de estado inválido.' });
    }
    if (!ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ error: 'Filtro de evento inválido.' });
    }

    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const page = parsePositiveInt(req.query.page, 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const supabase = getServiceClient();
    let query = supabase.from('inscripciones').select(ADMIN_COLUMNS, { count: 'exact' });

    if (status !== 'all') {
      query = query.eq('payment_status', status);
    }
    if (event !== 'all') {
      query = query.eq('event_slug', event);
    }
    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,email.ilike.%${search}%,buyer_email.ilike.%${search}%,order_session_id.ilike.%${search}%`
      );
    }

    query = query.order('created_at', { ascending: false });

    const { data, error, count } = await query.range(from, to);

    if (error) {
      console.error(`❌ Error listando inscripciones (admin ${auth.email}):`, error);
      return res.status(500).json({ error: 'No se pudieron cargar las inscripciones.' });
    }

    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === 'number' ? count : null;

    return res.status(200).json({
      rows,
      page,
      limit,
      total,
      hasMore: total === null ? rows.length === limit : from + rows.length < total,
    });
  } catch (error) {
    console.error('❌ Error inesperado en admin-list-inscriptions:', error);
    return res.status(500).json({ error: 'Error inesperado.' });
  }
};
