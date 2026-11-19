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
  const instructions = typeof policy.channel === 'string' &&
    policy.channel === 'chat' ? 'Consulta las actualizaciones en este mismo chat.' : 'Conserva este chat para consultar las actualizaciones.';
  const schedule = typeof policy.schedule === 'string' && policy.schedule.trim().length > 0 &&
    policy.schedule.trim().length <= 160 ? policy.schedule.trim() : null;
  const window = Number.isSafeInteger(policy.firstResponseBusinessHours) &&
    policy.firstResponseBusinessHours >= 1 && policy.firstResponseBusinessHours <= 168 ?
      policy.firstResponseBusinessHours : null;
  // This is a first-response target, NOT a guaranteed solution time or deadline.
  const timing = window === null
    ? 'El equipo revisará tu caso durante su horario de atención.'
    : `Nuestro objetivo es darte una primera respuesta en un máximo de ${window} horas hábiles; esto no representa un plazo de resolución.`;
  const body = [
    `Recibimos tu solicitud${ticket ? ' ' + ticket : ''}.`,
    `Categoría registrada: ${label}.`,
    timing,
    ...(schedule ? [`Horario de atención: ${schedule}.`] : []),
    instructions,
    'Si tu solicitud requiere intervención humana, el equipo dará seguimiento. Esta confirmación es automática.',
  ].join('\n');
  if (body.length > MAX_LENGTH) throw new Error('Intake acknowledgment exceeds message limit.');
  return Object.freeze({ classification, body, author:'agent', intent:'acknowledgment', requiresHuman:true });
}
module.exports = { intake, classify, CATEGORIES };
