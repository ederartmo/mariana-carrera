'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'fixtures','kinetic-inscripciones-schema.json'),'utf8'));
const quote=name=>{if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('Invalid fixture identifier');return '"'+name+'"';};
async function installFixture(db,repo=path.resolve(root,'..')) {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const columns=snapshot.columns.map(c=>{
    if(!['uuid','text','numeric','int4','bool','timestamptz','date'].includes(c.udt))throw new Error('Unreviewed column type');
    return quote(c.name)+' '+c.udt+(c.default!==null?' default '+c.default:'')+(c.nullable==='NO'?' not null':'');
  });
  const constraints=snapshot.constraints.map(c=>'constraint '+quote(c.name)+' '+c.definition);
  await db.exec('create table public.inscripciones ('+[...columns,...constraints].join(',')+');');
  const constraintIndexes=new Set(snapshot.constraints.filter(c=>/^(?:PRIMARY KEY|UNIQUE)/.test(c.definition)).map(c=>c.name));
  for(const index of snapshot.indexes)if(!constraintIndexes.has(index.name))await db.exec(index.definition+';');
  await db.exec(fs.readFileSync(path.join(repo,'desc','sql-finalize-paid-order-pr4.sql'),'utf8'));
  await db.exec('revoke all on function public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb) from public,anon,authenticated; grant execute on function public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb) to service_role;');
}
module.exports={installFixture,snapshot};
