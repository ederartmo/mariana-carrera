'use strict';

// Deterministic, reviewable intake policy. No LLM, external calls or database writes.
// Production MUST NOT treat this module as authorization to post on behalf of an agent.
const CATEGORIES = Object.freeze({
  general: 'Consulta general',
  events: 'Consulta sobre eventos',
  registration: 'Consulta sobre inscripciones',
  other: 'Otra consulta',
});

function classify(category) {
  return Object.hasOwn(CATEGORIES, category) ? category : 'general';
}
function intake({ category, folio } = {}) {
  const classification = classify(category);
  const ticket = typeof folio === 'string' && /^#[0-9A-F]{8}$/.test(folio) ? folio : '';
  const body = 'Recibimos tu solicitud' + (ticket ? ' ' + ticket : '') + '.';
  return Object.freeze({ classification, body, author:'agent', intent:'acknowledgment', requiresHuman:true });
}
module.exports = { intake, classify, CATEGORIES };
