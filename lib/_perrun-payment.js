'use strict';

const { requireTestMode } = require('./_perrun-checkout');
const SLUG = 'perrun-2027';
const TYPES = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']);
class PaymentError extends Error {
  constructor(reason, retry = false) { super(reason); this.reason = reason; this.retry = retry; }
}
function isPerrunMetadata(metadata) {
  return metadata?.event_slug === SLUG || metadata?.flow_version === 'perrun_v1';
}
function objectId(value) { return typeof value === 'string' ? value : value?.id; }
function validateMetadata(metadata) {
  if (metadata?.event_slug !== SLUG || metadata?.flow_version !== 'perrun_v1'
    || metadata?.ticket_count !== '1' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(metadata?.order_ref || '')) {
    throw new PaymentError('invalid_metadata');
  }
}
async function findDraft(supabase, column, value) {
  const result = await supabase.from('perrun_checkout_orders').select('*').eq(column, value).maybeSingle();
  if (result.error) throw new PaymentError('draft_read_failed', true);
  return result.data;
}
async function authoritativeSession({ stripe, supabase, id, snapshot, draft, event }) {
  try { requireTestMode(); } catch { throw new PaymentError('test_configuration_required', true); }
  if (event?.livemode === true || snapshot?.livemode === true) throw new PaymentError('live_event_rejected');
  if (snapshot) validateMetadata(snapshot.metadata);
  let session;
  try { session = await stripe.checkout.sessions.retrieve(id); }
  catch { throw new PaymentError('stripe_session_read_failed', true); }
  if (session.id !== id || session.livemode !== false || session.mode !== 'payment') throw new PaymentError('invalid_session');
  validateMetadata(session.metadata);
  if (snapshot && ['event_slug', 'flow_version', 'order_ref', 'ticket_count'].some(key => snapshot.metadata[key] !== session.metadata[key])) throw new PaymentError('metadata_mismatch');
  draft = draft || await findDraft(supabase, 'order_session_id', id);
  if (!draft) throw new PaymentError('draft_not_ready', true);
  if (draft.order_session_id !== id || draft.event_slug !== SLUG || !['1K', '3K', '5K'].includes(draft.distance)
    || !Array.isArray(draft.dogs) || ![1, 2].includes(draft.dogs.length)) throw new PaymentError('invalid_draft');
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total !== draft.amount_cents
    || session.currency !== 'mxn' || draft.currency !== 'mxn') throw new PaymentError('amount_currency_mismatch');
  if (snapshot && ((snapshot.amount_total !== undefined && snapshot.amount_total !== session.amount_total)
    || (snapshot.currency !== undefined && snapshot.currency !== session.currency)
    || (objectId(snapshot.payment_intent) && objectId(snapshot.payment_intent) !== objectId(session.payment_intent)))) throw new PaymentError('snapshot_mismatch');
  return { session, draft };
}
function outcome(error) {
  const retry = !(error instanceof PaymentError) || error.retry;
  const reason = error instanceof PaymentError ? error.reason : 'perrun_processing_failed';
  // Only fixed diagnostics: never log participant data, credentials or raw provider errors.
  console.warn('Perrun webhook:', reason);
  return { status: retry ? 503 : 200, body: { received: !retry, flow: 'perrun', ...(retry ? { retry: true } : { rejected: true }), reason } };
}
async function callRpc(supabase, name, args) {
  const result = await supabase.rpc(name, args);
  if (result.error) {
    const permanent = ['22023', '23505', '23514'].includes(result.error.code)
      || (result.error.code === 'P0001' && ['Payment identity conflict', 'Confirmed Stripe amount/currency mismatch', 'Confirmed Stripe identities required'].includes(result.error.message));
    throw new PaymentError(permanent ? 'rpc_contract_conflict' : 'rpc_failed', !permanent);
  }
  return result.data;
}
async function handlePerrunPayment({ stripe, supabase, event, draft }) {
  try {
    if (!TYPES.has(event.type) && event.type !== 'payment_intent.payment_failed') return { status: 200, body: { received: true, flow: 'perrun', ignored: true } };
    const snapshot = event.data.object;
    if (!/^evt_[A-Za-z0-9_]{1,200}$/.test(event.id || '') || !/^cs_[A-Za-z0-9_]+$/.test(snapshot.id || '')) throw new PaymentError('invalid_event');
    const verified = await authoritativeSession({ stripe, supabase, id: snapshot.id, snapshot, draft, event });
    const session = verified.session;
    if (event.type === 'checkout.session.async_payment_failed' || event.type === 'payment_intent.payment_failed'
      || (event.type === 'checkout.session.completed' && snapshot.payment_status !== 'paid')) {
      const status = event.type === 'checkout.session.completed' ? 'pending' : 'failed';
      // Failed/pending delivery never performs fulfillment, even if Stripe now says paid.
      const state = await callRpc(supabase, 'record_perrun_payment_state', {
        p_order_session_id: session.id, p_stripe_event_id: event.id, p_payment_status: status,
      });
      return { status: 200, body: { received: true, flow: 'perrun', paymentStatus: (Array.isArray(state) ? state[0] : state)?.payment_status || status } };
    }
    if (session.payment_status !== 'paid') throw new PaymentError('payment_not_confirmed', true);
    const paymentIntentId = objectId(session.payment_intent);
    if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId || '')) throw new PaymentError('missing_payment_intent', true);
    const dogs = await callRpc(supabase, 'finalize_perrun_paid_order', {
      p_order_session_id: session.id, p_payment_intent_id: paymentIntentId, p_stripe_event_id: event.id,
      p_confirmed_amount_cents: session.amount_total, p_confirmed_currency: session.currency,
    });
    if (!Array.isArray(dogs) || dogs.length !== verified.draft.dogs.length || dogs.some(dog => dog.order_session_id !== session.id)) throw new PaymentError('finalization_result_invalid', true);
    return { status: 200, body: { received: true, flow: 'perrun', finalized: true } };
  } catch (error) { return outcome(error); }
}
async function handlePerrunRefund({ stripe, supabase, sessionId, draft, paymentIntentId }) {
  try {
    const verified = await authoritativeSession({ stripe, supabase, id: sessionId, draft });
    if (objectId(verified.session.payment_intent) !== paymentIntentId) throw new PaymentError('refund_identity_mismatch');
    if (!verified.draft.finalized_at || verified.draft.payment_intent_id !== paymentIntentId) throw new PaymentError('refund_waiting_for_finalization', true);
    const human = await supabase.from('inscripciones').select('payment_status,event_slug,payment_intent_id,ticket_count,ticket_index')
      .eq('order_session_id', sessionId).maybeSingle();
    if (human.error || !human.data) throw new PaymentError('refund_human_not_ready', true);
    if (human.data.event_slug !== SLUG || human.data.payment_intent_id !== paymentIntentId
      || human.data.ticket_count !== 1 || human.data.ticket_index !== 1) throw new PaymentError('refund_human_identity_mismatch');
    if (!['paid', 'paid_no_email', 'refunded'].includes(human.data.payment_status)) throw new PaymentError('refund_human_status_mismatch');
    // Historical draft/payment identity, dogs, counter and engraving ledger remain untouched.
    const result = await supabase.from('inscripciones').update({ payment_status: 'refunded', registration_status: 'cancelled', cancellation_type: 'refunded', cancelled_at: new Date().toISOString() })
      .eq('order_session_id', sessionId).eq('payment_intent_id', paymentIntentId).eq('event_slug', SLUG)
      .in('payment_status', ['paid', 'paid_no_email']).select('id');
    if (result.error) throw new PaymentError('refund_update_failed', true);
    return { status: 200, body: { received: true, flow: 'perrun', refunded: true } };
  } catch (error) { return outcome(error); }
}
module.exports = { TYPES, isPerrunMetadata, findDraft, handlePerrunPayment, handlePerrunRefund, outcome };
