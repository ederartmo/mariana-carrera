(function(root,factory){
  if(typeof module!=="undefined"&&module.exports)module.exports=factory(require('./axolote-stage-config'),require('./cascanueces-stage-config'),require('./perrun-event-data'));
  else root.KineticHubEventCatalog=factory(root.KineticHubStageConfig,root.KineticHubCascanuecesStageConfig,root.KineticHubPerrunEvent);
})(typeof globalThis!=="undefined"?globalThis:this,function(axolote,cascanueces,perrun){
  const events=Object.freeze({
    'axolote-night-run':Object.freeze({slug:'axolote-night-run',name:'Axolote Night Run 2026',statementDescriptorSuffix:'AXOLOTE',distances:Object.freeze(['5K']),defaultDistance:'5K',getStage:axolote?.getAxoloteStageByDate,checkoutEnabled:true}),
    'cascanueces-run':Object.freeze({slug:'cascanueces-run',name:'Cascanueces Run 2026',statementDescriptorSuffix:'CASCANUEZ',distances:Object.freeze(['5K','10K']),defaultDistance:'5K',getStage:cascanueces?.getCascanuecesStageByDate,checkoutEnabled:true,priceEnvironmentVariables:Object.freeze({preventa:'STRIPE_CASCANUECES_PREVENTA_PRICE_ID',acceso_general:'STRIPE_CASCANUECES_GENERAL_PRICE_ID',ultimo_minuto:'STRIPE_CASCANUECES_LAST_MINUTE_PRICE_ID'})}),
    [perrun.slug]:Object.freeze({...perrun,statementDescriptorSuffix:'PERRUN',getStage:perrun.pricing.getCurrentStage})
  });
  // Dashboard prerequisite: shortened card descriptor KINETICHUB (10 chars).
  // Stripe adds "* " (2 chars); the full descriptor must be 5–22 chars.
  // Conservative ASCII allowlist; never truncate or inherit another race's suffix.
  const STRIPE_DESCRIPTOR_PREFIX='KINETICHUB';
  function validateStatementDescriptorSuffix(event){
    const suffix=event?.statementDescriptorSuffix;
    const label=event?.slug||'unknown event';
    if(typeof suffix!=='string'||!suffix)throw new Error(`Stripe statementDescriptorSuffix is required for ${label}`);
    if(!/^[A-Z0-9 -]+$/.test(suffix)||!/[A-Z]/.test(suffix)||suffix!==suffix.trim())throw new Error(`Invalid Stripe statementDescriptorSuffix for ${label}: use uppercase ASCII letters, digits, spaces or hyphens, with at least one letter`);
    const length=STRIPE_DESCRIPTOR_PREFIX.length+2+suffix.length;
    if(length<5||length>22)throw new Error(`Invalid Stripe statementDescriptorSuffix length for ${label}: maximum ${22-STRIPE_DESCRIPTOR_PREFIX.length-2} characters with prefix ${STRIPE_DESCRIPTOR_PREFIX}`);
    return suffix;
  }
  Object.values(events).forEach(validateStatementDescriptorSuffix);
  function getStatementDescriptorSuffix(slug){
    return validateStatementDescriptorSuffix(resolveEvent(slug));
  }
  function resolveEvent(slug){return events[String(slug||'').trim().toLowerCase()]||null;}
  function resolveEventSelection(slug,distance){
    const event=resolveEvent(slug||'axolote-night-run');if(!event)return null;
    const selected=String(distance||event.defaultDistance||'').trim().toUpperCase();if(!event.distances.includes(selected))return null;
    return {...event,distance:selected};
  }
  return Object.freeze({events,resolveEvent,resolveEventSelection,STRIPE_DESCRIPTOR_PREFIX,validateStatementDescriptorSuffix,getStatementDescriptorSuffix});
});
