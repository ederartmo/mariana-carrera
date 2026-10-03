'use strict';
const CSV_COLUMNS=['production_number','bib_number','nombre','talla','distancia','telefono','cantidad_perros',
 ...[1,2].flatMap(i=>['name','weight','category','engraving_sequence','plate_status','printed_name','printed_phone'].map(k=>'dog_'+i+'_'+k))];
function productionCsv(items){
 const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[CSV_COLUMNS];
 for(const item of [...items].sort((a,b)=>a.production_number-b.production_number)){
  const s=item.snapshot;if(!s||s.schema_version!==1||!item.production_number)throw Error('Closed snapshot required');
  rows.push([String(s.production_number).padStart(3,'0'),s.bib_number,s.participant.name,s.participant.shirt_size,s.participant.distance,s.participant.phone,s.dog_count,
   ...[0,1].flatMap(i=>{const d=s.dogs[i]||{};return [d.name,d.weight_kg,d.category,d.engraving_sequence,d.plate_status,d.dog_name_for_plate,d.owner_phone_for_plate];})]);
 }
 return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
async function productionInfo(client,orderId){
 const r=await client.from('perrun_production_items').select('batch_id,production_number').eq('order_session_id',orderId).eq('event_slug','perrun-2027');
 if(r.error){if(['42P01','PGRST205'].includes(r.error.code))return {production_status:'not_available',production_batch_id:null,production_number:null};throw Error('Production information unavailable');}
 const rows=(r.data||[]).filter(i=>i.production_number!=null);if(rows.length>1)throw Error('Production identity conflict');
 return rows.length?{production_status:'closed',production_batch_id:rows[0].batch_id,production_number:rows[0].production_number}
 :{production_status:'not_produced',production_batch_id:null,production_number:null};
}
module.exports={productionCsv,productionInfo,CSV_COLUMNS};
