// api/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Faltan variables de Supabase");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

// api/create-checkout-session.js
console.log("🚀 create-checkout-session.js cargado correctamente");

export default async function handler(req, res) {
  console.log(`📥 Método recibido: ${req.method}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    // Verificar variables de entorno primero
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("❌ STRIPE_SECRET_KEY no configurada");
      return res.status(500).json({ error: "Falta configuración de Stripe en el servidor" });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const { email } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Por favor ingresa un correo válido.' });
    }

    console.log(`🔄 Creando sesión para: ${email}`);

    // Usamos un priceId fijo temporalmente para probar si Stripe funciona
    const priceId = 'price_1TMJT7IXKIIcpa3QGMfn9Ww4'; // Early Bird

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://www.kinetichub.com.mx/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.kinetichub.com.mx/checkout.html',
      metadata: { event_slug: 'axolote-night-run' }
    });

    console.log(`✅ Sesión creada: ${session.id}`);

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("💥 ERROR EN CHECKOUT:");
    console.error(error.message);
    console.error(error.stack || error);

    return res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
}