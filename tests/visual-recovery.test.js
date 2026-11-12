const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');
function environment(now = '2026-11-12T00:00:00-06:00') {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  const root = { innerHTML: '' };
  const c = { Date: Clock, Intl, document: { getElementById: id => id === 'homeRoot' ? root : null }, setInterval() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['axolote-stage-config.js', 'cascanueces-stage-config.js', 'perrun-stage-config.js', 'perrun-event-data.js', 'event-countdown-cta.js', 'featured-events.js']) vm.runInContext(read(file), c);
  return { c, root };
}
test('home restores both clocks from current event configuration without reopening Axolote', () => {
  const { c, root } = environment();
  const events = c.KineticHubFeaturedEvents;
  const axolote = events.find(e => e.id === 'axolote-night-run');
  const cascanueces = events.find(e => e.id === 'cascanueces-run');
  const perrun = events.find(e => e.id === 'perrun-2027');
  assert.equal(axolote.isPast, true);
  assert.equal(axolote.getStage().isOpen, false);
  assert.equal(axolote.galleryHref, 'axolote-galeria.html');
  assert.equal(cascanueces.countdown.target, '2026-12-06T08:00:00-06:00');
  assert.equal(perrun.countdown.target, c.KineticHubPerrunEvent.pricing.salesClose);
  assert.equal(perrun.getStage().amount, c.KineticHubPerrunEvent.pricing.getCurrentStage().amount);
  vm.runInContext(read('home-corporate.js'), c);
  assert.match(root.innerHTML, /Evento celebrado/);
  assert.match(root.innerHTML, /href="axolote-galeria.html"/);
  assert.match(root.innerHTML, /data-countdown-mode="race-start"/);
  assert.match(root.innerHTML, /data-countdown-mode="sales-close"/);
  assert.match(root.innerHTML, /Clínica deportiva/);
});
function countdown(mode, target) {
  const nodes = Object.fromEntries(['days', 'time', 'status'].map(key => [`[data-countdown-${key}]`, { textContent: '' }]));
  return { dataset: { countdownMode: mode, countdownTarget: target }, querySelector: s => nodes[s], nodes };
}
test('all card clocks update independently across start and sales-close boundaries', () => {
  for (const now of ['2026-12-06T07:59:59-06:00', '2026-12-06T08:00:00-06:00', '2027-01-25T16:00:00-06:00']) {
    const { c } = environment(now);
    const race = countdown('race-start', '2026-12-06T08:00:00-06:00');
    const sales = countdown('sales-close', c.KineticHubPerrunEvent.pricing.salesClose);
    c.document = { querySelectorAll: () => [race, sales], querySelector: () => race };
    const s = read('script.js');
    vm.runInContext(s.slice(s.indexOf('function setupEventCountdown()'), s.indexOf('function setupHomeRewardsScroller()')) + '\nsetupEventCountdown();', c);
    assert.notEqual(sales.nodes['[data-countdown-days]'].textContent, '');
    assert.equal(race.nodes['[data-countdown-time]'].textContent, now.includes('07:59:59') ? '00:00:01' : '00:00:00');
    if (!now.includes('07:59:59')) assert.match(race.nodes['[data-countdown-status]'].textContent, /comenzó/);
    if (now.startsWith('2027')) assert.match(sales.nodes['[data-countdown-status]'].textContent, /Inscripciones cerradas/);
  }
});
test('recovered countdown renderer escapes attributes and retains safe local detail links', () => {
  const { c } = environment();
  const html = c.KineticHubCountdownCTA.render({ target: '"<test>', href: 'cascanueces-run.html', label: '<test>', tone: 'blue' });
  assert.match(html, /href="cascanueces-run.html"/);
  assert.match(html, /&quot;&lt;test&gt;/);
  assert.doesNotMatch(html, /label="<test>/);
});
test('gallery has 48 complete pairs, native-dialog controls, no Drive dependency and build-ready versions', () => {
  const html = read('axolote-galeria.html');
  const refs = [...new Set(html.match(/assets\/events\/axolote-night-run\/photos\/axolote-\d{2}(?:-thumb)?\.webp/g))];
  assert.equal(refs.length, 96);
  assert.equal((html.match(/data-gallery-photo/g) || []).length, 48);
  for (const file of refs) {
    const bytes = fs.readFileSync(path.join(base, file));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    assert.ok(bytes.length > 12);
  }
  for (const attr of ['viewer', 'prev', 'next', 'close', 'download', 'position']) assert.ok(html.includes(`data-gallery-${attr}`));
  assert.doesNotMatch(html, /drive\.google\.com|ee6279b3/);
  assert.match(html, /gallery-viewer\.js\?v=__ASSET_VERSION__/);
  for (const file of ['index.html', 'eventos.html']) {
    assert.match(read(file), /event-memories\.css\?v=__ASSET_VERSION__/);
    assert.match(read(file), /event-countdown-cta\.js\?v=__ASSET_VERSION__/);
  }
  assert.match(read('eventos.html'), /Santa Run/); // Unrelated main cards must not be dropped.
  for (const match of read('event-memories.css').matchAll(/url\(["']?([^\s)"']+)/g)) {
    assert.ok(fs.existsSync(path.join(base, match[1])), `Missing recovered CSS resource: ${match[1]}`);
  }
});
test('gallery viewer opens, navigates, wraps, downloads and restores opener focus', () => {
  const listeners = new Map();
  const node = () => ({ addEventListener: (type, fn) => listeners.set(type, fn) });
  const controls = Object.fromEntries(['close', 'prev', 'next'].map(k => [k, node()]));
  for (const [k, value] of Object.entries(controls)) value.addEventListener = (type, fn) => listeners.set(k + ':' + type, fn);
  const image = { removeAttribute() {} }, position = {}, download = {};
  const photos = Array.from({ length: 48 }, (_, i) => ({ href: `photo-${i}.webp`, querySelector: () => ({ alt: `Photo ${i}` }), focus() { this.focused = true; }, addEventListener(type, fn) { this.click = fn; } }));
  const dialog = { ...node(), showModal() { this.open = true; }, close() { this.open = false; listeners.get('close')(); }, querySelector(s) {
    if (s === 'img') return image;
    return s.includes('position') ? position : s.includes('download') ? download : controls[s.match(/gallery-(\w+)/)[1]];
  } };
  vm.runInNewContext(read('gallery-viewer.js'), { document: { querySelector: () => dialog, querySelectorAll: () => photos } });
  photos[0].click({ preventDefault() {} });
  assert.equal(dialog.open, true);
  assert.equal(image.src, 'photo-0.webp');
  listeners.get('prev:click')();
  assert.equal(position.textContent, 'Foto 48 de 48');
  assert.equal(download.download, 'photo-47.webp');
  listeners.get('keydown')({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(image.src, 'photo-0.webp');
  listeners.get('close:click')();
  assert.equal(photos[0].focused, true);
});
