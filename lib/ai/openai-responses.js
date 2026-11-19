'use strict';

const {resolveTenant} = require('./tenants');
const MAX_TEXT = 2000;
const MAX_HISTORY = 12;
const RESERVED_OVERHEAD = 256;
const unsafe = /\b(ignora|ignore|override|bypass|jailbreak|prompt|instrucciones|instructions|secreto|secret|developer|system message|base de datos)\b/;
const wantsHuman = /\b(hablar|comunicarme|conectarme|pasame|transfiereme|quiero|necesito|quisiera)\b.{0,40}\b(operador|asesor|humano|persona)\b/;
const privateAction = /\b(pago|stripe|reembolso|devolucion|cobro|orden|folio|dorsal|bib|transferencia|perfil|cancelar|cambio|cambios|cambiar|modificar|titular|talla)\b/;
const supportedTerms = new Set('perrun kits kit entrega paquetes recoge recoger recogida cuando donde hora horario horarios salida salen salidas distancia distancias recorridos carrera carreras incluye inscripcion inscripciones contacto soporte operador humano conversar chat atencion'.split(' '));
const histories = new Set(['visitor','automatic_ack','ai_generated','human_operator']);
const reasons = ['none','insufficient_information','needs_operator'];
const defaults = Object.freeze({model:'evaluation-fixture-model', timeoutMs:1200, maxInputTokens:2200, maxOutputTokens:96,
  maxRequestsPerMinute:6, dailyBudgetMicros:15000, inputMicrosPerMillion:1000000, outputMicrosPerMillion:3000000});
const normalize = s => s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const tokens = s => normalize(s).match(/[a-z0-9]+/g) || [];

function projection(s) {
  // Strip whole common identifier sequences before intersecting with public vocabulary.
  const stripped = normalize(s).replace(/\b\S+@\S+\b|\bhttps?:\/\/\S+|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\+?\d(?:[\d(). -]{6,})\d/g,' ');
  return [...new Set(tokens(stripped).filter(t=>supportedTerms.has(t)))].slice(0,20).join(' ');
}

function select(text) {
  const s=normalize(text), t=new Set(tokens(s));
  if (privateAction.test(s) || /\b(cascanueces|santa|trail|axolote|ride|tri|family|night)\b/.test(s)) return null;
  if (t.has('perrun')) {
    const ids=[];
    if (/\b(kits?|paquetes?|recog(?:e|er|ida)|entrega)\b/.test(s)) ids.push('perrun-kit');
    if (/\b(salen|salidas?|arranque)\b/.test(s)) ids.push('perrun-starts');
    if (/\b(distancias?|recorridos?)\b/.test(s)) ids.push('perrun-distances');
    if (/\b(incluye|incluida)\b/.test(s) && /\binscripcion(?:es)?\b/.test(s)) ids.push('perrun-registration');
    if ((t.has('inscripcion')||t.has('inscripciones')) && !ids.includes('perrun-registration')) return null;
    return ids.length===1 ? ids[0] : null;
  }
  if (/\b(contacto|contactar|chat|soporte|operador)\b/.test(s)) return 'contact-chat';
  return null;
}

function settings(overrides) {
  const s = {...defaults,...overrides};
  const ranges={timeoutMs:[1,10000],maxInputTokens:[1,10000],maxOutputTokens:[16,512],maxRequestsPerMinute:[0,60],
    dailyBudgetMicros:[0,10000000],inputMicrosPerMillion:[1,100000000],outputMicrosPerMillion:[1,100000000]};
  for(const [k,[min,max]] of Object.entries(ranges)) if(!Number.isSafeInteger(s[k])||s[k]<min||s[k]>max) throw Error('Invalid evaluation limits');
  if(typeof s.model!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(s.model)) throw Error('Invalid evaluation model');
  return Object.freeze(s);
}

const escalate=(reason,metrics)=>({decision:'escalate',reason,...(metrics?{metrics}:{})});
const money=(input,output,s)=>Math.ceil((input*s.inputMicrosPerMillion+output*s.outputMicrosPerMillion)/1e6);

function decode(r) {
  if(r?.status!=='completed'||!Array.isArray(r.output)||r.output.length!==1) return null;
  const m=r.output[0];
  if(m?.type!=='message'||m.role!=='assistant'||!Array.isArray(m.content)||m.content.length!==1) return null;
  const value=m.content[0];
  if(value?.type!=='output_text'||typeof value.text!=='string'||value.text.length>500) return null;
  try {
    const d=JSON.parse(value.text);
    if(!d||Array.isArray(d)||Object.keys(d).sort().join(',')!=='decision,reason,source_id'||!reasons.includes(d.reason))return null;
    return d;
  } catch { return null; }
}

function createEvaluationService({env=process.env, provider, limits, now=Date.now}={}) {
  const tenant=resolveTenant(env);
  const config=settings(limits);
  // In-memory, evaluation-only accounting per instance; never use as a distributed budget.
  let minute, day, requests=0, reserved=0;
  const reserve=(at,cost)=>{
    const m=Math.floor(at/60000),d=Math.floor(at/86400000);
    if(minute===undefined||m>minute){minute=m;requests=0;}
    if(day===undefined||d>day){day=d;reserved=0;}
    if(requests>=config.maxRequestsPerMinute)return 'rate_limit';
    if(reserved+cost>config.dailyBudgetMicros)return 'budget_limit';
    requests++;reserved+=cost;
    return null;
  };

  async function evaluate(input={}) {
    if(!tenant)return escalate('tenant_not_enabled');
    if(!input||typeof input!=='object')return escalate('invalid_input');
    const {context,message,history=[],approvedSourceIds}=input;
    if(Object.hasOwn(input,'tenantId')||context?.tenantId!==tenant.id)return escalate('tenant_mismatch');
    if(context.automationPausedAt!==null||context.humanIntervened!==false||context.status!=='pending')return escalate('human_intervention');
    if(context.historyVerified!==true)return escalate('unverified_history');
    if(!Array.isArray(history)||history.length>MAX_HISTORY||typeof message!=='string'||!message.trim()||message.length>MAX_TEXT)return escalate('invalid_input');
    if(history.some(h=>h?.tenantId!==tenant.id))return escalate('tenant_mismatch');
    if(history.some(h=>h.role==='human_operator'))return escalate('human_intervention');
    if(history.some(h=>!histories.has(h.role)||typeof h.text!=='string'||h.text.length>MAX_TEXT))return escalate('unverified_history');
    if(wantsHuman.test(normalize(message)))return escalate('needs_operator');
    if(unsafe.test(normalize(message))||history.some(h=>unsafe.test(normalize(h.text))))return escalate('unsafe_input');
    if(approvedSourceIds!==undefined&&(!Array.isArray(approvedSourceIds)||approvedSourceIds.length>tenant.knowledge.sources.length||
       approvedSourceIds.some(id=>!tenant.knowledge.sources.some(s=>s.id===id))))return escalate('invalid_sources');
    const at=now();
    if(!Number.isFinite(at))return escalate('invalid_clock');
    const query=projection(message);
    const sourceId=select(query);
    const fact=tenant.knowledge.sources.find(s=>s.id===sourceId&&(!s.expiresAt||at<Date.parse(s.expiresAt))&&
      (approvedSourceIds===undefined||approvedSourceIds.includes(s.id)));
    // Keep the broader rejection checks on the original input, but never transmit it.
    if(!fact||privateAction.test(normalize(message))||select(message)!==sourceId)return escalate('insufficient_information');
    if(typeof provider!=='function')return escalate('provider_disabled');
    const payload={ model:config.model, instructions:tenant.instructions, store:false, tools:tenant.tools,
      max_output_tokens:config.maxOutputTokens,
      input:JSON.stringify({query,history:history.map(h=>({role:h.role,text:projection(h.text)})).filter(h=>h.text),
        sources:[{id:fact.id,text:fact.text}]}),
      text:{format:{type:'json_schema',name:'support_evaluation',strict:true,schema:{type:'object',
        properties:{decision:{type:'string',enum:['respond','escalate']},source_id:{type:'string',enum:['none',fact.id]},reason:{type:'string',enum:reasons}},
        required:['decision','source_id','reason'],additionalProperties:false}}}
    };
    const inputBound=Buffer.byteLength(JSON.stringify(payload),'utf8')+RESERVED_OVERHEAD;
    if(inputBound>config.maxInputTokens)return escalate('input_limit');
    const cost=money(inputBound,config.maxOutputTokens,config);
    const blocked=reserve(at,cost);
    if(blocked)return escalate(blocked);
    const metrics={tenantId:tenant.id,knowledgeVersion:tenant.knowledge.version,model:config.model,reservedMicros:cost};
    const controller=new AbortController();
    const timedOut=Symbol('timeout');
    let timer,r;
    try{
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>{resolve(timedOut);controller.abort();},config.timeoutMs);});
      r=await Promise.race([deadline,Promise.resolve().then(()=>provider(payload,{tenantId:tenant.id,signal:controller.signal}))]);
    }catch{return escalate('provider_error',metrics);}
    finally{clearTimeout(timer);}
    if(r===timedOut)return escalate('provider_timeout',metrics);
    const use=r?.usage;
    if(!Number.isSafeInteger(use?.input_tokens)||use.input_tokens<1||use.input_tokens>inputBound||
       !Number.isSafeInteger(use.output_tokens)||use.output_tokens<1||use.output_tokens>config.maxOutputTokens)return escalate('invalid_usage',metrics);
    Object.assign(metrics,{inputTokens:use.input_tokens,outputTokens:use.output_tokens,
      estimatedMicros:money(use.input_tokens,use.output_tokens,config)});
    const result=decode(r);
    if(result?.decision==='escalate'&&result.source_id==='none'&&result.reason!=='none')return escalate(result.reason,metrics);
    if(result?.decision!=='respond'||result.source_id!==fact.id||result.reason!=='none')return escalate('invalid_provider_output',metrics);
    // Never serve provider-authored free text, only the server-approved fact.
    return {decision:'respond',response:fact.text,sources:[{id:fact.id,repositoryPath:fact.repositoryPath,anchor:fact.anchor}],metrics};
  }
  return Object.freeze({evaluate});
}
module.exports = {createEvaluationService};
