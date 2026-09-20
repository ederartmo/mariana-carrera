// storage-upload.js - Batch 6: reglas de subida a Supabase Storage (browser).
// Verdad canónica navegador (window.KineticHubStorageUpload vía
// <script src="storage-upload.js"> en perfil/checkout/contacto) y tests
// (require). Vive en raíz para que build.js lo copie a public/.
// Solo funciones puras: validación MIME/tamaño, construcción de paths y
// UUIDs. La frontera real (RLS/policies/límites de bucket) vive en
// desc/sql-batch6-storage-hardening.sql: el frontend NO es el boundary.

const STORAGE_BUCKET = 'contact-attachments';

const PROFILE_IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Contacto público: imágenes + PDF (comprobantes). NUNCA svg/html/js.
// Supuesto documentado: la UI de contacto necesita adjuntos de soporte;
// si necesita otros tipos, ampliar aquí Y en el bucket (allowed_mime_types).
const CONTACT_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const STORAGE_SIZE_LIMITS = {
  avatar: 2 * 1024 * 1024,
  cover: 4 * 1024 * 1024,
  contact: 5 * 1024 * 1024,
};

// Solo estos dos tipos generan paths de perfil. Cualquier otro → null.
function normalizeProfileMediaType(type) {
  if (type === 'avatar' || type === 'cover') return type;
  return null;
}

// Extensión derivada ÚNICAMENTE del MIME permitido. null = rechazar.
function extensionForMime(mimeType, kind) {
  const clean = String(mimeType || '').trim().toLowerCase();
  if (kind === 'contact') {
    return Object.prototype.hasOwnProperty.call(CONTACT_EXTENSIONS, clean)
      ? CONTACT_EXTENSIONS[clean]
      : null;
  }
  return Object.prototype.hasOwnProperty.call(PROFILE_IMAGE_EXTENSIONS, clean)
    ? PROFILE_IMAGE_EXTENSIONS[clean]
    : null;
}

// Valida tipo+tamaño. '' = ok, mensaje = rechazar (para UI).
function validateUploadFile(file, kind) {
  if (!file) {
    return 'No se detectó archivo.';
  }

  const extensions = kind === 'contact' ? CONTACT_EXTENSIONS : PROFILE_IMAGE_EXTENSIONS;
  const clean = String(file.type || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(extensions, clean)) {
    return kind === 'contact'
      ? 'Formato no permitido. Usa JPG, PNG, WEBP o PDF.'
      : 'Formato no permitido. Usa JPG, PNG o WEBP.';
  }

  const maxBytes = STORAGE_SIZE_LIMITS[kind] || STORAGE_SIZE_LIMITS.avatar;
  if (typeof file.size !== 'number' || !(file.size >= 0)) {
    return 'Archivo inválido.';
  }
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return `El archivo supera el límite de ${maxMb} MB.`;
  }

  return '';
}

// Segmentos de path: solo [A-Za-z0-9_-], 1..128. user.id (UUID) pasa;
// cualquier cosa con /, ., espacios o vacía → false.
function isSafePathSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

// avatars/{userId}/avatar.{ext} | covers/{userId}/cover.{ext}. null = no subir.
function buildProfileObjectPath({ type, userId, ext }) {
  const cleanType = normalizeProfileMediaType(type);
  if (!cleanType) return null;
  if (!isSafePathSegment(userId)) return null;
  if (!isSafePathSegment(ext)) return null;
  return `${cleanType}s/${userId}/${cleanType}.${ext}`;
}

// contact/{uuid}.{ext}. El nombre original NUNCA controla el path.
function buildContactObjectPath({ uploadId, ext }) {
  if (!isSafePathSegment(uploadId)) return null;
  if (!isSafePathSegment(ext)) return null;
  return `contact/${uploadId}.${ext}`;
}

// UUID no predecible (el nombre/Date.now() no son identificadores seguros).
function newUploadId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

const catalog = {
  STORAGE_BUCKET,
  PROFILE_IMAGE_EXTENSIONS,
  CONTACT_EXTENSIONS,
  STORAGE_SIZE_LIMITS,
  normalizeProfileMediaType,
  extensionForMime,
  validateUploadFile,
  isSafePathSegment,
  buildProfileObjectPath,
  buildContactObjectPath,
  newUploadId,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = catalog;
}
if (typeof globalThis !== 'undefined' && globalThis.window) {
  globalThis.window.KineticHubStorageUpload = catalog;
}
