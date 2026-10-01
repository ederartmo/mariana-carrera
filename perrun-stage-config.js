(function(root,factory){
  if(typeof module!=="undefined"&&module.exports)module.exports=factory();
  else root.KineticHubPerrunStageConfig=factory();
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const TIME_ZONE="America/Mexico_City";
  const SALES_CLOSE="2027-01-25T16:00:00-06:00";
  const stages=Object.freeze([
    Object.freeze({key:"presale",label:"Preventa",displayName:"Preventa",amount:450,start:null,end:"2026-11-01T00:00:00-06:00",period:"Hasta el 31 de octubre de 2026"}),
    Object.freeze({key:"general",label:"General",displayName:"General",amount:500,start:"2026-11-01T00:00:00-06:00",end:"2027-01-01T00:00:00-06:00",period:"1 de noviembre al 31 de diciembre de 2026"}),
    Object.freeze({key:"late",label:"Extemporánea",displayName:"Extemporánea",amount:550,start:"2027-01-01T00:00:00-06:00",end:SALES_CLOSE,period:"1 al 25 de enero de 2027, antes de las 16:00"})
  ]);
  function getPerrunStageByDate(value=new Date()){
    if(typeof value==="string"&&!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new TypeError("Timestamp must include timezone");
    const time=new Date(value).getTime();if(!Number.isFinite(time))throw new TypeError("Invalid timestamp");
    const stage=stages.find(s=>(s.start===null||time>=Date.parse(s.start))&&time<Date.parse(s.end));
    return stage?{...stage,price:stage.amount,isOpen:true,status:"OPEN"}:{key:"closed",label:"Inscripciones cerradas",displayName:"Inscripciones cerradas",amount:null,price:null,isOpen:false,status:"CLOSED"};
  }
  return Object.freeze({TIME_ZONE,SALES_CLOSE,PERRUN_STAGE_CATALOG:stages,getPerrunStageByDate});
});
