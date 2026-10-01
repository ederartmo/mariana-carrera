'use strict';
const list = require('./admin-list-inscriptions');
const { perrunCsv } = require('./_perrun-operations');
// Reuse the existing authenticated, server-filtered list. No client-provided rows.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' });
  const rows = [];
  for (let page = 1; page <= 1000; page++) {
    let payload, status = 200;
    await list({ ...req, query: { ...req.query, event: 'perrun-2027', page, limit: 100 } }, {
      status(code) { status = code; return this; }, json(body) { payload = body; return this; }
    });
    if (status !== 200) return res.status(status).json(payload);
    rows.push(...payload.rows);
    if (!payload.hasMore) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="perrun-2027-dogs.csv"');
      return res.status(200).send(perrunCsv(rows));
    }
  }
  return res.status(413).json({ error: 'Exportación demasiado grande; reduce los filtros.' });
};
