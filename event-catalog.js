(function(root,factory){
  if(typeof module!=="undefined"&&module.exports)module.exports=factory(require('./axolote-stage-config'),require('./cascanueces-stage-config'),require('./perrun-event-data'));
  else root.KineticHubEventCatalog=factory(root.KineticHubStageConfig,root.KineticHubCascanuecesStageConfig,root.KineticHubPerrunEvent);
})(typeof globalThis!=="undefined"?globalThis:this,function(axolote,cascanueces,perrun){
  const events=Object.freeze({
    'axolote-night-run':Object.freeze({slug:'axolote-night-run',name:'Axolote Night Run 2026',distances:Object.freeze(['5K']),defaultDistance:'5K',getStage:axolote?.getAxoloteStageByDate,checkoutEnabled:true}),
    'cascanueces-run':Object.freeze({slug:'cascanueces-run',name:'Cascanueces Run 2026',distances:Object.freeze(['5K','10K']),defaultDistance:'5K',getStage:cascanueces?.getCascanuecesStageByDate,checkoutEnabled:true,priceEnvironmentVariables:Object.freeze({preventa:'STRIPE_CASCANUECES_PREVENTA_PRICE_ID',acceso_general:'STRIPE_CASCANUECES_GENERAL_PRICE_ID',ultimo_minuto:'STRIPE_CASCANUECES_LAST_MINUTE_PRICE_ID'})}),
    [perrun.slug]:Object.freeze({...perrun,getStage:perrun.pricing.getCurrentStage})
  });
  function resolveEvent(slug){return events[String(slug||'').trim().toLowerCase()]||null;}
  function resolveEventSelection(slug,distance){
    const event=resolveEvent(slug||'axolote-night-run');if(!event)return null;
    const selected=String(distance||event.defaultDistance||'').trim().toUpperCase();if(!event.distances.includes(selected))return null;
    return {...event,distance:selected};
  }
  return Object.freeze({events,resolveEvent,resolveEventSelection});
});
