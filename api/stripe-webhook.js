// Endpoint serverless para Stripe Webhook en Vercel
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  // --- VALIDACIÓN DE STRIPE WEBHOOK ---
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // Envía correo con Resend
    await resend.emails.send({
      from: 'Kinetic Hub <no-reply@tudominio.com>',
      to: session.customer_email,
      subject: '¡Gracias por tu pago! Finaliza tu registro',
      html: `<p>¡Hola!</p>
        <p>Tu pago para el evento Axolote Night Run 2026 ha sido recibido exitosamente.</p>
        <p>Para completar tu inscripción, finaliza tu registro aquí:</p>
        <p><a href='https://tusitio.com/finalizar-registro?email=${encodeURIComponent(session.customer_email)}'>Finalizar registro</a></p>
        <p>¡Gracias por ser parte de Kinetic Hub!</p>`
    });
  }
  // Solo una respuesta por petición
  return res.status(200).json({ message: 'Webhook recibido correctamente' });
};