const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function toMoney(amountInCents) {
  return Number((amountInCents / 100).toFixed(2));
}

async function resolvePromotionCode({ promoCode, subtotalAmount, currency = 'mxn' }) {
  const cleanCode = String(promoCode || '').trim().toUpperCase();
  if (!cleanCode) {
    return { cleanCode: '', promotionCodeId: null, preview: null };
  }

  const subtotalCents = Math.round(Number(subtotalAmount || 0) * 100);
  const { data } = await stripe.promotionCodes.list({
    code: cleanCode,
    active: true,
    limit: 1,
  });

  const promotionCode = data?.[0] || null;
  const coupon = promotionCode?.coupon || null;

  if (!promotionCode?.id || !coupon) {
    return {
      error: 'El código de descuento no existe, ya venció o no está activo.',
    };
  }

  if (coupon.valid === false) {
    return {
      error: 'El código de descuento ya no es válido.',
    };
  }

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
    promotionCodeId: promotionCode.id,
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