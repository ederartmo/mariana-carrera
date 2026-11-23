'use strict';

const questions = Object.freeze({
  sales: '¡Claro! ¿Te refieres a Cascanueces Run o Perrun?',
  pickup: '¿Para qué carrera necesitas esa información? Así puedo indicarte los requisitos correspondientes.',
  kit: '¿De qué carrera quieres consultar la entrega del kit?',
});
const normalize = text => text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const races = /\b(?:perrun|cascanueces|axolote|santa|trail|tri|ride|family|night)\b/g;
const handoff = 'Para confirmarte ese detalle, voy a pasar tu consulta a nuestro equipo de atención.';

function topicFor(words) {
  if (/\b(?:hasta cuando|hasta que dia|fecha limite|cierre|cierran)\b/.test(words) &&
    /\b(?:boletos?|entradas?|ventas?|inscripcion(?:es)?|inscribirme|registrarme|registro|comprar)\b/.test(words)) return 'sales';
  if (/\b(?:kits?|paquetes?)\b/.test(words) &&
    /\b(?:alguien mas|otra persona|tercer[oa]s?|por mi)\b/.test(words) &&
    /\b(?:recog\w*|retir\w*|recib\w*)\b/.test(words)) return 'pickup';
  if (/\b(?:kits?|paquetes?)\b/.test(words) && /\b(?:entrega|recogida|donde|cuando|horario)\b/.test(words)) return 'kit';
  return null;
}

function eventGuidance(words, allowClarification) {
  const topic = topicFor(words);
  if (!topic) return null;
  const names = new Set(words.match(races));
  if (names.size !== 1) return allowClarification ? 'clarify-event-' + topic : null;
  if (!names.has('perrun')) return null;
  return {sales:'perrun-sales-close', pickup:'perrun-kit-requirements'}[topic] || null;
}

function continueEventQuestion(body, messages) {
  const previous = Array.isArray(messages) ? messages.filter(item =>
    ['visitor','ai_generated','human_operator'].includes(item.provenance)).slice(-3) : [];
  const [original, clarification, current] = previous;
  if (original?.provenance !== 'visitor' || clarification?.provenance !== 'ai_generated' ||
    current?.provenance !== 'visitor' || current.body !== body) return null;
  const originalWords = normalize(original.body || '');
  const topic = topicFor(originalWords);
  if (!topic || !['','Claro. ','Además: ','Te cuento: '].some(prefix => clarification.body === prefix + questions[topic])) return null;
  const answer = normalize(body).replace(/[^a-z0-9 ]/g,' ').trim().replace(/\s+/g,' ');
  const race = answer.match(/^(?:(?:es para|me refiero a|la de|para) )?(perrun|cascanueces|axolote)(?: (?:run|night run|2027|2026)){0,2}$/)?.[1];
  const kit = /\b(?:requisitos?|documentos|necesito llevar)\b/.test(originalWords) ? 'requisitos entrega del kit' : 'entrega del kit';
  const query = {sales:'hasta cuando venden boletos', pickup:'puede alguien mas recoger mi kit', kit}[topic];
  return {message:race ? query + ' ' + race : body, allowEventClarification:false};
}

module.exports = {questions, handoff, eventGuidance, continueEventQuestion};
