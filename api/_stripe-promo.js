const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function toMoney(amountInCents) {
  return Number((amountInCents / 100).toFixed(2));
}

function isCouponExpired(coupon) {
  if (!coupon || typeof coupon.redeem_by !== 'number') return false;
  return coupon.redeem_by * 1000 < Date.now();
}

function matchesCode(value, cleanCode) {
  return String(value || '').trim().toUpperCase() === cleanCode;
}

async function findCouponByCode(cleanCode) {
  try {
    const directCoupon = await stripe.coupons.retrieve(cleanCode);
    if (directCoupon?.id) {
      return directCoupon;
    }
  } catch (_error) {
    // Ignore: el código no corresponde a un coupon ID directo.
  }

  let startingAfter = null;
  for (let page = 0; page < 5; page += 1) {
    const { data, has_more: hasMore } = await stripe.coupons.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const match = (data || []).find((coupon) =>
      matchesCode(coupon?.name, cleanCode) || matchesCode(coupon?.id, cleanCode)
    );

    if (match) {
      return match;
    }

    if (!hasMore || !data?.length) break;
    startingAfter = data[data.length - 1].id;
  }

  return null;
}

async function resolvePromotionCode({ promoCode, subtotalAmount, currency = 'mxn' }) {
  const cleanCode = String(promoCode || '').trim().toUpperCase();
  if (!cleanCode) {
    return { cleanCode: '', promotionCodeId: null, couponId: null, preview: null };
  }

  const subtotalCents = Math.round(Number(subtotalAmount || 0) * 100);
  const { data } = await stripe.promotionCodes.list({
    code: cleanCode,
    active: true,
    limit: 1,
  });

  const promotionCode = data?.[0] || null;
  let coupon = promotionCode?.coupon || null;
  let couponId = null;

  if (!promotionCode?.id || !coupon) {
    coupon = await findCouponByCode(cleanCode);
    if (!coupon?.id) {
      return {
        error: 'El código de descuento no existe, ya venció o no está activo.',
      };
    }
    couponId = coupon.id;
  }

  if (coupon.valid === false) {
    return {
      error: 'El código de descuento ya no es válido.',
    };
  }

  if (isCouponExpired(coupon)) {
    return {
      error: 'El código de descuento ya venció.',
    };
  }

  if (promotionCode?.id) {
    const minimumAmount = promotionCode.restrictions?.minimum_amount;
    const minimumCurrency = String(promotionCode.restrictions?.minimum_amount_currency || '').toLowerCase();
    if (
      typeof minimumAmount === 'number' &&
      minimumCurrency === currency.toLowerCase() &&
      subtotalCents < minimumAmount
    ) {
      return {
        error: `Este código requiere un mínimo de $${toMoney(minimumAmount)} MXN.`,
      };
    }
  }

  let discountCents = 0;
  let description = cleanCode;

  if (typeof coupon.percent_off === 'number') {
    discountCents = Math.round(subtotalCents * (coupon.percent_off / 100));
    description = `${coupon.percent_off}% de descuento`;
  } else if (typeof coupon.amount_off === 'number') {
    if (String(coupon.currency || '').toLowerCase() !== currency.toLowerCase()) {
      return {
        error: 'El código de descuento no aplica a esta moneda.',
      };
    }
    discountCents = Math.min(subtotalCents, coupon.amount_off);
    description = `$${toMoney(coupon.amount_off)} MXN de descuento`;
  }

  discountCents = Math.max(0, Math.min(discountCents, subtotalCents));
  const finalCents = Math.max(0, subtotalCents - discountCents);

  return {
    cleanCode,
    promotionCodeId: promotionCode?.id || null,
    couponId,
    preview: {
      code: cleanCode,
      description,
      discountAmount: toMoney(discountCents),
      finalTotal: toMoney(finalCents),
      subtotalAmount: toMoney(subtotalCents),
    },
  };
}

module.exports = {
  resolvePromotionCode,
};