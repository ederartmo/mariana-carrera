const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createHash } = require('node:crypto');

test('official PDF URLs serve the distinct supplied originals in source and public', () => {
  const expected = {
    'Cascanueces Run_convocatoria.pdf': '9790f7149c5b835d611759f4a8838cc40af985c9d8645fcba20912b6e0b5424e',
    'Cascanueces Run1.pdf': 'd8225180f917d2b7c1b29dd08dc95bcc4997694533a64ac0f3c8a3285f9dc224',
  };
  for (const prefix of ['', 'public/']) {
    for (const [file, hash] of Object.entries(expected)) {
      const bytes = fs.readFileSync(path.join(__dirname, '..', prefix, 'assets/events/cascanueces-run/legal', file));
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    }
  }
});

for (const prefix of ['', 'public/']) {
  test(`${prefix}Cascanueces pickup and race details preserve official dates and document URLs`, () => {
    const context = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', prefix, 'cascanueces-event-data.js'), 'utf8'), context);
    const event = context.KineticHubCascanuecesEvent;
    assert.equal(event.packetPickup.date, 'Sábado 5 de diciembre de 2026');
    assert.equal(event.packetPickup.time, '10:00 a 16:00 h');
    assert.equal(event.packetPickup.location, 'Huerto Educativo del Bosque de San Juan de Aragón, CDMX');
    assert.equal(event.schedule[0].date, event.packetPickup.date);
    assert.equal(event.schedule[0].time, event.packetPickup.time);
    assert.match(event.faqs[1].answer, /sábado 5 de diciembre de 2026 de 10:00 a 16:00 h/);
    assert.equal(event.date.iso, '2026-12-06');
    assert.equal(event.time.start, '08:00');
    const source = fs.readFileSync(path.join(__dirname, '..', prefix, 'cascanueces-event-data.js'), 'utf8');
    assert.ok(source.includes('Cascanueces%20Run_convocatoria.pdf'));
    assert.ok(source.includes('Cascanueces%20Run1.pdf'));
    assert.doesNotMatch(source, /viernes 4 de diciembre|11:00 a 17:30/i);
  });
}
