'use strict';

// Deterministic, reviewable intake policy. No LLM, external calls or database writes.
// Production MUST NOT treat this module as authorization to post on behalf of an agent.
const CATEGORIES = Object.freeze({
  general: 'Consulta general',
  events: 'Consulta sobre eventos',
  registration: 'Consulta sobre inscripciones',
  other: 'Otra consulta',
});

const MAX_LENGTH = 2000;
function classify(category) {
  return Object.hasOwn(CATEGORIES, category) ? category : 'general';
}
function intake({ category, folio, policy = {} } = {}) {
  const classification = classify(category);
  const label = CATEGORIES[classification];
  const ticket = typeof folio === 'string' && /^#[0-9A-F]{8}$/.test(folio) ? folio : '';
  // The selected category is not a diagnosis. Keep this first receipt short
  // and avoid implying staffed hours or response deadlines not approved.
  const body = [
    `Recibimos tu mensaje${ticket ? '. Folio: ' + ticket : ''}.`,
    'Nuestro equipo lo revisará. Puedes consultar la respuesta en este mismo chat.',
    '(Mensaje automático.)',
  ].join('\\n');
  if (body.length > MAX_LENGTH) throw new Error('Intake acknowledgment exceeds message limit.');
  return Object.freeze({ classification, body, author:'agent', intent:'acknowledgment', requiresHuman:true });
}
module.exports = { intake, classify, CATEGORIES };
