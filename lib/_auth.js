// api/_auth.js - Helper compartido de autenticación server-side (Batch 1A).
//
// Centraliza el único patrón de auth válido en este proyecto:
//   Authorization: Bearer <supabase access token>
//   → supabase.auth.getUser(token)  (JWT validado por Supabase, nunca email del body/query)
//   → email real derivado del usuario validado
//   → admin = allowlist server-side ADMIN_EMAILS
//
// Usado por TODOS los endpoints admin (lectura y mutaciones) desde Batch 4.
// No existen helpers locales de allowlist en api/ ni lib/: la búsqueda
// "duplicated admin auth" debe dar cero.
// Fail closed: sin ADMIN_EMAILS configurado, admin = DENY (sin fallback).

// Sin caché y con require perezoso: cada request resuelve el cliente vigente
// (evita reutilizar credenciales obsoletas y recoge rotaciones de env;
// en tests, respeta el mock activo de cada caso).
function getServiceClient() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (typeof authHeader !== 'string') return '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Valida el JWT contra Supabase y devuelve el usuario real.
// Nunca usa email de body/query para autorización.
async function getAuthenticatedUser(req, options = {}) {
  const supabase = options.supabase || getServiceClient();
  const token = extractBearerToken(req);

  if (!token) {
    return { error: 'No autorizado: falta token de sesión.', status: 401 };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) {
    return { error: 'No autorizado: sesión inválida.', status: 401 };
  }

  return {
    user: data.user,
    email: normalizeEmail(data.user.email),
  };
}

// Igual que getAuthenticatedUser + allowlist admin server-side.
async function getAdminUser(req, options = {}) {
  const auth = await getAuthenticatedUser(req, options);
  if (auth.error) {
    return auth;
  }

  const admins = options.adminEmails || getAdminEmails();
  if (!admins.includes(auth.email)) {
    return { error: 'No autorizado: este usuario no es admin.', status: 403 };
  }

  return auth;
}

module.exports = {
  getServiceClient,
  getAdminEmails,
  extractBearerToken,
  normalizeEmail,
  getAuthenticatedUser,
  getAdminUser,
};
