// storage-upload.js - Batch 6 (rev): buckets separados public/private.
// contact-attachments (PUBLIC): solo media pública de perfil
//   avatars/{uid}/... covers/{uid}/...
// contact-private (PRIVADO): adjuntos de contacto contact/{uuid}.{ext}.
//   Sin getPublicUrl para contacto: el backend firma URLs cortas.
// Verdad canónica navegador (window.KineticHubStorageUpload) y tests.
// Frontera real: RLS/policies/límites en
// desc/sql-batch6-storage-hardening.sql (el frontend NO es el boundary).

// Todo el código vive dentro de esta IIFE: ningún const/let interno contamina
// el global scope del navegador cuando se combina con otros helpers.
(function () {
'use strict';

// Bucket PÚBLICO: media de perfil (avatares/portadas).
const PROFILE_MEDIA_BUCKET = 'contact-attachments';

// Bucket PRIVADO: adjuntos de contacto. Nunca getPublicUrl desde browser.
const CONTACT_PRIVATE_BUCKET = 'contact-private';

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

const catalog = {
  PROFILE_MEDIA_BUCKET,
  CONTACT_PRIVATE_BUCKET,
  PROFILE_IMAGE_EXTENSIONS,
  CONTACT_EXTENSIONS,
  STORAGE_SIZE_LIMITS,
  normalizeProfileMediaType,
  extensionForMime,
  validateUploadFile,
  isSafePathSegment,
  buildProfileObjectPath,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = catalog;
}
if (typeof globalThis !== 'undefined' && globalThis.window) {
  globalThis.window.KineticHubStorageUpload = catalog;
}
})();
