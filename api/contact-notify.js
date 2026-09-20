const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const { trackMetaEvent } = require('../lib/_meta-capi');

const resendApiKey = process.env.RESEND_API_KEY;
const adminEmail = process.env.CONTACT_ADMIN_EMAIL || 'hola@kinetichub.com.mx';
const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Kinetic Hub <no-reply@kinetichub.com.mx>';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Batch 6 (rev): adjuntos viven en bucket PRIVADO contact-private.
// El browser envía attachment_path (contact/<uuid>.<ext>); NUNCA se acepta
// attachment_url ni URLs arbitrarias. Solo service_role firma URLs cortas.
const CONTACT_PRIVATE_BUCKET = 'contact-private';
const CONTACT_SIGNED_URL_TTL_SECONDS = 3600;
const ATTACHMENT_PATH_RE = /^contact\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/;
const MAX_ATTACHMENT_PATH_LENGTH = 200;

function isValidAttachmentPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ATTACHMENT_PATH_LENGTH
    && ATTACHMENT_PATH_RE.test(value);
}

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

function splitName(fullName) {
  const value = sanitize(fullName);
  if (!value) return { firstName: '', lastName: '' };
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
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
      attachment_path,
    } = req.body || {};
    // attachment_url del browser se IGNORA por diseño (nunca confiar en URLs
    // enviadas por el cliente para adjuntos).

    const cleanEmail = sanitize(email).toLowerCase();
    const cleanName = sanitize(full_name);
    const cleanSubject = sanitize(subject) || 'Solicitud de contacto';
    const cleanEvent = sanitize(event_slug) || 'Sin evento';
    const cleanReason = sanitize(reason) || 'Sin categoria';
    const cleanMessage = sanitize(message);
    const cleanPhone = sanitize(phone) || 'No proporcionado';
    const cleanAttachmentPath = sanitize(attachment_path);

    const safeName = escapeHtml(cleanName);
    const safeEmail = escapeHtml(cleanEmail);
    const safeSubject = escapeHtml(cleanSubject);
    const safeEvent = escapeHtml(cleanEvent);
    const safeReason = escapeHtml(cleanReason);
    const safePhone = escapeHtml(cleanPhone);
    const safeMessage = formatMultiline(cleanMessage);

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Email invalido' });
    }

    if (!cleanName || !cleanMessage) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (cleanAttachmentPath && !isValidAttachmentPath(cleanAttachmentPath)) {
      return res.status(400).json({ error: 'Adjunto invalido' });
    }

    const hasAttachment = isValidAttachmentPath(cleanAttachmentPath);

    // Firmar URL corta SOLO para el correo admin. Si falla, el contacto
    // sigue procesándose (el email dirá "Adjunto no disponible").
    let attachmentSignedUrl = null;

    if (hasAttachment && supabase) {
      try {
        const { data, error: signError } = await supabase.storage
          .from(CONTACT_PRIVATE_BUCKET)
          .createSignedUrl(cleanAttachmentPath, CONTACT_SIGNED_URL_TTL_SECONDS);

        if (signError || !data?.signedUrl) {
          throw new Error(signError?.message || 'sin signedUrl');
        }
        attachmentSignedUrl = data.signedUrl;
      } catch (signError) {
        console.error('Error firmando adjunto de contacto:', signError?.message || signError);
      }
    }

    if (supabase) {
      // attachment_path preferido; attachment_url legacy queda null en filas
      // nuevas. Si la columna aún no existe (migración pendiente), reintentar
      // sin ella para no perder el mensaje.
      const baseRow = {
        event_slug: cleanEvent,
        reason: cleanReason,
        full_name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        subject: cleanSubject,
        message: cleanMessage,
        attachment_url: null,
      };

      let insertResult = await supabase.from('contact_messages').insert({
        ...baseRow,
        attachment_path: hasAttachment ? cleanAttachmentPath : null,
      });

      if (insertResult.error && /attachment_path/i.test(insertResult.error.message || '')) {
        console.warn('contact_messages sin columna attachment_path; guardando sin path');
        insertResult = await supabase.from('contact_messages').insert(baseRow);
      }

      if (insertResult.error) {
        console.error('Error insert contact_messages desde backend:', insertResult.error);
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
                ${hasAttachment ? `
                <tr>
                  <td style="padding:8px 24px 18px;font-size:14px;line-height:22px;color:#0f172a;">
                    ${attachmentSignedUrl
                      ? `<strong>Archivo:</strong> <a href="${escapeHtml(attachmentSignedUrl)}" style="color:#1d4ed8;text-decoration:none;">Ver adjunto</a>`
                      : `<strong>Archivo:</strong> Adjunto no disponible`}
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

    const { firstName, lastName } = splitName(cleanName);
    const contactTrack = await trackMetaEvent({
      req,
      eventName: 'Contact',
      userData: {
        email: cleanEmail,
        phone: cleanPhone !== 'No proporcionado' ? cleanPhone : '',
        firstName,
        lastName,
        externalId: cleanEmail,
      },
      customData: {
        event_slug: cleanEvent,
        reason: cleanReason,
      },
      testEventCode: process.env.META_TEST_EVENT_CODE,
    });

    if (!contactTrack.ok && !contactTrack.skipped) {
      console.error('Error enviando Contact a Meta CAPI:', contactTrack.error || contactTrack);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error en /api/contact-notify:', error);
    return res.status(500).json({ error: 'No se pudo enviar el correo' });
  }
};
