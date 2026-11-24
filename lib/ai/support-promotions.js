'use strict';

// Scope and date confirmed by the project owner on 2026-11-24 (CDMX).
// The date is day-granular. No exact closing hour or bank details were confirmed.
const cascanuecesDuo=Object.freeze({
  race:'cascanueces-run',distance:'5K',quantity:2,amountMXN:850,
  confirmedFromDate:'2026-11-24',lastConfirmedDate:'2026-11-29',
  lastConfirmedDateLabel:'domingo 29 de noviembre',
  publicContact:'https://wa.me/525530790944',
});
const localCalendar=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'});

function publishedDuo(now) {
  const parts=Object.fromEntries(localCalendar.formatToParts(new Date(now)).map(({type,value})=>[type,value]));
  const date=parts.year+'-'+parts.month+'-'+parts.day;
  if(date<cascanuecesDuo.confirmedFromDate) return 'unknown';
  return date>cascanuecesDuo.lastConfirmedDate ? 'expired' : 'active';
}

function isDuoInformation(text) {
  return text.startsWith('La promoción Dúo 5K de Cascanueces') || text.startsWith('Esa promoción Dúo 5K de Cascanueces') ||
    text.startsWith('No, la promoción Dúo 5K de Cascanueces');
}

function renderDuoInformation(now,{asksForCheckout,asksForTransferDetails}={}) {
  const status=publishedDuo(now);
  if(status==='unknown') return 'No tengo confirmadas las condiciones de la promoción Dúo 5K de Cascanueces para esa fecha.';
  if(status==='expired') return 'Esa promoción Dúo 5K de Cascanueces tenía vigencia hasta el '+cascanuecesDuo.lastConfirmedDateLabel+
    '. No tengo confirmada una extensión ni otra promoción.';
  const price='$'+cascanuecesDuo.amountMXN+' MXN por '+cascanuecesDuo.quantity+' inscripciones';
  if(!asksForCheckout && asksForTransferDetails) return 'La promoción Dúo 5K de Cascanueces se tramita solo por transferencia. Pide las instrucciones de pago en el WhatsApp oficial: '+cascanuecesDuo.publicContact;
  const checkout=asksForCheckout ? 'No, la promoción Dúo 5K de Cascanueces no se compra desde este chat ni en el checkout web. Son '+price+' y se tramita solo por transferencia.' :
    'La promoción Dúo 5K de Cascanueces cuesta '+price+' y se tramita solo por transferencia, no en el checkout web.';
  return checkout+' La fecha confirmada de vigencia es hasta el '+cascanuecesDuo.lastConfirmedDateLabel+
    '. Escribe al WhatsApp oficial para que el equipo te indique cómo tramitarla: '+cascanuecesDuo.publicContact;
}

module.exports={cascanuecesDuo,publishedDuo,isDuoInformation,renderDuoInformation};
