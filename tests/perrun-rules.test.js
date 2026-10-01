'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { categoryForWeight, normalizeDogs, quoteRegistration, engravingOutcome } = require('../lib/_perrun-rules');
const dog = (weightKg = 10, engravingRequested = true) => ({ name: ' Luna ', weightKg, engravingRequested });

for (const [weight, expected] of [[3,'S'],[10,'S'],[10.001,'M'],[25,'M'],[25.001,'L'],[50,'L'],[50.001,'XL'],[80,'XL']]) {
  test(`Perrun category boundary ${weight} kg`, () => assert.equal(categoryForWeight(weight), expected));
}
test('Perrun rejects invalid weights without coercion', () => {
  for (const weight of [2.99,80.01,NaN,Infinity,'10',null]) assert.throws(() => categoryForWeight(weight));
});
test('Perrun permits two S/M dogs and keeps one human ticket', () => {
  const quote = quoteRegistration({ at:'2026-10-31T23:59:59-06:00',dogs:[dog(10),dog(25)] });
  assert.equal(quote.totalCents,63000); assert.equal(quote.humanTicketCount,1);
  assert.deepEqual(quote.dogs.map(d => d.dogIndex),[1,2]); assert.equal(quote.dogs[0].name,'Luna');
});
test('Perrun prohibits a second dog when either dog is L/XL', () => {
  for (const dogs of [[dog(25.001),dog(3)],[dog(3),dog(80)],[dog(30),dog(60)]]) assert.throws(() => normalizeDogs(dogs));
  assert.equal(normalizeDogs([dog(80)]).length,1);
});
test('Perrun validates dog count/name/category and explicit engraving choice', () => {
  for (const dogs of [[],[dog(),dog(),dog()],[{...dog(),name:''}],[{...dog(),category:'XL'}],[{...dog(),engravingRequested:'true'}]]) assert.throws(() => normalizeDogs(dogs));
});
for (const [at, stage, total] of [
  ['2026-10-31T23:59:59.999-06:00','presale',45000],
  ['2026-11-01T00:00:00-06:00','general',50000],
  ['2026-12-31T23:59:59.999-06:00','general',50000],
  ['2027-01-01T00:00:00-06:00','late',55000],
  ['2027-01-25T15:59:59.999-06:00','late',55000]
]) test(`Perrun price stage ${at}`, () => {
  const q=quoteRegistration({at,dogs:[dog()]}); assert.equal(q.stage,stage); assert.equal(q.totalCents,total);
});
test('Perrun closes at 16:00 Mexico City and requires absolute timestamps', () => {
  for(const at of ['2027-01-25T16:00:00-06:00','2027-01-25T22:00:00Z','2026-10-31','invalid']) assert.throws(() => quoteRegistration({at,dogs:[dog()]}));
});
test('Perrun main price never includes engraving and rejects coupons', () => {
  for(const requested of [true,false]) assert.equal(quoteRegistration({at:'2027-01-02T00:00:00Z',dogs:[dog(10,requested),dog(20,requested)]}).totalCents,73000);
  assert.throws(() => quoteRegistration({at:'2026-10-31T00:00:00Z',dogs:[dog()],promoCode:'PROMO'}));
});
test('Perrun confirmed dog positions 299/300 are free, 301 is paid only if requested', () => {
  for(const position of [299,300]) for(const requested of [true,false]) assert.deepEqual(engravingOutcome(position,requested),{sequence:position,free:true,paymentRequired:false,paymentAmountCents:0});
  assert.deepEqual(engravingOutcome(301,true),{sequence:301,free:false,paymentRequired:true,paymentAmountCents:3500});
  assert.deepEqual(engravingOutcome(301,false),{sequence:301,free:false,paymentRequired:false,paymentAmountCents:0});
});
test('Perrun crossing free limit follows dog_index, independent of engraving request', () => {
  const dogs=normalizeDogs([dog(3,false),dog(25,true)]);
  assert.deepEqual(dogs.map((d,i)=>engravingOutcome(300+i,d.engravingRequested).paymentAmountCents),[0,3500]);
});
test('Perrun outcome is a pure historical rule with no mutable reservation state', () => {
  const before=engravingOutcome(300,true); engravingOutcome(301,true);
  assert.deepEqual(engravingOutcome(300,true),before);
  for(const sequence of [0,-1,1.5,NaN]) assert.throws(()=>engravingOutcome(sequence,true));
});
