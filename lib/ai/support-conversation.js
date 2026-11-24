'use strict';

const {events} = require('../../event-catalog');
const {MAX_TICKETS_PER_ORDER} = require('../_participant-validation');
const {eventOffer,salesReply,formatAmount,conversationalPublicGuidance} = require('./support-public-guidance');
const knowledge = require('./kinetichub-knowledge');

const eventSlugs = Object.keys(events);
const distances = [...new Set(Object.values(events).flatMap(event => event.distances))];
const shortReplies = ['assistant-greeting','assistant-identity','assistant-farewell'];
const publicSources = knowledge.sources.filter(source => ['payments','kits','races','contact'].includes(source.topic) ||
  ['registration-self-service','registration-account-only','perrun-registration','perrun-two-dogs'].includes(source.id));
const publicIds = publicSources.map(source => source.id);
const choice = values => ({enum:values,type:values.includes(null) ? ['string','null'] : 'string'});
const quantity = {type:'integer',minimum:1,maximum:100};
const schema = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const tool = (name, description, properties) => ({type:'function',name,description,strict:true,parameters:schema(properties)});
const conversationTools = Object.freeze([
  tool('consultar_carreras','Carreras, distancias, etapa y precio. Con null lista las carreras.',{
    carrera:choice([...eventSlugs,null]),
  }),
  tool('cotizar_inscripcion','Total base y límite por operación. Distancia desconocida: null.',{
    carrera:choice(eventSlugs),cantidad:quantity,distancia:choice([...distances,null]),
  }),
  tool('informacion_publica','Política aprobada. Inscripción propia: registration-self-service.',{
    fuente:choice(publicIds),
  }),
  tool('ruta_inscripcion','Ruta y pasos. entrada: transición breve sin hechos, p. ej. Te guío paso a paso, o null.',{
    carrera:choice([...eventSlugs,null]),cantidad:{...quantity,type:['integer','null']},entrada:{type:['string','null']},
  }),
]);

const clarificationKinds=['carrera','cantidad','distancia','duo','modalidad','tema'];
const decisionFormat = {format:{type:'json_schema',name:'decision_conversacion',strict:true,schema:schema({
  decision:choice(['responder','aclarar','transferir']),
  aclaracion:choice([...clarificationKinds,null]),
  fuente:choice([...shortReplies,null]),
})}};

const instructions = [
  'Asistente de KineticHub, en español. Solo recibes datos estructurados. Retoma carrera, cantidad, distancia e intención del historial.',
  'Si falta una carrera para comprar, elige aclaracion carrera. inscripcion_pasos significa que pide pasos, no otra aclaración si ya conoces la carrera. Para duo_ambiguo elige aclaracion duo. No inventes promociones.',
  'Para hechos y acciones públicas usa una sola herramienta. El servidor presenta su resultado. Para una inscripción propia usa registration-self-service.',
  'Jamás pidas datos personales, confirmes compras o inventes precios, descuentos, requisitos o enlaces.',
  'Transfiere si piden a una persona o precisan una gestión fuera del autoservicio. Si faltan datos, aclara primero.',
  'Usa fuente para saludos, identidad y despedidas. Para aclarar selecciona un tipo, no redactes texto. Para mensaje desconocido elige tema. Otros campos: null.',
].join(' ');

const MAX_PAYLOAD_BYTES = 4500 - 256; // Same bound and overhead as the existing conversational evaluator.
const privateFields = /\b(?:me llamo|soy (?:el |la )?(?:titular|comprador[a]?)|mi (?:nombre|apellido|domicilio|direcci[oó]n|contrase[nñ]a|tel[eé]fono|referencia) (?:es|son)|nombre completo|fecha de nacimiento)\b[^.!?]*/gi;
const privateIdentifiers = /\b(?:folio|dorsal|bib|cvv|cvc|curp|rfc|contrase[nñ]a|clave|referencia|n[uú]mero de corredor)\s*(?:es\s+|[:=#]\s*)[^.!?]*/gi;
const redact = text => text.normalize('NFKC')
  .replace(/[\p{Cc}\p{Cf}]/gu,' ')
  .replace(/(?:https?:\/\/|www\.)[^\s]+/gi,'[enlace omitido]')
  .replace(/[^\s<>,;:]+@[^\s<>,;:]+/g,'[correo omitido]')
  .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b[a-z0-9_-]{24,}\b/gi,'[identificador omitido]')
  .replace(/(?:\+?\d[\s().-]*){7,}\d?/g,'[número omitido]')
  .replace(privateFields,'[dato personal omitido]')
  .replace(privateIdentifiers,'[identificador omitido]')
  .replace(/\s+/g,' ').trim().slice(0,300);

function recentConversation(messages, message) {
  const visible = Array.isArray(messages) ? messages.filter(item => typeof item.body === 'string' && (
    (item.author === 'visitor' && item.provenance === 'visitor') ||
    (item.author === 'agent' && ['ai_generated','automatic_ack'].includes(item.provenance))
  )) : [];
  // The claimed write is also the last visible message. Never use a mismatched snapshot as context.
  const latest = visible.at(-1);
  const history = latest?.author === 'visitor' && latest.body === message
    ? visible.slice(-7,-1).map(item => ({role:item.author === 'visitor' ? 'visitante' : 'asistente',text:redact(item.body)}))
    : [];
  return {historial:history, mensaje:redact(message)};
}

// Nothing below copies an arbitrary substring into the provider request.
// Every string is a constant or a public catalog enum; quantities are bounded ticket counts.
function publicTurnFacts(body,role) {
  const s=normalizeQuery(body);
  if(/\b(?:ignora|ignore|desobedece|instrucciones|prompt|jailbreak|override|bypass|revela)\b/.test(s)){
    return {rol:role,intencion:'desconocido',carrera:null,cantidad:null,distancia:null};
  }
  const named=eventSlugs.filter(slug=>new RegExp('\\b'+slug.split('-')[0]+'\\b').test(s));
  const carrera=named.length===1?named[0]:null;
  const matchedD=[...new Set([...s.matchAll(/\b(1|3|5|10)\s*k\b/g)].map(x=>Number(x[1])+'K'))];
  const distancia=matchedD.length===1 && distances.includes(matchedD[0]) ? matchedD[0] : null;
  const numberWords={un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10};
  const quantityMatch=s.match(/(?<![\w.#/\-])\b([1-9]\d?|100|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:boletos?|lugares?|entradas?|inscripciones?)\b/);
  const q=quantityMatch ? numberWords[quantityMatch[1]] ?? Number(quantityMatch[1]) : null;
  const cantidad=Number.isInteger(q)&&q>=1&&q<=100?q:null;
  const has=(pattern)=>pattern.test(s);
  let intencion='desconocido';
  if(role==='asistente') {
    if(s.startsWith('la etapa vigente de ')) intencion='cotizacion';
    else if(has(/\b(?:que|cual) carrera\b/)) intencion='pregunta_carrera';
    else if(has(/\b(?:dos boletos|promocion)\b/) && has(/\bduo|especial\b/)) intencion='pregunta_duo';
    else if(s.startsWith('la convocatoria de cascanueces contempla')) intencion='menores';
    else if(has(/\bmis carreras\b/)) intencion='autoservicio_registro';
    else if(has(/\bagregar ticket\b/)) intencion='inscripcion_pasos';
    else if(has(/\bequipo de atencion\b/)) intencion='atencion_humana';
  } else if(explicitHumanRequest(body)) intencion='atencion_humana';
  else if(has(/\b(?:alguien|una persona|un humano|un asesor|un operador)\b/) && has(/\b(?:atiend\w*|hablar|transfier\w*)\b/)) intencion='atencion_humana';
  else if(hasDuoPromo(s)) intencion='promo_transferencia';
  else if(has(/\bduo\b/)) intencion='duo_ambiguo';
  else if(has(/\b(?:menor(?:es)?|nin[oa]s?|hij[oa]s?|edad minima|adolescentes?)\b/) && !has(/\b(?:pago|pague|cargo|cobro)\b/)) intencion='menores';
  else if(has(/\b(?:no|tampoco|sin)\b/) && has(/\b(?:aparece|aparecer|veo|encuentro|sale|salir|figura)\b/) &&
          has(/\b(?:inscripcion|registro|pague|pago|cargo|mis carreras|revise|cheque|consulte)\b/)) intencion='registro_no_visible';
  else if(has(/\b(?:como|donde|pasos)\b/) && has(/\b(?:agreg\w*|anad\w*|meto|metemos|compr\w*|inscri\w*|registr\w*|participantes?)\b/)) intencion='inscripcion_pasos';
  else if(has(/\b(?:kit|kits|paquete|paquetes)\b/)) intencion='kit';
  else if(has(/\b(?:oxxo|voucher)\b/)) intencion='pago_oxxo';
  else if(cantidad!==null || has(/\b(?:cuanto|precio|comprar|inscribirme)\b/)) intencion='compra';
  else if(carrera) intencion='carrera';
  else if(distancia) intencion='distancia';
  else if(has(/^[¡¿ ]*(?:hola|buenos dias|buenas tardes)[!. ]*$/)) intencion='saludo';
  else if(has(/^[¡¿ ]*(?:gracias|hasta luego|adios)[!. ]*$/)) intencion='despedida';
  else if(has(/\b(?:eres un bot|eres una ia|eres el asistente)\b/)) intencion='identidad';
  return {rol:role,intencion,carrera,cantidad,distancia};
}

function providerFacts(local) {
  return {
    actual:publicTurnFacts(local.mensaje,'visitante'),
    historial:local.historial.slice(-6).map(turn=>publicTurnFacts(turn.text,turn.role))
      .filter(turn=>turn.intencion!=='desconocido'||turn.carrera!==null||turn.cantidad!==null||turn.distancia!==null),
  };
}

const DUO_QUESTION = '¿Para qué carrera viste la promoción Dúo?';
const DUO_HANDOFF_REASON = 'confirm_duo_transfer_validity';
const DUO_HANDOFF = 'Las promociones mensuales se gestionan por transferencia y no se aplican en el checkout web. Le voy a pedir al equipo que confirme si la promoción Dúo sigue vigente para esa carrera y, si aplica, cómo hacer el trámite por el canal oficial.';
const normalizeQuery = text => text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();

// Require actual commercial intent before treating a spelling variant as a named promotion.
const duoPromoCue = /\b(?:promocion(?:es)?|promo|whats(?:\s*app)?|transferencia|850|vigente|vigencia)\b/;
const strongDuoPromoCue = /\b(?:promocion(?:es)?|promo|transferencia|whats(?:\s*app)?)\b/;
const hasDuoPromo = text => (/\bduo\b/.test(text) && duoPromoCue.test(text)) ||
  (/\bd(?:u{2,}o+|uo{2,})\b/.test(text) && strongDuoPromoCue.test(text) &&
  /\b(?:850|oferta|anunci\w*|vigente|vigencia|sigue|mensual|transferencia)\b/.test(text));

function regularAfterDuoPromo(history,message) {
  const assistant=history.at(-1), visitor=history.at(-2);
  if (assistant?.role!=='asistente' || visitor?.role!=='visitante' ||
      (assistant.text!==DUO_QUESTION && !hasDuoPromo(normalizeQuery(visitor.text)))) return null;
  const input=normalizeQuery(message);
  const remainder=input.match(/^[¡¿ ]*(?:(?:mejor\s+)?(?:olvida(?:te)?(?:\s+de)?|deja(?:mos)?(?:\s+de\s+lado)?|descarta(?:mos)?)\s+(?:esa|esta|la)\s+(?:promo(?:cion)?|oferta|duo)|no\s+(?:quiero|busco|me\s+interesa)\s+(?:esa|esta|la|una)\s+(?:promo(?:cion)?|oferta|duo))\s*[,.;:]\s*(.+)$/u)?.[1];
  return remainder && /\b(?:quiero|quisiera|necesito|cuanto|precio|comprar)\b/.test(remainder) ? remainder : null;
}

function duoPromoStep(messages, message) {
  const {historial, mensaje} = recentConversation(messages,message);
  const current = normalizeQuery(mensaje);
  const last = historial.at(-1);
  const race = value => /\b(?:cascanueces|axolote|perrun)\b/.test(value);
  const priorVisitor = historial.filter(turn=>turn.role==='visitante').at(-1);
  const previous = normalizeQuery(priorVisitor?.text || '');
  if (regularAfterDuoPromo(historial,mensaje)) return null;
  const active = hasDuoPromo(current);
  const clarifiesPromotion = (/\bduo\b/.test(previous) || hasDuoPromo(previous)) &&
    /^(?:si[,. ]+)?(?:es |era |me refiero a )?(?:la |una )?(?:promo|promocion)(?:[ ,.].*)?$/u.test(current);
  if (active || clarifiesPromotion) {
    return race(current) || race(previous) ? 'handoff' : 'ask-race';
  }
  if (last?.role==='asistente' && last.text===DUO_QUESTION &&
      /^(?:(?:es |era )?para )?(?:(?:la |el )?(?:carrera )?de )?(?:cascanueces(?: run)?|axolote(?: night run)?|perrun)(?: (?:run )?20\d\d)?(?: (?:1k|3k|5k|10k))?[.!]?$/u.test(current)) {
    return 'handoff';
  }
  return null;
}

const MINOR_RACE_QUESTION = '¿Para qué carrera quieres consultar si pueden participar menores de edad?';
// Cascanueces official convocatoria, p. 1, CATEGORÍAS:
// /assets/events/cascanueces-run/legal/Cascanueces%20Run_convocatoria.pdf
const CASCANUECES_MINOR_GUIDANCE = 'La convocatoria de Cascanueces contempla la participación de menores y pide que la carta de exoneración vaya firmada por su madre, padre o tutor legal. No publica una edad mínima ni una restricción de edad por distancia. Eso no confirma la elegibilidad de cada participante; el equipo de atención puede aclarar tu caso.';
const OTHER_RACE_MINOR_GUIDANCE = 'Para esa carrera no tengo confirmada la regla de edad. El equipo de atención puede verificar si pueden participar menores y qué requisitos les piden. https://www.kinetichub.com.mx/atencion.html';

function minorRaceGuidance(messages,message) {
  const {historial, mensaje} = recentConversation(messages,message);
  if (reviewedFollowup(historial,mensaje)) return null;
  const visitor = normalizeQuery(mensaje);
  const races = text => [...new Set(text.match(/\b(?:cascanueces|axolote|perrun|santa run|trail|triatlon|ride|family run)\b/g) || [])];
  const minor = /\b(?:menor(?:es)?|nin[oa]s?|hij[oa]s?|pequen[oa]s?|adolescentes?|edad minima|(?:[1-9]|1[0-7]) anos)\b/;
  const eligibility = /\b(?:particip\w*|corr[ea]\w*|edad minima|permit\w*|acept\w*|admit\w*|requisit\w*|categoria|pued\w*\s+inscri\w*)\b/;
  const explicitRaces = races(visitor);
  const shortRaceAnswer = /^(?:(?:es |era )?para )?(?:(?:la |el )?(?:carrera )?de )?(?:cascanueces(?: run)?|axolote(?: night run)?|perrun|santa run|trail|triatlon|ride|family run)(?: (?:run )?20\d\d)?(?: (?:1k|3k|5k|10k))?[.!]?$/u;
  const last = historial.at(-1);
  const raceReply = last?.role==='asistente' && last.text===MINOR_RACE_QUESTION && shortRaceAnswer.test(visitor);
  if (!raceReply && !(minor.test(visitor) && eligibility.test(visitor))) return null;
  if (explicitRaces.length>1) return MINOR_RACE_QUESTION;
  const previous = historial.filter(turn=>turn.role==='visitante').map(turn=>normalizeQuery(turn.text)).reverse()
    .find(text=>races(text).length);
  const known = explicitRaces.length ? explicitRaces : races(previous || '');
  if (!known.length) return MINOR_RACE_QUESTION;
  if (known.length>1) return MINOR_RACE_QUESTION;
  return known[0]==='cascanueces' ? CASCANUECES_MINOR_GUIDANCE : OTHER_RACE_MINOR_GUIDANCE;
}

function explicitHumanRequest(message) {
  return /^(?:hola[, ]+)?(?:[¡¿]\s*)?(?:(?:quiero|quisiera|necesito|puedo) hablar con (?:alguien|una persona|un humano|un asesor|un operador|el equipo de atencion)|(?:solicito|quiero|necesito|quisiera) atencion humana)\b/.test(normalizeQuery(message));
}

function reviewedFollowup(history,message) {
  const input=normalizeQuery(message);
  const last=history.at(-1);
  if(last?.role!=='asistente') return false;
  if (last.text===redact(CASCANUECES_MINOR_GUIDANCE) &&
      !/\b(?:perrun|axolote|santa run|trail|tri(?:atlon)?|ride|family run|kits?|paquetes?|precio|boletos?|costo|entrega|horario|salida|ruta)\b/.test(input)) {
    const ellipticalDistance = /^[¿¡ ]*(?:y\s+)?(?:(?:en|para)\s+)?(?:(?:la|el)\s+de\s+|(?:la\s+)?distancia\s+(?:de\s+)?)?(?:5|10)\s*k(?:\s+tambien)?[?!. ]*$/u.test(input);
    const explicitEligibility = /\b(?:particip\w*|corr[ea]\w*|inscri\w*|permit\w*|acept\w*)\b/.test(input) &&
      /\b(?:los dos|las dos|ambos|ambas|5k|10k|edad|menor(?:es)?|nin[oa]s?|hij[oa]s?)\b/.test(input);
    if(ellipticalDistance || explicitEligibility) return true;
  }
  return last.text===redact(knowledge.sources.find(s=>s.id==='registration-self-service').text) &&
    /\b(?:ya revise|ya consulte|ya cheque|revise|consulte|cheque|mis carreras|tampoco|sigue sin)\b/.test(input) &&
    /\b(?:no|tampoco|sin)\b.{0,35}\b(?:aparece|aparecer|veo|encuentro|figura|sale|salir)\b/.test(input);
}

function scopedConversationalGuidance(messages,message,now) {
  const {historial,mensaje}=recentConversation(messages,message);
  if (reviewedFollowup(historial,mensaje)) return null;
  return conversationalPublicGuidance(historial,regularAfterDuoPromo(historial,mensaje) || mensaje,now);
}

function decodedJson(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text,'utf8') > 1500) return null;
  try { const data = JSON.parse(text); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
  catch { return null; }
}

const exact = (object, keys) => object && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object,key));
const knownEvent = value => eventSlugs.includes(value);
const validQuantity = value => Number.isInteger(value) && value >= quantity.minimum && value <= quantity.maximum;
const reply = (response, id, reason) => ({decision:'respond',response,sources:[{id}],reason});
const invalid = () => ({decision:'escalate',reason:'invalid_provider_output'});
const clarification = question => reply(question,'conversation-clarification','clarification');

function catalogResult(carrera, now) {
  return (carrera === null ? eventSlugs : [carrera]).map(slug => {
    const {event,stage,route} = eventOffer(slug,now);
    const status = route ? 'Inscripciones abiertas, etapa ' + stage.label + '. ' + formatAmount(stage.amount) + ' por lugar.' :
      stage?.isOpen ? 'Compra en línea no disponible.' : 'Inscripciones cerradas.';
    return event.name + ' (' + event.distances.join(', ') + '). ' + status;
  }).join('\n');
}

function registrationResult(carrera, cantidad, now) {
  const steps = 'En el checkout, usa «+ Agregar ticket» y completa los datos de cada participante.';
  if (carrera === null) return 'En Cascanueces y Axolote puedes agregar hasta ' + MAX_TICKETS_PER_ORDER +
    ' boletos por operación cuando las inscripciones están abiertas. ' + steps +
    ' Para Perrun, haz una inscripción por persona. ¿Para qué carrera quieres los boletos?';
  const {event,stage,route,maxPerOrder} = eventOffer(carrera,now);
  if (!route) return stage?.isOpen ? 'La compra en línea de esta carrera no está disponible ahora.' :
    'Las inscripciones de ' + event.name + ' están cerradas en este momento.';
  const limit = maxPerOrder === 1 ? 'Perrun admite una persona por inscripción. Si van varias, inscribe a cada una por separado.' :
    (cantidad === null || cantidad > 1 ? steps + ' El límite es de ' + maxPerOrder + ' boletos por operación.' : '');
  return ('Elige una distancia en la página de ' + event.name + ' para empezar. ' + limit).trim() + ' ' + route;
}

// This is intentionally an acknowledgment/transition grammar, not a generator of facts.
function checkedRouteIntro(value) {
  if(typeof value!=='string' || value.length>78 || /[\r\n\p{Cc}\p{Cf}]/u.test(value)) return '';
  const intro=value.trim().normalize('NFC');
  const tone=normalizeQuery(intro);
  const allowed=/^(?:(?:claro|con gusto|por supuesto|va)[,.!]?(?: |$))?(?:(?:(?:te (?:explico|muestro|comparto|guio)|vamos|veamos)(?: (?:a verlo|paso a paso|como (?:agregar|anadir|registrar|inscribir) (?:a (?:los|las) (?:participantes|personas)|(?:tus |los |las )?(?:boletos|entradas|participantes))|por donde empezar|los pasos(?: para (?:continuar|inscribirte))?))|(?:aqui tienes|te dejo) los pasos|(?:asi puedes|aqui te explico como) (?:agregar (?:tus |los )?boletos|agregar a (?:los participantes|las personas)|continuar con (?:el registro|la inscripcion))))[.!]?$/u;
  if(!allowed.test(tone)) return '';
  return /[.!]$/.test(intro) ? intro + ' ' : intro + '. ';
}

function enrollmentRouteFallback(messages,message,now) {
  const {historial,mensaje}=recentConversation(messages,message);
  const input=normalizeQuery(mensaje);
  if(explicitHumanRequest(mensaje) || /\b(?:duo|promo(?:cion)?|transferencia|cupon|descuento|pago|cobro|oxxo|kit|no quiero|no necesito|cancelar)\b/.test(input)) return null;
  if(!/\b(?:como|donde)\b.*\b(?:agreg\w*|anad\w*|registr\w*|inscrib\w*|compr\w*|meto|metemos|meten)\b/.test(input) ||
     !/\b(?:boletos?|lugares?|entradas?|personas?|participantes?|otros|otras|demas|los|las)\b/.test(input)) return null;
  const prior=historial.at(-1);
  if(prior?.role!=='asistente') return null;
  const pinnedRace=eventSlugs.find(slug=>prior.text.startsWith('La etapa vigente de '+events[slug].name+' es ') &&
    prior.text.includes('[enlace omitido]'));
  if(!pinnedRace) return null;
  const otherRace=eventSlugs.some(slug=>slug!==pinnedRace&&input.includes(slug.split('-')[0]));
  return otherRace ? null : registrationResult(pinnedRace,null,now);
}

function runTool(name, args, now) {
  if (name === 'consultar_carreras' && exact(args,['carrera']) && (args.carrera === null || knownEvent(args.carrera))) {
    return reply(catalogResult(args.carrera,now),'conversation-catalog','catalog_lookup');
  }
  if (name === 'cotizar_inscripcion' && exact(args,['carrera','cantidad','distancia']) && knownEvent(args.carrera) && validQuantity(args.cantidad)) {
    const {event} = eventOffer(args.carrera,now);
    if (args.distancia !== null && !event.distances.includes(args.distancia)) {
      return clarification('¿Qué distancia prefieres para ' + event.name + ', ' + event.distances.join(' o ') + '?');
    }
    return reply(salesReply(args.carrera,'purchase',args.cantidad,now),'conversation-quote','registration_quote');
  }
  if (name === 'informacion_publica' && exact(args,['fuente']) && publicIds.includes(args.fuente)) {
    const source = publicSources.find(entry => entry.id === args.fuente);
    return !source.expiresAt || now < Date.parse(source.expiresAt)
      ? reply(source.text,source.id,'public_information')
      : clarification('¿Quieres que el equipo de atención te confirme esa información?');
  }
  if (name === 'ruta_inscripcion' && (exact(args,['carrera','cantidad','entrada']) || exact(args,['carrera','cantidad'])) && (args.carrera === null || knownEvent(args.carrera)) &&
      (args.cantidad === null || validQuantity(args.cantidad))) {
    return reply(checkedRouteIntro(args.entrada) + registrationResult(args.carrera,args.cantidad,now),'conversation-registration-route','registration_route');
  }
  return invalid();
}

function publicClarification(kind,facts) {
  if(!clarificationKinds.includes(kind)) return null;
  const context=[facts.actual,...facts.historial.slice().reverse()];
  const visitor=context.filter(x=>x.rol==='visitante');
  const count=visitor.find(x=>x.cantidad!==null)?.cantidad;
  const carrera=visitor.find(x=>x.carrera!==null)?.carrera;
  if(kind==='carrera') {
    if(carrera) return '¿En qué te gustaría que te ayude con esa carrera?';
    return count>1 ? '¿Para qué carrera quieres los '+count+' boletos?' : '¿Para qué carrera es tu consulta?';
  }
  if(kind==='cantidad') return '¿Cuántos boletos necesitas?';
  if(kind==='distancia') return carrera ? '¿Qué distancia te interesa, '+events[carrera].distances.join(' o ')+'?' : '¿Para qué carrera y distancia es tu consulta?';
  if(kind==='duo') return '¿Quieres agregar dos boletos o buscas información sobre una promoción?';
  if(kind==='modalidad') return '¿Buscas el precio de los boletos o los pasos para inscribirte?';
  return '¿Sobre qué carrera o inscripción quieres consultar?';
}

function decode(result, now, facts) {
  if (result?.status !== 'completed' || !Array.isArray(result.output) || result.output.length !== 1) return invalid();
  const [item] = result.output;
  if (item?.type === 'function_call' && (item.status === undefined || item.status === 'completed')) {
    return runTool(item.name,decodedJson(item.arguments),now);
  }
  if (item?.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || item.content?.length !== 1 ||
      item.content[0]?.type !== 'output_text') return invalid();
  const data = decodedJson(item.content[0].text);
  if (!exact(data,['decision','aclaracion','fuente'])) return invalid();
  if (data.decision === 'transferir' && data.aclaracion === null && data.fuente === null) return {decision:'escalate',reason:'needs_operator'};
  if (data.decision === 'responder' && data.aclaracion === null && shortReplies.includes(data.fuente)) {
    const source = knowledge.sources.find(entry => entry.id === data.fuente);
    return reply(source.text,source.id,'public_information');
  }
  if (data.decision === 'aclarar' && data.fuente === null) {
    const question=publicClarification(data.aclaracion,facts);
    if(question) return clarification(question);
  }
  return invalid();
}

async function evaluateConversation({provider,model,tenantId,message,messages,now=Date.now,timeoutMs=8000}) {
  if (tenantId==='kinetichub' && duoPromoStep(messages,message)==='handoff') {
    return {decision:'escalate',reason:DUO_HANDOFF_REASON};
  }
  const local = recentConversation(messages,message);
  if (tenantId==='kinetichub' && (explicitHumanRequest(local.mensaje) || reviewedFollowup(local.historial,local.mensaje))) return {decision:'escalate',reason:'needs_operator'};
  if (!local.mensaje) return {decision:'escalate',reason:'invalid_input'};
  const input=providerFacts(local);
  const payload = {model,instructions,input:JSON.stringify(input),tools:conversationTools,parallel_tool_calls:false,
    text:decisionFormat,store:false,max_output_tokens:192};
  const size = () => Buffer.byteLength(JSON.stringify(payload),'utf8');
  while (size() > MAX_PAYLOAD_BYTES && input.historial.length) {
    input.historial.shift();
    payload.input = JSON.stringify(input);
  }
  if (size() > MAX_PAYLOAD_BYTES) return {decision:'escalate',reason:'input_limit'};
  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise(resolve => { timer = setTimeout(() => { resolve(null); controller.abort(); },timeoutMs); });
    const response = await Promise.race([deadline,provider(payload,{tenantId,signal:controller.signal})]);
    if(!response) return {decision:'escalate',reason:'provider_timeout'};
    const at=now(), decision=decode(response,at,input);
    const pinned=decision.decision==='respond' && enrollmentRouteFallback(messages,message,at);
    if(pinned) {
      const url=pinned.match(/https:\/\/\S+$/u)?.[0];
      const expectedSteps='«+ Agregar ticket»';
      if(decision.reason!=='registration_route' || (url ? !decision.response.endsWith(url) : decision.response!==pinned) ||
         (pinned.includes(expectedSteps) && !decision.response.includes(expectedSteps))) {
        return reply(pinned,'conversation-registration-route','registration_route');
      }
    }
    return decision;
  } catch { return {decision:'escalate',reason:'provider_error'}; }
  finally { clearTimeout(timer); }
}

module.exports = {conversationTools,evaluateConversation,enrollmentRouteFallback,explicitHumanRequest,scopedConversationalGuidance,minorRaceGuidance,duoPromoStep,DUO_QUESTION,DUO_HANDOFF,DUO_HANDOFF_REASON};
