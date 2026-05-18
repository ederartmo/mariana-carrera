const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resendApiKey = process.env.RESEND_API_KEY;
const adminEmail = process.env.CONTACT_ADMIN_EMAIL || 'hola@kinetichub.com.mx';
const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Kinetic Hub <no-reply@kinetichub.com.mx>';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sanitize(value) {
  if (value == null) return '';
  return String(value).trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMultiline(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

async function sendEmailOrThrow(resend, payload, label) {
  const result = await resend.emails.send(payload);
  if (result && result.error) {
    throw new Error(`${label}: ${result.error.message || 'Error desconocido al enviar correo'}`);
  }
  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Metodo no permitido' });
  }

  if (!resendApiKey) {
    return res.status(500).json({ error: 'Falta RESEND_API_KEY en variables de entorno' });
  }

  const resend = new Resend(resendApiKey);
  const supabase =
    supabaseUrl && supabaseServiceRoleKey
      ? createClient(supabaseUrl, supabaseServiceRoleKey)
      : null;

  try {
    const {
      email,
      full_name,
      subject,
      event_slug,
      reason,
      message,
      phone,
      attachment_url,
    } = req.body || {};

    const cleanEmail = sanitize(email).toLowerCase();
    const cleanName = sanitize(full_name);
    const cleanSubject = sanitize(subject) || 'Solicitud de contacto';
    const cleanEvent = sanitize(event_slug) || 'Sin evento';
    const cleanReason = sanitize(reason) || 'Sin categoria';
    const cleanMessage = sanitize(message);
    const cleanPhone = sanitize(phone) || 'No proporcionado';
    const cleanAttachment = sanitize(attachment_url);

    const safeName = escapeHtml(cleanName);
    const safeEmail = escapeHtml(cleanEmail);
    const safeSubject = escapeHtml(cleanSubject);
    const safeEvent = escapeHtml(cleanEvent);
    const safeReason = escapeHtml(cleanReason);
    const safePhone = escapeHtml(cleanPhone);
    const safeMessage = formatMultiline(cleanMessage);
    const safeAttachment = escapeHtml(cleanAttachment);

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Email invalido' });
    }

    if (!cleanName || !cleanMessage) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (supabase) {
      const { error: insertError } = await supabase.from('contact_messages').insert({
        event_slug: cleanEvent,
        reason: cleanReason,
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        subject: cleanSubject,
        message: cleanMessage,
        attachment_url: cleanAttachment || null,
      });

      if (insertError) {
        console.error('Error insert contact_messages desde backend:', insertError);
        return res.status(500).json({ error: 'No se pudo guardar el mensaje de contacto' });
      }
    }

    const adminHtml = `
      <!doctype html>
      <html>
      <body style="margin:0;padding:0;background-color:#edf1f7;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#edf1f7">
          <tr>
            <td align="center" style="padding:20px 10px;">
              <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background-color:#ffffff;font-family:Arial,sans-serif;color:#0f172a;">
                <tr>
                  <td bgcolor="#132a5e" style="padding:20px 24px;color:#ffffff;">
                    <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Kinetic Hub</p>
                    <h1 style="margin:0;font-size:24px;line-height:30px;font-weight:700;">Nuevo mensaje de contacto</h1>
                    <p style="margin:10px 0 0;font-size:14px;line-height:20px;">Asunto: ${safeSubject}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 24px 6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;line-height:22px;">
                      <tr><td width="130" style="padding:6px 0;color:#475569;"><strong>Nombre</strong></td><td style="padding:6px 0;color:#0f172a;">${safeName}</td></tr>
                      <tr><td width="130" style="padding:6px 0;color:#475569;"><strong>Email</strong></td><td style="padding:6px 0;color:#0f172a;"><a href="mailto:${safeEmail}" style="color:#1d4ed8;text-decoration:none;">${safeEmail}</a></td></tr>
                      <tr><td width="130" style="padding:6px 0;color:#475569;"><strong>Telefono</strong></td><td style="padding:6px 0;color:#0f172a;">${safePhone}</td></tr>
                      <tr><td width="130" style="padding:6px 0;color:#475569;"><strong>Evento</strong></td><td style="padding:6px 0;color:#0f172a;">${safeEvent}</td></tr>
                      <tr><td width="130" style="padding:6px 0;color:#475569;"><strong>Motivo</strong></td><td style="padding:6px 0;color:#0f172a;">${safeReason}</td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 24px 8px;">
                    <p style="margin:0 0 8px;font-size:12px;line-height:16px;color:#334155;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Mensaje</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="border:1px solid #dbe4f0;">
                      <tr>
                        <td style="padding:12px 14px;font-size:14px;line-height:22px;color:#0f172a;">${safeMessage}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${cleanAttachment ? `
                <tr>
                  <td style="padding:8px 24px 18px;font-size:14px;line-height:22px;color:#0f172a;">
                    <strong>Archivo:</strong> <a href="${safeAttachment}" style="color:#1d4ed8;text-decoration:none;">Ver adjunto</a>
                  </td>
                </tr>` : ''}
                <tr>
                  <td bgcolor="#f3f6fb" style="padding:12px 24px;font-size:12px;line-height:18px;color:#64748b;">
                    Correo generado automaticamente por el formulario de contacto de Kinetic Hub.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const userHtml = `
      <!doctype html>
      <html>
      <body style="margin:0;padding:0;background-color:#edf1f7;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#edf1f7">
          <tr>
            <td align="center" style="padding:20px 10px;">
              <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background-color:#ffffff;font-family:Arial,sans-serif;color:#0f172a;">
                <tr>
                  <td bgcolor="#132a5e" style="padding:20px 24px;color:#ffffff;">
                    <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Kinetic Hub</p>
                    <h1 style="margin:0;font-size:24px;line-height:30px;font-weight:700;">Recibimos tu solicitud</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 24px 8px;font-size:15px;line-height:24px;color:#1e293b;">
                    <p style="margin:0 0 12px;">Hola ${safeName},</p>
                    <p style="margin:0;">Gracias por contactarnos. Ya recibimos tu mensaje y nuestro equipo te respondera a la brevedad.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 24px 18px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="border:1px solid #dbe4f0;">
                      <tr><td style="padding:12px 14px;font-size:14px;line-height:22px;color:#0f172a;"><strong>Asunto:</strong> ${safeSubject}<br><strong>Evento:</strong> ${safeEvent}<br><strong>Motivo:</strong> ${safeReason}</td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#f3f6fb" style="padding:12px 24px;font-size:12px;line-height:18px;color:#64748b;">
                    Equipo Kinetic Hub
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    console.info('Enviando notificacion de contacto a admin:', adminEmail);

    await sendEmailOrThrow(resend, {
      from: fromEmail,
      to: adminEmail,
      replyTo: cleanEmail,
      subject: `Nuevo contacto: ${cleanSubject}`,
      html: adminHtml,
    }, 'Fallo envio admin');

    await sendEmailOrThrow(resend, {
      from: fromEmail,
      to: cleanEmail,
      subject: 'Recibimos tu solicitud - Kinetic Hub',
      html: userHtml,
    }, 'Fallo envio usuario');

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error en /api/contact-notify:', error);
    return res.status(500).json({ error: 'No se pudo enviar el correo' });
  }
};
