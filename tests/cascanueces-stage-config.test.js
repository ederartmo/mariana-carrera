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

test('Cascanueces switches to Último minuto at midnight on November 1', () => {
  assertStage('2026-11-01T00:00:00-06:00', {
    label: 'Último minuto',
    amount: 500,
  });
});
