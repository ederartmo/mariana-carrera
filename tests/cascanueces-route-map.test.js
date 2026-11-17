const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const asset = 'assets/events/cascanueces-run/route/bosque-aragon.jpeg';
const expectedHash = 'e7a496b39d0885da5b99c3d4720f3471d1fad0920a3cd4485bdfd3eb366f5603';

for (const prefix of ['', 'public/']) {
  test(`${prefix || 'source/'} route map preserves the supplied JPEG bytes`, () => {
    const bytes = fs.readFileSync(path.join(root, prefix, asset));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    assert.equal(bytes.length, 162091);
  });

  test(`${prefix || 'source/'} rendered information section offers the real map and enlargement`, () => {
    const ctx = { Date, Intl, URLSearchParams };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const file of ['cascanueces-stage-config.js', 'cascanueces-event-data.js', 'event-landing.js']) {
      vm.runInContext(fs.readFileSync(path.join(root, prefix, file), 'utf8'), ctx);
    }
    const node = { style: { setProperty() {} }, classList: { add() {} }, dataset: {}, innerHTML: '' };
    ctx.EventLanding({ root: node, event: ctx.KineticHubCascanuecesEvent });
    const section = node.innerHTML.split('id="informacion"')[1].split('</section>')[0];
    assert.ok(section.includes(`src="${asset}"`));
    assert.ok(section.includes(`href="${asset}"`));
    assert.match(section, /Ampliar mapa/);
    assert.doesNotMatch(section, /Mapa detallado próximamente|Ver mapa interactivo/);
    assert.equal(ctx.KineticHubCascanuecesEvent.distances.join(','), '5K,10K');
    assert.equal(ctx.KineticHubCascanuecesEvent.date.iso, '2026-12-06');
  });

  test(`${prefix || 'source/'} map has scoped responsive styling without cropping`, () => {
    const html = fs.readFileSync(path.join(root, prefix, 'cascanueces-run.html'), 'utf8');
    assert.match(html, /data-event-slug="cascanueces-run"/);
    assert.match(html, /height:\s*auto/);
    assert.match(html, /aspect-ratio:\s*auto/);
    assert.match(html, /object-fit:\s*contain/);
    assert.match(html, /@media\s*\(max-width:\s*700px\)/);
  });
}
