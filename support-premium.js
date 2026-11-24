(function () {
  'use strict';

  // 60 scheduled reads per visible hour; the shared cap is 100 per hour.
  const POLL_INTERVAL_MS = 60_000;

  function createVisiblePoll(isVisible, refresh) {
    let running = false;
    return async function tick() {
      if (running || !isVisible()) return;
      running = true;
      try { await refresh(); } finally { running = false; }
    };
  }

  if (typeof module !== 'undefined') { module.exports = { createVisiblePoll, POLL_INTERVAL_MS }; return; }

  const icons = {
    chat: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7zM22 2 11 13"/>',
    expand: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6m0 6 7-7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    box: '<path d="m12 2 9 5v10l-9 5-9-5V7zm0 10 9-5m-9 5L3 7m9 5v10"/>',
    shirt: '<path d="m8 4-5 3 2 5 3-1v9h8v-9l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    ticket: '<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3l-1 2m0 2v1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  const icon = name => '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
  const brand = '<img class="premium-brand" src="/assets/brand/icon.png" alt="" width="46" height="46">';
  const quick = (symbol, label, category, prompt) => '<button type="button" data-topic="' + category + '" data-prompt="' + prompt + '">' + icon(symbol) + label + '</button>';
  const ticketStates = {
    pending: ['Pendiente', 'Recibimos tu solicitud y está esperando atención.'],
    in_progress: ['Abierto', 'El equipo está atendiendo tu solicitud.'],
    resolved: ['Resuelto', 'El equipo cerró la solicitud. Si envías otro mensaje, se volverá a abrir.'],
  };

  function thread(expanded) {
    return `
      <header class="premium-thread-head">
        ${expanded ? icon('ticket') : brand}
        <div><h2 id="premium-thread-title">${expanded ? 'Conversación' : 'Soporte Kinetic Hub'}</h2>
        <p class="premium-indicator">${'Atención y seguimiento'}</p></div>
        ${expanded ? '' : '<a class="premium-icon" href="/atencion.html" data-support-draft-link aria-label="Abrir seguimiento">' + icon('expand') + '</a><button type="button" class="premium-icon" data-widget-close aria-label="Cerrar chat">' + icon('close') + '</button>'}
      </header>
      <div class="premium-scroll">
        <div class="premium-welcome" data-support-welcome hidden>
          <p>¡Hola! 👋 Soy el asistente de KineticHub. ¿En qué podemos ayudarte?</p>
        </div>
        ${expanded ? '' : `<div class="premium-topics">
          ${quick('box','Entrega de kits','events','Tengo una consulta sobre la entrega de kits.')}
          ${quick('shirt','Cambiar talla','registration','Quisiera consultar sobre un cambio de talla.')}
          <a href="/atencion.html" data-support-draft-link>${icon('ticket')} Mi solicitud</a>
          ${quick('help','Otra consulta','other','')}
          </div>`}
        <div class="premium-divider"><span>Historial</span></div>
        <div class="premium-login-return" data-support-login-return hidden>
          <p role="status">Tu conversación anterior quedó guardada, pero no está vinculada a esta cuenta</p>
          <p>El historial de invitado queda separado. Si verificaste tu correo en ese chat, el aviso de respuesta incluirá un enlace privado a la misma solicitud.</p>
          <button class="support-reply-action" type="button" data-support-continue-account>Continuar con mi cuenta</button>
        </div>
        <p class="premium-empty" data-support-empty hidden></p>
        <p class="premium-followup" data-support-guest-mode role="status" hidden>Estás viendo una solicitud de invitado, separada de tu cuenta. <a href="/atencion.html?chat=account#premium-conversation">Volver al chat de mi cuenta</a></p>
        <div class="premium-followup" data-support-resume hidden>
          <p data-support-resume-status role="status"></p>
          <button type="button" class="support-reply-action" data-support-resume-open>Abrir conversación de invitado</button>
          <a href="/atencion.html?chat=account#premium-conversation" class="premium-text-button" data-support-resume-account hidden>Abrir el chat de mi cuenta</a>
        </div>
        ${expanded ? '' : `<a class="premium-ticket premium-ticket-link" href="/atencion.html" data-support-draft-link data-premium-ticket hidden>${icon('ticket')}<span><strong>Mi solicitud</strong><small data-premium-category></small></span><span class="premium-status" data-premium-state></span><span aria-hidden="true">›</span></a>`}
        <details class="premium-previous" data-support-previous hidden><summary>Conversaciones anteriores</summary></details>
        <div class="support-transcript" data-support-messages role="log" aria-label="Historial de mensajes"></div>
      </div>
        <section class="premium-followup premium-email-followup" data-support-email hidden aria-label="Seguimiento humano">
          <div class="premium-email-heading">
            <p class="premium-email-state" data-support-email-state role="status"></p>
            <button type="button" class="premium-text-button" data-support-email-toggle aria-controls="support-email-fields" aria-expanded="true">Cerrar formulario</button>
          </div>
          <div id="support-email-fields" data-support-email-fields>
            <p data-support-email-title>Nuestro equipo te ayudará con esta consulta.</p>
            <form data-support-email-request>
              <label data-support-email-address>¿A qué correo te avisamos cuando recibas respuesta? <input type="email" name="email" maxlength="254" autocomplete="email" required></label>
              <button type="submit" class="support-reply-action" data-support-email-continue>Continuar con mi correo</button>
            </form>
            <p data-support-email-destination hidden></p>
            <form data-support-email-verify hidden>
              <label>Código de seis dígitos <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
              <button type="submit" class="support-reply-action">Verificar correo</button>
            </form>
            <p data-support-email-expiry hidden>El código vence en 15 minutos.</p>
            <div class="premium-email-actions">
              <button type="button" class="premium-text-button" data-support-email-change hidden>Cambiar correo</button>
              <button type="button" class="premium-text-button" data-support-email-back hidden>Volver al código</button>
              <button type="button" class="premium-text-button" data-support-email-resend hidden>Reenviar código</button>
              <a class="premium-text-button" data-support-email-login>Abrir un chat separado con mi cuenta</a>
            </div>
            <p data-support-email-status role="status"></p>
          </div>
        </section>
      <form data-support-form class="premium-form">
        <input type="hidden" name="category" value="general">
        <div class="premium-compose">
          <textarea name="supportMessage" aria-label="Mensaje" maxlength="2000" rows="1" required disabled placeholder="Escribe tu mensaje..."></textarea>
          <button class="premium-send" type="submit" aria-label="Enviar mensaje" disabled>${icon('send')}</button>
        </div>
        <p class="premium-notice" data-support-notice role="status">Preparando el chat…</p>
        <button class="premium-text-button" type="button" data-support-retry hidden>Reintentar envío</button>
      </form>
      <details class="premium-actions">
        <summary>Opciones y privacidad</summary>
        <button class="premium-text-button" type="button" data-support-refresh>Actualizar conversación</button>
        <button class="premium-text-button" type="button" data-support-human>Solicitar atención humana</button>
        <button class="premium-text-button" type="button" data-support-clear>Borrar sesión de invitado</button>
        <p>El primer mensaje crea una solicitud. No envíes contraseñas ni datos de tarjetas. El historial de invitado permanece en esta pestaña.</p>
      </details>`;
  }

  function details() {
    return `<aside class="premium-detail">
      <h2>${icon('help')} Detalle de tu solicitud</h2>
      <p data-premium-no-ticket>Aún no tienes una solicitud en esta conversación.</p>
      <div data-premium-ticket hidden>
        <div class="premium-ticket"><strong>Mi solicitud</strong><span class="premium-status" data-premium-state></span></div>
        <dl class="premium-fields"><div><dt>Categoría</dt><dd data-premium-category></dd></div></dl>
      </div>
      <div class="premium-status-guide" data-premium-status-guide hidden><h3>¿Qué significa tu estado?</h3>
        <p data-premium-status-description></p>
      </div>
      <p class="premium-other"><a href="/contacto.html">Otros canales de contacto</a></p>
    </aside>`;
  }

  const expandedHost = document.querySelector('[data-premium-expanded]');
  const expanded = Boolean(expandedHost);
  const host = expandedHost || document.createElement('div');
  if (document.getElementById('premium-conversation')) return;
  host.classList.add('premium-support', expanded ? 'premium-expanded' : 'premium-widget');
  host.innerHTML = (expanded ? '' : '<button type="button" class="premium-launch" aria-expanded="false" aria-controls="premium-conversation">' + icon('chat') + '<span>Soporte</span></button>') +
    '<section class="premium-thread" data-support-chat data-draft-handoff="' + (expanded ? 'receive' : 'send') + '" id="premium-conversation" aria-labelledby="premium-thread-title"' + (expanded ? '' : ' hidden') + '>' + thread(expanded) + '</section>' +
    (expanded ? details() : '');
  if (!expanded) document.body.append(host);
  const panel = host.querySelector('[data-support-chat]');
  const field = panel.querySelector('textarea');
  const notice = panel.querySelector('[data-support-notice]');
  const launch = host.querySelector('.premium-launch');
  let connection;

  function connect() {
    return connection ||= (async () => {
      try {
        const authClient = await window.KineticHubSupabase.ensureClient();
        if (!authClient) throw new Error('Unavailable auth');
        const client = await window.KineticHubSupport.connectPublicSupportChat({
          authClient, onTicket: ticket => {
            const card = host.querySelector('[data-premium-ticket]');
            const blank = host.querySelector('[data-premium-no-ticket]');
            const guide = host.querySelector('[data-premium-status-guide]');
            const category = { general: 'Consulta general', events: 'Eventos', registration: 'Inscripciones', other: 'Otro tema' }[ticket?.category];
            card.hidden = !ticket;
            if (blank) blank.hidden = Boolean(ticket);
            host.querySelector('[data-premium-category]').textContent = category || 'Consulta de soporte';
            const badge = card.querySelector('[data-premium-state]');
            badge.dataset.status = ticket?.status || '';
            const [label = '', description = ''] = Object.hasOwn(ticketStates, ticket?.status) ? ticketStates[ticket.status] : [];
            badge.textContent = label;
            if (guide) {
              guide.hidden = !description;
              guide.querySelector('[data-premium-status-description]').textContent = description;
            }
          },
        });
        if (notice.textContent.startsWith('Preparando')) notice.textContent = '';
        return client?.refresh;
      } catch {
        notice.textContent = 'No pudimos comprobar la sesión. Recarga la página para volver a intentar.';
      }
    })();
  }

  host.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => {
    panel.querySelector('[name="category"]').value = button.dataset.topic;
    if (!field.value.trim()) field.value = button.dataset.prompt;
    field.focus();
  }));

  if (expanded) connect();
  else {
    const close = () => { panel.hidden = true; launch.hidden = false; launch.setAttribute('aria-expanded', 'false'); launch.focus(); };
    launch.addEventListener('click', () => {
      launch.hidden = true;
      launch.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      host.querySelector('[data-widget-close]').focus();
      connect();
    });
    host.querySelector('[data-widget-close]').addEventListener('click', close);
    host.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); close(); } });
  }

  const support = window.KineticHubSupport;
  const tick = support.createRefreshGate({
    isVisible: () => connection && !document.hidden && !panel.hidden,
    minGapMs: POLL_INTERVAL_MS,
    refresh: async () => { const poll = await connection; await poll?.(); },
  });
  support.scheduleRefresh({ doc: document, tick, intervalMs: POLL_INTERVAL_MS });
})();
