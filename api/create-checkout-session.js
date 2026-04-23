// Endpoint para crear una sesión de Stripe Checkout
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price: 'price_1TMJT7IXKIIcpa3QGMfn9Ww4',
          quantity: 1,
        },
      ],
      success_url: 'https://kinetichub.com.mx/gracias',
      cancel_url: 'https://kinetichub.com.mx/cancelado',
    });
    res.status(200).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
 //hola