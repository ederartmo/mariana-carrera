(function(root,factory){if(typeof module!=='undefined'&&module.exports)module.exports=factory;else root.createPerrunProductionUI=factory;})(typeof globalThis!=='undefined'?globalThis:this,function({document,root,getToken,fetch:request=window.fetch.bind(window),confirm:confirmClose=window.confirm.bind(window),uuid=()=>globalThis.crypto.randomUUID(),download}){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=n=>String(n).padStart(3,'0');
 const labels={not_started:'No iniciada',preparing:'En preparación',engraved:'Grabada',skipped:'Omitida'};
 const warning='Al cerrar este lote se asignarán números de producción definitivos. Los números y snapshots del lote ya no podrán renumerarse.';
 let state=null,selected=new Set(),busy=false,pendingId=null,message='';
 const style=document.createElement('style');style.textContent='.perrun-production-panel{padding:18px}.perrun-production-panel .production-summary{display:flex;gap:20px;flex-wrap:wrap}.perrun-production-panel .production-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.perrun-production-panel button{min-height:44px}.perrun-production-panel .production-table{overflow:auto}.perrun-production-panel table{width:100%;border-collapse:collapse}.perrun-production-panel th,.perrun-production-panel td{padding:10px;text-align:left;border-bottom:1px solid #d6dfda;vertical-align:top}.perrun-production-panel input[type=checkbox]{width:22px;height:22px}.perrun-production-panel label{display:flex;gap:10px;align-items:center;min-height:44px}.perrun-production-panel .production-warning{padding:12px;background:#fff5da;border-radius:8px}.perrun-production-panel .production-feedback{color:#963817;overflow-wrap:anywhere}';document.head.appendChild(style);
 root.classList.add('perrun-production-panel');
 async function call(method,body,query=''){
  const token=await getToken();if(!token)throw Error('Sesión no válida.');
  const response=await request('/api/data?action=admin-perrun-production'+query,{method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(query.includes('format=csv')&&response.ok)return response.blob();
  const data=await response.json();if(!response.ok)throw Error(data.error||'Producción no disponible.');return data;
 }
 function accept(data){state=data;selected=new Set((data.items||[]).map(i=>i.registration_id));pendingId=null;render();}
 function dates(value){return value?new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(value)):'';}
 function rows(){
  if(state?.batch?.status==='closed')return state.items.map(i=>({id:i.registration_id,s:i.snapshot,n:i.production_number,bib:i.bib_number}));
  const candidates=new Map((state?.candidates||[]).map(s=>[s.registration_id,{id:s.registration_id,s,n:null,bib:s.bib_number}]));
  for(const i of state?.items||[])if(!candidates.has(i.registration_id))candidates.set(i.registration_id,{id:i.registration_id,s:i.preview,n:null,bib:i.bib_number});
  return [...candidates.values()].sort((a,b)=>Number(a.bib)-Number(b.bib)||a.id.localeCompare(b.id));
 }
 function render(){
  if(!state){root.innerHTML='<p>Revisa los participantes pagados y activos antes de crear un lote. No se asignan números al crear un borrador.</p><button type="button" data-production="load">Cargar producción</button><p class="production-feedback" role="status">'+esc(message)+'</p>';return;}
  const b=state.batch,closed=b?.status==='closed',items=rows(),stored=new Set((state.items||[]).map(i=>i.registration_id));
  const dirty=b&&!closed&&(selected.size!==stored.size||[...selected].some(id=>!stored.has(id)));
  root.innerHTML='<div class="production-summary"><span>Pendientes de producción: <strong>'+esc(state.summary.pending)+'</strong></span><span>Ya en producción: <strong>'+esc(state.summary.produced)+'</strong></span><span>Lotes cerrados: <strong>'+esc(state.summary.closed_batches)+'</strong></span></div>'
   +'<div class="production-actions"><button type="button" data-production="new">Nuevo lote</button><button type="button" data-production="load">Recargar</button></div>'
   +'<div class="production-actions">'+state.batches.map(x=>'<button type="button" data-production="view" data-batch="'+esc(x.id)+'">'+(x.status==='closed'?'Lote cerrado':'Ver borrador')+' · '+esc(x.id.slice(0,8))+' · '+esc(x.item_count)+' participantes</button>').join('')+'</div>'
   +'<h3>'+(closed?'Lote cerrado · '+esc(dates(b.closed_at)):b?'Borrador · Revisa y guarda la selección':'Candidatos · Selecciona quién entra')+'</h3>'
   +(closed?'<p>Datos congelados al cierre. Esta tabla y el CSV usan el snapshot histórico.</p>':'<p>Número de producción: <strong>Se asignará al cerrar</strong>. El BIB no cambia.</p>')
   +'<div class="production-table"><table><thead><tr>'+(closed?'<th>Producción</th>':'<th>Incluir</th>')+'<th>BIB</th><th>Participante</th><th>Talla</th><th>Distancia</th><th>Perros</th><th>Estado de placa</th></tr></thead><tbody>'
   +items.map(r=>'<tr><td>'+(closed?esc(number(r.n)):'<label><input type="checkbox" data-registration="'+esc(r.id)+'" '+(selected.has(r.id)?'checked':'')+' '+(busy?'disabled':'')+'><span class="sr-only">Incluir BIB '+esc(r.bib)+'</span></label>')+'</td><td>'+esc(r.bib)+'</td><td>'+esc(r.s?.participant.name||'Ya no elegible')+'</td><td>'+esc(r.s?.participant.shirt_size)+'</td><td>'+esc(r.s?.participant.distance)+'</td><td>'+esc((r.s?.dogs||[]).map(d=>d.name+' · '+d.weight_kg+' kg · '+d.category+' · Grabado #'+d.engraving_sequence).join('; '))+'</td><td>'+esc((r.s?.dogs||[]).map(d=>labels[d.plate_status]||d.plate_status).join('; '))+'</td></tr>').join('')+'</tbody></table></div>'
   +'<p>'+esc(closed?b.item_count:selected.size)+' participantes '+(closed?'en este lote':'seleccionados')+'</p>'
   +(closed?'<button type="button" data-production="export">Exportar CSV de lote cerrado</button>':'<p class="production-warning">'+warning+'</p><div class="production-actions"><button type="button" data-production="save" '+(busy||!selected.size?'disabled':'')+'>'+(b?'Guardar selección':'Crear lote')+'</button>'+(b?'<button type="button" data-production="close" '+(busy||dirty||!selected.size?'disabled':'')+'>Cerrar lote</button>':'')+'</div>'+(dirty?'<p>Guarda la selección antes de cerrar.</p>':''))
   +'<p class="production-feedback" role="status" aria-live="polite">'+esc(message)+'</p>';
  if(busy)for(const button of root.querySelectorAll('button'))button.disabled=true;
 }
 async function act(operation,id){
  if(busy)return;
  if(operation==='new'){state={...state,batch:null,items:[]};selected=new Set();pendingId=null;message='';render();return;}
  if(operation==='close'&&!confirmClose(warning+'\n¿Confirmas el cierre definitivo?'))return;
  busy=true;message='';render();
  try{
   if(operation==='load'||operation==='view'){accept(await call('GET',null,operation==='view'?'&batchId='+encodeURIComponent(id):state?.batch?'&batchId='+encodeURIComponent(state.batch.id):''));}
   else if(operation==='save'){
    pendingId=pendingId||uuid();accept(await call('POST',{operation:'save',batchId:state.batch?.id||pendingId,expectedRevision:state.batch?.revision??null,registrationIds:[...selected]}));
   }else if(operation==='close')accept(await call('POST',{operation:'close',batchId:state.batch.id,expectedRevision:state.batch.revision,confirm:true}));
   else if(operation==='export'){
    const blob=await call('GET',null,'&batchId='+encodeURIComponent(state.batch.id)+'&format=csv');
    if(download)download(blob,state.batch.id);else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='perrun-production-'+state.batch.id+'.csv';a.click();URL.revokeObjectURL(url);}
   }
  }catch(e){message=e.message;}finally{busy=false;render();}
 }
 root.addEventListener('click',e=>{const b=e.target.closest('[data-production]');if(b&&!b.disabled)act(b.dataset.production,b.dataset.batch);});
 root.addEventListener('change',e=>{const id=e.target.dataset.registration;if(!id||busy)return;if(e.target.checked)selected.add(id);else selected.delete(id);pendingId=null;render();});
 render();return {act,accept,render,warning,get state(){return state;}};
});
