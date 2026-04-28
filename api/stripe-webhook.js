// Endpoint serverless para Stripe Webhook - Kinetic Hub
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ==================== CHECKOUT SESSION COMPLETED ====================
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const email = session.customer_email || session.customer_details?.email;
    const nombreCompleto = session.customer_details?.name || "Atleta";
    const ordenId = session.id;
    const amountTotal = (session.amount_total || 0) / 100;

    console.log(`✅ Pago recibido: ${nombreCompleto} - ${email} - Orden: ${ordenId}`);

    if (!email) {
      console.warn("No se encontró email en la sesión de Stripe");
      return res.status(200).json({ received: true });
    }

    // ====================== GUARDAR EN SUPABASE ======================
    try {
      const { error: insertError } = await supabase
  .from('inscripciones')
  .upsert({
    stripe_session_id: ordenId,
    email: email.toLowerCase().trim(),
    full_name: nombreCompleto.trim(),
    event_slug: 'axolote-night-run',
    amount_paid: amountTotal,
    payment_status: 'paid',
    payment_method: 'card',
    // Agrega más campos si los tienes
  }, { 
    onConflict: 'stripe_session_id',           // sigue siendo útil
    // O mejor, si ya tienes la constraint única:
    // onConflict: 'email,event_slug'
  });

      if (insertError) {
        console.error("Error al guardar inscripción en Supabase:", insertError);
      } else {
        console.log(`Inscripción guardada correctamente para ${email}`);
      }
    } catch (dbError) {
      console.error("Error de base de datos:", dbError);
    }

    // ====================== ENVIAR EMAIL DE CONFIRMACIÓN ======================
    const BASE_URL = 'https://www.kinetichub.com.mx';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>¡Estás inscrito!</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- LOGO -->
        <tr>
          <td style="background:#1e2e28;padding:20px 32px;text-align:center;">
            <img src="${BASE_URL}/KineticHUB.png" alt="Kinetic Hub" height="40" style="display:inline-block;" />
          </td>
        </tr>

        <!-- FELICIDADES -->
        <tr>
          <td style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid #eee;">
            <p style="margin:0 0 8px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;">Confirmación de inscripción</p>
            <h1 style="margin:0;font-size:26px;font-weight:800;color:#1e2e28;line-height:1.3;">
              ¡FELICIDADES ${nombreCompleto.toUpperCase()},<br/>YA ESTÁS INSCRITO!
            </h1>
          </td>
        </tr>

        <!-- PRÓXIMOS PASOS -->
        <tr>
          <td style="padding:28px 40px 8px;">
            <h2 style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1e2e28;text-transform:uppercase;letter-spacing:0.5px;">Próximos pasos</h2>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:28px;height:28px;background:#3a9b6f;border-radius:50%;text-align:center;color:#fff;font-weight:700;font-size:13px;vertical-align:middle;">1</td>
                    <td style="padding-left:12px;font-size:14px;color:#333;">
                      <strong>Completa tu perfil</strong> — llena tu información de contacto y contactos de emergencia en 
                      <a href="${BASE_URL}/perfil.html" style="color:#3a9b6f;">kinetichub.com.mx/perfil.html</a>
                    </td>
                  </tr></table>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:28px;height:28px;background:#3a9b6f;border-radius:50%;text-align:center;color:#fff;font-weight:700;font-size:13px;vertical-align:middle;">2</td>
                    <td style="padding-left:12px;font-size:14px;color:#333;">
                      <strong>Descarga, imprime y firma</strong> la Exoneración de Responsabilidad (ver abajo). Preséntala en el registro para recoger tu kit.
                    </td>
                  </tr></table>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:28px;height:28px;background:#3a9b6f;border-radius:50%;text-align:center;color:#fff;font-weight:700;font-size:13px;vertical-align:middle;">3</td>
                    <td style="padding-left:12px;font-size:14px;color:#333;">
                      <strong>¡Entrena y disfruta!</strong> Nos vemos el 19 de abril de 2026 en Ciudad de México.
                    </td>
                  </tr></table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- RESUMEN DE PAGO -->
        <tr>
          <td style="padding:28px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;">
              <tr>
                <td colspan="3" style="background:#1e2e28;padding:14px 20px;">
                  <p style="margin:0;font-size:15px;font-weight:700;color:#ffffff;">Resumen de tu Pago</p>
                </td>
              </tr>
              <tr style="background:#f9f9f9;">
                <td style="padding:16px 20px;border-bottom:1px solid #eee;">
                  <p style="margin:0 0 4px;font-size:11px;color:#999;text-transform:uppercase;">Fecha de emisión</p>
                  <p style="margin:0;font-size:14px;font-weight:600;color:#1e2e28;">${new Date(session.created * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </td>
                <td style="padding:16px 20px;border-bottom:1px solid #eee;border-left:1px solid #eee;">
                  <p style="margin:0 0 4px;font-size:11px;color:#999;text-transform:uppercase;">Número de orden</p>
                  <p style="margin:0;font-size:12px;font-weight:600;color:#1e2e28;word-break:break-all;">${ordenId}</p>
                </td>
                <td style="padding:16px 20px;border-bottom:1px solid #eee;border-left:1px solid #eee;">
                  <p style="margin:0 0 4px;font-size:11px;color:#999;text-transform:uppercase;">Método de pago</p>
                  <p style="margin:0;font-size:14px;font-weight:600;color:#1e2e28;">Tarjeta</p>
                </td>
              </tr>

              <!-- INFO DEL EVENTO -->
              <tr style="background:#fff;">
                <td colspan="3" style="padding:16px 20px;border-bottom:1px solid #eee;">
                  <table cellpadding="0" cellspacing="0" width="100%"><tr>
                    <td style="width:64px;vertical-align:top;">
                      <img src="${BASE_URL}/axo_oficial.png" alt="Axolote Night Run" width="56" style="border-radius:6px;display:block;" />
                    </td>
                    <td style="padding-left:12px;vertical-align:top;">
                      <p style="margin:0;font-size:14px;font-weight:700;color:#1e2e28;">Axolote Night Run 2026</p>
                      <p style="margin:4px 0 0;font-size:12px;color:#666;">Ciudad de México, CDMX</p>
                      <p style="margin:2px 0 0;font-size:12px;color:#666;">19 abril 2026</p>
                    </td>
                  </tr></table>
                </td>
              </tr>

              <!-- TOTAL -->
              <tr style="background:#fff;">
                <td colspan="2" style="padding:14px 20px;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:#1e2e28;">Total Pagado</p>
                </td>
                <td style="padding:14px 20px;border-left:1px solid #eee;text-align:right;">
                  <p style="margin:0;font-size:15px;font-weight:800;color:#3a9b6f;">$${amountTotal} MXN</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- EXONERACIÓN -->
        <tr>
          <td style="padding:28px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;border-radius:10px;overflow:hidden;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px;font-size:14px;color:#555;">
                    <a href="${BASE_URL}/exo.jpeg" style="color:#c0600a;font-weight:700;text-decoration:underline;">DESCARGAR AQUÍ la Exoneración de Responsabilidad (Hoja 1)</a>
                  </p>
                  <p style="margin:0 0 12px;font-size:14px;color:#555;">
                    <a href="${BASE_URL}/exo1.jpeg" style="color:#c0600a;font-weight:700;text-decoration:underline;">DESCARGAR AQUÍ la Exoneración de Responsabilidad (Hoja 2)</a>
                  </p>
                  <p style="margin:0;font-size:14px;color:#444;">
                    Imprime <strong>ambas hojas</strong>, fírmalas y preséntalas en el registro para recoger tu kit.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#1e2e28;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">¿Tienes dudas? Escríbenos a <a href="mailto:hola@kinetichub.com.mx" style="color:#3a9b6f;">hola@kinetichub.com.mx</a></p>
            <p style="margin:8px 0 0;font-size:11px;color:#666;">© 2026 Kinetic Hub — Ciudad de México</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Enviar email
    try {
      await resend.emails.send({
        from: 'Kinetic Hub <no-reply@kinetichub.com.mx>',
        to: email,
        subject: `¡${nombreCompleto}, ya estás inscrito en Axolote Night Run 2026! 🎉`,
        html: html
      });
      console.log(`Email de confirmación enviado a ${email}`);
    } catch (emailError) {
      console.error("Error enviando email con Resend:", emailError);
    }
  }

  // Respuesta final
  return res.status(200).json({ 
    received: true,
    message: 'Webhook procesado correctamente' 
  });
};