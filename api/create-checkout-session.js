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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { email } = req.body || {};

    console.log(`🔄 Intentando crear checkout para email: ${email}`);

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Correo electrónico inválido.' });
    }

    const priceId = getPriceId();
    if (!priceId) {
      return res.status(400).json({ error: 'Inscripciones cerradas.' });
    }

    // Verificar inscripción existente
    const { data: existingInscripcion, error: checkError } = await supabase
      .from('inscripciones')
      .select('payment_status')
      .eq('email', email.toLowerCase().trim())
      .eq('payment_status', 'paid')
      .maybeSingle();

    if (checkError) {
      console.error("Error al consultar Supabase:", checkError);
    }

    if (existingInscripcion) {
      return res.status(400).json({
        error: 'Ya tienes una inscripción pagada con este correo.',
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

    console.log(`✅ Sesión creada exitosamente: ${session.id}`);

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ Error grave en create-checkout-session:");
    console.error(error.message);
    console.error(error.stack);

    return res.status(500).json({ 
      error: 'Error interno del servidor. Revisa los logs de Vercel.'
    });
  }
}