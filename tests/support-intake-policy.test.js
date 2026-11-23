const test = require('node:test');
const assert = require('node:assert/strict');
const { intake, classify, CATEGORIES } = require('../lib/support-intake-policy');

test('keeps the chosen category but does not repeat it in the greeting', () => {
  for (const category of Object.keys(CATEGORIES)) {
    assert.equal(classify(category), category);
    const result = intake({ category });
    assert.equal(result.classification, category);
    assert.equal(result.body, 'Recibimos tu solicitud.');
    assert.equal(result.author, 'agent');
    assert.equal(result.requiresHuman, true);
  }
});

test('greeting is neutral when category is not known and keeps a valid reference', () => {
  const result = intake({ category:'unexpected', body:'Hola, quiero un reembolso', folio:'#C1AF3583',
    policy:{schedule:'Lunes a viernes',firstResponseBusinessHours:24} });
  assert.equal(result.classification, 'general');
  assert.equal(result.body, 'Recibimos tu solicitud #C1AF3583.');
  assert.doesNotMatch(result.body,/horario|24 horas|reembolso|seguimiento|intervención/i);
});

test('does not echo invalid references', () => {
  assert.doesNotMatch(intake({folio:'#not-a-real-folio'}).body,/not-a-real-folio/);
  assert.equal(Object.isFrozen(CATEGORIES),true);
});
