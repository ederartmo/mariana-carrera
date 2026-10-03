'use strict';
const {getServiceClient,getAdminUser}=require('./_auth');
const {productionCsv}=require('./_perrun-production');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
module.exports=async function(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido.'});
 res.setHeader('Cache-Control','no-store');
 try{
  const client=getServiceClient(),auth=await getAdminUser(req,{supabase:client});
  if(auth.error)return res.status(auth.status||401).json({error:auth.error});
  let name,args;
  if(req.method==='GET'){
   const id=req.query?.batchId;
   if(id!==undefined&&!UUID.test(id))return res.status(400).json({error:'Lote inválido.'});
   if(req.query?.format!==undefined&&req.query.format!=='csv')return res.status(400).json({error:'Formato inválido.'});
   if(req.query?.format==='csv'&&!id)return res.status(400).json({error:'Selecciona un lote cerrado.'});
   name='admin_read_perrun_production';args={p_batch_id:id||null};
  }else{
   const b=req.body||{};
   if(!['save','close'].includes(b.operation)||!UUID.test(b.batchId)||Object.keys(b).some(k=>!['operation','batchId','expectedRevision','registrationIds','confirm'].includes(k))
    ||(b.expectedRevision!==null&&(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0)))return res.status(400).json({error:'Operación de producción inválida.'});
   if(b.operation==='close'){
    if(b.confirm!==true||b.expectedRevision===null||b.registrationIds!==undefined)return res.status(400).json({error:'Confirma el cierre definitivo del lote.'});
    name='admin_close_perrun_production_batch';
   }else{
    if(b.confirm!==undefined||!Array.isArray(b.registrationIds)||b.registrationIds.length>1000||b.registrationIds.some(id=>!UUID.test(id))||new Set(b.registrationIds).size!==b.registrationIds.length)return res.status(400).json({error:'Selección de participantes inválida.'});
    name='admin_save_perrun_production_batch';
   }
   args={p_batch_id:b.batchId,p_expected_revision:b.expectedRevision,p_admin_user_id:auth.user.id,p_admin_email:auth.email};
   if(b.operation==='save')args.p_registration_ids=b.registrationIds;
  }
  const result=await client.rpc(name,args);
  if(result.error){
   if(result.error.message==='PRODUCTION_BATCH_NOT_FOUND')return res.status(404).json({error:'Lote no encontrado.'});
   if(['P0001','23505','23514','22023'].includes(result.error.code))return res.status(409).json({error:'El lote o sus participantes cambiaron. Recarga y revisa antes de continuar.'});
   throw Error('Production unavailable');
  }
  if(req.query?.format==='csv'){
   if(result.data?.batch?.status!=='closed')return res.status(409).json({error:'El CSV sólo está disponible para lotes cerrados.'});
   res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="perrun-production-'+req.query.batchId+'.csv"');
   return res.status(200).send(productionCsv(result.data.items));
  }
  return res.status(200).json(result.data);
 }catch{return res.status(503).json({error:'Producción Perrun no disponible. Verifica que su migración esté instalada.'});}
};
