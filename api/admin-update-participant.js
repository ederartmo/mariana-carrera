// Admin-only editor for participant details and event distance on paid legacy registrations.
// The database RPC applies and audits each change in one locked transaction.
const { createClient } = require('@supabase/supabase-js');
const { validateParticipant } = require('../lib/_participant-validation');
const { getAdminUser } = require('../lib/_auth');
const { toExpectedSnapshot, toRpcSnapshot, toRpcChanges } = require('../lib/admin-participant-change');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BODY_KEYS = ['id', 'email', 'participant', 'expectedSnapshot'];
const PARTICIPANT_KEYS = ['fullName', 'shirtSize', 'birthDate', 'whatsapp', 'state', 'borough', 'distance'];
const SNAPSHOT_KEYS = ['fullName', 'shirtSize', 'birthDate', 'whatsapp', 'state', 'borough', 'distance'];

function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')); }
function exactKeys(value, allowed) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key)); }
function snapshotHasAll(value) { return exactKeys(value, SNAPSHOT_KEYS) && SNAPSHOT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }

async function loadTarget(id, email) {
  const { data, error } = await supabase.from('inscripciones')
    .select('id,email,event_slug,payment_status,full_name,shirt_size,birth_date,whatsapp,state,borough,distance')
    .eq('id', id).eq('email', email).single();
  if (error || !data) return { error: { status: 404, message: 'No se encontró la inscripción.' } };
  if (data.event_slug === 'perrun-2027') return { error: { status: 409, message: 'La edición legacy no es compatible con el ledger Perrun.' } };
  if (String(data.payment_status || '').trim() !== 'paid') return { error: { status: 409, message: 'Solo se pueden editar inscripciones pagadas.' } };
  return { data };
}

async function handleGet(req, res, auth) {
  const query = req.query || {};
  const id = String(query.id || '').trim();
  const email = String(query.email || '').trim().toLowerCase();
  if (!id || id.length > 100 || !validEmail(email)) return res.status(400).json({ error: 'Identificador de inscripción inválido.' });
  const target = await loadTarget(id, email);
  if (target.error) return res.status(target.error.status).json({ error: target.error.message });
  const { data: history, error } = await supabase.from('admin_participant_change_audit')
    .select('admin_email,changed_fields,before,after,created_at')
    .eq('inscription_id', id).eq('inscription_email', email).eq('event_slug', target.data.event_slug)
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  console.log(`admin_action=read_participant_change_history admin=${auth.email} target=${id} rows=${(history || []).length}`);
  return res.status(200).json({ ok: true, inscription: target.data, history: history || [] });
}

async function handlePost(req, res, auth) {
  const body = req.body || {};
  for (const key of Object.keys(body)) if (!BODY_KEYS.includes(key)) return res.status(400).json({ error: `Campo no permitido: ${key}.` });
  const id = String(body.id || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!id || id.length > 100) return res.status(400).json({ error: 'Identificador de inscripción inválido.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Correo identificador inválido.' });
  const participant = body.participant;
  if (!exactKeys(participant, PARTICIPANT_KEYS)) return res.status(400).json({ error: 'Faltan los datos del participante o hay campos no permitidos.' });
  for (const key of PARTICIPANT_KEYS.slice(0, 6)) {
    if (!Object.prototype.hasOwnProperty.call(participant, key)) return res.status(400).json({ error: `Falta el campo del participante: ${key}.` });
  }
  if (body.expectedSnapshot !== undefined && !snapshotHasAll(body.expectedSnapshot)) {
    return res.status(400).json({ error: 'La versión cargada de la inscripción está incompleta; vuelve a abrirla.' });
  }

  const target = await loadTarget(id, email);
  if (target.error) return res.status(target.error.status).json({ error: target.error.message });
  let normalized;
  try {
    normalized = validateParticipant({
      fullName: participant.fullName, shirtSize: participant.shirtSize, birthDate: participant.birthDate,
      whatsapp: participant.whatsapp, state: participant.state, borough: participant.borough,
    }, 0);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  let changes;
  try { changes = toRpcChanges(participant, normalized, target.data.event_slug); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  const expected = body.expectedSnapshot || toExpectedSnapshot(target.data);
  const { data, error } = await supabase.rpc('admin_update_participant_change', {
    p_id: id,
    p_email: email,
    p_event_slug: target.data.event_slug,
    p_expected: toRpcSnapshot(expected),
    p_changes: changes,
    p_admin_email: auth.email,
  });
  if (error) {
    const message = String(error.message || '');
    if (/stale|changed; reload/i.test(message) || error.code === '40001') return res.status(409).json({ error: 'La inscripción cambió desde que se abrió. Recárgala antes de guardar.' });
    if (/not found/i.test(message) || error.code === 'P0002') return res.status(404).json({ error: 'No se encontró la inscripción.' });
    if (/paid|Perrun/i.test(message)) return res.status(409).json({ error: message });
    if (/distance|unsupported/i.test(message) || error.code === '22023') return res.status(400).json({ error: message });
    throw new Error(message || 'No se pudo guardar el cambio.');
  }
  const result = data || {};
  console.log(`admin_action=update_participant admin=${auth.email} target=${id} result=${result.audit ? 'updated' : 'unchanged'}`);
  return res.status(200).json({ ok: true, inscription: result.inscription, adminChange: result.audit || null, adminEmail: auth.email });
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido.' });
  try {
    const auth = await getAdminUser(req);
    if (auth.error) return res.status(auth.status || 401).json({ error: auth.error });
    if (req.method === 'GET') return await handleGet(req, res, auth);
    return await handlePost(req, res, auth);
  } catch (error) {
    console.error('Error en admin-update-participant:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
