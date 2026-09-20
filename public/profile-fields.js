// profile-fields.js - Batch 5: allowlist de escritura para user_profiles.
// Verdad canónica navegador (window.KineticHubProfileFields vía
// <script src="profile-fields.js"> en perfil.html/checkout.html) y tests
// (require). Vive en raíz para que build.js lo copie a public/.
// El navegador SOLO puede enviar estas columnas; user_id/email/timestamps
// los fija el llamador desde la sesión, nunca desde input. Todo lo demás
// (bib_number, payment_status, amount_paid, stripe_*, ownership, etc.)
// se descarta aquí Y debe denegarse además en DB (ver
// desc/sql-batch5-user-profiles-hardening.sql): RLS limita FILAS, no columnas.

const PROFILE_WRITABLE_FIELDS = [
  'user_id',
  'email',
  'first_name',
  'last_name',
  'maternal_last_name',
  'full_name',
  'birth_date',
  'gender',
  'phone',
  'weight_kg',
  'height_cm',
  'country',
  'state',
  'emergency_name',
  'emergency_phone',
  'emergency_relation',
  'emergency_email',
  'avatar_url',
  'cover_url',
  'cover_position_y',
  'updated_at',
];

const PROFILE_WRITABLE_SET = new Set(PROFILE_WRITABLE_FIELDS);

// Copia únicamente claves permitidas presentes en input (undefined se omite,
// null se conserva). Nunca inventa user_id/email: los fija el llamador.
function pickProfileWritableFields(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of PROFILE_WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      out[key] = input[key];
    }
  }
  return out;
}

const catalog = {
  PROFILE_WRITABLE_FIELDS,
  pickProfileWritableFields,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = catalog;
}
if (typeof globalThis !== 'undefined' && globalThis.window) {
  globalThis.window.KineticHubProfileFields = catalog;
}
