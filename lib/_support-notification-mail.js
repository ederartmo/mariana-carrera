async function deliverNotification(payload, key, idempotencyKey, fetcher = fetch) {
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    if (response.ok) return 'sent';
    return response.status >= 500 || [408,409,429].includes(response.status) ? 'retry' : 'permanent';
  } catch { return 'retry'; }
}

module.exports = { deliverNotification };
