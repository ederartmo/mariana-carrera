// api/admin-delete-inscription.js - Batch 4: hard delete solo test.
// REGLA: hard delete ÚNICAMENTE si TODAS las filas target son registros
// Stripe TEST inequívocos: order_session_id Y stripe_session_id con prefijo
// "cs_test_" (convención de IDs de Stripe test-mode; los fixtures del repo
// usan cs_test_* para sintéticos). Todo lo demás FAIL CLOSED:
//   - cs_live_* → bloqueado (compra real).
//   - manual_* → bloqueado (transferencias manuales pueden ser reales).
//   - paid/refunded/paid_no_email/pending/payment_failed sin prefijo test → bloqueado.
//   - orden mixta (una fila no borrable) → DELETE = ZERO (409).
// Además exige confirmTarget == identificador exacto (400 si no coincide).
// Sin soft-delete ni columnas nuevas en este batch. Log estructurado sin PII.

const { createClient } = require('@supabase/supabase-js');
const { getAdminUser } = require('../lib/_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEST_SESSION_PREFIX = 'cs_test_';
const LIVE_SESSION_PREFIX = 'cs_live_';

function isTestSessionId(value) {
  return typeof value === 'string' && value.startsWith(TEST_SESSION_PREFIX);
}

function classifyRow(row) {
  const orderId = row.order_session_id || '';
  const stripeId = row.stripe_session_id || '';

  if (isTestSessionId(orderId) && isTestSessionId(stripeId)) {
    return 'test';
  }
  if (String(orderId).startsWith(LIVE_SESSION_PREFIX) || String(stripeId).startsWith(LIVE_SESSION_PREFIX)) {
    return 'production';
  }
  return 'unknown';
}

function logDeleteAttempt({ admin, target, mode, classification, result, rows }) {
  console.log(
    `admin_action=delete_inscription admin=${admin} target=${target} mode=${mode} classification=${classification} result=${result} rows=${rows}`
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUser(req);
    if (auth.error) {
      return res.status(auth.status || 401).json({ error: auth.error });
    }

    const { inscriptionId, orderSessionId, confirmTarget } = req.body || {};
    const cleanInscriptionId = String(inscriptionId || '').trim();
    const cleanOrderSessionId = String(orderSessionId || '').trim();
    const cleanConfirm = String(confirmTarget || '').trim();

    if (!cleanInscriptionId && !cleanOrderSessionId) {
      return res.status(400).json({ error: 'Debes indicar una inscripción o una orden.' });
    }
    if (cleanInscriptionId && cleanOrderSessionId) {
      return res.status(400).json({ error: 'Indica una inscripción O una orden, no ambas.' });
    }

    const mode = cleanOrderSessionId ? 'order' : 'row';
    const expectedTarget = cleanOrderSessionId || cleanInscriptionId;

    if (cleanConfirm !== expectedTarget) {
      logDeleteAttempt({
        admin: auth.email, target: expectedTarget, mode,
        classification: 'unknown', result: 'blocked_confirm', rows: 0,
      });
      return res.status(400).json({ error: 'Debes confirmar el identificador exacto del registro a eliminar.' });
    }

    // Preflight: leer ANTES de borrar.
    let selectQuery = supabase
      .from('inscripciones')
      .select('id, order_session_id, stripe_session_id, payment_status');

    selectQuery = cleanOrderSessionId
      ? selectQuery.eq('order_session_id', cleanOrderSessionId)
      : selectQuery.eq('id', cleanInscriptionId);

    const { data: targets, error: lookupError } = await selectQuery;

    if (lookupError) {
      throw new Error(lookupError.message);
    }

    if (!targets || targets.length === 0) {
      logDeleteAttempt({
        admin: auth.email, target: expectedTarget, mode,
        classification: 'unknown', result: 'not_found', rows: 0,
      });
      return res.status(404).json({ error: 'No se encontraron registros para eliminar.' });
    }

    // Para orden: todas las filas deben pertenecer a la orden pedida.
    if (cleanOrderSessionId && targets.some((row) => row.order_session_id !== cleanOrderSessionId)) {
      logDeleteAttempt({
        admin: auth.email, target: expectedTarget, mode,
        classification: 'unknown', result: 'blocked_mismatch', rows: targets.length,
      });
      return res.status(409).json({ error: 'La orden contiene registros inconsistentes; no se eliminó nada.' });
    }

    const classifications = targets.map(classifyRow);
    const overall = classifications.every((c) => c === 'test')
      ? 'test'
      : classifications.some((c) => c === 'production') ? 'production' : 'unknown';

    if (overall !== 'test') {
      logDeleteAttempt({
        admin: auth.email, target: expectedTarget, mode,
        classification: overall, result: 'blocked_not_test', rows: targets.length,
      });
      return res.status(409).json({
        error: 'No se puede eliminar esta compra porque no está identificada como registro de prueba.',
      });
    }

    let deleteQuery = supabase.from('inscripciones').delete().select('id');
    deleteQuery = cleanOrderSessionId
      ? deleteQuery.eq('order_session_id', cleanOrderSessionId)
      : deleteQuery.eq('id', cleanInscriptionId);

    const { data: deleted, error: deleteError } = await deleteQuery;
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const deletedCount = Array.isArray(deleted) ? deleted.length : 0;
    if (deletedCount !== targets.length) {
      logDeleteAttempt({
        admin: auth.email, target: expectedTarget, mode,
        classification: 'test', result: 'partial_mismatch', rows: deletedCount,
      });
      return res.status(500).json({ error: 'El borrado no coincidió con lo verificado; revisa manualmente.' });
    }

    logDeleteAttempt({
      admin: auth.email, target: expectedTarget, mode,
      classification: 'test', result: 'deleted', rows: deletedCount,
    });

    return res.status(200).json({
      ok: true,
      deletedCount,
      orderSessionId: cleanOrderSessionId || targets[0]?.order_session_id || null,
      deletedIds: (deleted || []).map((item) => item.id),
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-delete-inscription:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
