'use strict';

const event = require('../../perrun-event-data');
const cascanueces = require('../../cascanueces-event-data');
const axolote = require('../../axolote-event-data');
const {questions, handoff} = require('./support-clarification');

const source = (id, topic, text, path, anchor, expiresAt = null) =>
  Object.freeze({id, topic, text, repositoryPath:path, anchor, expiresAt});

const kitDate = new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(event.pickup.date+'T12:00:00Z'));
const version = 'kinetichub-kb-2026-11-24-v8';
const salesClose = new Intl.DateTimeFormat('es-MX',{dateStyle:'long',timeZone:'America/Mexico_City'}).format(new Date(event.pricing.salesClose));
const salesTime = new Intl.DateTimeFormat('es-MX',{timeStyle:'short',hourCycle:'h23',timeZone:'America/Mexico_City'}).format(new Date(event.pricing.salesClose));
const profile = 'Inicia sesión en https://www.kinetichub.com.mx/auth.html?mode=login y abre Mis carreras en https://www.kinetichub.com.mx/perfil.html.';
const support = 'Si no aparece tu inscripción o no puedes recuperar tu referencia, solicita ayuda en https://www.kinetichub.com.mx/atencion.html.';
const publishedKit = (race) => {
  const {date,time,location}=race.packetPickup;
  return 'Entrega del kit de '+race.name+': '+date+', '+time+', en '+location.replace(/\.$/u,'')+'.';
};
const oxxoHandoff = handoff + ' Si ya pagaste, conserva tu ticket de OXXO. Si la referencia venció, no la uses. Puedes revisar el estado de tu inscripción en Mis carreras: https://www.kinetichub.com.mx/perfil.html';
const sources = Object.freeze([
  source('registration-self-service', 'registration', profile + ' Ahí puedes consultar el estado de tus inscripciones y tu número de corredor si ya fue asignado. «Pendiente de pago» significa que existe un registro, pero el pago aún no está confirmado. Si no recibiste el correo, revisa también la carpeta de spam. ' + support,
    'lib/me-registrations.js', 'getAuthenticatedUser; perfil.html: Mis carreras; script.js: formatStatus'),
  source('oxxo-registration', 'payments', 'Vamos a comprobar si tu inscripción quedó registrada. 1. Inicia sesión y abre Mis carreras. https://www.kinetichub.com.mx/auth.html?mode=login https://www.kinetichub.com.mx/perfil.html 2. Si aparece «Pendiente de pago», tu inscripción existe y el pago todavía no está confirmado. 3. Si generaste una referencia OXXO, busca el correo «Tu referencia de pago OXXO está lista», también en spam. Si no encuentras tu inscripción o tu referencia, solicita ayuda. https://www.kinetichub.com.mx/atencion.html',
    'lib/_oxxo-voucher-email.js', 'SUBJECT; perfil.html: Mis carreras; script.js: formatStatus'),
  source('oxxo-voucher', 'payments', 'Si ya generaste una referencia, busca «Tu referencia de pago OXXO está lista» en el correo que usaste en Stripe, incluida la carpeta de spam. Abre «Descargar voucher oficial» para ver la referencia y su vencimiento. Si sigue vigente, presenta el voucher en OXXO y conserva el ticket de pago. ' + support,
    'lib/_oxxo-voucher-email.js', 'renderVoucherEmail; usableVoucher'),
  source('oxxo-timing', 'payments', 'Si ya pagaste en OXXO, la confirmación puede tardar hasta 24 horas en reflejarse. Conserva tu ticket. Recibirás otro correo cuando se confirme el pago. Para consultar tu estado, abre Mis carreras en https://www.kinetichub.com.mx/perfil.html y, si después de 24 horas sigue sin confirmarse, contacta a soporte en https://www.kinetichub.com.mx/atencion.html.',
    'lib/_oxxo-voucher-email.js', 'renderVoucherEmail: notice, confirmation, ticket, support'),
  source('registration-account-only', 'registration', 'Por privacidad, no puedo confirmar inscripciones, pagos ni referencias de otra persona. Cada participante puede consultar únicamente los registros asociados a su propia cuenta. ' + profile,
    'lib/me-registrations.js', 'GET: verified email ownership'),
  source('cascanueces-kit-logistics','kits',publishedKit(cascanueces),
    'cascanueces-event-data.js','packetPickup', '2026-12-05T22:00:00Z'),
  source('axolote-kit-logistics','kits',publishedKit(axolote),
    'axolote-event-data.js','packetPickup', '2026-10-30T23:30:00Z'),
  source('cascanueces-kit-requirements', 'kits', 'La entrega del kit de Cascanueces es personal. Lleva una identificación oficial y la exoneración firmada.',
    'cascanueces-event-data.js', 'packetPickup.note', '2026-12-05T22:00:00Z'),
  source('axolote-kit-requirements', 'kits', 'Para recoger el kit de Axolote, presenta una identificación oficial y consulta la convocatoria para los lineamientos de entrega.',
    'axolote-event-data.js', 'packetPickup.note', '2026-10-30T23:30:00Z'),
  source('perrun-kit-requirements', 'kits', 'La persona titular debe acudir personalmente con su número de corredor, carnet de vacunación vigente o certificado veterinario firmado y sellado, una copia de su identificación oficial por ambos lados y la carta de exoneración firmada. La convocatoria detalla las vacunas y la desparasitación obligatorias.',
    'assets/events/perrun-2027/docs/convocatoria-perrun-2027.pdf', 'Entrega de paquetes; Mariana §5', '2027-02-14T06:00:00Z'),
  source('perrun-sales-close', 'registration', 'La fecha límite de inscripción de Perrun es el ' + salesClose + ' a las ' + salesTime + ' (hora de Ciudad de México).',
    'perrun-stage-config.js', 'SALES_CLOSE', event.pricing.salesClose),
  source('clarify-event-sales', 'conversation', questions.sales, 'lib/ai/support-clarification.js', 'questions.sales'),
  source('clarify-event-pickup', 'conversation', questions.pickup, 'lib/ai/support-clarification.js', 'questions.pickup'),
  source('clarify-event-kit', 'conversation', questions.kit, 'lib/ai/support-clarification.js', 'questions.kit'),
  source('perrun-pricing', 'registration', 'Perrun tiene precios por etapa: ' + event.pricing.stages.map(stage=>stage.label + ': $' + stage.amount + ' MXN (' + stage.period + ')').join('; ') + '. Consulta la etapa vigente y el importe en https://www.kinetichub.com.mx/perrun-2027.html antes de pagar.',
    'perrun-stage-config.js', 'PERRUN_STAGE_CATALOG; Mariana §2', event.pricing.salesClose),
  source('perrun-official-checkout', 'registration', 'Puedes verificar los datos de Perrun y abrir la inscripción desde la página oficial: https://www.kinetichub.com.mx/perrun-2027.html. El checkout en línea usa Stripe. El chat no confirma pagos ni realiza inscripciones.',
    'lib/_perrun-checkout.js', 'Stripe Checkout; Mariana §4', '2027-02-15T06:00:00Z'),
  source('perrun-venue', 'races', 'Perrun 2027 se realizará en el Bosque de San Juan de Aragón, en Gustavo A. Madero, Ciudad de México. Mapa: https://www.google.com/maps/search/?api=1&query=Bosque+de+San+Juan+de+Aragon+CDMX',
    'perrun-landing-data.js', 'location; Mariana §8', '2027-02-15T06:00:00Z'),
  source('perrun-transit', 'races', 'Para llegar al Bosque de San Juan de Aragón en Metro, revisa Bosque de Aragón y Villa de Aragón de la Línea B. El Metrobús Línea 6 también da servicio en la zona. Consulta el estado del servicio antes de salir.',
    'lib/ai/kinetichub-knowledge.js', 'Mariana §7; metro.cdmx.gob.mx/la-red/linea-b; metrobus.cdmx.gob.mx/mapas-de-sistema/mapa-linea-6', '2027-02-15T06:00:00Z'),
  source('perrun-date', 'races', 'Perrun 2027 se celebra el ' + event.date.label + '.',
    'perrun-event-data.js', 'date', '2027-02-15T06:00:00Z'),
  source('perrun-two-dogs', 'registration', 'Puedes llevar dos perros únicamente si ambos son de categoría S o M. El segundo perro cuesta $' + event.dogRules.secondDogFee + ' MXN. Si uno es L o XL, la inscripción admite un solo perro.',
    'perrun-landing-data.js', 'FAQ: ¿Puedo llevar dos perros?', '2027-02-15T06:00:00Z'),
  source('perrun-distances', 'races', 'Perrun 2027 tiene recorridos recreativos de ' + event.distances.join(', ') + ', sin premiación.',
    'perrun-event-data.js', 'distances; recreational; awards', '2027-02-15T06:00:00Z'),
  source('perrun-starts', 'races', 'Perrun 2027: ' + Object.entries(event.starts).map(([d,t])=>d+' a las '+t+' h').join(', ') + '.',
    'perrun-event-data.js', 'starts', '2027-02-15T06:00:00Z'),
  source('perrun-kit', 'kits', 'La entrega de kits de Perrun es el ' + kitDate + ', de ' + event.pickup.start+' a '+event.pickup.end+' h, en el '+event.pickup.location+'. El punto exacto está por confirmar.',
    'perrun-landing-data.js', 'packetPickup; perrun-event-data.js pickup', '2027-02-14T06:00:00Z'),
  source('perrun-registration', 'registration', 'La inscripción de Perrun incluye 1 participante humano y 1 perro. Para el participante: ' + event.humanKit.join(', ') + '. Para el perro: ' + event.dogKit.join(', ') + '.',
    'perrun-landing-data.js', 'FAQ: Qué incluye mi inscripción', '2027-02-15T06:00:00Z'),
  source('clarify-dog-distance', 'conversation', '¿Te refieres a Perrun 2027? Dime en qué carrera quieres participar para poder indicarte sus reglas. Que tu perro sea pequeño no basta para confirmar si puede correr 5 km.',
    'perrun-event-data.js', 'dogRules; distances'),
  source('assistant-greeting', 'conversation', '¿Sobre qué carrera o inscripción quieres consultar?', 'lib/ai/kinetichub-knowledge.js', 'assistant-greeting'),
  source('assistant-identity', 'conversation', 'Sí, soy el asistente virtual de KineticHub. Puedo ayudarte con información pública sobre nuestras carreras.', 'lib/ai/kinetichub-knowledge.js', 'assistant-identity'),
  source('assistant-farewell', 'conversation', '¡Gracias por escribir! Si tienes otra pregunta, aquí estoy para ayudarte.', 'lib/ai/kinetichub-knowledge.js', 'assistant-farewell'),
  source('conversation-clarification', 'trace', 'El asistente pidió una aclaración para continuar con la consulta.', 'lib/ai/support-conversation.js', 'clarificar'),
  source('conversation-catalog', 'trace', 'Consulta al catálogo y a las etapas públicas de las carreras.', 'event-catalog.js', 'getStage'),
  source('conversation-quote', 'trace', 'Cotización calculada con la etapa vigente y el límite de inscripción.', 'lib/ai/support-public-guidance.js', 'salesReply'),
  source('conversation-registration-route', 'trace', 'Ruta y pasos de inscripción de la página oficial.', 'checkout.html', 'addTicketBtn'),
  source('contact-social', 'contact', 'Puedes encontrar las redes oficiales de KineticHub en https://linktr.ee/kinetichub.', 'lib/ai/kinetichub-knowledge.js', 'Official social link supplied by the project owner'),
  source('contact-chat', 'contact', 'Puedes abrir una conversación de soporte en la página de Atención de Kinetic Hub: /atencion.html.',
    'contacto.html', 'Abrir conversación'),
]);

const gaps = Object.freeze([
  'Cambios de talla, distancia, nombre y titularidad: no hay una política pública consolidada aprobada para este piloto.',
  'El chat orienta sobre el autoservicio de pagos; el estado individual se consulta en Mis carreras y el voucher en el correo de Stripe Checkout.',
  'Las consultas de venta del chat usan el catálogo oficial antes de pasar por el evaluador de respuestas.',
]);

module.exports = Object.freeze({version,sources,gaps,oxxoHandoff});
