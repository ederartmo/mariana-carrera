const { resolveEventSelection } = require('../event-catalog');

const EDITABLE_FIELDS = Object.freeze([
  'full_name', 'shirt_size', 'birth_date', 'whatsapp', 'state', 'borough', 'distance',
]);
const SNAPSHOT_FIELDS = Object.freeze([
  'fullName', 'shirtSize', 'birthDate', 'whatsapp', 'state', 'borough', 'distance',
]);

function normalizeDistance(eventSlug, distance) {
  if (distance === undefined || distance === null || String(distance).trim() === '') return null;
  const selection = resolveEventSelection(eventSlug, distance);
  return selection ? selection.distance : null;
}

function toExpectedSnapshot(existing) {
  return {
    fullName: existing.full_name,
    shirtSize: existing.shirt_size,
    birthDate: existing.birth_date,
    whatsapp: existing.whatsapp,
    state: existing.state,
    borough: existing.borough,
    distance: existing.distance,
  };
}

function toRpcSnapshot(snapshot) {
  const result = {};
  for (const key of SNAPSHOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(snapshot || {}, key)) result[key] = snapshot[key];
  }
  return result;
}

function toRpcChanges(participant, normalized, eventSlug) {
  const result = {
    full_name: normalized.fullName,
    shirt_size: normalized.shirtSize,
    birth_date: normalized.birthDate,
    whatsapp: normalized.whatsapp,
    state: normalized.state,
    borough: normalized.borough,
  };
  if (Object.prototype.hasOwnProperty.call(participant, 'distance')) {
    const distance = normalizeDistance(eventSlug, participant.distance);
    if (!distance) throw new Error('La distancia no es válida para este evento.');
    result.distance = distance;
  }
  return result;
}

module.exports = { EDITABLE_FIELDS, SNAPSHOT_FIELDS, normalizeDistance, toExpectedSnapshot, toRpcSnapshot, toRpcChanges };
