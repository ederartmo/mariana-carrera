// api/_participant-validation.js - PR4 Parte B: validación por participante.
// Reglas aprobadas (rev. sin edad mínima):
// - birthDate obligatoria en nuevas inscripciones (YYYY-MM-DD, fecha real, no futura, >=1900-01-01)
// - edad se calcula pero NO acepta/rechaza
// - whatsapp obligatorio, normalizado a +52XXXXXXXXXX
// - state nombre oficial completo (32 entidades)
// - borough solo CDMX, else NULL (16 alcaldías)
// - edad derivada, no almacenada
// - email/buyer_email intactos (este módulo no los toca)
// - correo sin birth_date/whatsapp (no se agregan al template)
// - metadata Stripe máximo 46/50 keys (margen de seguridad)

const { normalizeShirtSize, isValidShirtSize } = require('./_shirt-sizes');
const {
  normalizeState,
  isCdmxState,
  normalizeBorough,
  normalizeBoroughForState,
} = require('./location-catalog');

const MAX_TICKETS_PER_ORDER = 5;
const MAX_STRIPE_METADATA_KEYS = 46;
const STRIPE_HARD_LIMIT = 50;

function normalizeFullName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeBirthDate(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  // Acepta YYYY-MM-DD (input date HTML). Rechaza otros formatos para evitar ambigüedad.
  // Regla vigente: obligatorio, formato, fecha real, no futura, >=1900-01-01. Sin edad mínima/máxima.
  const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const birthUTC = Date.UTC(y, mo - 1, d);
  if (birthUTC >= todayUTC) return null; // futura o hoy
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getAge(birthDateStr, refDate = new Date()) {
  const norm = typeof birthDateStr === 'string' ? birthDateStr.trim() : '';
  const m = norm.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ref = refDate instanceof Date ? refDate : new Date(refDate);
  let age = ref.getFullYear() - y;
  const refM = ref.getMonth() + 1;
  const refD = ref.getDate();
  if (refM < mo || (refM === mo && refD < d)) age -= 1;
  return age;
}

function normalizeWhatsapp(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Extrae dígitos; acepta +, espacios, guiones, paréntesis.
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // 0052XXXXXXXXXX -> 52XXXXXXXXXX
  if (digits.startsWith('0052') && digits.length === 16) {
    digits = digits.slice(2);
  }
  // 52 + 10 dígitos (12) -> nacional 10
  if (digits.length === 12 && digits.startsWith('52')) {
    digits = digits.slice(2);
  }
  // 521 + 10 dígitos (13, prefijo legacy móvil 044) -> últimos 10
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = digits.slice(3);
  }
  if (digits.length !== 10) return null;
  if (!/^[1-9]\d{9}$/.test(digits)) return null;
  return `+52${digits}`;
}

function isValidWhatsapp(value) {
  return normalizeWhatsapp(value) !== null;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return obj[k];
    }
  }
  return undefined;
}

function validateParticipant(ticket, index = 0) {
  const label = `El ticket ${index + 1}`;
  const source = ticket || {};

  const fullName = normalizeFullName(pickFirst(source, ['fullName', 'full_name', 'name']));
  if (!fullName || fullName.length < 3) {
    throw new Error(`${label} debe incluir un nombre válido.`);
  }

  const shirtSize = normalizeShirtSize(pickFirst(source, ['shirtSize', 'shirt_size']));
  if (!isValidShirtSize(shirtSize)) {
    throw new Error(`${label} debe incluir una talla válida (XS, S, M, L, XL, XXL o XXXL).`);
  }

  const birthDate = normalizeBirthDate(pickFirst(source, ['birthDate', 'birth_date', 'birthdate', 'dob']));
  if (!birthDate) {
    throw new Error(`${label} debe incluir fecha de nacimiento válida (YYYY-MM-DD).`);
  }

  const whatsapp = normalizeWhatsapp(pickFirst(source, ['whatsapp', 'phone', 'telefono', 'tel']));
  if (!whatsapp) {
    throw new Error(`${label} debe incluir un WhatsApp válido de 10 dígitos.`);
  }

  const state = normalizeState(pickFirst(source, ['state', 'estado', 'entidad']));
  if (!state) {
    throw new Error(`${label} debe incluir un estado válido de México.`);
  }

  let borough = null;
  if (isCdmxState(state)) {
    borough = normalizeBorough(pickFirst(source, ['borough', 'alcaldia', 'alcaldía', 'municipio']));
    if (!borough) {
      throw new Error(`${label} debe incluir una alcaldía válida de CDMX.`);
    }
  } else {
    // Regla PR4: borough solo CDMX, else NULL (se ignora lo enviado).
    borough = null;
  }

  const age = getAge(birthDate);

  return { fullName, shirtSize, birthDate, whatsapp, state, borough, age };
}

function normalizeTicketsPR4({ tickets, legacyShirtSize }) {
  if (Array.isArray(tickets) && tickets.length > 0) {
    if (tickets.length > MAX_TICKETS_PER_ORDER) {
      return { error: `Puedes comprar hasta ${MAX_TICKETS_PER_ORDER} tickets por operación.` };
    }
    try {
      const normalized = tickets.map((t, i) => validateParticipant(t, i));
      return { tickets: normalized };
    } catch (err) {
      return { error: err.message };
    }
  }
  // Sin arreglo: exigir tickets explícitos con campos PR4 (no auto-crear).
  if (legacyShirtSize !== undefined) {
    return { error: 'Por favor agrega al menos un ticket con nombre, talla, fecha de nacimiento, WhatsApp y estado.' };
  }
  return { error: 'Por favor agrega al menos un ticket con nombre y talla válida.' };
}

function buildParticipantsMetadataPR4(tickets) {
  const metadata = {};
  tickets.forEach((ticket, index) => {
    const position = index + 1;
    metadata[`participant_${position}_name`] = String(ticket.fullName).slice(0, 80);
    metadata[`participant_${position}_shirt`] = ticket.shirtSize;
    metadata[`participant_${position}_birth`] = ticket.birthDate;
    metadata[`participant_${position}_wa`] = ticket.whatsapp;
    metadata[`participant_${position}_state`] = String(ticket.state).slice(0, 80);
    // borough puede ser null fuera de CDMX; Stripe no acepta null -> cadena vacía.
    metadata[`participant_${position}_boro`] = ticket.borough || '';
  });
  return metadata;
}

// Espejo JS de la defensa estructural del early-return paid en SQL PR4:
// exige EXACTAMENTE ticket_index 1..ticketCount, sin comparar PII.
// Retorna true si idempotente estructural, false si debe rechazarse.
function hasExactTicketIndices(existingIndices, ticketCount) {
  if (!Number.isInteger(ticketCount) || ticketCount < 1) return false;
  if (!Array.isArray(existingIndices)) return false;
  if (existingIndices.length !== ticketCount) return false;
  const seen = new Set();
  for (const idx of existingIndices) {
    if (!Number.isInteger(idx) || idx < 1 || idx > ticketCount) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
  }
  for (let i = 1; i <= ticketCount; i += 1) {
    if (!seen.has(i)) return false;
  }
  return true;
}

function countMetadataKeys(baseMetadata, participantsMetadata) {
  return Object.keys(baseMetadata || {}).length + Object.keys(participantsMetadata || {}).length;
}

function assertMetadataBudget(baseMetadata, participantsMetadata, maxKeys = MAX_STRIPE_METADATA_KEYS) {
  const total = countMetadataKeys(baseMetadata, participantsMetadata);
  if (total > maxKeys) {
    throw new Error(`Metadata Stripe excede presupuesto (${total}/${maxKeys}, hard ${STRIPE_HARD_LIMIT}). Reduce tickets o campos.`);
  }
  return total;
}

module.exports = {
  MAX_TICKETS_PER_ORDER,
  MAX_STRIPE_METADATA_KEYS,
  STRIPE_HARD_LIMIT,
  normalizeFullName,
  normalizeBirthDate,
  getAge,
  normalizeWhatsapp,
  isValidWhatsapp,
  validateParticipant,
  normalizeTicketsPR4,
  buildParticipantsMetadataPR4,
  hasExactTicketIndices,
  countMetadataKeys,
  assertMetadataBudget,
  // re-export para conveniencia
  normalizeState,
  isCdmxState,
  normalizeBorough,
  normalizeBoroughForState,
};
