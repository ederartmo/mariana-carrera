// api/create-checkout-session.js - Versión temporal SOLO STRIPE (funciona)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { trackMetaEvent } = require('./_meta-capi');
const { resolvePromotionCode } = require('./_stripe-promo');
const { getAxoloteStageByDate } = require('../axolote-stage-config');
const { getCascanuecesStageByDate } = require('../cascanueces-stage-config');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const MAX_TICKETS_PER_ORDER = 5;

function getCookieValue(req, name) {
  const raw = req.headers.cookie || '';
  if (!raw) return '';
  const cookies = raw.split(';');
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return '';
}

const EVENT_CATALOG = {
  'axolote-night-run': {
    name: 'Axolote Night Run 2026',
    distances: ['5K'],
    defaultDistance: '5K',
    getStage: getAxoloteStageByDate,
  },
  'cascanueces-run': {
    name: 'Cascanueces Run 2026',
    distances: ['5K', '10K'],
    defaultDistance: '5K',
    getStage: getCascanuecesStageByDate,
  },
};

function resolveEventSelection(eventSlug, distance) {
  const cleanSlug = String(eventSlug || 'axolote-night-run').trim().toLowerCase();
  const event = EVENT_CATALOG[cleanSlug];
  if (!event) return null;

  const cleanDistance = String(distance || event.defaultDistance).trim().toUpperCase();
  if (!event.distances.includes(cleanDistance)) return null;

  return { ...event, slug: cleanSlug, distance: cleanDistance };
}

function getCurrentStage(event) {
  const stage = event.getStage(new Date());

  if (!stage?.isOpen) {
    return null;
  }

  return {
    key: stage.key,
    label: stage.displayName || stage.label,
    amount: stage.amount,
    period: stage.period,
  };
}

function getRequestOrigin(req) {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const host = String(req.headers.host || '').trim();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `http://${host}`;
  }

  return 'https://www.kinetichub.com.mx';
}

function normalizeFullName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeTickets({ tickets, legacyShirtSize }) {
  if (Array.isArray(tickets) && tickets.length > 0) {
    if (tickets.length > MAX_TICKETS_PER_ORDER) {
      return {
        error: `Puedes comprar hasta ${MAX_TICKETS_PER_ORDER} tickets por operación.`,
      };
    }

    const normalizedTickets = [];
    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i] || {};
      const fullName = normalizeFullName(ticket.fullName);
      const shirtSize = String(ticket.shirtSize || '').trim().toUpperCase();

      if (!fullName || fullName.length < 3) {
        return {
          error: `El ticket ${i + 1} debe incluir un nombre válido.`,
        };
      }

      if (!ALLOWED_SHIRT_SIZES.includes(shirtSize)) {
        return {
          error: `El ticket ${i + 1} debe incluir una talla válida (XS, S, M, L o XL).`,
        };
      }

      normalizedTickets.push({ fullName, shirtSize });
    }

    return { tickets: normalizedTickets };
  }

  const fallbackSize = String(legacyShirtSize || '').trim().toUpperCase();
  if (!ALLOWED_SHIRT_SIZES.includes(fallbackSize)) {
    return {
      error: 'Por favor agrega al menos un ticket con nombre y talla válida.',
    };
  }

  return {
    tickets: [{ fullName: 'Participante 1', shirtSize: fallbackSize }],
  };
}

function buildParticipantsMetadata(tickets) {
  const metadata = {};
  tickets.forEach((ticket, index) => {
    const position = index + 1;
    metadata[`participant_${position}_name`] = ticket.fullName;
    metadata[`participant_${position}_shirt`] = ticket.shirtSize;
  });
  return metadata;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { email, buyerEmail, shirtSize, tickets, metaEventId, promoCode, eventSlug, distance } = req.body;
    const rawEmail = buyerEmail || email;
    const event = resolveEventSelection(eventSlug, distance);

    if (!event) {
      return res.status(400).json({ error: 'El evento o la distancia seleccionada no son válidos.' });
    }

    if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
      return res.status(400).json({ 
        error: 'Por favor ingresa un correo electrónico válido.' 
      });
    }

    const normalized = normalizeTickets({ tickets, legacyShirtSize: shirtSize });
    if (normalized.error) {
      return res.status(400).json({
        error: normalized.error,
      });
    }

    const normalizedTickets = normalized.tickets;
    const ticketCount = normalizedTickets.length;

    const cleanEmail = rawEmail.toLowerCase().trim();
    const primaryTicket = normalizedTickets[0];
    const fbp = getCookieValue(req, '_fbp');
    const fbc = getCookieValue(req, '_fbc');
    const initiateCheckoutEventId =
      typeof metaEventId === 'string' && metaEventId.trim().length > 0
        ? metaEventId.trim().slice(0, 120)
        : `ic_${crypto.randomUUID()}`;
    console.log(`🔄 Checkout para: ${cleanEmail} | tickets=${ticketCount}`);

    const stage = getCurrentStage(event);
    if (!stage) {
      return res.status(400).json({ 
        error: 'Las inscripciones están cerradas.' 
      });
    }

    console.log(`🧾 Etapa seleccionada: ${stage.label} | ${stage.amount} MXN | tickets=${ticketCount}`);

    const participantsMetadata = buildParticipantsMetadata(normalizedTickets);
    const totalAmount = Number((stage.amount * ticketCount).toFixed(2));
    const promoResolution = await resolvePromotionCode({
      promoCode,
      subtotalAmount: totalAmount,
      currency: 'mxn',
    });

    if (promoResolution.error) {
      return res.status(400).json({ error: promoResolution.error });
    }

    const stripeDiscount = promoResolution.promotionCodeId
      ? { promotion_code: promoResolution.promotionCodeId }
      : promoResolution.couponId
        ? { coupon: promoResolution.couponId }
        : null;

    const origin = getRequestOrigin(req);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      // allow_promotion_codes y discounts son mutuamente exclusivos en Stripe:
      // si ya hay un descuento aplicado, no se puede activar la caja de promociones.
      ...(stripeDiscount
        ? { discounts: [stripeDiscount] }
        : { allow_promotion_codes: true }),
      customer_email: cleanEmail,
      line_items: [{
        quantity: ticketCount,
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(stage.amount * 100),
          product_data: {
            name: `${event.name} - ${stage.label}`,
            description: `Inscripción modalidad ${event.distance} | ${stage.period} | ${ticketCount} ticket(s)`
          }
        }
      }],
      success_url: `${origin}/succes.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?event=${encodeURIComponent(event.slug)}&distance=${encodeURIComponent(event.distance)}`,
      metadata: {
        event_slug: event.slug,
        event_name: event.name,
        distance: event.distance,
        user_email: cleanEmail,
        buyer_email: cleanEmail,
        stage_key: stage.key,
        stage_label: stage.label,
        stage_amount: String(stage.amount),
        ticket_count: String(ticketCount),
        shirt_size: primaryTicket.shirtSize,
        full_name: primaryTicket.fullName,
        meta_fbp: fbp || '',
        meta_fbc: fbc || '',
        meta_external_id: cleanEmail,
        meta_initiate_checkout_event_id: initiateCheckoutEventId,
        discount_code: promoResolution.cleanCode || '',
        ...participantsMetadata,
      }
    });

    console.log(`✅ Sesión creada: ${session.id}`);

    const { error: pendingUpsertError } = await supabase
      .from('inscripciones')
      .upsert({
        stripe_session_id: session.id,
        order_session_id: session.id,
        buyer_email: cleanEmail,
        email: cleanEmail,
        full_name: primaryTicket.fullName,
        event_slug: event.slug,
        amount_paid: totalAmount,
        payment_status: 'pending',
        shirt_size: primaryTicket.shirtSize,
        ticket_index: 1,
        ticket_count: ticketCount,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'stripe_session_id',
      });

    if (pendingUpsertError) {
      console.error('❌ Error guardando inscripción pending:', pendingUpsertError);
      await stripe.checkout.sessions.expire(session.id).catch((expireError) => {
        console.error(`❌ No se pudo expirar la sesión ${session.id}:`, expireError.message);
      });
      return res.status(500).json({
        error: 'No se pudo preparar tu inscripción. Inténtalo de nuevo.',
      });
    }

    console.log(`📝 Inscripción pending creada/actualizada | session_id=${session.id}`);

    const initiateTrack = await trackMetaEvent({
      req,
      eventName: 'InitiateCheckout',
      eventId: initiateCheckoutEventId,
      userData: {
        email: cleanEmail,
        externalId: cleanEmail,
        fbp,
        fbc,
      },
      customData: {
        currency: 'MXN',
        value: totalAmount,
        content_name: `${event.name} - ${event.distance} - ${stage.label}`,
        content_type: 'product',
      },
      testEventCode: process.env.META_TEST_EVENT_CODE,
    });

    if (!initiateTrack.ok && !initiateTrack.skipped) {
      console.error('Error enviando InitiateCheckout a Meta CAPI:', initiateTrack.error || initiateTrack);
    }

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("💥 Error:", error.message);
    console.error(error.stack);
    return res.status(500).json({ 
      error: 'Error interno del servidor. Inténtalo de nuevo.' 
    });
  }
}