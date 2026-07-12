const { createClient } = require('@supabase/supabase-js');
const { sendConfirmationEmail } = require('./stripe-webhook');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function htmlPage(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; margin: 0; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #00f5ff; font-size: 24px; margin: 0 0 8px; }
    h2 { color: #ffffff; font-size: 18px; margin: 24px 0 12px; }
    .summary { background: #1a1a2e; border: 1px solid #2c2c52; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
    .summary-grid { display: flex; gap: 16px; flex-wrap: wrap; }
    .stat { text-align: center; min-width: 100px; }
    .stat-value { font-size: 28px; font-weight: bold; color: #00f5ff; display: block; }
    .stat-label { font-size: 12px; color: #aaaaaa; text-transform: uppercase; letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #2c2c52; font-size: 14px; }
    th { color: #00f5ff; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; background: #141428; }
    td { color: #e0e0e0; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .badge-ok { background: #00ff9d22; color: #00ff9d; border: 1px solid #00ff9d44; }
    .badge-skip { background: #ffaa0022; color: #ffaa00; border: 1px solid #ffaa0044; }
    .badge-err { background: #ff444422; color: #ff4444; border: 1px solid #ff444444; }
    .participant-list { font-size: 13px; color: #cccccc; }
    .progress-bar { width: 100%; background: #141428; border-radius: 999px; height: 8px; overflow: hidden; margin: 8px 0; }
    .progress-fill { height: 100%; background: #00f5ff; border-radius: 999px; transition: width 0.3s; }
    .footer { margin-top: 24px; font-size: 12px; color: #666; text-align: center; }
    .loading { text-align: center; padding: 60px 20px; }
    .loading .spinner { width: 40px; height: 40px; border: 3px solid #2c2c52; border-top-color: #00f5ff; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 600px) { .summary-grid { flex-direction: column; gap: 8px; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>\u2709\uFE0F Reenviar confirmaciones</h1>
    <p style="color:#888;margin:0 0 20px;font-size:14px;">${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p>
    ${bodyContent}
    <div class="footer">Kinetic Hub • Axolote Night Run 2026</div>
  </div>
</body>
</html>`;
}

async function sendForAllPaid() {
  const { data: inscriptions, error } = await supabase
    .from('inscripciones')
    .select('*')
    .eq('payment_status', 'paid')
    .order('order_session_id')
    .order('ticket_index');

  if (error) throw new Error(`Error consultando DB: ${error.message}`);
  if (!inscriptions || inscriptions.length === 0) {
    return { totalOrders: 0, totalTickets: 0, results: [] };
  }

  const groups = {};
  for (const ins of inscriptions) {
    if (!groups[ins.order_session_id]) {
      groups[ins.order_session_id] = [];
    }
    groups[ins.order_session_id].push(ins);
  }

  const orderIds = Object.keys(groups);
  const results = [];
  let sentCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const orderSessionId of orderIds) {
    const records = groups[orderSessionId];
    const email = records[0]?.buyer_email || records[0]?.email;

    if (!email) {
      results.push({
        orderSessionId,
        email: null,
        tickets: records.length,
        participants: records.map(r => r.full_name),
        status: 'skipped',
        reason: 'Sin email en la orden',
      });
      skipCount++;
      continue;
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

    try {
      const result = await sendConfirmationEmail({
        email,
        fullName,
        primaryBibNumber,
        primaryParticipant,
        amountTotal,
        safeParticipants,
        shirtSize,
        participantDetails,
      });

      if (result?.ok) {
        await supabase
          .from('inscripciones')
          .update({ email_sent: true })
          .eq('order_session_id', orderSessionId);
        results.push({
          orderSessionId,
          email,
          tickets: records.length,
          participants: records.map(r => r.full_name),
          status: 'sent',
        });
        sentCount++;
      } else {
        results.push({
          orderSessionId,
          email,
          tickets: records.length,
          participants: records.map(r => r.full_name),
          status: 'error',
          reason: result?.error || 'Error al enviar',
        });
        errorCount++;
      }
    } catch (err) {
      results.push({
        orderSessionId,
        email,
        tickets: records.length,
        participants: records.map(r => r.full_name),
        status: 'error',
        reason: err.message,
      });
      errorCount++;
    }
  }

  return {
    totalOrders: orderIds.length,
    totalTickets: inscriptions.length,
    sentCount,
    skipCount,
    errorCount,
    results,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  try {
    const report = await sendForAllPaid();
    const pct = report.totalOrders > 0
      ? Math.round((report.sentCount / report.totalOrders) * 100)
      : 0;

    const summaryHtml = `
      <div class="summary">
        <div class="summary-grid">
          <div class="stat">
            <span class="stat-value">${report.totalOrders}</span>
            <span class="stat-label">\u00d3rdenes</span>
          </div>
          <div class="stat">
            <span class="stat-value">${report.totalTickets}</span>
            <span class="stat-label">Tickets</span>
          </div>
          <div class="stat">
            <span class="stat-value" style="color:#00ff9d;">${report.sentCount}</span>
            <span class="stat-label">Enviados</span>
          </div>
          <div class="stat">
            <span class="stat-value" style="color:#ffaa00;">${report.skipCount}</span>
            <span class="stat-label">Saltados</span>
          </div>
          <div class="stat">
            <span class="stat-value" style="color:#ff4444;">${report.errorCount}</span>
            <span class="stat-label">Errores</span>
          </div>
        </div>
        <div class="progress-bar" style="margin-top:12px;">
          <div class="progress-fill" style="width:${pct}%;"></div>
        </div>
      </div>
    `;

    if (report.results.length === 0) {
      return res.status(200).send(htmlPage(
        'Reenviar confirmaciones',
        `<p style="color:#888;">No se encontraron inscripciones con estado <strong>paid</strong>.</p>
         <p style="color:#666;font-size:13px;">Verifica que haya registros en la base de datos con payment_status = 'paid'.</p>`
      ));
    }

    const rowsHtml = report.results.map(r => {
      const badgeClass = r.status === 'sent' ? 'badge-ok' : r.status === 'skipped' ? 'badge-skip' : 'badge-err';
      const badgeLabel = r.status === 'sent' ? '\u2705 Enviado' : r.status === 'skipped' ? '\u23ED\uFE0F Saltado' : '\u274C Error';
      const participantsStr = r.participants.join(', ');
      return `<tr>
        <td style="font-family:monospace;font-size:12px;">${r.orderSessionId}</td>
        <td>${r.email || '<span style="color:#ffaa00;">sin email</span>'}</td>
        <td>${r.tickets}</td>
        <td><div class="participant-list">${participantsStr}</div></td>
        <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
        <td style="color:#888;font-size:12px;">${r.reason || ''}</td>
      </tr>`;
    }).join('');

    const tableHtml = `
      <h2>Resultados</h2>
      <table>
        <thead>
          <tr>
            <th>Orden</th>
            <th>Email</th>
            <th>Tickets</th>
            <th>Participantes</th>
            <th>Estado</th>
            <th>Nota</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <p style="text-align:right;font-size:12px;color:#666;">
        <a href="${req.url}" style="color:#00f5ff;">\uD83D\uDD04 Reintentar</a>
      </p>
    `;

    return res.status(200).send(htmlPage('Reenviar confirmaciones', summaryHtml + tableHtml));

  } catch (err) {
    console.error('Error en resend-confirmations:', err);
    return res.status(500).send(htmlPage('Error', `
      <div class="summary" style="border-color:#ff4444;">
        <h2 style="color:#ff4444;margin:0 0 8px;">Error</h2>
        <p style="margin:0;">${err.message}</p>
      </div>
    `));
  }
};
