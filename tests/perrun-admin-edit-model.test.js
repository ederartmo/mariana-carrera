'use strict';
const test=require('node:test');const {PGlite}=require('@electric-sql/pglite');const f=require('./helpers/perrun-admin-edit-cases.cjs');let db;
test.before(async()=>{db=new PGlite();await f.install(db);});test.after(()=>db.close());for(const c of f.cases)test(c.name,()=>c.run(db));
