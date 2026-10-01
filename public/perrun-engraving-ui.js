(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function button(order,index,allowed){return allowed?'<button type="button" class="profile-race-pay-btn" data-engraving-order="'+esc(order)+'" data-engraving-dog-index="'+esc(index)+'">Pagar grabado — $35 MXN</button><span role="status" data-engraving-message></span>':'';}
 async function pay(button){
  button.disabled=true;const message=button.parentElement.querySelector('[data-engraving-message]');if(message)message.textContent='Preparando pago…';
  try{
   const headers={'Content-Type':'application/json'};
   if(root.location.pathname.endsWith('/perfil.html')){const client=root.KineticHubSupabase?.getClient();const result=await client?.auth.getSession();if(result?.data?.session?.access_token)headers.Authorization='Bearer '+result.data.session.access_token;}
   const response=await root.fetch('/api/create-checkout-session',{method:'POST',credentials:'same-origin',headers,body:JSON.stringify({flow:'perrun-engraving-v1',orderSessionId:button.dataset.engravingOrder,dogIndex:Number(button.dataset.engravingDogIndex)})});
   const data=await response.json();if(!response.ok)throw Error('No se pudo preparar el grabado. Actualiza el estado o verifica tu sesión.');
   if(data.refresh){if(message)message.textContent='Pago pendiente de confirmación. Actualiza esta página para consultar el estado.';return;}
   const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Destino de pago inválido.');root.location.assign(url.href);
  }catch(error){button.disabled=false;if(message)message.textContent=error.message;}
 }
 root.KineticHubEngraving={button,pay};
 if(root.document)root.document.addEventListener('click',event=>{const target=event.target.closest?.('[data-engraving-order]');if(target&&!target.disabled)pay(target);});
})(typeof window==='undefined'?globalThis:window);
