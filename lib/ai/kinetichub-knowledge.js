'use strict';

const event = require('../../perrun-event-data');

const source = (id, topic, text, path, anchor, expiresAt = null) =>
  Object.freeze({id, topic, text, repositoryPath:path, anchor, expiresAt});

const kitDate = new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(event.pickup.date+'T12:00:00Z'));
const version = 'kinetichub-kb-2026-11-19-v1';
const sources = Object.freeze([
  source('perrun-distances', 'races', 'Perrun 2027 tiene recorridos recreativos de ' + event.distances.join(', ') + ', sin premiación.',
    'perrun-event-data.js', 'distances; recreational; awards', '2027-02-15T06:00:00Z'),
  source('perrun-starts', 'races', 'Perrun 2027: ' + Object.entries(event.starts).map(([d,t])=>d+' a las '+t+' h').join(', ') + '.',
    'perrun-event-data.js', 'starts', '2027-02-15T06:00:00Z'),
  source('perrun-kit', 'kits', 'La entrega de kits de Perrun es el ' + kitDate + ', de ' + event.pickup.start+' a '+event.pickup.end+' h, en el '+event.pickup.location+'. El punto exacto está por confirmar.',
    'perrun-landing-data.js', 'packetPickup; perrun-event-data.js pickup', '2027-02-14T06:00:00Z'),
  source('perrun-registration', 'registration', 'La inscripción de Perrun incluye 1 participante humano y 1 perro.',
    'perrun-landing-data.js', 'FAQ: Qué incluye mi inscripción', '2027-02-15T06:00:00Z'),
  source('contact-chat', 'contact', 'Puedes abrir una conversación de soporte en la página de Atención de Kinetic Hub: /atencion.html.',
    'contacto.html', 'Abrir conversación'),
]);

const gaps = Object.freeze([
  'Cambios de talla, distancia, nombre y titularidad: no hay una política pública consolidada aprobada para este piloto.',
  'No se responde sobre pagos, inscripciones individuales ni datos personales.',
  'Cascanueces y otros eventos: no se han incorporado fuentes autorizadas en este piloto.',
  'No se publican precios ni disponibilidad dinámica.'
]);

module.exports = Object.freeze({version,sources,gaps});
