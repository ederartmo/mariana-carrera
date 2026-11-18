'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const event = require('../perrun-event-data');
const { renderConfirmation } = require('../lib/_perrun-confirmation');
const base = path.resolve(__dirname, '..');

function renderLanding() {
  let html;
  const root = { style: { setProperty() {} }, classList: { add() {} }, dataset: {}, set innerHTML(value) { html = value; } };
  const context = { Date, URLSearchParams, setInterval: () => 1, clearInterval() {}, document: { querySelector: () => root } };
  vm.createContext(context);
  for (const file of ['perrun-stage-config.js', 'perrun-event-data.js', 'perrun-landing-data.js', 'event-landing.js']) {
    vm.runInContext(fs.readFileSync(path.join(base, file), 'utf8'), context);
  }
  context.EventLanding({ root, event: context.KineticHubPerrunLanding });
  return html;
}

test('Perrun event config contains confirmed pickup and distance-specific starts', () => {
  assert.equal(event.pickup.date, '2027-02-13');
  assert.equal(event.pickup.start, '10:00');
  assert.equal(event.pickup.end, '16:00');
  assert.deepEqual(event.starts, { '1K': '08:00', '3K': '08:15', '5K': '08:30' });
});

test('Perrun landing renders the confirmed schedule and replaces unconfirmed departure copy', () => {
  const html = renderLanding();
  assert.match(html, /13 de febrero de 2027/);
  assert.match(html, /10:00[^<]{0,12}16:00/);
  for (const [distance, time] of [['1K', '08:00'], ['3K', '08:15'], ['5K', '08:30']]) {
    assert.match(html, new RegExp(distance + '[^<]{0,30}' + time));
  }
  assert.doesNotMatch(html, /Horario de salida por confirmar|horario de salida por distancia estÃ¡ por confirmar/);
});

test('Perrun future confirmation email includes approved pickup and staggered starts', () => {
  const result = renderConfirmation({
    event_slug: 'perrun-2027', payment_status: 'paid', registration_status: 'active', bib_number: '1',
    full_name: 'Test Runner', distance: '3K', shirt_size: 'M', amount_paid: 450,
    dogs: [{ dog_index: 1, dog_name: 'Luna', dog_size: 'S', dog_weight_kg: 8, engraving_free: true }],
  });
  assert.match(result.text, /13 de febrero de 2027, 10:00[^\n]*16:00/);
  assert.match(result.text, /1K[^\n]*08:00/);
  assert.match(result.text, /3K[^\n]*08:15/);
  assert.match(result.text, /5K[^\n]*08:30/);
  assert.match(result.html, /Salidas:<\/strong> 1K 08:00 h · 3K 08:15 h · 5K 08:30 h/);
});
