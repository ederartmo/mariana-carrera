'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { installFixture } = require('./perrun-schema-fixture.cjs');
const event = require('../../perrun-event-data');
const root = path.resolve(__dirname, '../..');
const migration = '20261002034528_perrun_manual_paid_order.sql';
const human = { fullName: 'Manual Owner', shirtSize: 'M', birthDate: '1990-01-01', whatsapp: '+525512345678', state: 'Jalisco', borough: null };
const dog = (weightKg = 10, engravingRequested = true) => ({ name: 'Dog', weightKg, category: event.categoryForWeight(weightKg), engravingRequested });
async function install(db) {
  await installFixture(db, root);
  for (const file of ['20261001055227_perrun_phase1_model.sql','20261001113351_perrun_payment_state.sql','20261001162118_perrun_engraving_payment_persistence.sql',migration]) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  }
}
function args({ id = crypto.randomUUID(), distance = '3K', dogs = [dog()], reference = 'SPEI-123', participant = human } = {}) {
  const now = new Date(), stage = event.pricing.getCurrentStage(now);
  return [id, distance, 'owner@example.invalid', JSON.stringify(participant), JSON.stringify(dogs), stage.key, now.toISOString(), (stage.amount + (dogs.length === 2 ? 180 : 0)) * 100, reference, '00000000-0000-4000-8000-000000000001', 'admin@example.invalid'];
}
const sql = 'select * from public.register_perrun_manual_paid_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)';
async function manual(db, values = args()) { return (await db.query(sql, values)).rows; }
async function stripe(db, { id = 'cs_fixture_' + crypto.randomUUID().replaceAll('-',''), dogs = [dog()] } = {}) {
  const a = args({ dogs });
  await db.query('select public.prepare_perrun_order($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)', [id,...a.slice(1,7)]);
  return (await db.query('select * from public.finalize_perrun_paid_order($1,$2,$3,$4,$5)', [id,'pi_'+id,'evt_'+id,a[7],'mxn'])).rows;
}
module.exports = { install, args, manual, stripe, sql, human, dog, migration };
