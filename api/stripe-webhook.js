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
    const shirtSize = (session.metadata?.shirt_size || '').trim().toUpperCase();

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
          shirt_size: ['S', 'M', 'L'].includes(shirtSize) ? shirtSize : null,
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
            <!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmación de Inscripción</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            background: #0a0a0a;
            color: #ffffff;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #111111;
            border-radius: 12px;
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #0a0a0a, #1a1a2e);
            padding: 40px 20px;
            text-align: center;
            display: flex;
            justify-content: center;
            align-items: center;

            section {
                display: flex;
                flex-direction: column;
                justify-items: center;
                align-items: center;
            }
        }

        .logo {
            max-width: 180px;
            margin-bottom: 20px;
        }

        .title {
            font-size: 28px;
            font-weight: bold;
            margin: 10px 0;
            color: #00f5ff;
        }

        .subtitle {
            font-size: 20px;
            color: #ffffff;
        }

        .content {
            padding: 30px 25px;
        }

        .bib-box {
            background: #1a1a2e;
            border: 2px solid #00f5ff;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            margin: 25px 0;
        }

        .bib-number {
            font-size: 48px;
            font-weight: bold;
            color: #00f5ff;
            letter-spacing: 4px;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            margin: 12px 0;
            padding: 8px 0;
            border-bottom: 1px solid #333;
        }

        .label {
            color: #aaaaaa;
        }

        .value {
            color: #ffffff;
            font-weight: 600;
        }

        .footer {
            background: #0a0a0a;
            padding: 25px;
            text-align: center;
            font-size: 14px;
            color: #777;
        }

        .button {
            display: inline-block;
            background: #00f5ff;
            color: #000;
            padding: 14px 32px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: bold;
            margin: 20px 0;
        }
    </style>
</head>

<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <img src="https://www.kinetichub.com.mx/Logo_kinect.png" alt="Kinetic Hub" class="logo"
                style="filter: brightness(1.1);">
            <section>
                <h1 class="title">¡FELICIDADES ${fullName.toUpperCase()}!</h1>
                <p class="subtitle">YA ESTÁS INSCRITO 🎉</p>
            </section>
        </div>

        <!-- Contenido -->
        <div class="content">
            <div class="bib-box">
                <p style="margin:0 0 8px 0; color:#00f5ff; font-size:18px;">Tu número de dorsal es:</p>
                <div class="bib-number">${bibNumber}</div>
            </div>

            <h2 style="text-align:center; color:#ffffff;">Resumen de tu inscripción</h2>

            <div class="info-row">
                <span class="label">Evento</span>
                <span class="value">Axolote Night Run 2026</span>
            </div>
            <div class="info-row">
                <span class="label">Nombre</span>
                <span class="value">${fullName}</span>
            </div>
            <div class="info-row">
                <span class="label">Monto pagado</span>
                <span class="value">$${amountTotal} MXN</span>
            </div>
            <div class="info-row">
              <span class="label">Talla de playera</span>
              <span class="value">${['S', 'M', 'L'].includes(shirtSize) ? shirtSize : 'Por confirmar'}</span>
            </div>
            <div class="info-row">
                <span class="label">Estado</span>
                <span class="value" style="color:#00ff9d;">✅ Pago confirmado</span>
            </div>

            <p style="text-align:center; margin:30px 0 10px 0;">
                <strong>Guarda este correo.</strong><br>
                Próximamente te enviaremos información importante sobre la entrega de kit y el día del evento.
            </p>

            <div style="text-align:center;">
                <a href="https://www.kinetichub.com.mx/exoRe.jpeg" download class="btn"
                    style="display: inline-block; margin: 8px 8px 8px 0; background: #19c88b; color: white; padding: 12px 24px; border-radius: 999px; text-decoration: none;">
                    📄 Hoja 1 - Exoneración
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p>Kinetic Hub • Axolote Night Run 2026</p>
            <p>Si tienes alguna duda, responde este correo o escríbenos a hola@kinetichub.com.mx</p>
        </div>
    </div>
</body>

</html>
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