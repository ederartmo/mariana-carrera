'use strict';

// Phase 1: pure rules only. No checkout/webhook imports this module yet.
const event = require('../perrun-event-data');
const EVENT_SLUG = event.slug;
const SECOND_DOG_CENTS = event.dogRules.secondDogFee * 100;
const ENGRAVING_CENTS = event.dogRules.engravingPaidPrice * 100;
const FREE_DOG_LIMIT = event.dogRules.freeEngravingLimit;

function categoryForWeight(weightKg) { return event.categoryForWeight(weightKg); }

/** @returns {{dogIndex:number,name:string,weightKg:number,category:string,engravingRequested:boolean}[]} */
function normalizeDogs(dogs) {
  if (!Array.isArray(dogs) || dogs.length < 1 || dogs.length > event.dogRules.maxDogs) throw new RangeError('One or two dogs required');
  const normalized = dogs.map((dog, index) => {
    if (!dog || typeof dog.name !== 'string' || !dog.name.trim() || [...dog.name.trim()].length > 80) {
      throw new TypeError('Dog name required (maximum 80 characters)');
    }
    if (typeof dog.engravingRequested !== 'boolean') throw new TypeError('engravingRequested must be boolean');
    const category = categoryForWeight(dog.weightKg);
    if (dog.category !== undefined && dog.category !== category) throw new RangeError('Category does not match weight');
    return { dogIndex: index + 1, name: dog.name.trim(), weightKg: dog.weightKg, category, engravingRequested: dog.engravingRequested };
  });
  event.validateDogWeights(normalized.map(dog => dog.weightKg));
  return normalized;
}

function quoteRegistration({ at, dogs, promoCode = '' }) {
  // Require an absolute timestamp; never interpret a timezone-free date on the host.
  if (typeof at !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at)) throw new TypeError('Timestamp must include timezone');
  const time = Date.parse(at);
  if (!Number.isFinite(time)) throw new TypeError('Invalid timestamp');
  if (!event.pricing.getCurrentStage(at).isOpen) throw new RangeError('Registration sales closed');
  if (typeof promoCode !== 'string' || promoCode.trim()) throw new RangeError('Perrun does not accept coupons');
  const normalized = normalizeDogs(dogs);
  const currentStage = event.pricing.getCurrentStage(at);
  const stage = currentStage.key;
  const baseCents = currentStage.amount * 100;
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
