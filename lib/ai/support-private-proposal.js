'use strict';
const {resolveTenant}=require('./tenants');
const {rpcData}=require('../_support');

async function privateProposal(client,ticket,env=process.env,now=Date.now()){
  const tenant=resolveTenant(env);
  if(!tenant||!Number.isSafeInteger(ticket?.version)||ticket.version<1)return null;
  const result=await client.rpc('support_admin_proposal',{p_tenant:tenant.id,p_ticket:ticket.id,p_version:ticket.version});
  const data=rpcData(result.data);
  if(result.error||!data||typeof data.eligible!=='boolean')return null;
  const active=data.eligible&&env.SUPPORT_AI_SHADOW_ENABLED==='true'&&env.SUPPORT_AI_PRIVATE_ENABLED==='true';
  const p=data.proposal;
  const source=p?.knowledge===tenant.knowledge.version?tenant.knowledge.sources.find(s=>s.id===p.source):null;
  const usable=source&&(!source.expiresAt||Date.parse(source.expiresAt)>now);
  return {paused:!active,proposal:p&&['current','obsolete'].includes(p.state)&&['respond','escalate'].includes(p.decision)?{
    state:p.state==='current'&&p.knowledge===tenant.knowledge.version&&(p.decision==='escalate'||usable)?'current':'obsolete',
    source:source?.id||null,
    text:p.decision==='respond'&&usable?source.text:null,
    decision:p.decision==='escalate'?'escalate':'respond',
  }:null};
}
module.exports={privateProposal};
