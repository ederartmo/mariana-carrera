(function(root,factory){
 if(typeof module!=='undefined'&&module.exports)module.exports=factory;
 else root.createPerrunEditUI=factory;
})(typeof globalThis!=='undefined'?globalThis:this,function({document,getToken,refresh,fetch:request=window.fetch.bind(window),catalog=window.KineticHubLocationCatalog,event=window.KineticHubPerrunEvent}){
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const locked=d=>d.plate_status!=='not_started'||!!d.plate_started_at;
 const dialog=document.createElement('dialog');dialog.className='perrun-edit-dialog';dialog.setAttribute('aria-labelledby','perrunEditTitle');document.body.appendChild(dialog);
 const style=document.createElement('style');style.textContent='.perrun-edit-dialog{box-sizing:border-box;width:min(760px,calc(100% - 24px));max-height:90dvh;overflow:auto;border:0;border-radius:14px;padding:24px;color:#17352c}.perrun-edit-dialog::backdrop{background:#0008}.perrun-edit-dialog form{display:grid;gap:16px}.perrun-edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.perrun-edit-dialog label{display:grid;gap:6px}.perrun-edit-dialog input,.perrun-edit-dialog select,.perrun-edit-dialog textarea{box-sizing:border-box;min-width:0;width:100%;padding:10px;border:1px solid #b3c3bd;border-radius:6px;font:inherit}.perrun-edit-dialog fieldset{min-width:0;border:1px solid #ccd7d1;border-radius:8px;padding:14px}.perrun-edit-dialog .readonly,.perrun-edit-dialog input:disabled,.perrun-edit-dialog select:disabled{background:#edf1f0;color:#63736d;border-color:#d0d9d5;cursor:not-allowed;opacity:1;-webkit-text-fill-color:#63736d}.perrun-edit-dialog .readonly-field{display:grid;gap:6px;min-width:0}.perrun-edit-dialog .readonly-field output{display:block;box-sizing:border-box;width:100%;min-height:44px;padding:10px;border:1px solid #d0d9d5;border-radius:6px;white-space:normal;overflow-wrap:anywhere;line-height:1.45}.perrun-edit-dialog .readonly-tag{display:inline-block;margin-left:6px;font-size:11px;font-weight:500;color:#6d7b75}.perrun-edit-dialog label>span{line-height:1.4}.perrun-edit-dialog button{min-height:44px;padding:10px 18px;cursor:pointer}.perrun-edit-dialog .warning{background:#fff5da;padding:10px;border-radius:6px}.perrun-edit-dialog .feedback{color:#963817}.perrun-edit-dialog footer{display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap}@media(max-width:480px){.perrun-edit-dialog{padding:16px}.perrun-edit-grid{grid-template-columns:1fr}}';document.head.appendChild(style);
 let current=null,busy=false,generation=0;
 const field=(name,label,value,type='text',extra='')=>'<label><span>'+label+(extra.includes('readonly')||extra.includes('disabled')?'<small class="readonly-tag">Solo lectura</small>':'')+'</span><input name="'+name+'" type="'+type+'" value="'+escape(value)+'" '+extra+'></label>';
 const ro=(label,value)=>{
  const labels={stripe:'Stripe',manual_transfer:'Transferencia',preparing:'En preparación',engraved:'Grabada',not_started:'No iniciada',skipped:'Omitida',free:'Gratis',pending:'Pendiente',paid:'Pagado',refunded:'Reembolsado'};
  let visible=value??'—';
  if(['Origen de pago','Pago de grabado','Estado de placa'].includes(label))visible=labels[visible]??visible;
  if(label==='Inicio de placa'&&value){const date=new Date(value);visible=Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City'}).format(date);}
  return '<div class="readonly-field"><span>'+escape(label)+'<small class="readonly-tag">Solo lectura</small></span><output class="readonly" aria-label="'+escape(label)+'">'+escape(visible)+'</output></div>';
 };
 const opts=(values,selected)=>values.map(v=>'<option '+(v===selected?'selected':'')+' value="'+escape(v)+'">'+escape(v)+'</option>').join('');
 function render(data){
  current=data;const h=data.registration,o=data.order;
  dialog.innerHTML='<form><h2 id="perrunEditTitle">Editar inscripción Perrun</h2><p>No cambia la compra original, pagos, dorsal ni posiciones. No envía correo al guardar.</p><div class="perrun-edit-grid">'
   +ro('BIB',String(h.bib_number||'').padStart(3,'0'))+ro('Distancia',h.distance)+ro('Monto pagado',Number(h.amount_paid).toFixed(2)+' MXN')+ro('Origen de pago',o.payment_source||'stripe')+ro('Cantidad de perros',h.dogs.length)+ro('Teléfono original de compra',o.owner_phone)
   +(h.production_status==='closed'?ro('Número de producción',String(h.production_number).padStart(3,'0')):'')+'</div>'
   +(h.production_status==='closed'?'<p class="warning">Esta inscripción ya pertenece a un lote de producción cerrado. Las correcciones actuales no modificarán los datos que ya fueron enviados a producción.</p>':'')+'<fieldset><legend>Participante</legend><div class="perrun-edit-grid">'
   +field('fullName','Nombre completo',h.full_name,'text','required maxlength="80" minlength="3"')+field('email','Correo',h.email,'email','required maxlength="254"')
   +'<label>Talla<select name="shirtSize">'+opts(['XS','S','M','L','XL','XXL','XXXL'],h.shirt_size)+'</select></label>'
   +field('birthDate','Nacimiento (AAAA-MM-DD)',String(h.birth_date||'').slice(0,10),'text','required pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" placeholder="AAAA-MM-DD"')
   +field('whatsapp','Teléfono actual',h.whatsapp||o.owner_phone,'tel','required')
   +'<label>Estado<select name="state">'+opts(catalog.STATES,h.state)+'</select></label><label>Alcaldía<select name="borough"></select></label></div><p class="warning">Cambiar el correo también cambia qué cuenta puede ver esta inscripción.</p></fieldset>'
   +h.dogs.map((d,i)=>'<fieldset><legend>Perro '+(i+1)+'</legend><div class="perrun-edit-grid">'+field('dogName'+i,'Nombre',d.dog_name,'text','required maxlength="80" '+(locked(d)?'disabled':''))
    +field('dogWeight'+i,'Peso (kg)',d.weight_kg,'number','required min="3" max="'+(h.dogs.length===2?'25':'80')+'" step="any"')+field('dogCategory'+i,'Categoría derivada',d.dog_size||d.category,'text','readonly class="readonly"')
    +ro('Posición de grabado',d.engraving_sequence)+ro('Grabado solicitado',d.engraving_requested?'Sí':'No')+ro('Gratuito',d.engraving_free?'Sí':'No')+ro('Estado de grabado',d.engraving_status)
    +ro('Pago adicional requerido',d.engraving_payment_required?'Sí':'No')+ro('Pago de grabado',d.engraving_payment_status||'Sin pago')+ro('Estado de placa',d.plate_status)
    +ro('Nombre impreso',d.dog_name_for_plate)+ro('Teléfono impreso',d.owner_phone_for_plate)+ro('Inicio de placa',d.plate_started_at)+'</div>'+(locked(d)?'<p class="warning">Este dato ya no puede modificarse porque la placa entró a producción.</p>':'')+'</fieldset>').join('')
   +'<label>Motivo de corrección (obligatorio)<textarea name="reason" required minlength="3" maxlength="500" placeholder="Ej. Corrección solicitada por el participante"></textarea></label><p class="feedback" role="status" aria-live="polite"></p><footer><button type="button" data-cancel>Cancelar</button><button type="submit">Guardar cambios</button></footer></form>';
  const form=dialog.querySelector('form'),f=form.elements;
  function borough(selected){const applicable=catalog.isCdmxState(f.state.value);f.borough.disabled=!applicable;f.borough.required=applicable;f.borough.innerHTML=applicable?'<option value="">Selecciona alcaldía</option>'+opts(catalog.CDMX_BOROUGHS,selected):'<option value="">No aplica</option>';}
  borough(h.borough);f.state.addEventListener('change',()=>borough(null));
  h.dogs.forEach((d,i)=>f['dogWeight'+i].addEventListener('input',()=>{try{f['dogCategory'+i].value=event.categoryForWeight(Number(f['dogWeight'+i].value));}catch{f['dogCategory'+i].value='—';}}));
  dialog.querySelector('[data-cancel]').onclick=()=>{if(!busy){generation++;dialog.close();}};
  form.onsubmit=async e=>{e.preventDefault();if(busy||!form.reportValidity())return;busy=true;form.querySelector('button[type="submit"]').disabled=true;
   const payload={orderSessionId:o.order_session_id,expectedRevision:current.expectedRevision,reason:f.reason.value,
    participant:Object.fromEntries(['fullName','email','shirtSize','birthDate','whatsapp','state'].map(k=>[k,f[k].value])),dogs:h.dogs.map((d,i)=>({id:d.id,name:locked(d)?d.dog_name:f['dogName'+i].value,weightKg:Number(f['dogWeight'+i].value)}))};payload.participant.borough=f.borough.disabled?null:f.borough.value;
   try{await call('POST',payload);dialog.close();await refresh();}catch(error){dialog.querySelector('.feedback').textContent=error.message;}finally{busy=false;form.querySelector('button[type="submit"]').disabled=false;}
  };
 }
 async function call(method,data){const token=await getToken();if(!token)throw Error('Sesión no válida.');const response=await request('/api/data?action=admin-perrun-registration'+(method==='GET'?'&orderSessionId='+encodeURIComponent(data):''),{method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo consultar la inscripción.');return result;}
 async function open(orderId){if(busy)return;const n=++generation;dialog.innerHTML='<h2 id="perrunEditTitle">Editar inscripción Perrun</h2><p role="status">Cargando…</p>';if(!dialog.open)dialog.showModal();try{const result=await call('GET',orderId);if(n===generation)render(result);}catch(error){if(n===generation){dialog.innerHTML='<h2 id="perrunEditTitle">Editar inscripción Perrun</h2><p role="alert">'+escape(error.message)+'</p><button type="button">Cerrar</button>';dialog.querySelector('button').onclick=()=>dialog.close();}}}
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else generation++;});
 document.addEventListener('click',e=>{const button=e.target.closest('[data-perrun-edit-order]');if(button)open(button.dataset.perrunEditOrder);});
 return {open,render,locked,dialog};
});
