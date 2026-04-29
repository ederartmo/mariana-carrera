// api/stripe-webhook.js - Versión mejorada y robusta para Vercel
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Función para obtener el raw body (necesario para verificar la firma de Stripe)
const getRawBody = (req) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
};

// Función para generar el siguiente bib_number
async function generateNextBibNumber() {
  try {
    const { count, error } = await supabase
      .from('inscripciones')
      .select('*', { count: 'exact', head: true })
      .not('bib_number', 'is', null);

    if (error) {
      console.error("Error al contar bib_numbers:", error);
      return String(Math.floor(Math.random() * 900) + 100).padStart(3, '0'); // fallback
    }

    const nextNumber = (count || 0) + 1;
    return String(nextNumber).padStart(3, '0');
  } catch (err) {
    console.error("Error generando bib_number:", err);
    return "001";
  }
}

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
    console.error('❌ Error de firma Stripe:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🪝 Evento recibido: ${event.type}`);

  // ==================== CHECKOUT SESSION COMPLETED ====================
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    const email = session.customer_email || session.customer_details?.email;
    const fullName = session.customer_details?.name || "Atleta";
    const sessionId = session.id;
    const amountTotal = (session.amount_total || 0) / 100;

    if (!email) {
      console.warn("⚠️ No se encontró email en la sesión de checkout");
      return res.status(200).json({ received: true });
    }

    const cleanEmail = email.toLowerCase().trim();
    console.log(`✅ Pago confirmado: ${fullName} (${cleanEmail}) - ${sessionId}`);

    try {
      const bibNumber = await generateNextBibNumber();

      // Guardar / actualizar inscripción en Supabase
      const { error: upsertError } = await supabase
        .from('inscripciones')
        .upsert({
          stripe_session_id: sessionId,
          email: cleanEmail,
          full_name: fullName.trim(),
          event_slug: 'axolote-night-run',
          amount_paid: amountTotal,
          payment_status: 'paid',
          bib_number: bibNumber,
          created_at: new Date().toISOString()
        }, { 
          onConflict: 'stripe_session_id' 
        });

      if (upsertError) {
        console.error("❌ Error al guardar en Supabase:", upsertError);
      } else {
        console.log(`✅ Inscripción guardada correctamente | Bib: ${bibNumber}`);
      }

      // Enviar email de confirmación
      try {
        await resend.emails.send({
          from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
          to: email,
          subject: `¡${fullName}, ya estás inscrito en Axolote Night Run 2026! 🎉`,
          html: `
            <h1>¡Felicidades ${fullName}!</h1>
            <p>Tu inscripción ha sido confirmada exitosamente.</p>
            <p><strong>Número de dorsal (Bib):</strong> ${bibNumber}</p>
            <p><strong>Evento:</strong> Axolote Night Run 2026</p>
            <p><strong>Monto pagado:</strong> $${amountTotal} MXN</p>
            <hr>
            <p>Guarda este correo. Te enviaremos más información sobre la entrega de kit pronto.</p>
          `
        });
        console.log(`📧 Email enviado a ${cleanEmail}`);
      } catch (emailError) {
        console.error("❌ Error al enviar email con Resend:", emailError);
      }

    } catch (dbError) {
      console.error("❌ Error general en procesamiento del webhook:", dbError);
    }
  }

  // Responder siempre con 200 para que Stripe no reintente
  return res.status(200).json({ received: true });
};