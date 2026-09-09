// api/_shirt-sizes.js - Verdad canónica de tallas de playera (PR3).
// Único lugar donde vive la lista en backend. Frontend (script.js,
// admin-inscripciones.html) mantiene un espejo con el mismo orden;
// tests/shirt-sizes.test.js falla si divergen.

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

function normalizeShirtSize(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidShirtSize(value) {
  return SHIRT_SIZES.includes(normalizeShirtSize(value));
}

module.exports = { SHIRT_SIZES, normalizeShirtSize, isValidShirtSize };
