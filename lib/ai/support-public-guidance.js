'use strict';

const {events} = require('../../event-catalog');
const {MAX_TICKETS_PER_ORDER} = require('../_participant-validation');
const knowledge = require('./kinetichub-knowledge');

const publicSite = 'https://www.kinetichub.com.mx/';
const aliases = {
  'axolote-night-run': 'axolote(?: night run)?',
  'cascanueces-run': 'cascanueces(?: run)?',
  'perrun-2027': 'perrun',
};
const kitSources = {
  'axolote-night-run': 'axolote-kit-requirements',
  'cascanueces-run': 'cascanueces-kit-requirements',
  'perrun-2027': 'perrun-kit-requirements',
};
const quantityWords = ['cero','un','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez'];
const ticketNouns = 'boletos?|lugares?|entradas?';
const quantityPattern = new RegExp('(?<![.\\d-])\\b(\\d+|' + quantityWords.join('|') + '|uno|una)\\s+(?:' + ticketNouns + ')\\b');
const kitQuestion = '¿Para qué carrera necesitas esa información? Así puedo indicarte los requisitos correspondientes.';
const salesQuestion = '¡Claro! 😊 ¿Para qué carrera quieres';
const salesAvailableQuestion = '¿De qué carrera quieres saber si las inscripciones siguen abiertas?';
const formatAmount = amount => '$' + amount.toLocaleString('es-MX') + ' MXN';
const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = text => normalize(text).replace(/[^a-z0-9]+/g, ' ').trim();

function eventNames(text) {
  return Object.entries(aliases).filter(([,alias]) => new RegExp('\\b' + alias + '\\b').test(text)).map(([slug]) => slug);
}

function sourceText(id, now) {
  const source = knowledge.sources.find(item => item.id === id);
  return source && (!source.expiresAt || now < Date.parse(source.expiresAt)) ? source.text : null;
}

function salesIntent(input) {
  if (/\b(?:oxxo|voucher|cobro|reembolso|no quiero|ya compre|descuento|cupon|promocion|mi inscripcion|mi boleto|segundo perro|dos perros)\b/.test(input)) return null;
  if (/\b(?:hasta cuando|fecha limite|cuando cierran)\b/.test(input)) return null;
  if (/\b(?:todavia|aun|siguen?|hay|abiertas?|cerradas?|disponibles?)\b/.test(input) &&
      /\b(?:inscripciones?|boletos?|entradas?|lugares?|inscribirme)\b/.test(input)) return 'availability';
  if (/\b(?:inscribirme|inscribo|inscribirse)\b/.test(input)) return 'purchase';
  if (/\b(?:cuanto|precio|cuestan?|compr[aoe]\w*|quiero|quisiera|necesito|adquirir)\b/.test(input) &&
      (new RegExp('\\b(?:' + ticketNouns + ')\\b').test(input) || eventNames(input).length &&
        /\b(?:cuanto (?:cuesta|sale|queda|es)|precio de)\b/.test(input))) return 'purchase';
  return null;
}

function eventOffer(slug, now) {
  if (!Object.hasOwn(events,slug)) return null;
  const event = events[slug];
  const stage = event.getStage(new Date(now));
  const route = stage?.isOpen && event.checkoutEnabled && Number.isFinite(stage.amount)
    ? publicSite + slug + '.html#modalidades' : null;
  return {event,stage,route,maxPerOrder:slug === 'perrun-2027' ? 1 : MAX_TICKETS_PER_ORDER};
}

function salesReply(slug, intent, quantity, now) {
  const {event,stage,route,maxPerOrder} = eventOffer(slug,now);
  if (!stage?.isOpen) return `Las inscripciones de ${event.name} están cerradas en este momento.`;
  if (!route) return 'Por ahora no puedo confirmar la compra en línea de esta carrera.';
  const unit = formatAmount(stage.amount);
  const registration = `La etapa vigente de ${event.name} es ${stage.label}. El precio base es ${unit} por lugar.`;
  if (quantity !== null && (!Number.isSafeInteger(quantity * stage.amount) || quantity < 1)) {
    return registration + ' ¿Cuántos lugares necesitas?';
  }
  if (slug === 'perrun-2027') {
    const limit = 'Cada inscripción admite a una persona con su perro.';
    const separate = quantity > 1 ? ` Para ${quantity} lugares, haz ${quantity} inscripciones por separado.` : '';
    const total = quantity > 1 ? ` El total base sería ${formatAmount(stage.amount * quantity)}.` : '';
    return `${registration} ${limit}${separate}${total} Elige una distancia para empezar. ${route}`;
  }
  if (quantity > maxPerOrder) {
    return `${registration} Puedes comprar de 1 a ${maxPerOrder} boletos por operación. Elige una distancia para continuar. ${route}`;
  }
  const total = quantity > 1 ? ` ${quantity} boletos suman ${formatAmount(stage.amount * quantity)}.` : '';
  const open = intent === 'availability' ? 'Las inscripciones están abiertas. ' : '';
  return `${open}${registration}${total} Elige una distancia y completa los datos en el checkout. ${route}`;
}

function paidMissingRegistration(input) {
  return /\b(?:ya pague|hice el pago|se (?:me )?(?:hizo|reflejo) el cargo|me (?:cobraron|hicieron el cargo)|se desconto|me descontaron|se reflejo (?:mi |el )?pago)\b/.test(input) &&
    /\bno\b.{0,45}\b(?:aparece|veo|encuentro|figura|sale)\b.{0,40}\b(?:inscripcion|registro|boleto)\b/.test(input) &&
    !/\b(?:oxxo|voucher|alguien|una persona|un humano|un asesor|un operador|atencion humana)\b/.test(input);
}

function conversationalPublicGuidance(history,current,now) {
  const input=words(current);
  if (paidMissingRegistration(input)) return sourceText('registration-self-service',now);
  if (/\b(?:promocion|promo|duo|descuento|cupon|transferencia)\b/.test(input)) return null;
  const choices=eventNames(input);
  const distance=input.match(/\b(?:1|3|5|10)k\b/g);
  if(choices.length!==1 || distance?.length!==1 ||
      !events[choices[0]]?.distances.includes(distance[0].toUpperCase())) return null;
  const last=history.at(-1), previous=history.at(-2);
  const raceClarification=last?.role==='asistente' && /\b(?:que|cual) carrera\b/.test(words(last.text));
  const isRaceAnswer=new RegExp('^(?:(?:es |era )?para )?(?:(?:la |el )?(?:carrera )?de )?' + aliases[choices[0]] + '(?: 202[67])? ' + distance[0] + '$').test(input);
  const origin=raceClarification && isRaceAnswer && previous?.role==='visitante' ? words(previous.text) : input;
  if(salesIntent(origin)!=='purchase' || /\b(?:promocion|promo|duo|descuento|cupon|transferencia|reembolso)\b/.test(origin)) return null;
  const specified=origin.match(quantityPattern)?.[1];
  if(specified===undefined) return null;
  const quantity=/^\d+$/.test(specified)?Number(specified):['una','uno'].includes(specified)?1:quantityWords.indexOf(specified);
  return Number.isSafeInteger(quantity)&&quantity>0 ? salesReply(choices[0],'purchase',quantity,now) : null;
}

function publicGuidance(messages, now) {
  if (!Array.isArray(messages)) return null;
  const relevant = messages.filter(item => ['visitor','automatic_ack','ai_generated','human_operator'].includes(item.provenance));
  const latest = relevant.at(-1);
  const assistant = relevant.at(-2);
  const previous = relevant.at(-3);
  if (latest?.provenance !== 'visitor' || typeof latest.body !== 'string') return null;
  const input = words(latest.body);
  if (/\b(?:ignora|ignore|override|bypass|jailbreak|prompt|instrucciones|secreto|developer|base de datos)\b/.test(input)) return null;
  if (/\b(?:atencion humana|hablar con (?:una persona|un humano|un asesor|un operador))\b/.test(input)) return null;
  if (/^(?:hola )?no (?:encuentro|veo) mi inscripcion$/.test(input)) return sourceText('registration-self-service',now);
  let intent = /\b(?:kits?|paquetes?)\b/.test(input) && /\b(?:necesito|requisitos?|documentos|llevar|alguien mas|otra persona)\b/.test(input) &&
    !/\b(?:cambiar|cambio|talla)\b/.test(input) ? 'kit' : salesIntent(input);
  let source = latest.body;
  const slugs = eventNames(input);
  if (!intent && slugs.length === 1 && previous?.provenance === 'visitor' && assistant?.provenance === 'automatic_ack' &&
      new RegExp('^(?:(?:es )?para |me refiero a |la de )?(?:la carrera (?:de )?)?' + aliases[slugs[0]] + '(?: 202[67])?$').test(input)) {
    if (assistant.body === kitQuestion) intent = 'kit';
    else if (assistant.body === salesAvailableQuestion || assistant.body.startsWith(salesQuestion)) {
      source = previous.body;
      intent = salesIntent(words(source));
    }
  }
  if (!intent) return null;
  if (intent === 'kit') return slugs.length === 1 ? sourceText(kitSources[slugs[0]],now) : kitQuestion;
  const match = normalize(source).match(quantityPattern)?.[1];
  const quantity = match === undefined ? null :
    /^\d+$/.test(match) ? Number(match) : ['una','uno'].includes(match) ? 1 : quantityWords.indexOf(match);
  if (slugs.length === 1) return salesReply(slugs[0],intent,quantity,now);
  if (intent === 'availability') return salesAvailableQuestion;
  return salesQuestion + (quantity === 3 ? ' los tres lugares?' : ' comprar boletos?');
}

module.exports = {publicGuidance,conversationalPublicGuidance,eventOffer,salesReply,formatAmount};
