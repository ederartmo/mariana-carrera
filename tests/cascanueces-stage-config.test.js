const assert = require('node:assert/strict');
const test = require('node:test');

const { getCascanuecesStageByDate } = require('../cascanueces-stage-config');

function assertStage(isoDate, expected) {
  const stage = getCascanuecesStageByDate(isoDate);

  assert.equal(stage.isOpen, true);
  assert.equal(stage.label, expected.label);
  assert.equal(stage.amount, expected.amount);
  assert.equal(stage.price, expected.amount);
}

test('Cascanueces remains open in Preventa through August 31 afternoon', () => {
  assertStage('2026-08-31T17:20:00-06:00', {
    label: 'Preventa',
    amount: 400,
  });
});

test('Cascanueces remains open in Preventa until the last second of August 31', () => {
  assertStage('2026-08-31T23:59:59-06:00', {
    label: 'Preventa',
    amount: 400,
  });
});

test('Cascanueces switches to Acceso General at midnight on September 1', () => {
  assertStage('2026-09-01T00:00:00-06:00', {
    label: 'Acceso General',
    amount: 450,
  });
});

test('Cascanueces remains open in Acceso General until the last second of October 31', () => {
  assertStage('2026-10-31T23:59:59-06:00', {
    label: 'Acceso General',
    amount: 450,
  });
});

test('Cascanueces switches to Extemporánea at midnight on November 1', () => {
  assertStage('2026-11-01T00:00:00-06:00', {
    label: 'Extemporánea',
    amount: 500,
  });
  assert.equal(getCascanuecesStageByDate('2026-11-01T00:00:00-06:00').key, 'ultimo_minuto');
  assert.equal(getCascanuecesStageByDate('2026-11-15T11:59:59-06:00').isOpen, true);
  assert.equal(getCascanuecesStageByDate('2026-11-15T12:00:00-06:00').isOpen, true);
});

test('Cascanueces preserves the $500 stage through November 23 Mexico City time in both copies', () => {
  const source = require('../cascanueces-stage-config');
  const published = require('../public/cascanueces-stage-config');
  assert.deepEqual(published.CASCANUECES_STAGE_CATALOG, source.CASCANUECES_STAGE_CATALOG);
  for (const config of [source, published]) {
    for (const now of ['2026-11-15T17:00:00-06:00', '2026-11-21T00:00:00-06:00', '2026-11-23T23:59:59.999-06:00']) {
      const stage = config.getCascanuecesStageByDate(now);
      assert.equal(stage.isOpen, true);
      assert.equal(stage.key, 'ultimo_minuto');
      assert.equal(stage.label, 'Extemporánea');
      assert.equal(stage.amount, 500);
      assert.equal(stage.price, 500);
      assert.equal(stage.end, '2026-11-24T00:00:00-06:00');
      assert.equal(stage.period, '1 de noviembre, 00:00 h a 23 de noviembre, 23:59 h');
    }
    const closed = config.getCascanuecesStageByDate('2026-11-24T06:00:00.000Z');
    assert.equal(closed.isOpen, false);
    assert.equal(closed.key, 'closed');
    assert.equal(closed.amount, null);
  }
});
