// api/create-checkout-session.js - Versión temporal SOLO STRIPE (funciona)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getPriceId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // TEST MODE: usar price de prueba
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    return 'price_1TRmV3IXKIIcpa3Qn0BUOdxn'; // Test price ($480-ish)
  }

  // EARLY BIRD: hasta 31 de mayo 2026 - $480 MXN
  if (year < 2026 || (year === 2026 && month < 6)) {
    return 'price_1TMJT7IXKIIcpa3QGMfn9Ww4'; // Early Bird - $480
  }
  if (year === 2026 && month === 5 && day <= 31) {
    return 'price_1TMJT7IXKIIcpa3QGMfn9Ww4'; // Early Bird - $480
  }

  // REGULAR: 1 de junio - 31 de julio 2026 - $550 MXN
  if (year === 2026 && month >= 6 && month <= 7) {
    return 'price_1TPS8dIXKIIcpa3QtPe4BzQS'; // Regular - $550
  }

  // EXTEMPORÁNEA: 1 de agosto - 10 de octubre 2026 - $600 MXN
  if (year === 2026 && (month === 8 || month === 9 || (month === 10 && day <= 10))) {
    return 'price_1TPSEKIXKIIcpa3QsyDngV4h'; // Extemporánea - $600
  }

  // Inscripciones cerradas después del 10 de octubre
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ 
        error: 'Por favor ingresa un correo electrónico válido.' 
      });
    }

    const cleanEmail = email.toLowerCase().trim();
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

    const priceId = getPriceId();
    if (!priceId) {
      return res.status(400).json({ 
        error: 'Las inscripciones están cerradas.' 
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      allow_promotion_codes: true,
      customer_email: cleanEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://www.kinetichub.com.mx/succes.html?v=20260508&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.kinetichub.com.mx/checkout.html',
      metadata: {
        event_slug: 'axolote-night-run',
        user_email: cleanEmail
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