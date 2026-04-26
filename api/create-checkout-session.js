// Endpoint para crear una sesión de Stripe Checkout
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function getPriceId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();

  // Early Bird: hasta 31 de mayo
  if (year < 2026 || (year === 2026 && month <= 5)) {
    return 'price_1TMJT7IXKIIcpa3QGMfn9Ww4';
  }
  // General: junio y julio
  if (year === 2026 && month <= 7) {
    return 'price_1TPS8dIXKIIcpa3QtPe4BzQS';
  }
  // Last / Last Minute: agosto - 10 octubre
  if (year === 2026 && (month <= 9 || (month === 10 && day <= 10))) {
    return 'price_1TPSEKIXKIIcpa3QsyDngV4h';
  }
  // Fuera de fecha
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { email } = req.body;

    const priceId = getPriceId();
    if (!priceId) {
      return res.status(400).json({ error: 'Las inscripciones están cerradas.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      allow_promotion_codes: true,
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // success_url: process.env.STRIPE_SUCCESS_URL,
      // cancel_url: process.env.STRIPE_CANCEL_URL,
      success_url: 'https://www.kinetichub.com.mx/succes.html?session_id={CHECKOUT_SESSION_ID}',   // ← importante el {CHECKOUT_SESSION_ID}
      cancel_url: 'https://www.kinetichub.com.mx/checkout.html',
    });
    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
 //hola