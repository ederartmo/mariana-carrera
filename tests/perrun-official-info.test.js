'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const event = require('../perrun-event-data');
const { renderConfirmation, WAIVER_URL } = require('../lib/_perrun-confirmation');

test('Official pickup changes without changing race or venue', () => {
  assert.equal(event.pickup.date, '2027-02-13');
  assert.equal(event.pickup.start, '11:00');
  assert.equal(event.pickup.end, '17:00');
  assert.match(event.pickup.dateLabel, /13 de febrero de 2027/);
  assert.equal(event.date.iso, '2027-02-14');
  assert.equal(event.pickup.location, 'Bosque de San Juan de Aragón');
});

test('Landing renders central pickup data and both official downloads', () => {
  let html;
  const root = {style:{setProperty(){}}, classList:{add(){}}, dataset:{}, set innerHTML(v){html=v;}};
  const c = {Date, Intl, URLSearchParams, setInterval:()=>1, clearInterval(){}, document:{querySelector:()=>root}};
  vm.createContext(c);
  for (const file of ['perrun-stage-config.js','perrun-event-data.js','perrun-landing-data.js','event-landing.js']) vm.runInContext(fs.readFileSync(file,'utf8'),c);
  c.EventLanding({root,event:c.KineticHubPerrunLanding});
  assert.match(html, /13 de febrero de 2027/);
  assert.match(html, /11:00–17:00/);
  assert.match(html, /punto exacto por confirmar/i);
  assert.match(html, /convocatoria-perrun-2027.pdf/);
  assert.match(html, /exoneracion-perrun-2027.pdf/);
  assert.doesNotMatch(html, /12 de febrero de 2027|10:00–16:00/);
});

test('HTML and text confirmations preserve participant, dogs, payment and waiver', () => {
  const mail = renderConfirmation({event_slug:event.slug,payment_status:'paid',registration_status:'active',bib_number:2,full_name:'Fixture Owner',distance:'3K',shirt_size:'M',amount_paid:450,dogs:[{dog_index:1,dog_name:'Luna',dog_size:'S',dog_weight_kg:10,engraving_free:true}]});
  for (const part of [mail.html, mail.text]) {
    for (const expected of ['Fixture Owner','3K','Luna','450.00',WAIVER_URL,'13 de febrero de 2027','11:00–17:00','14 de febrero de 2027']) assert.ok(part.includes(expected), expected);
    assert.doesNotMatch(part, /12 de febrero de 2027|10:00–16:00/);
  }
  assert.match(mail.text, /BIB #002/);
  assert.match(WAIVER_URL, /exoneracion-perrun-2027.pdf\?v=b5f732a05e49/);
});

test('Official downloads use hash versions without changing cache headers', () => {
  const config = JSON.parse(fs.readFileSync('vercel.json','utf8'));
  assert.ok(config.headers.every(rule => rule.headers.every(header => !/cache-control/i.test(header.key))));
  assert.equal(new URL(WAIVER_URL).pathname, '/assets/events/perrun-2027/docs/exoneracion-perrun-2027.pdf');
  const bytes = fs.readFileSync('assets/events/perrun-2027/docs/exoneracion-perrun-2027.pdf');
  assert.equal(new URL(WAIVER_URL).searchParams.get('v'), createHash('sha256').update(bytes).digest('hex').slice(0,12));
});

for (const [name,hash] of [['exoneracion','b5f732a05e49bc85db51f92d2db69a7d2cbe19ef1310e540b5b4d747ad3f0d26'],['convocatoria','efab6382745e5c1850c6ab62a46851ebdb60de1286e1c6b5facbb99a193f8a39']]) test(name+' keeps official bytes in source and public', () => {
  const path = 'assets/events/perrun-2027/docs/'+name+'-perrun-2027.pdf';
  const source = fs.readFileSync(path);
  assert.equal(createHash('sha256').update(source).digest('hex'),hash);
  assert.deepEqual(fs.readFileSync('public/'+path), source);
});
