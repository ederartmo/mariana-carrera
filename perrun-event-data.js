(function(root,factory){
  if(typeof module!=="undefined"&&module.exports)module.exports=factory(require('./perrun-stage-config'));
  else root.KineticHubPerrunEvent=factory(root.KineticHubPerrunStageConfig);
})(typeof globalThis!=="undefined"?globalThis:this,function(stageConfig){
  if(!stageConfig)throw new Error("Perrun stage configuration required");
  const dogRules=Object.freeze({secondDogFee:180,engravingPaidPrice:35,freeEngravingLimit:300,maxDogs:2,
    categories:Object.freeze([Object.freeze({key:"S",min:3,max:10,minInclusive:true,maxDogs:2}),Object.freeze({key:"M",min:10,max:25,minInclusive:false,maxDogs:2}),Object.freeze({key:"L",min:25,max:50,minInclusive:false,maxDogs:1}),Object.freeze({key:"XL",min:50,max:80,minInclusive:false,maxDogs:1})])});
  function categoryForWeight(weight){
    if(typeof weight!=="number"||!Number.isFinite(weight))throw new RangeError("Invalid dog weight");
    const category=dogRules.categories.find(c=>(c.minInclusive?weight>=c.min:weight>c.min)&&weight<=c.max);
    if(!category)throw new RangeError("Dog weight must be between 3 and 80 kg");return category.key;
  }
  function validateDogWeights(weights){
    if(!Array.isArray(weights)||weights.length<1||weights.length>dogRules.maxDogs)throw new RangeError("One or two dogs required");
    const categories=weights.map(categoryForWeight);if(categories.length===2&&categories.some(key=>dogRules.categories.find(c=>c.key===key).maxDogs<weights.length))throw new RangeError("Two dogs allowed only when both are S/M");return categories;
  }
  const location=Object.freeze({name:'Bosque de San Juan de Aragón',city:'CDMX'});
  const distances=Object.freeze(['1K','3K','5K']);
  function validateDistance(value){const distance=String(value||'').trim().toUpperCase();if(!distances.includes(distance))throw new RangeError("Invalid Perrun distance");return distance;}
  return Object.freeze({slug:'perrun-2027',name:'Perrun 2027',date:Object.freeze({iso:'2027-02-14',label:'14 de febrero de 2027'}),
    location,timeZone:stageConfig.TIME_ZONE,distances,recreational:true,awards:false,
    checkoutEnabled:false,featured:false,detailUrl:'eventos.html',
    pricing:Object.freeze({currency:'MXN',stages:stageConfig.PERRUN_STAGE_CATALOG,salesClose:stageConfig.SALES_CLOSE,getCurrentStage:stageConfig.getPerrunStageByDate}),
    dogRules,categoryForWeight,validateDogWeights,validateDistance,
    dogKit:Object.freeze(['Bandana','Servicio veterinario','Placa conmemorativa']),humanKit:Object.freeze(['Número','Playera']),
    pickup:Object.freeze({date:'2027-02-12',start:'10:00',end:'16:00',location:location.name,timeZone:stageConfig.TIME_ZONE})});
});
