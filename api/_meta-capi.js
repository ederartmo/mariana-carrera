const crypto = require('crypto');

const DEFAULT_API_VERSION = process.env.META_API_VERSION || 'v22.0';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits;
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    return String(forwardedFor).split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return String(realIp).trim();
  return req.socket?.remoteAddress || undefined;
}

function pickSourceUrl(req, explicitUrl) {
  if (explicitUrl) return explicitUrl;
  const referer = req.headers.referer || req.headers.referrer;
  if (referer) return String(referer);
  const host = req.headers.host;
  if (host) return `https://${host}`;
  return undefined;
}

function buildUserData(req, userData = {}) {
  const payload = {};
  const email = normalize(userData.email);
  const phone = normalizePhone(userData.phone);
  const externalId = normalize(userData.externalId);
  const firstName = normalize(userData.firstName);
  const lastName = normalize(userData.lastName);
  const city = normalize(userData.city);
  const state = normalize(userData.state);
  const country = normalize(userData.country);
  const zip = normalize(userData.zip);
  const gender = normalize(userData.gender);
  const dateOfBirth = String(userData.dateOfBirth || '').replace(/[^0-9]/g, '');

  if (email) payload.em = [sha256(email)];
  if (phone) payload.ph = [sha256(phone)];
  if (externalId) payload.external_id = [sha256(externalId)];
  if (firstName) payload.fn = [sha256(firstName)];
  if (lastName) payload.ln = [sha256(lastName)];
  if (city) payload.ct = [sha256(city)];
  if (state) payload.st = [sha256(state)];
  if (country) payload.country = [sha256(country)];
  if (zip) payload.zp = [sha256(zip)];
  if (gender) payload.ge = [sha256(gender)];
  if (dateOfBirth) payload.db = [sha256(dateOfBirth)];

  if (userData.fbp) payload.fbp = String(userData.fbp);
  if (userData.fbc) payload.fbc = String(userData.fbc);

  const clientIp = userData.clientIp || getClientIp(req);
  if (clientIp) payload.client_ip_address = String(clientIp);

  const ua = userData.userAgent || req.headers['user-agent'];
  if (ua) payload.client_user_agent = String(ua);

  return payload;
}

async function trackMetaEvent({
  req,
  eventName,
  eventId,
  userData,
  customData,
  eventSourceUrl,
  testEventCode,
}) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return { ok: false, skipped: true, reason: 'missing_meta_env' };
  }

  const url = `https://graph.facebook.com/${DEFAULT_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: pickSourceUrl(req, eventSourceUrl),
    user_data: buildUserData(req, userData),
  };

  if (eventId) {
    event.event_id = String(eventId);
  }

  if (customData && Object.keys(customData).length > 0) {
    event.custom_data = customData;
  }

  const payload = { data: [event] };
  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body?.error || body,
      };
    }

    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

module.exports = {
  trackMetaEvent,
};