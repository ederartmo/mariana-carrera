// api/create-checkout-session.js
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

  // Early Bird hasta mayo 2026
  if (year < 2026 || (year === 2026 && month <= 5)) {
    return 'price_1TMJT7IXKIIcpa3QGMfn9Ww4';
  }
  // Precio normal junio-julio
  if (year === 2026 && month <= 7) {
    return 'price_1TPS8dIXKIIcpa3QtPe4BzQS';
  }
  // Precio final hasta 10 oct
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

    if (!email || !email.includes('@')) {
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

    console.log(`🔄 Creando checkout para: ${email}`);

    // Verificar si ya pagó
    const { data: existing } = await supabase
      .from('inscripciones')
      .select('payment_status')
      .eq('email', email.toLowerCase().trim())
      .eq('payment_status', 'paid')
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        error: 'Ya tienes una inscripción pagada con este correo electrónico.',
        alreadyPaid: true
      });
    }

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

    console.log(`✅ Checkout session creada: ${session.id}`);

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ Error en create-checkout-session:", error.message);
    console.error(error.stack);

    return res.status(500).json({ 
      error: 'Error interno del servidor. Inténtalo de nuevo o contacta soporte.' 
    });
  }
}