'use strict';
const {getServiceClient,getAdminUser}=require('./_auth');
module.exports=async function(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido.'});
 res.setHeader?.('Cache-Control','no-store');
 try{
  const client=getServiceClient(),auth=await getAdminUser(req,{supabase:client});
  if(auth.error)return res.status(auth.status||401).json({error:auth.error});
  const b=req.body;
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['orderSessionId','expectedRevision','reason','confirm'].includes(k))
   ||typeof b.orderSessionId!=='string'||!b.orderSessionId.trim()||b.orderSessionId.length>255
   ||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<0||b.confirm!==true
   ||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.trim().length>500)
   return res.status(400).json({error:'Confirma la anulación e indica un motivo de 3 a 500 caracteres.'});
  const r=await client.rpc('admin_annul_perrun_participation',{p_order_session_id:b.orderSessionId.trim(),p_expected_revision:b.expectedRevision,
   p_reason:b.reason.trim(),p_admin_user_id:auth.user.id,p_admin_email:auth.email});
  if(r.error){if(['P0001','P0002','23514','23505','55P03'].includes(r.error.code))return res.status(409).json({error:'La inscripción cambió o no puede anularse. Recarga y revisa antes de continuar.'});throw Error('annul_unavailable');}
  return res.status(200).json({ok:true,...r.data});
 }catch{return res.status(503).json({error:'Anulación Perrun no disponible.'});}
};
