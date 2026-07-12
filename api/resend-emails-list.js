const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || 'mariana@kinetichub.com.mx,gato.jijen01@gmail.com';
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user?.email) {
    return res.status(401).json({ error: 'Sesión inválida.' });
  }

  if (!getAdminEmails().includes(userData.user.email.trim().toLowerCase())) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY no configurada.' });
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.list({ limit });

    if (error) {
      console.error('Error al listar emails de Resend:', error);
      return res.status(500).json({ error: error.message || 'Error al consultar Resend.' });
    }

    const rawList = data?.data || data || [];
    const emails = (Array.isArray(rawList) ? rawList : []).map(e => ({
      id: e.id,
      to: Array.isArray(e.to) ? e.to.join(', ') : (e.to || ''),
      from: e.from || '',
      subject: e.subject || '',
      created_at: e.created_at || '',
      last_event: e.last_event || '',
    }));

    return res.status(200).json({ emails });
  } catch (err) {
    console.error('Error en resend-emails-list:', err);
    return res.status(500).json({ error: err.message || 'Error interno.' });
  }
};
