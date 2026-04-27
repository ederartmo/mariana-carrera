// Endpoint para crear una sesión de Stripe Checkout - Kinetic Hub
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
    return 'price_1TPS8dIXKIIcpa3QtPe4BzQS'; // General
  }
  if (year === 2026 && (month <= 9 || (month === 10 && day <= 10))) {
    return 'price_1TPSEKIXKIIcpa3QsyDngV4h'; // Last Minute
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Por favor ingresa un correo válido.' });
    }

    const priceId = getPriceId();
    if (!priceId) {
      return res.status(400).json({ error: 'Las inscripciones están cerradas.' });
    }

    // ====================== VERIFICACIÓN PREVIA ======================
    // 1. Revisar si ya tiene una inscripción pagada
    const { data: existingInscripcion } = await supabase
      .from('inscripciones')
      .select('payment_status')
      .eq('email', email.toLowerCase().trim())
      .eq('payment_status', 'paid')
      .maybeSingle();

    if (existingInscripcion) {
      return res.status(400).json({ 
        error: 'Ya tienes una inscripción pagada con este correo electrónico.',
        alreadyPaid: true
      });
    }

    // 2. Revisar si ya tiene cuenta en user_profiles
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    // ====================== CREAR SESIÓN DE STRIPE ======================
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
        user_email: email.toLowerCase().trim()
      }
    });

    res.status(200).json({ 
      url: session.url,
      hasProfile: !!existingProfile 
    });

  } catch (error) {
    console.error("Error en create-checkout-session:", error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
}