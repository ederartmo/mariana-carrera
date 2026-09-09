// api/location-catalog.js - PR4 Parte B: catálogo oficial de ubicación.
// Verdad canónica backend para state (32 entidades) y borough (16 alcaldías CDMX).
// Frontend (script.js) mantiene un espejo; tests/pr4-participant-fields.test.js falla si divergen.
// Compatible Node (require) y navegador (window.KineticHubLocationCatalog).

const STATES = [
  'Aguascalientes',
  'Baja California',
  'Baja California Sur',
  'Campeche',
  'Chiapas',
  'Chihuahua',
  'Ciudad de México',
  'Coahuila de Zaragoza',
  'Colima',
  'Durango',
  'Guanajuato',
  'Guerrero',
  'Hidalgo',
  'Jalisco',
  'Estado de México',
  'Michoacán de Ocampo',
  'Morelos',
  'Nayarit',
  'Nuevo León',
  'Oaxaca',
  'Puebla',
  'Querétaro',
  'Quintana Roo',
  'San Luis Potosí',
  'Sinaloa',
  'Sonora',
  'Tabasco',
  'Tamaulipas',
  'Tlaxcala',
  'Veracruz de Ignacio de la Llave',
  'Yucatán',
  'Zacatecas',
];

const CDMX_BOROUGHS = [
  'Álvaro Obregón',
  'Azcapotzalco',
  'Benito Juárez',
  'Coyoacán',
  'Cuajimalpa de Morelos',
  'Cuauhtémoc',
  'Gustavo A. Madero',
  'Iztacalco',
  'Iztapalapa',
  'La Magdalena Contreras',
  'Miguel Hidalgo',
  'Milpa Alta',
  'Tláhuac',
  'Tlalpan',
  'Venustiano Carranza',
  'Xochimilco',
];

const CDMX_CANONICAL = 'Ciudad de México';

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function collapseSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function keyOf(value) {
  return stripAccents(collapseSpaces(value)).toLowerCase();
}

const STATE_ALIASES = {
  cdmx: CDMX_CANONICAL,
  df: CDMX_CANONICAL,
  'distrito federal': CDMX_CANONICAL,
  'ciudad de mexico': CDMX_CANONICAL,
  mexico: 'Estado de México',
  edomex: 'Estado de México',
  'edo mex': 'Estado de México',
  'estado de mexico': 'Estado de México',
  coahuila: 'Coahuila de Zaragoza',
  michoacan: 'Michoacán de Ocampo',
  veracruz: 'Veracruz de Ignacio de la Llave',
  'nuevo leon': 'Nuevo León',
  'san luis potosi': 'San Luis Potosí',
  queretaro: 'Querétaro',
  yucatan: 'Yucatán',
  tlaxcala: 'Tlaxcala',
};

const stateByKey = new Map();
STATES.forEach((name) => {
  stateByKey.set(keyOf(name), name);
});

const boroughByKey = new Map();
CDMX_BOROUGHS.forEach((name) => {
  boroughByKey.set(keyOf(name), name);
});

function normalizeState(value) {
  if (value === null || value === undefined) return null;
  const cleaned = collapseSpaces(value);
  if (!cleaned) return null;
  const k = keyOf(cleaned);
  if (stateByKey.has(k)) return stateByKey.get(k);
  if (STATE_ALIASES[k]) return STATE_ALIASES[k];
  return null;
}

function isValidState(value) {
  return normalizeState(value) !== null;
}

function isCdmxState(value) {
  return normalizeState(value) === CDMX_CANONICAL;
}

function normalizeBorough(value) {
  if (value === null || value === undefined) return null;
  const cleaned = collapseSpaces(value);
  if (!cleaned) return null;
  const k = keyOf(cleaned);
  return boroughByKey.get(k) || null;
}

function isValidBorough(value) {
  return normalizeBorough(value) !== null;
}

// borough solo CDMX, else NULL (regla PR4).
function normalizeBoroughForState(borough, state) {
  if (!isCdmxState(state)) return null;
  return normalizeBorough(borough);
}

const catalog = {
  STATES,
  CDMX_BOROUGHS,
  CDMX_CANONICAL,
  normalizeState,
  isValidState,
  isCdmxState,
  normalizeBorough,
  isValidBorough,
  normalizeBoroughForState,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = catalog;
}
if (typeof globalThis !== 'undefined' && globalThis.window) {
  globalThis.window.KineticHubLocationCatalog = catalog;
}
