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

// Función para generar el siguiente bib_number de forma atómica via RPC.
// Requiere ejecutar desc/sql-atomic-bib-number.sql en Supabase primero.
async function generateNextBibNumber() {
  const { data, error } = await supabase.rpc('get_next_bib_number');
  if (error) {
    console.error("Error al generar bib_number via RPC:", error);
    // Fallback: timestamp para minimizar colisiones en caso extremo
    return String(Date.now()).slice(-4).padStart(4, '0');
  }
  return String(data).padStart(3, '0');
}

async function updateRegistrationBySessionId(sessionId, payload) {
  if (!sessionId) return;

  const { error } = await supabase
    .from('inscripciones')
    .upsert({
      stripe_session_id: sessionId,
      ...payload
    }, {
      onConflict: 'stripe_session_id'
    });

  if (error) {
    console.error(`❌ Error actualizando inscripción para sesión ${sessionId}:`, error);
  }
}

async function findCheckoutSessionByPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null;

  try {
    const { data } = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1
    });
    return data?.[0] || null;
  } catch (error) {
    console.error(`❌ Error buscando checkout session por payment_intent ${paymentIntentId}:`, error);
    return null;
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
      console.error(`❌ PAGO SIN EMAIL: session_id=${sessionId} amount=${amountTotal}`);
      // Guardar el pago en DB sin email para no perder el registro
      await supabase.from('inscripciones').upsert({
        stripe_session_id: sessionId,
        email: null,
        full_name: fullName.trim(),
        event_slug: 'axolote-night-run',
        amount_paid: amountTotal,
        payment_status: 'paid_no_email',
        shirt_size: null,
        bib_number: null,
        created_at: new Date().toISOString()
      }, { onConflict: 'stripe_session_id' });
      // Alertar al admin
      await resend.emails.send({
        from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
        to: 'hola@kinetichub.com.mx',
        subject: `⚠️ Pago recibido sin email — sesión ${sessionId}`,
        html: `<p>Se recibió un pago de <strong>$${amountTotal} MXN</strong> pero no se pudo obtener el email del comprador.</p><p>Session ID: <code>${sessionId}</code></p><p>Nombre: ${fullName}</p><p>Revisar en el dashboard de Stripe y completar la inscripción manualmente.</p>`
      }).catch(e => console.error("Error enviando alerta admin:", e));
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
          shirt_size: ['S', 'M', 'L', 'XL', 'XXL'].includes(shirtSize) ? shirtSize : null,
          bib_number: bibNumber,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'stripe_session_id'
        });

      if (upsertError) {
        console.error("❌ Error al guardar en Supabase:", upsertError);
        return res.status(200).json({ received: true });
      }

      console.log(`✅ Inscripción guardada correctamente | Bib: ${bibNumber}`);

      // Enviar email de confirmación solo si la DB se guardó correctamente
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
        @media only screen and (max-width: 600px) {
            .outer { padding: 0 !important; }
            .bib-num { font-size: 36px !important; }
        }
    </style>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;" class="outer">
        <tr>
            <td align="center" style="padding:30px 16px;">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">

                    <!-- HEADER -->
                    <tr>
                        <td style="background-color:#0d0d1a;padding:40px 20px;text-align:center;">
                            <img src="https://www.kinetichub.com.mx/Logo_kinect.png" alt="Kinetic Hub" width="150" style="display:block;margin:0 auto 20px auto;max-width:150px;">
                            <h1 style="margin:8px 0;font-size:26px;font-weight:bold;color:#00f5ff;">¡FELICIDADES ${fullName.toUpperCase()}!</h1>
                            <p style="margin:4px 0;font-size:18px;color:#ffffff;">YA ESTÁS INSCRITO 🎉</p>
                        </td>
                    </tr>

                    <!-- DORSAL -->
                    <tr>
                        <td style="padding:30px 25px 0 25px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a1a2e;border:2px solid #00f5ff;border-radius:12px;">
                                <tr>
                                    <td style="padding:20px;text-align:center;">
                                        <p style="margin:0 0 8px 0;color:#00f5ff;font-size:16px;">Tu número de dorsal es:</p>
                                        <p class="bib-num" style="margin:0;font-size:52px;font-weight:bold;color:#00f5ff;letter-spacing:6px;">${String(bibNumber).padStart(3,'0')}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- RESUMEN -->
                    <tr>
                        <td style="padding:20px 25px 10px 25px;">
                            <h2 style="text-align:center;color:#ffffff;font-size:18px;margin:0 0 16px 0;">Resumen de tu inscripción</h2>

                            <!-- fila -->
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Evento</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">Axolote Night Run 2026</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Nombre</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${fullName}</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Monto pagado</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">$${amountTotal} MXN</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#aaaaaa;font-size:14px;">Talla de playera</td>
                                    <td style="padding:10px 0;border-bottom:1px solid #333;color:#ffffff;font-weight:600;font-size:14px;text-align:right;">${['S','M','L','XL','XXL'].includes(shirtSize) ? shirtSize : 'Por confirmar'}</td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0;color:#aaaaaa;font-size:14px;">Estado</td>
                                    <td style="padding:10px 0;color:#00ff9d;font-weight:600;font-size:14px;text-align:right;">✅ Pago confirmado</td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- NOTA -->
                    <tr>
                        <td style="padding:24px 25px;text-align:center;color:#cccccc;font-size:14px;line-height:1.6;">
                            <strong style="color:#ffffff;">Guarda este correo.</strong><br>
                            Próximamente te enviaremos información importante sobre la entrega de kit y el día del evento.
                        </td>
                    </tr>

                    <!-- BOTÓN -->
                    <tr>
                        <td style="padding:0 25px 30px 25px;text-align:center;">
                            <a href="https://www.kinetichub.com.mx/Expediente%20Axolote%20Night%20Run%20.pdf"
                               style="display:inline-block;background-color:#19c88b;color:#000000;padding:13px 28px;border-radius:999px;text-decoration:none;font-weight:bold;font-size:14px;">
                                📄 Hoja 1 - Exoneración
                            </a>
                        </td>
                    </tr>

                    <!-- FOOTER -->
                    <tr>
                        <td style="background-color:#0a0a0a;padding:25px;text-align:center;font-size:13px;color:#777777;">
                            <p style="margin:0 0 6px 0;">Kinetic Hub • Axolote Night Run 2026</p>
                            <p style="margin:0;">Si tienes alguna duda, responde este correo o escríbenos a <a href="mailto:hola@kinetichub.com.mx" style="color:#00f5ff;text-decoration:none;">hola@kinetichub.com.mx</a></p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
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

  // ==================== CHECKOUT SESSION ASYNC PAYMENT FAILED ====================
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    const sessionId = session.id;
    const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim() || null;
    const fullName = session.customer_details?.name || 'Atleta';
    const amountTotal = (session.amount_total || 0) / 100;
    const shirtSize = (session.metadata?.shirt_size || '').trim().toUpperCase();

    await updateRegistrationBySessionId(sessionId, {
      email,
      full_name: fullName,
      event_slug: session.metadata?.event_slug || 'axolote-night-run',
      amount_paid: amountTotal,
      payment_status: 'payment_failed',
      shirt_size: ['S', 'M', 'L', 'XL', 'XXL'].includes(shirtSize) ? shirtSize : null,
      created_at: new Date().toISOString()
    });

    console.warn(`⚠️ Pago fallido (async) registrado | session_id=${sessionId}`);
  }

  // ==================== PAYMENT INTENT FAILED ====================
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    const checkoutSession = await findCheckoutSessionByPaymentIntent(paymentIntent.id);

    if (checkoutSession?.id) {
      const email = (checkoutSession.customer_email || checkoutSession.customer_details?.email || '').toLowerCase().trim() || null;
      const fullName = checkoutSession.customer_details?.name || 'Atleta';
      const amountTotal = (checkoutSession.amount_total || paymentIntent.amount || 0) / 100;
      const shirtSize = (checkoutSession.metadata?.shirt_size || '').trim().toUpperCase();

      await updateRegistrationBySessionId(checkoutSession.id, {
        email,
        full_name: fullName,
        event_slug: checkoutSession.metadata?.event_slug || 'axolote-night-run',
        amount_paid: amountTotal,
        payment_status: 'payment_failed',
        shirt_size: ['S', 'M', 'L', 'XL', 'XXL'].includes(shirtSize) ? shirtSize : null,
        created_at: new Date().toISOString()
      });

      console.warn(`⚠️ PaymentIntent fallido actualizado | session_id=${checkoutSession.id}`);
    } else {
      console.warn(`⚠️ PaymentIntent fallido sin sesión relacionada | payment_intent=${paymentIntent.id}`);
    }
  }

  // ==================== CHARGE REFUNDED ====================
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

    const checkoutSession = await findCheckoutSessionByPaymentIntent(paymentIntentId);

    if (checkoutSession?.id) {
      await updateRegistrationBySessionId(checkoutSession.id, {
        payment_status: 'refunded'
      });
      console.warn(`↩️ Reembolso registrado | session_id=${checkoutSession.id}`);
    } else {
      console.warn(`⚠️ Reembolso sin sesión relacionada | payment_intent=${paymentIntentId}`);
    }
  }

  // Responder siempre con 200 para que Stripe no reintente
  return res.status(200).json({ received: true });
};