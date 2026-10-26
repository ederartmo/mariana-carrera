const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.resolve(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(base, name), 'utf8');

function fixture(now) {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  const nodes = new Map();
  const countdown = {
    dataset: { countdownMode: 'calendar-day', countdownDate: '2026-12-06' },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '' });
      return nodes.get(selector);
    },
  };
  const context = { Date: Clock, Intl, document: { querySelector: () => countdown }, setInterval() {} };
  context.window = context;
  vm.createContext(context);
  const updater = source('script.js').slice(source('script.js').indexOf('function setupEventCountdown()'), source('script.js').indexOf('function setupHomeRewardsScroller()'));
  vm.runInContext(updater + '\nsetupEventCountdown();', context);
  return { nodes, countdown };
}

test('Cascanueces countdown shows calendar days only across timezones and no invented hours', () => {
  for (const instant of ['2026-12-05T00:00:00-06:00', '2026-12-05T06:00:00Z']) {
    const { nodes } = fixture(instant);
    assert.match(nodes.get('[data-countdown-days]').textContent, /1 día/);
    assert.equal(nodes.has('[data-countdown-time]'), false);
  }
});

test('Cascanueces countdown shows race-day and post-race states without closing sales', () => {
  assert.equal(fixture('2026-12-06T00:00:00-06:00').nodes.get('[data-countdown-days]').textContent, '¡Hoy es la carrera!');
  assert.equal(fixture('2026-12-07T00:00:00-06:00').nodes.get('[data-countdown-days]').textContent, 'La carrera ya se celebró.');
});

test('Cascanueces landing targets event date while Perrun remains a sales-close countdown', () => {
  const c = { Date, Intl, URLSearchParams, setInterval() {}, clearInterval() {} };
  c.window = c;
  vm.createContext(c);
  for (const name of ['cascanueces-stage-config.js', 'cascanueces-event-data.js', 'event-landing.js']) vm.runInContext(source(name), c);
  const root = { style: { setProperty() {} }, classList: { add() {} }, dataset: {}, innerHTML: '' };
  c.EventLanding({ root, event: c.KineticHubCascanuecesEvent });
  assert.match(root.innerHTML, /data-countdown-mode="calendar-day"/);
  assert.match(root.innerHTML, /data-countdown-date="2026-12-06"/);
  assert.doesNotMatch(root.innerHTML, /data-countdown-time/);
  assert.doesNotMatch(root.innerHTML, /Cierre de inscripciones/);
});
