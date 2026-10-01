'use strict';
// Loaded ONLY by the local QA server. Blocks cloud DB access in every Node worker.
if(process.env.PERRUN_QA_LOCAL!=='1')throw Error('QA marker missing');
const configured=new URL(process.env.SUPABASE_URL||'http://invalid');
if(configured.hostname!=='127.0.0.1'||configured.port!=='55321')throw Error('QA requires Supabase localhost:55321');
function assertNetwork(input){
  let host;
  if(typeof input==='string'||input instanceof URL)host=new URL(input).hostname;
  else if(input?.url)host=new URL(input.url).hostname;
  else host=input?.hostname||input?.host||'';
  host=String(host).toLowerCase().replace(/:\d+$/,'');
  if(/(^|\.)supabase\.(co|net)$/.test(host)||host==='api.resend.com'||host==='graph.facebook.com')throw Error('QA blocks remote database/email/tracking connections');
}
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){assertNetwork(input);return originalFetch.call(this,input,...args);};
for(const name of ['node:http','node:https']){
  const module=require(name);
  for(const method of ['request','get']){
    const original=module[method];module[method]=function(input,...args){assertNetwork(input);return original.call(this,input,...args);};
  }
}
