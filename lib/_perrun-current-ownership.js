'use strict';
const { verifyCheckoutSummaryClaim } = require('./_checkout-summary-claim');
const { getAuthenticatedUser } = require('./_auth');
// Original checkout cookies are permanently revoked after the first email correction.
// A current, verified profile JWT then proves ownership; no Supabase Auth mutation.
async function authorizePerrunOrder(req, client, orderId) {
 const claim = !orderId.startsWith('manual_perrun_') && verifyCheckoutSummaryClaim(req.headers?.cookie, orderId).ok;
 let auth;
 if (!claim) { auth = await getAuthenticatedUser(req, {supabase:client}); if(auth.error) return false; }
 const result = await client.from('perrun_checkout_orders').select('*').eq('order_session_id',orderId).maybeSingle();
 if(result.error) throw new Error('Current ownership unavailable');
 if(!result.data) return false;
 if(claim && Number(result.data.ownership_revision || 0)===0) return true;
 if(!auth) auth=await getAuthenticatedUser(req,{supabase:client});
 if(auth.error) return false;
 const human=await client.from('inscripciones').select('email').eq('order_session_id',orderId).eq('event_slug','perrun-2027').maybeSingle();
 if(human.error) throw new Error('Current ownership unavailable');
 return human.data?.email?.toLowerCase()===auth.email;
}
module.exports={authorizePerrunOrder};
