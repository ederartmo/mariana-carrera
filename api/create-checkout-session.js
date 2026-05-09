// api/create-checkout-session.js - Versión temporal SOLO STRIPE (funciona)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getCurrentStage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // EARLY BIRD: hasta 31 de mayo 2026 - $480 MXN
  if (year < 2026 || (year === 2026 && month < 6) || (year === 2026 && month === 5 && day <= 31)) {
    return {
      key: 'early',
      label: 'Early Bird',
      amount: 480,
      period: 'Hasta 31 de mayo de 2026'
    };
  }

  // REGULAR: 1 de junio - 31 de julio 2026 - $550 MXN
  if (year === 2026 && month >= 6 && month <= 7) {
    return {
      key: 'regular',
      label: 'Regular',
      amount: 550,
      period: '1 de junio al 31 de julio de 2026'
    };
  }

  // EXTEMPORÁNEA: 1 de agosto - 10 de octubre 2026 - $600 MXN
  if (year === 2026 && (month === 8 || month === 9 || (month === 10 && day <= 10))) {
    return {
      key: 'extemporanea',
      label: 'Extemporánea',
      amount: 600,
      period: '1 de agosto al 10 de octubre de 2026'
    };
  }

  // Inscripciones cerradas después del 10 de octubre
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { email, shirtSize } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ 
        error: 'Por favor ingresa un correo electrónico válido.' 
      });
    }

    if (!shirtSize || !['S', 'M', 'L'].includes(shirtSize.toUpperCase())) {
      return res.status(400).json({ 
        error: 'Por favor selecciona una talla válida.' 
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanShirtSize = shirtSize.toUpperCase();
    console.log(`🔄 Checkout para: ${cleanEmail}`);

    const { data: existingRegistration, error: existingRegistrationError } = await supabase
      .from('inscripciones')
      .select('id')
      .eq('event_slug', 'axolote-night-run')
      .eq('email', cleanEmail)
      .eq('payment_status', 'paid')
      .limit(1);

    if (existingRegistrationError) {
      console.error('❌ Error validando inscripción existente:', existingRegistrationError);
      return res.status(500).json({
        error: 'No se pudo validar tu inscripción actual. Inténtalo de nuevo.'
      });
    }

    if (existingRegistration && existingRegistration.length > 0) {
      return res.status(409).json({
        error: 'Este correo ya tiene una inscripción pagada para este evento.'
      });
    }

    const stage = getCurrentStage();
    if (!stage) {
      return res.status(400).json({ 
        error: 'Las inscripciones están cerradas.' 
      });
    }

    console.log(`🧾 Etapa seleccionada: ${stage.label} | ${stage.amount} MXN`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      allow_promotion_codes: true,
      customer_email: cleanEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: Math.round(stage.amount * 100),
          product_data: {
            name: `Axolote Night Run 2026 - ${stage.label}`,
            description: `Inscripción modalidad 5K | ${stage.period}`
          }
        }
      }],
      success_url: 'https://www.kinetichub.com.mx/succes.html?v=20260508&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.kinetichub.com.mx/checkout.html',
      metadata: {
        event_slug: 'axolote-night-run',
        user_email: cleanEmail,
        stage_key: stage.key,
        stage_label: stage.label,
        stage_amount: String(stage.amount),
        shirt_size: cleanShirtSize
      }
    });

    console.log(`✅ Sesión creada: ${session.id}`);

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("💥 Error:", error.message);
    console.error(error.stack);
    return res.status(500).json({ 
      error: 'Error interno del servidor. Inténtalo de nuevo.' 
    });
  }
}