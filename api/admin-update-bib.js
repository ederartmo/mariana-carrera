// Cambia/reasigna el BIB de UNA inscripción activa.
// No modifica el pago ni la orden. Al cambiar el BIB, marca email_sent=false
// para permitir reenviar la confirmación con el dorsal actualizado.
const { createClient } = require('@supabase/supabase-js');
const { getAdminUser } = require('../lib/_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ASSIGNABLE_PAYMENT_STATUSES = new Set(['paid', 'paid_no_email']);

function normalizeBib(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits || digits.length > 6) return null;
  const numeric = Number.parseInt(digits, 10);
  if (!Number.isInteger(numeric) || numeric < 1) return null;
  return String(numeric).padStart(3, '0');
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

    const { inscriptionId, bibNumber } = req.body || {};
    const cleanId = String(inscriptionId || '').trim();
    const cleanBib = normalizeBib(bibNumber);

    if (!cleanId || cleanId.length > 100) {
      return res.status(400).json({ error: 'Identificador de inscripción inválido.' });
    }
    if (!cleanBib) {
      return res.status(400).json({ error: 'BIB inválido. Usa un número mayor a 0.' });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('inscripciones')
      .select('id, event_slug, payment_status, registration_status, bib_number')
      .eq('id', cleanId)
      .single();

    if (lookupError || !existing) {
      return res.status(404).json({ error: 'No se encontró la inscripción.' });
    }

    const registrationStatus = String(existing.registration_status || 'active').trim().toLowerCase();
    if (registrationStatus !== 'active') {
      return res.status(409).json({ error: 'No puedes asignar BIB a una inscripción anulada.' });
    }

    const paymentStatus = String(existing.payment_status || '').trim().toLowerCase();
    if (!ASSIGNABLE_PAYMENT_STATUSES.has(paymentStatus)) {
      return res.status(409).json({ error: 'Solo se puede asignar BIB a una inscripción pagada.' });
    }

    const { data: conflicts, error: conflictError } = await supabase
      .from('inscripciones')
      .select('id, registration_status')
      .eq('event_slug', existing.event_slug)
      .eq('bib_number', cleanBib);

    if (conflictError) {
      throw new Error(conflictError.message);
    }

    const activeConflict = (conflicts || []).find((row) =>
      String(row.id) !== cleanId &&
      String(row.registration_status || 'active').trim().toLowerCase() === 'active'
    );

    if (activeConflict) {
      return res.status(409).json({
        error: `El BIB #${cleanBib} ya está asignado a otra inscripción activa de esta carrera.`,
      });
    }

    const previousBibNumber = existing.bib_number ? String(existing.bib_number) : null;
    if (previousBibNumber === cleanBib) {
      return res.status(200).json({
        ok: true,
        unchanged: true,
        bibNumber: cleanBib,
        previousBibNumber,
        adminEmail: auth.email,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('inscripciones')
      .update({
        bib_number: cleanBib,
        email_sent: false,
      })
      .eq('id', cleanId)
      .eq('registration_status', 'active')
      .select('id, event_slug, bib_number, email_sent, payment_status, registration_status');

    if (updateError) {
      throw new Error(updateError.message);
    }
    if (!updated || updated.length !== 1) {
      return res.status(409).json({
        error: 'La inscripción cambió mientras se procesaba. Recarga el panel y vuelve a intentar.',
      });
    }

    console.log(
      `admin_action=update_bib admin=${auth.email} target=${cleanId} old_bib=${previousBibNumber || 'none'} new_bib=${cleanBib} result=updated`
    );

    return res.status(200).json({
      ok: true,
      inscription: updated[0],
      bibNumber: cleanBib,
      previousBibNumber,
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-update-bib:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
