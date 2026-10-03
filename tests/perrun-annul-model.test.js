'use strict';
const test=require('node:test'),{PGlite}=require('@electric-sql/pglite'),f=require('./helpers/perrun-annul-fixture.cjs');
let db;test.before(async()=>{db=new PGlite();await f.install(db);});test.after(()=>db.close());test.beforeEach(()=>f.production.reset(db));
for(const c of require('./helpers/perrun-annul-cases.cjs').cases)test(c.name,()=>c.run(db));
test('Annulled registration cannot send normal confirmation; mock transport stays unused',async()=>{const assert=require('node:assert/strict'),x=await f.paid(db);await f.annul(db,x);let sends=0;const result=await require('../lib/_perrun-confirmation').sendPerrunConfirmation({supabase:require('./helpers/perrun-payment-sql-adapter.cjs').sqlAdapter(db),sessionId:x.orderId,resendRequestId:require('node:crypto').randomUUID(),mockProvider:{emails:{send:async()=>{sends++;throw Error('Must not send');}}}});assert.equal(result.skipped,true);assert.equal(sends,0);});
