'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const stage = require('../axolote-stage-config');
const cases = [
  ['2026-10-15', true], ['2026-10-16', true],
  ['2026-10-16T00:00:00-06:00', true], ['2026-10-16T12:00:00-06:00', true],
  ['2026-10-16T23:59:59-06:00', true], ['2026-10-17T00:00:00-06:00', false],
  ['2026-10-17', false], ['2026-10-17T05:59:59Z', true], ['2026-10-17T06:00:00Z', false],
];
function browserProvider(file) {
  const context = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.KineticHubStageConfig.getAxoloteStageByDate;
}
function fallback(file) {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function getAxoloteStageByDate(');
  const end = source.indexOf('function setupHomeStagePricing(', start);
  const context = { window: {} };
  vm.runInNewContext(source.slice(start, end), context);
  return context.getAxoloteStageByDate;
}
for (const [date, open] of cases) test('Axolote closing ' + date, () => {
  const providers = [stage.getAxoloteStageByDate, require('../event-catalog').resolveEvent('axolote-night-run').getStage,
    browserProvider('axolote-stage-config.js'), browserProvider('public/axolote-stage-config.js'),
    fallback('script.js'), fallback('script.min.js'), fallback('public/script.js'), fallback('public/script.min.js')];
  for (const provider of providers) {
    const result = provider(date);
    assert.equal(result.isOpen, open);
    assert.equal(result.amount, open ? 550 : null);
    assert.equal(result.key, open ? 'extemporanea' : 'closed');
    if (open) assert.equal(result.period, '1 de septiembre al 16 de octubre de 2026');
  }
});
test('Race midnight is independent of process TZ; date-only inputs never become UTC midnight', () => {
  const probe = `const assert=require('node:assert/strict');const get=require('./axolote-stage-config').getAxoloteStageByDate;for(const [date,open] of ${JSON.stringify(cases)})assert.equal(get(date).isOpen,open,date);`;
  for (const TZ of ['UTC', 'America/Mexico_City', 'America/Los_Angeles']) execFileSync(process.execPath, ['-e', probe], { env: { ...process.env, TZ } });
});
test('Configured end is inclusive October 16 and generated providers match sources', () => {
  assert.equal(stage.TIME_ZONE, 'America/Mexico_City');
  const last = stage.AXOLOTE_STAGE_CATALOG.at(-1);
  assert.equal(last.start, '2026-09-01'); assert.equal(last.end, '2026-10-16');
  assert.deepEqual(stage.AXOLOTE_STAGE_CATALOG.map(s => s.amount), [480, 550, 550]);
  assert.equal(fs.readFileSync('axolote-stage-config.js', 'utf8'), fs.readFileSync('public/axolote-stage-config.js', 'utf8'));
  for (const file of ['script.min.js', 'public/script.js', 'public/script.min.js']) assert.equal(fallback('script.js').toString(), fallback(file).toString());
  for (const file of ['axolote-night-run.html', 'public/axolote-night-run.html']) assert.match(fs.readFileSync(file, 'utf8'), /1 de septiembre al 16 de octubre de 2026/);
});
