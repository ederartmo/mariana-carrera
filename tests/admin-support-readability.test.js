const test = require('node:test');
const assert = require('node:assert/strict');
const { presentTicket, formatLocalDate, updateFields } = require('../admin-support.js');

test('ticket presentation uses only the supported category and actual status', () => {
  const ticket = { id: 'b9b4d4b0-a062-47c1-a2e4-d5d04d98d33d', category: 'registration', status: 'pending', name: 'Never infer this' };
  const view = presentTicket(ticket);
  assert.equal(view.identity, 'Visitante sin identificar');
  assert.equal(view.folio, '#B9B4D4B0');
  assert.equal(view.subject, 'Consulta sobre inscripciones');
  assert.equal(view.category, 'Inscripciones');
  assert.equal(presentTicket({ ...ticket, category: 'test' }).category, 'Prueba');
  assert.equal(view.status, 'Pendiente');
  assert.match(view.explanation, /espera atención/);
  assert.equal(presentTicket({ ...ticket, status: 'in_progress' }).status, 'En proceso');
  assert.match(presentTicket({ ...ticket, status: 'resolved' }).explanation, /cerró/);
  assert.equal(presentTicket({ ...ticket, status: 'unknown' }).status, 'Estado desconocido');
});

test('uses the operator browser local time and does not display invalid ISO values', () => {
  const value = '2026-11-18T18:15:00Z';
  const expected = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  assert.equal(formatLocalDate(value), expected);
  assert.equal(formatLocalDate('not a timestamp'), '—');
  assert.equal(formatLocalDate(null), '—');
});

test('unified save preserves the existing assignment unless an allowed replacement was selected', () => {
  const current = { status: 'pending', category: 'general', assigned_to: 'old@example.test' };
  const base = { status: 'resolved', category: 'events' };
  assert.deepEqual(updateFields(current, base.status, base.category, ''), base);
  assert.deepEqual(updateFields(current, base.status, base.category, current.assigned_to), base);
  assert.deepEqual(updateFields(current, base.status, base.category, 'other@example.test'), { ...base, assignTo: 'other@example.test' });
  assert.deepEqual(updateFields(current, base.status, 'test', ''), { status: base.status, category: 'test' });
  assert.deepEqual(updateFields({ ...current, category: 'test' }, base.status, 'test', ''), { status: base.status });
});

test('assignee names change presentation only and preserve legacy or blank assignments', () => {
  const { assigneeLabel } = require('../admin-support.js');
  const email = 'operator@example.test';
  assert.equal(assigneeLabel(email, {[email]:'Equipo Operativo'}), 'Equipo Operativo');
  assert.equal(assigneeLabel(email, {}), email);
  assert.equal(assigneeLabel(null, {}), 'Sin asignar');
  assert.equal(updateFields({},'pending','general',email).assignTo,email);
});
