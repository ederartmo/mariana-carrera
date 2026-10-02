'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const factory=require('../admin-perrun-manual-ui'),event=require('../perrun-event-data');
function fixture(isFormValid=()=>true){
  const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,dataset:{},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});return elements.get(id);};
  const document={getElementById:get};let count=0;
  const ui=factory({document,event,isFormValid,uuid:()=> 'uuid-'+(++count),escapeHtml:s=>String(s).replaceAll('<','&lt;'),now:()=>new Date('2026-10-01T12:00:00-06:00')});
  const select=()=>{get('manualEventSlug').value=event.slug;ui.sync();};
  const input=(index,field,value)=>get('manualPerrunDogs').handlers.input({target:{dataset:{dog:String(index),field},value}});
  const toggle=value=>get('manualPerrunDogs').handlers.change({target:{id:'manualSecondDog',checked:value}});
  const body=()=>({buyerEmail:'owner@example.invalid',tickets:[{fullName:'Owner'}],distance:'3K',totalAmount:Number(get('totalAmount').value),transferReference:''});
  return {get,ui,select,input,toggle,body};
}
test('UI switches Perrun mode and restores editable legacy amount',()=>{
  const x=fixture();x.select();assert.equal(x.get('totalAmount').readOnly,true);assert.equal(x.get('addManualTicketBtn').hidden,true);assert.equal(x.get('manualPerrunDogs').hidden,false);assert.equal(Number(x.get('totalAmount').value),450);assert.match(x.get('manualPerrunPrice').textContent,/no está incluido/);
  x.get('manualEventSlug').value='cascanueces-run';x.ui.sync();assert.equal(x.get('totalAmount').readOnly,false);assert.equal(x.get('addManualTicketBtn').hidden,false);assert.equal(x.get('manualPerrunDogs').hidden,true);
});
test('UI S/M two dogs +180, derived category, L/XL pair blocked',()=>{
  const x=fixture();x.select();x.input(0,'dog_name','Luna');x.input(0,'dog_weight_kg','10');assert.equal(x.get('manualDogCategory0').value,'S');assert.equal(x.get('manualSecondDog').disabled,false);
  x.toggle(true);x.input(1,'dog_name','Sol');x.input(1,'dog_weight_kg','25');assert.equal(Number(x.get('totalAmount').value),630);assert.equal(x.get('manualDogCategory1').value,'M');assert.equal(x.ui.payload(x.body()).dogs.length,2);
  x.input(0,'dog_weight_kg','25.001');assert.equal(x.get('manualDogCategory0').value,'L');assert.throws(()=>x.ui.payload(x.body()),/S\/M/);
  x.toggle(false);assert.equal(x.get('manualSecondDog').disabled,true);assert.equal(x.get('manualDogGroup1').hidden,true);assert.equal(x.ui.payload(x.body()).dogs.length,1);
});
test('UI retains id and amount for identical retries and changes identity for changed payload',()=>{
  const x=fixture();x.select();x.input(0,'dog_name','Luna');x.input(0,'dog_weight_kg','10');const first=x.ui.payload(x.body());assert.equal(x.ui.payload({...x.body(),totalAmount:500}).manualPaymentId,first.manualPaymentId);assert.equal(x.ui.payload({...x.body(),totalAmount:500}).totalAmount,450);
  x.input(0,'dog_name','Sol');assert.notEqual(x.ui.payload(x.body()).manualPaymentId,first.manualPaymentId);
});
test('Price refresh preserves dog input and reset clears operation',()=>{
  const x=fixture();x.select();x.input(0,'dog_name','Luna');x.input(0,'dog_weight_kg','10');const first=x.ui.payload(x.body());x.ui.refreshPrice();assert.equal(x.ui.payload(x.body()).dogs[0].dog_name,'Luna');assert.notEqual(x.ui.payload(x.body()).manualPaymentId,first.manualPaymentId);x.ui.reset();assert.throws(()=>x.ui.payload(x.body()),/nombre/);
});
test('Actual panel scripts parse; Perrun uses shared distances and one human without BIB controls',()=>{
  const source=fs.readFileSync(require.resolve('../admin-inscripciones.html'),'utf8');
  for(const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
  assert.match(source,/manualPerrunUI\.isPerrun\(\) \? window\.KineticHubPerrunEvent\.distances/);
  assert.match(source,/manualTickets\.slice\(0, 1\)/);assert.match(source,/perrun \? 'hidden' : ''[\s\S]*?manualTicketBibMode/);
  assert.match(source,/body = manualPerrunUI\.payload\(body\)/);
});


test('UX order: dog 1, price context, second-dog control, dog 2',()=>{
  const x=fixture();x.select();const html=x.get('manualPerrunDogs').innerHTML;
  const ids=['manualDogGroup0','manualPerrunPrice','manualSecondDog','manualDogGroup1'];
  for(let i=1;i<ids.length;i++)assert.ok(html.indexOf(ids[i-1])<html.indexOf(ids[i]));
  assert.match(x.get('manualPerrunPrice').textContent,/Segundo perro: \+\$180 MXN/);
});
test('UX live total excludes engraving and returns to base when second dog removed',()=>{
  const x=fixture();x.select();assert.equal(x.get('manualPerrunTotal').textContent,'Total a registrar: $450 MXN');
  x.input(0,'dog_weight_kg','25');x.toggle(true);x.input(1,'engraving_requested','true');
  assert.equal(x.get('manualPerrunTotal').textContent,'Total a registrar: $630 MXN');
  x.toggle(false);assert.equal(x.get('manualPerrunTotal').textContent,'Total a registrar: $450 MXN');
});
test('UX 25 + 25 valid; 26 + 20 blocked inline; correction to 25 restores save',()=>{
  const x=fixture();x.select();x.input(0,'dog_name','Luna');x.input(0,'dog_weight_kg','25');x.toggle(true);
  x.input(1,'dog_name','Sol');x.input(1,'dog_weight_kg','25');assert.equal(x.get('saveManualTransferBtn').disabled,false);
  x.input(0,'dog_weight_kg','26');x.input(1,'dog_weight_kg','20');
  assert.equal(x.get('saveManualTransferBtn').disabled,true);assert.equal(x.get('manualPerrunDogError').hidden,false);
  assert.equal(x.get('manualPerrunDogError').textContent,'Para registrar 2 perros, ambos deben ser categoría S o M (máximo 25 kg cada uno).');
  assert.equal(x.get('manualDogGroup1').hidden,false);
  x.input(0,'dog_weight_kg','25');assert.equal(x.get('saveManualTransferBtn').disabled,false);assert.equal(x.get('manualPerrunDogError').hidden,true);
  assert.equal(x.ui.payload(x.body()).dogs[1].dog_name,'Sol');
  x.input(1,'dog_weight_kg','26');assert.equal(x.get('saveManualTransferBtn').disabled,true);
  x.input(1,'dog_weight_kg','2');assert.equal(x.get('saveManualTransferBtn').disabled,true);
});
test('UX busy state prevents re-enabling save while dogs change',()=>{
  const x=fixture();x.select();x.input(0,'dog_name','Luna');x.input(0,'dog_weight_kg','25');
  x.ui.setBusy(true);x.input(0,'dog_weight_kg','20');assert.equal(x.get('saveManualTransferBtn').disabled,true);
  x.ui.setBusy(false);assert.equal(x.get('saveManualTransferBtn').disabled,false);
});
test('UX birth date stays native and gets scoped dark styling',()=>{
  const html=fs.readFileSync(require.resolve('../admin-inscripciones.html'),'utf8');
  assert.match(html,/type="date"[\s\S]*?data-manual-field="birthDate"/);
  assert.match(html,/color-scheme: dark/);assert.match(html,/input\[type="date"\]:focus/);
  assert.match(html,/manualPerrunTotal[\s\S]*?id="saveManualTransferBtn"/);
});

test('UX correction keeps save blocked until remaining human fields are valid',()=>{
  let valid=false;const x=fixture(()=>valid);x.select();x.input(0,'dog_name','Luna');x.input(0,'dog_weight_kg','25');x.toggle(true);
  x.input(1,'dog_name','Sol');x.input(1,'dog_weight_kg','20');x.input(0,'dog_weight_kg','26');x.input(0,'dog_weight_kg','25');
  assert.equal(x.get('manualPerrunDogError').hidden,true);assert.equal(x.get('saveManualTransferBtn').disabled,true);
  valid=true;x.get('manualTransferForm').handlers.input();assert.equal(x.get('saveManualTransferBtn').disabled,false);
});
test('V2 manual quote shows benefits and surcharge, rejects mismatched received amount, confirms exact total',async()=>{
 const x=fixture();x.select();x.input(0,'dog_name','Dog');x.input(0,'dog_weight_kg','10');
 const quote={pricingModelVersion:2,baseAmount:450,secondDogFee:0,engravingAmount:35,total:485,reservationId:'fixture-reservation',quoteToken:'fixture-token',benefits:[{dogIndex:1,free:false,engravingRequested:true,surcharge:35}]};
 const request=async()=>({ok:true,json:async()=>quote});let confirmations=0;
 let input=x.ui.payload(x.body());await assert.rejects(x.ui.reserve(input,'mock-token',request,()=>{confirmations++;return true;}),/monto realmente recibido/);assert.equal(confirmations,0);assert.equal(x.get('totalAmount').readOnly,false);
 x.get('totalAmount').value='485';x.ui.update();assert.equal(x.get('totalAmount').value,'485');assert.match(x.get('manualPerrunPrice').textContent,/Grabado: \$35/);
 input=x.ui.payload(x.body());const result=await x.ui.reserve(input,'mock-token',request,()=>{confirmations++;return true;});assert.equal(result.totalAmount,485);assert.equal(result.reservationId,quote.reservationId);assert.equal(confirmations,1);
});
