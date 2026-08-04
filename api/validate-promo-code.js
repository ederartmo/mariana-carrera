const { getAxoloteStageByDate } = require('../axolote-stage-config');
const { getCascanuecesStageByDate } = require('../cascanueces-stage-config');
const { resolvePromotionCode } = require('./_stripe-promo');

const MAX_TICKETS_PER_ORDER = 5;

function getCurrentStage(eventSlug) {
  const stageProvider = eventSlug === 'cascanueces-run'
    ? getCascanuecesStageByDate
    : eventSlug === 'axolote-night-run'
      ? getAxoloteStageByDate
      : null;
  if (!stageProvider) return null;

  const stage = stageProvider(new Date());

  if (!stage?.isOpen) {
    return null;
  }

  return {
    key: stage.key,
    label: stage.displayName || stage.label,
    amount: stage.amount,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const { promoCode, ticketCount, eventSlug = 'axolote-night-run' } = req.body || {};
    const quantity = Number.parseInt(String(ticketCount || '1'), 10);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_ORDER) {
      return res.status(400).json({ error: 'Cantidad de tickets inválida.' });
    }

    const stage = getCurrentStage(String(eventSlug).trim().toLowerCase());
    if (!stage) {
      return res.status(400).json({ error: 'Las inscripciones están cerradas.' });
    }

    const subtotalAmount = Number((stage.amount * quantity).toFixed(2));
    const promoResolution = await resolvePromotionCode({
      promoCode,
      subtotalAmount,
      currency: 'mxn',
    });

    if (promoResolution.error) {
      return res.status(400).json({ error: promoResolution.error });
    }

    return res.status(200).json({
      ok: true,
      code: promoResolution.cleanCode,
      subtotalAmount,
      preview: promoResolution.preview,
    });
  } catch (error) {
    console.error('Error en validate-promo-code:', error);
    return res.status(500).json({ error: 'No se pudo validar el código de descuento.' });
  }
};