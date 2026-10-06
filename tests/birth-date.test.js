const test = require('node:test');
const assert = require('node:assert/strict');
require('../birth-date.js');

const birthDate = global.KineticHubBirthDate;
const now = new Date('2026-10-06T12:00:00Z');

test('public birth date helper returns real ISO dates and rejects invalid dates', () => {
  assert.equal(birthDate.birthISO('31', '1', '1998', now), '1998-01-31');
  assert.equal(birthDate.birthISO('29', '2', '2024', now), '2024-02-29');
  assert.equal(birthDate.birthISO('29', '2', '2023', now), '');
  assert.equal(birthDate.birthISO('31', '4', '2000', now), '');
  assert.equal(birthDate.birthISO('6', '10', '2026', now), '');
  assert.equal(birthDate.birthISO('1', '1', '1899', now), '');
});

test('public birth date markup exposes day, month, year and keeps an ISO hidden value', () => {
  const html = birthDate.markup({ id: 'ticketBirth1', iso: '1998-01-31', required: true, index: 0 });
  assert.match(html, /placeholder="DD"/);
  assert.match(html, /<option value="1" selected>Enero<\/option>/);
  assert.match(html, /placeholder="AAAA"/);
  assert.match(html, /id="ticketBirth1"[^>]*value="1998-01-31"/);
  assert.equal(html.includes('type="date"'), false);
});
