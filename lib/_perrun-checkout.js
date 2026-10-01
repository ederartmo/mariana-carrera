'use strict';

const crypto = require('node:crypto');
const { engravingStatus } = require('./_perrun-operations');
const event = require('../perrun-event-data');
const { validateParticipant } = require('./_participant-validation');
const { createCheckoutSummaryClaim, buildCheckoutSummaryCookie, shouldSecureCheckoutCookie } = require('./_checkout-summary-claim');

const QUOTE_TTL_MS = 15 * 60 * 1000;
class CheckoutError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function secret() {
  const value = process.env.CHECKOUT_SUMMARY_SECRET || '';
  if (value.length < 32) throw new CheckoutError('No se pudo preparar tu inscripción.', 503);
  return value;
}
function requireStripeMode() {
  const production = process.env.VERCEL_ENV === 'production';
  const qa = process.env.PERRUN_QA_LOCAL === '1';
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (qa) {
    const url = new URL(process.env.SUPABASE_URL || 'http://invalid');
    if (production || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new CheckoutError('QA requiere Supabase local fuera de Production.', 503);
    }
  }
  if (!(production ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(key)) {
    throw new CheckoutError('El modo Stripe no coincide con el entorno.', 503);
  }
  return production;
}
// Compatibility export for existing callers; policy now follows the deployment environment.
const requireTestMode = requireStripeMode;
function hmac(value) { return crypto.createHmac('sha256', secret()).update(value).digest('hex'); }
function normalizePerrunPayload(body) {
  if (body.eventSlug !== event.slug) throw new CheckoutError('Evento Perrun inválido.');
  const distance = event.validateDistance(body.distance);
  if (body.promoCode !== undefined && (typeof body.promoCode !== 'string' || body.promoCode.trim())) {
    throw new CheckoutError('Perrun no acepta códigos de descuento.');
  }
  const email = String(body.buyerEmail || body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CheckoutError('Correo electrónico inválido.');
  if (!Array.isArray(body.tickets) || body.tickets.length !== 1) throw new CheckoutError('Perrun requiere exactamente un participante humano.');
  let validated;
  try { validated = validateParticipant(body.tickets[0]); }
  catch (error) { throw new CheckoutError(error.message); }
  const { age, ...participant } = validated;
  if (!Array.isArray(body.dogs) || body.dogs.length < 1 || body.dogs.length > event.dogRules.maxDogs) {
    throw new CheckoutError('Perrun requiere uno o dos perros.');
  }
  const dogs = body.dogs.map(dog => {
    const name = typeof dog?.dog_name === 'string' ? dog.dog_name.trim() : '';
    if (!name || [...name].length > 80) throw new CheckoutError('Cada perro requiere un nombre de hasta 80 caracteres.');
    const weightKg = dog.dog_weight_kg;
    const category = event.categoryForWeight(weightKg);
    if (typeof dog.engraving_requested !== 'boolean') throw new CheckoutError('Indica si solicitas grabado para cada perro.');
    // Whitelist: client category, prices, eligibility, sequence and ticket indices are never trusted.
    return { name, weightKg, category, engravingRequested: dog.engraving_requested };
  });
  event.validateDogWeights(dogs.map(dog => dog.weightKg));
  return { eventSlug: event.slug, distance, email, participant, dogs };
}
function priceFor(payload, at) {
  const stage = event.pricing.getCurrentStage(at);
  if (!stage.isOpen) throw new CheckoutError('Las inscripciones están cerradas.');
  const secondDogFee = payload.dogs.length === 2 ? event.dogRules.secondDogFee : 0;
  return { stage, baseAmount: stage.amount, secondDogFee, total: stage.amount + secondDogFee };
}
function issueQuote(payload, now = new Date()) {
  const price = priceFor(payload, now);
  const quote = { id: crypto.randomUUID(), at: now.toISOString(), digest: hmac('perrun-payload:' + JSON.stringify(payload)) };
  const encoded = Buffer.from(JSON.stringify(quote)).toString('base64url');
  return { quoteToken: encoded + '.' + hmac('perrun-quote:' + encoded),
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(), stage: price.stage.key,
    baseAmount: price.baseAmount, secondDogFee: price.secondDogFee, total: price.total,
    currency: 'MXN', ticketCount: 1, dogCount: payload.dogs.length };
}
function verifyQuote(token, payload, now = new Date()) {
  if (typeof token !== 'string' || token.length > 1024) throw new CheckoutError('Solicita una nueva cotización.', 409);
  const [encoded, signature, extra] = token.split('.');
  const expected = hmac('perrun-quote:' + encoded);
  if (extra || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)
    || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new CheckoutError('Cotización inválida.', 409);
  let quote;
  try { quote = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw new CheckoutError('Cotización inválida.', 409); }
  const at = Date.parse(quote.at);
  if (!/^[a-f0-9-]{36}$/.test(quote.id || '') || !Number.isFinite(at) || at > now.getTime()
    || now.getTime() - at >= QUOTE_TTL_MS || quote.digest !== hmac('perrun-payload:' + JSON.stringify(payload))) {
    throw new CheckoutError('La cotización cambió o expiró. Solicita una nueva.', 409);
  }
  const current = priceFor(payload, now);
  if (priceFor(payload, quote.at).stage.key !== current.stage.key) throw new CheckoutError('Cambió la etapa. Solicita una nueva cotización.', 409);
  return quote;
}
function lineItems(payload, price) {
  const item = (name, amount) => ({ quantity: 1, price_data: { currency: 'mxn', unit_amount: amount * 100, product_data: { name } } });
  const items = [item(`${event.name} · ${payload.distance} · ${price.stage.label}`, price.baseAmount)];
  if (payload.dogs.length === 2) items.push(item('Segundo perro · Perrun 2027', price.secondDogFee));
  return items;
}
async function handlePerrunCheckout({ req, res, stripe, supabase, origin, now = new Date() }) {
  let session, live;
  try {
    res.setHeader('Cache-Control', 'no-store');
    live = requireStripeMode();
    let payload;
    try { payload = normalizePerrunPayload(req.body); }
    catch (error) { throw new CheckoutError(error.message); }
    if (req.body.action === 'quote') return res.status(200).json(issueQuote(payload, now));
    if (req.body.action !== undefined && req.body.action !== 'create') throw new CheckoutError('Acción inválida.');
    const quote = verifyQuote(req.body.quoteToken, payload, now);
    const price = priceFor(payload, quote.at);
    const params = {
      mode: 'payment', payment_method_types: ['card', 'oxxo'], customer_email: payload.email,
      line_items: lineItems(payload, price),
      success_url: `${origin}/succes.html?event=${event.slug}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?event=${event.slug}&distance=${payload.distance}`,
      metadata: { flow_version: 'perrun_v1', event_slug: event.slug, order_ref: quote.id, ticket_count: '1' },
    };
    session = await stripe.checkout.sessions.create(params, { idempotencyKey: 'perrun-' + hmac('perrun-session:' + quote.id) });
    if (session.livemode !== live) throw new CheckoutError('La sesión no pertenece al modo Stripe del entorno.', 503);
    if (session.amount_total !== price.total * 100 || session.currency !== 'mxn') throw new CheckoutError('Importe Stripe inesperado.', 503);
    if (session.status !== 'open' || !session.url) throw new CheckoutError('La sesión ya no está disponible. Solicita una nueva cotización.', 409);
    const { claim, error } = createCheckoutSummaryClaim(session.id);
    if (error || !claim) throw new CheckoutError('No se pudo proteger el resumen.', 503);
    const prepared = await supabase.rpc('prepare_perrun_order', {
      p_order_session_id: session.id, p_distance: payload.distance, p_buyer_email: payload.email,
      p_participant: payload.participant, p_dogs: payload.dogs, p_price_stage: price.stage.key, p_quoted_at: quote.at,
    });
    if (prepared.error) throw new CheckoutError('No se pudo preparar tu inscripción. Intenta nuevamente.', 503);
    const draft = Array.isArray(prepared.data) ? prepared.data[0] : prepared.data;
    if (!draft || draft.order_session_id !== session.id || draft.event_slug !== event.slug
      || draft.amount_cents !== price.total * 100 || draft.finalized_at != null) {
      throw new CheckoutError('La cotización almacenada no coincide con la sesión.', 503);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', buildCheckoutSummaryCookie(claim, { secure: shouldSecureCheckoutCookie(req) }));
    return res.status(200).json({ url: session.url, sessionId: session.id, ticketCount: 1, dogCount: payload.dogs.length, total: price.total });
  } catch (error) {
    // Expire only sessions matching the configured mode; QA never operates on LIVE.
    if (session && session.livemode === live && session.status === 'open') {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
    }
    const validation = error instanceof CheckoutError;
    return res.status(error.status || (validation && !session ? 400 : 503)).json({ error: session || !validation ? 'No se pudo preparar el checkout. Solicita una nueva cotización.' : error.message });
  }
}
async function getPerrunSummary(supabase, sessionId) {
  const { data, error } = await supabase.from('perrun_checkout_orders')
    .select('order_session_id,event_slug,distance,buyer_email,participant,dogs,base_amount_cents,amount_cents,price_stage,finalized_at,payment_status')
    .eq('order_session_id', sessionId).maybeSingle();
  if (error) throw new Error('No se pudo consultar el draft.');
  if (!data) return null;
  let human, registeredDogs = [];
  if (data.finalized_at) {
    const [humans, dogs] = await Promise.all([
      supabase.from('inscripciones').select('full_name,shirt_size,bib_number,payment_status,registration_status,event_slug,ticket_count,ticket_index').eq('order_session_id', sessionId),
      supabase.from('registration_dogs').select('id,dog_index,dog_name,category,engraving_requested,engraving_sequence,engraving_free,engraving_payment_required,engraving_payment_amount_cents').eq('order_session_id', sessionId).order('dog_index'),
    ]);
    if (humans.error || dogs.error || humans.data?.length !== 1 || dogs.data?.length !== data.dogs.length) throw new Error('Resumen finalizado incompleto.');
    human = humans.data[0]; registeredDogs = dogs.data;
    const payments = await supabase.from('perrun_engraving_payments').select('dog_id,status').in('dog_id', registeredDogs.map(dog => dog.id)).in('status',['paid','refunded']);
    if (payments.error) throw new Error('Estado de grabado no disponible.');
    registeredDogs = registeredDogs.map(dog => ({ ...dog, engraving_payment_status: (payments.data || []).find(payment => payment.dog_id === dog.id)?.status || 'pending' }));
    if (human.event_slug !== event.slug || human.ticket_count !== 1 || human.ticket_index !== 1
      || !['paid', 'paid_no_email', 'refunded'].includes(human.payment_status)) throw new Error('Identidad finalizada inválida.');
  }
  const status = human?.payment_status === 'refunded' ? 'refunded' : human ? 'paid'
    : data.payment_status === 'failed' ? 'payment_failed' : 'pending';
  return { sessionId, orderSessionId: data.order_session_id, eventSlug: event.slug, eventName: event.name,
    distance: data.distance, email: data.buyer_email, ticketCount: 1, dogCount: data.dogs.length,
    amountPaid: data.amount_cents / 100, total: data.amount_cents / 100, baseAmount: data.base_amount_cents / 100,
    secondDogFee: (data.amount_cents - data.base_amount_cents) / 100, payment_status: status, bib_number: human?.bib_number ?? null,
    draftState: data.payment_status || 'prepared',
    participants: [{ fullName: human?.full_name || data.participant.fullName, shirtSize: human?.shirt_size || data.participant.shirtSize, ticketIndex: 1, bibNumber: human?.bib_number ?? null }],
    dogs: human ? registeredDogs.map(dog => ({ name: dog.dog_name, category: dog.category, engravingRequested: dog.engraving_requested,
      engravingSequence: dog.engraving_sequence, engravingFree: dog.engraving_free,
      dogIndex: dog.dog_index, canPayEngraving: status === 'paid' && human.registration_status === 'active' && dog.engraving_requested && !dog.engraving_free && dog.engraving_payment_required && !['paid','refunded'].includes(dog.engraving_payment_status),
      engravingPaymentStatus: dog.engraving_payment_status, engravingPaymentRequired: dog.engraving_payment_required, engravingPaymentAmount: dog.engraving_payment_amount_cents / 100,
      engravingStatus: status === 'refunded' ? 'Pago reembolsado; posición histórica conservada'
        : engravingStatus(dog) }))
      : data.dogs.map(dog => ({ name: dog.name, category: dog.category, engravingRequested: dog.engravingRequested,
        engravingStatus: dog.engravingRequested ? 'Elegibilidad pendiente de confirmación del pago' : 'No solicitado' })) };
}
module.exports = { normalizePerrunPayload, priceFor, issueQuote, verifyQuote, lineItems, requireStripeMode, requireTestMode, handlePerrunCheckout, getPerrunSummary };
