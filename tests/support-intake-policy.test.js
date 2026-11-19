const test = require('node:test');
const assert = require('node:assert/strict');
const { intake, classify, CATEGORIES } = require('../lib/support-intake-policy');

test('category labels are deterministic and only rely on existing ticket categories', () => {
  for (const category of Object.keys(CATEGORIES)) {
    assert.equal(classify(category), category);
    const result = intake({ category });
    assert.equal(result.classification, category);
    assert.match(result.body, /Mensaje automático/);
    assert.equal(result.author, 'agent');
    assert.equal(result.requiresHuman, true);
    assert.ok(result.body.length <= 2000);
  }
});
test('does not infer classification, outcome or time from visitor-controlled text', () => {
  const result = intake({ category:'unexpected', body:'reembolsar dinero ahora',
    policy:{schedule:'',firstResponseBusinessHours:0}});
  assert.equal(result.classification, 'general');
  assert.match(result.body,/Nuestro equipo lo revisará/);
  assert.doesNotMatch(result.body,/reembolso|48 horas|resuelto/i);
});
test('approved policy distinguishes first response from resolution and handles valid folio', () => {
  const result = intake({ category:'registration',folio:'#C1AF3583',
    policy:{channel:'chat',schedule:'Lunes a viernes, 9:00 a 18:00',firstResponseBusinessHours:24}});
  assert.match(result.body,/#C1AF3583/);
  assert.doesNotMatch(result.body,/24 horas|Lunes a viernes|Categoría registrada/);
  assert.match(result.body,/este mismo chat/);
  assert.ok(result.body.split('\n').length <= 3);
});
test('invalid unapproved identifiers, schedule and durations are not echoed', () => {
  const result = intake({ folio:'#not-a-real-folio', policy:{schedule:'X'.repeat(400),firstResponseBusinessHours:169} });
  assert.doesNotMatch(result.body,/not-a-real-folio/);
  assert.doesNotMatch(result.body,/X{30}/);
  assert.doesNotMatch(result.body,/169 horas/);
  assert.equal(Object.isFrozen(CATEGORIES),true);
});
