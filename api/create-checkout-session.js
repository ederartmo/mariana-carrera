// api/create-checkout-session.js - Versión completa con Supabase
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

  if (year < 2026 || (year === 2026 && month <= 5)) {
    return 'price_1TMJT7IXKIIcpa3QGMfn9Ww4'; // Early Bird
  }
  if (year === 2026 && month <= 7) {
    return 'price_1TPS8dIXKIIcpa3QtPe4BzQS';
  }
  if (year === 2026 && (month <= 9 || (month === 10 && day <= 10))) {
    return 'price_1TPSEKIXKIIcpa3QsyDngV4h';
  }
  return null;
}

export default async function handler(req, res) {
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

    const priceId = getPriceId();
    if (!priceId) {
      return res.status(400).json({ 
        error: 'Las inscripciones para Axolote Night Run 2026 están cerradas.' 
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    console.log(`🔄 Creando checkout para: ${cleanEmail}`);

    // === VERIFICACIÓN EN SUPABASE ===
    const { data: existingInscripcion, error: checkError } = await supabase
      .from('inscripciones')
      .select('payment_status')
      .eq('email', cleanEmail)
      .eq('payment_status', 'paid')
      .maybeSingle();

    if (checkError) {
      console.error("Error al consultar Supabase:", checkError.message);
      // No bloqueamos el flujo por error de lectura, solo lo logueamos
    }

    if (existingInscripcion) {
      console.log(`⛔ Usuario ya tiene pago: ${cleanEmail}`);
      return res.status(400).json({
        error: 'Ya tienes una inscripción pagada con este correo electrónico.',
        alreadyPaid: true
      });
    }

    // === CREAR SESIÓN DE STRIPE ===
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      allow_promotion_codes: true,
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://www.kinetichub.com.mx/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.kinetichub.com.mx/checkout.html',
      metadata: {
        event_slug: 'axolote-night-run',
        source: 'guest_checkout',
        user_email: cleanEmail
      }
    });

    console.log(`✅ Sesión Stripe creada: ${session.id}`);

    return res.status(200).json({ 
      url: session.url 
    });

  } catch (error) {
    console.error("💥 Error en create-checkout-session:");
    console.error(error.message);
    console.error(error.stack);

    return res.status(500).json({ 
      error: 'Error interno del servidor. Por favor intenta de nuevo.' 
    });
  }
}