// api/perfil.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = async (req, res) => {
  // Solo permitimos GET para servir la página protegida
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // Obtener el token de la cookie o del header Authorization
    const token = req.cookies?.['sb-access-token'] || 
                  req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      // Redirigir al login si no hay token
      return res.redirect(302, '/auth.html?mode=login&returnTo=/perfil.html');
    }

    // Verificar la sesión con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.warn('Usuario no autenticado o token inválido');
      return res.redirect(302, '/auth.html?mode=login&returnTo=/perfil.html');
    }

    // Usuario autenticado → servir el contenido de perfil.html
    // Opción A: Redirigir al archivo estático (más simple)
    return res.redirect(302, '/perfil.html');

    // Opción B: Leer y servir el archivo manualmente (si quieres más control)
    // const fs = require('fs');
    // const path = require('path');
    // const filePath = path.join(process.cwd(), 'public', 'perfil.html');
    // const html = fs.readFileSync(filePath, 'utf8');
    // return res.status(200).send(html);

  } catch (err) {
    console.error('Error en middleware de perfil:', err);
    return res.redirect(302, '/auth.html?mode=login');
  }
};