'use strict';

const { getAdminUser, getServiceClient } = require('./_auth');
const { events } = require('../event-catalog');
const { csvCell } = require('./_perrun-operations');
const { normalizeShirtSize, isValidShirtSize } = require('./_shirt-sizes');

const EVENT_SLUGS = Object.keys(events);
const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const COLUMNS = 'id,event_slug,full_name,distance,shirt_size,email,buyer_email,bib_number,payment_status,registration_status,order_session_id,stripe_session_id,ticket_index,ticket_count';
const CSV_COLUMNS = ['Carrera', 'Nombre', 'Distancia', 'Talla', 'Cantidad', 'Correo', 'BIB', 'Estado', 'Observacion'];

function isEligible(row, event) {
  return EVENT_SLUGS.includes(row.event_slug)
    && (event === 'all' || row.event_slug === event)
    && ['paid', 'paid_no_email'].includes(row.payment_status)
    && row.registration_status === 'active'
    && !String(row.order_session_id || '').startsWith('cs_test_')
    && !String(row.stripe_session_id || '').startsWith('cs_test_');
}

async function readShirtRegistrations(req) {
  const auth = await getAdminUser(req);
  if (auth.error) return { status: auth.status || 401, error: auth.error };

  const rawEvent = req.query?.event;
  if (rawEvent !== undefined && typeof rawEvent !== 'string') {
    return { status: 400, error: 'Filtro de carrera inválido.' };
  }
  const event = String(rawEvent ?? 'all').trim().toLowerCase() || 'all';
  if (event !== 'all' && !EVENT_SLUGS.includes(event)) {
    return { status: 400, error: 'Filtro de carrera inválido.' };
  }

  const client = getServiceClient();
  const rows = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Only human registrations. Visual status/search/row limits are never used.
    let query = client.from('inscripciones').select(COLUMNS)
      .in('payment_status', ['paid', 'paid_no_email'])
      .eq('registration_status', 'active')
      .in('event_slug', event === 'all' ? EVENT_SLUGS : [event])
      .order('id', { ascending: true }).limit(PAGE_SIZE);
    if (cursor !== undefined) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return { status: 500, error: 'No se pudieron cargar las playeras.' };
    }
    rows.push(...data.filter(row => isEligible(row, event)));
    if (data.length < PAGE_SIZE) return { status: 200, event, rows };
    const nextCursor = data[data.length - 1].id;
    if (!nextCursor || (cursor !== undefined && nextCursor <= cursor)) {
      return { status: 500, error: 'No se pudo completar la exportación de playeras.' };
    }
    cursor = nextCursor;
  }
  return { status: 413, error: 'Exportación demasiado grande. Selecciona una carrera con menos registros.' };
}

function shirtsCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  const orderKey = row => JSON.stringify([row.event_slug, row.order_session_id || row.stripe_session_id || row.id]);
  const orderRows = new Map();
  for (const row of rows) {
    const key = orderKey(row);
    orderRows.set(key, (orderRows.get(key) || 0) + 1);
  }
  for (const row of rows) {
    const ticketCount = Number(row.ticket_count);
    const legacySummary = row.payment_status === 'paid_no_email'
      && Number.isInteger(ticketCount) && ticketCount > 1 && orderRows.get(orderKey(row)) === 1;
    const shirtSize = normalizeShirtSize(row.shirt_size);
    const incomplete = legacySummary || !isValidShirtSize(shirtSize);
    const observation = legacySummary
      ? `DATOS_INCOMPLETOS_LEGACY: orden reporta ${ticketCount} tickets; tallas individuales no disponibles`
      : incomplete ? 'DATOS_INCOMPLETOS_LEGACY' : '';
    // A summary is still one persisted row, never ticket_count invented participants.
    const values = [events[row.event_slug].name, row.full_name, row.distance,
      incomplete ? 'TALLA_PENDIENTE' : shirtSize,
      1, row.email || row.buyer_email, row.bib_number, row.payment_status, observation];
    lines.push(values.map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    const result = await readShirtRegistrations(req);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    const csv = shirtsCsv(result.rows);
    const filename = (result.event === 'all' ? 'todas-las-carreras' : result.event) + '-playeras.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Error exportando playeras CSV:', error);
    return res.status(500).json({ error: 'No se pudo completar la exportación de playeras.' });
  }
};

module.exports.readShirtRegistrations = readShirtRegistrations;
module.exports.shirtsCsv = shirtsCsv;
