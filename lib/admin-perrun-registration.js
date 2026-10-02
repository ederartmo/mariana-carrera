'use strict';
const {getServiceClient,getAdminUser}=require('./_auth');
const {validateParticipant}=require('./_participant-validation');
const {enrichRegistrations}=require('./_perrun-operations');
function only(object,keys){return object && typeof object==='object' && !Array.isArray(object) && Object.keys(object).every(k=>keys.includes(k));}
module.exports=async function handler(req,res){
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido.'});
 res.setHeader?.('Cache-Control','no-store');
 try{
  const client=getServiceClient(),auth=await getAdminUser(req,{supabase:client});
  if(auth.error)return res.status(auth.status||401).json({error:auth.error});
  const body=req.body||{},orderId=String(req.method==='GET'?req.query?.orderSessionId:body.orderSessionId||'');
  if(!orderId || orderId.length>200)return res.status(400).json({error:'Orden inválida.'});
  if(req.method==='GET'){
   const [order,human]=await Promise.all([
    client.from('perrun_checkout_orders').select('order_session_id,buyer_email,owner_phone,admin_revision,ownership_revision,payment_source').eq('order_session_id',orderId).maybeSingle(),
    client.from('inscripciones').select('id,email,buyer_email,full_name,shirt_size,birth_date,whatsapp,state,borough,bib_number,distance,amount_paid,event_slug,order_session_id,payment_status,registration_status').eq('order_session_id',orderId).eq('event_slug','perrun-2027').maybeSingle()
   ]);
   if(order.error || human.error)throw Error('migration_required');
   if(!order.data || !human.data)return res.status(404).json({error:'Inscripción Perrun no encontrada.'});
   const [current]=await enrichRegistrations(client,[human.data]);
   return res.status(200).json({registration:current,order:order.data,expectedRevision:Number(order.data.admin_revision)});
  }
  if(!only(body,['orderSessionId','expectedRevision','participant','dogs','reason']) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0
   || !only(body.participant,['fullName','email','shirtSize','birthDate','whatsapp','state','borough'])
   || !Array.isArray(body.dogs) || ![1,2].includes(body.dogs.length)
   || body.dogs.some(d=>!only(d,['id','name','weightKg']) || typeof d.id!=='string' || typeof d.name!=='string' || !Number.isFinite(d.weightKg))
   || typeof body.reason!=='string' || body.reason.trim().length<3 || body.reason.trim().length>500)
   return res.status(400).json({error:'Campos de corrección inválidos.'});
  const email=String(body.participant.email||'').trim().toLowerCase();
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Correo inválido.'});
  let participant;try{participant=validateParticipant(body.participant);delete participant.age;participant.email=email;}catch(e){return res.status(400).json({error:e.message});}
  const result=await client.rpc('admin_update_perrun_registration',{p_order_session_id:orderId,p_expected_revision:body.expectedRevision,
   p_participant:participant,p_dogs:body.dogs,p_reason:body.reason.trim(),p_admin_user_id:auth.user.id,p_admin_email:auth.email});
  if(result.error){
   if(result.error.message==='PERRUN_REVISION_CONFLICT')return res.status(409).json({error:'Otro administrador editó esta inscripción. Recarga antes de guardar.'});
   if(['P0001','23514','23505','22007','22008','22P02','P0002','P0003'].includes(result.error.code))return res.status(409).json({error:'La corrección no es válida o la inscripción cambió. Recarga y verifica pesos, placa e identidad.'});
   throw Error('correction_unavailable');
  }
  return res.status(200).json({ok:true,...result.data});
 }catch(e){return res.status(503).json({error:'Edición Perrun no disponible. Verifica que la migración admin esté instalada.'});}
};
