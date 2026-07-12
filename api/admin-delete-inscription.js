const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || 'mariana@kinetichub.com.mx,gato.jijen01@gmail.com';
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function getAdminUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return { error: 'No autorizado: falta token de sesión.' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) {
    return { error: 'No autorizado: sesión inválida.' };
  }

  const email = String(data.user.email).trim().toLowerCase();
  const admins = getAdminEmails();

  if (!admins.includes(email)) {
    return { error: 'No autorizado: este usuario no es admin.' };
  }

  return { email };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const auth = await getAdminUserFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ error: auth.error });
    }

    const { inscriptionId, orderSessionId } = req.body || {};
    const cleanInscriptionId = String(inscriptionId || '').trim();
    const cleanOrderSessionId = String(orderSessionId || '').trim();

    if (!cleanInscriptionId && !cleanOrderSessionId) {
      return res.status(400).json({ error: 'Debes indicar una inscripción o una orden.' });
    }

    let query = supabase
      .from('inscripciones')
      .delete()
      .select('id, order_session_id, full_name');

    if (cleanOrderSessionId) {
      query = query.eq('order_session_id', cleanOrderSessionId);
    } else {
      query = query.eq('id', cleanInscriptionId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No se encontraron registros para eliminar.' });
    }

    return res.status(200).json({
      ok: true,
      deletedCount: data.length,
      orderSessionId: cleanOrderSessionId || data[0]?.order_session_id || null,
      deletedIds: data.map((item) => item.id),
      adminEmail: auth.email,
    });
  } catch (error) {
    console.error('Error en admin-delete-inscription:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
  }
};
