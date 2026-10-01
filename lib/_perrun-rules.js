'use strict';

// Phase 1: pure rules only. No checkout/webhook imports this module yet.
const EVENT_SLUG = 'perrun-2027';
const SECOND_DOG_CENTS = 18000;
const ENGRAVING_CENTS = 3500;
const FREE_DOG_LIMIT = 300;
const GENERAL_START = Date.parse('2026-11-01T00:00:00-06:00');
const LATE_START = Date.parse('2027-01-01T00:00:00-06:00');
const SALES_CLOSE = Date.parse('2027-01-25T16:00:00-06:00');

function categoryForWeight(weightKg) {
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg < 3 || weightKg > 80) {
    throw new RangeError('Dog weight must be a number between 3 and 80 kg');
  }
  if (weightKg <= 10) return 'S';
  if (weightKg <= 25) return 'M';
  if (weightKg <= 50) return 'L';
  return 'XL';
}

/** @returns {{dogIndex:number,name:string,weightKg:number,category:string,engravingRequested:boolean}[]} */
function normalizeDogs(dogs) {
  if (!Array.isArray(dogs) || dogs.length < 1 || dogs.length > 2) throw new RangeError('One or two dogs required');
  const normalized = dogs.map((dog, index) => {
    if (!dog || typeof dog.name !== 'string' || !dog.name.trim() || [...dog.name.trim()].length > 80) {
      throw new TypeError('Dog name required (maximum 80 characters)');
    }
    if (typeof dog.engravingRequested !== 'boolean') throw new TypeError('engravingRequested must be boolean');
    const category = categoryForWeight(dog.weightKg);
    if (dog.category !== undefined && dog.category !== category) throw new RangeError('Category does not match weight');
    return { dogIndex: index + 1, name: dog.name.trim(), weightKg: dog.weightKg, category, engravingRequested: dog.engravingRequested };
  });
  if (normalized.length === 2 && normalized.some(dog => !['S', 'M'].includes(dog.category))) {
    throw new RangeError('Two dogs allowed only when both are S/M');
  }
  return normalized;
}

function quoteRegistration({ at, dogs, promoCode = '' }) {
  // Require an absolute timestamp; never interpret a timezone-free date on the host.
  if (typeof at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at)) throw new TypeError('Timestamp must include timezone');
  const time = Date.parse(at);
  if (!Number.isFinite(time)) throw new TypeError('Invalid timestamp');
  if (time >= SALES_CLOSE) throw new RangeError('Registration sales closed');
  if (typeof promoCode !== 'string' || promoCode.trim()) throw new RangeError('Perrun does not accept coupons');
  const normalized = normalizeDogs(dogs);
  const stage = time < GENERAL_START ? 'presale' : time < LATE_START ? 'general' : 'late';
  const baseCents = { presale: 45000, general: 50000, late: 55000 }[stage];
  return { currency: 'mxn', stage, baseCents, secondDogCents: normalized.length === 2 ? SECOND_DOG_CENTS : 0,
    totalCents: baseCents + (normalized.length === 2 ? SECOND_DOG_CENTS : 0), humanTicketCount: 1, dogs: normalized };
}

// Specification oracle for tests/display, NOT a database allocator. The RPC owns allocation.
function engravingOutcome(sequence, requested) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || typeof requested !== 'boolean') throw new TypeError('Invalid confirmed dog position');
  const free = sequence <= FREE_DOG_LIMIT;
  return { sequence, free, paymentRequired: !free && requested, paymentAmountCents: !free && requested ? ENGRAVING_CENTS : 0 };
}

module.exports = { EVENT_SLUG, SECOND_DOG_CENTS, ENGRAVING_CENTS, FREE_DOG_LIMIT, categoryForWeight, normalizeDogs, quoteRegistration, engravingOutcome };
