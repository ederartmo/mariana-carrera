'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../admin-inscripciones.html'),'utf8');
const source=html.slice(html.indexOf('    function buildEmailButton(row)'),html.indexOf('    function buildEditEmailButton(row)'));
const build=vm.runInNewContext(source+';buildEmailButton',{escapeHtml:x=>String(x)});
const row={event_slug:'perrun-2027',registration_status:'active',payment_status:'paid',order_session_id:'cs_fixture',email_sent:false};
for(const sent of [false,true])test('Perrun confirmation button '+(sent?'resend':'first send'),()=>{const b=build({...row,email_sent:sent});assert.match(b,sent?/Reenviar confirmación/:/Enviar confirmación/);assert.match(b,sent?/data-perrun-email-action="resend"/:/data-perrun-email-action="send"/);assert.match(b,/data-resend-order="cs_fixture"/);});
for(const slug of ['axolote-night-run','cascanueces-run'])test('Legacy confirmation labels unchanged: '+slug,()=>{assert.match(build({...row,event_slug:slug}),/>Enviar email</);assert.match(build({...row,event_slug:slug,email_sent:true}),/>Reenviar email</);});
test('Confirmation remains unavailable for inactive/unpaid/missing order',()=>{for(const patch of [{registration_status:'cancelled'},{payment_status:'pending'},{order_session_id:''}])assert.equal(build({...row,...patch}),'');assert.match(build({...row,payment_status:'paid_no_email'}),/Enviar confirmación/);});
const start=html.lastIndexOf("      contentDiv.addEventListener('click', async (event) => {",html.indexOf("const button = event.target?.closest('[data-resend-order]')"));
const end=html.indexOf("      contentDiv.addEventListener('click'",start+1);
for(const sent of [false,true])for(const email of [undefined,'fixture@example.invalid'])test('Confirmation success message '+(sent?'resend':'send')+' recipient '+!!email,async()=>{
 let callback,alert,request;const button={disabled:false,textContent:sent?'Reenviar confirmación':'Enviar confirmación',getAttribute:k=>({'data-resend-order':'cs_fixture','data-perrun-email-action':sent?'resend':'send'}[k]||'')};
 vm.runInNewContext(html.slice(start,end),{contentDiv:{addEventListener:(type,fn)=>callback=fn},client:{auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}},fetch:async(url,args)=>{request={url,args};return {ok:true,json:async()=>({email})};},window:{alert:m=>alert=m},loadPaidInscriptions:async()=>{},statusFilter:null});
 await callback({target:{closest:()=>button}});assert.equal(alert,'Correo de confirmación '+(sent?'reenviado':'enviado')+(email?' a '+email:'.'));assert.equal(request.url,'/api/resend-single-confirmation');assert.deepEqual(JSON.parse(request.args.body),{orderSessionId:'cs_fixture'});
});
