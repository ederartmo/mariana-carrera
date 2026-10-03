'use strict';
const test=require('node:test'),{PGlite}=require('@electric-sql/pglite'),d=require('./helpers/perrun-admin-distance-fixture.cjs');
let db;test.before(async()=>{db=new PGlite();await d.install(db);});test.after(()=>db?.close());test.beforeEach(()=>d.production.reset(db));
for(const c of require('./helpers/perrun-admin-distance-cases.cjs').cases)test(c.name,()=>c.run(db));
// Replay the established correction invariants using the new signature, retaining current distance.
// Both-signature security and post-deploy removal are covered by the distance contract above.
for(const c of require('./helpers/perrun-admin-edit-cases.cjs').cases.slice(2))test('New signature regression: '+c.name,()=>c.run(d.legacyCaseAdapter(db)));
