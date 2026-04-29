// api/stripe-webhook.js - Versión robusta para Vercel
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const getRawBody = (req) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Stripe Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🪝 Evento recibido: ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const nombreCompleto = session.customer_details?.name || "Atleta";
    const ordenId = session.id;
    const amountTotal = (session.amount_total || 0) / 100;

    console.log(`✅ Pago recibido: ${nombreCompleto} (${email}) - ${ordenId}`);

    if (email) {
      // Guardar en Supabase
      await supabase.from('inscripciones').upsert({
        stripe_session_id: ordenId,
        email: email.toLowerCase().trim(),
        full_name: nombreCompleto.trim(),
        event_slug: 'axolote-night-run',
        amount_paid: amountTotal,
        payment_status: 'paid',
        payment_method: 'card',
      }, { onConflict: 'stripe_session_id' }).catch(err => console.error("Supabase error:", err));

      // Enviar email
      try {
        await resend.emails.send({
          from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
          to: email,
          subject: `¡${nombreCompleto}, ya estás inscrito en Axolote Night Run 2026! 🎉`,
          html: `Tu HTML del email aquí...` // pega tu HTML largo
        });
        console.log(`📧 Email enviado a ${email}`);
      } catch (e) {
        console.error("Resend error:", e);
      }
    }
  }

  return res.status(200).json({ received: true });
};