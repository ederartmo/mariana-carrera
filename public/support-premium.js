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

  function thread(expanded) {
    return `
      <header class="premium-thread-head">
        ${expanded ? icon('ticket') : brand}
        <div><h2 id="premium-thread-title">${expanded ? 'Conversación' : 'Soporte Kinetic Hub'}</h2>
        <p class="premium-indicator">${'Atención y seguimiento'}</p></div>
        ${expanded ? '' : '<a class="premium-icon" href="/atencion.html" aria-label="Abrir seguimiento">' + icon('expand') + '</a><button type="button" class="premium-icon" data-widget-close aria-label="Cerrar chat">' + icon('close') + '</button>'}
      </header>
      <div class="premium-scroll">
        ${expanded ? '' : `<div class="premium-welcome"><h3>¡Hola! 👋</h3><strong>¿Cómo podemos ayudarte?</strong><p>Déjanos tu mensaje y el equipo de Kinetic Hub podrá responderte aquí.</p></div>
          <div class="premium-topics">
          ${quick('box','Entrega de kits','events','Tengo una consulta sobre la entrega de kits.')}
          ${quick('shirt','Cambiar talla','registration','Quisiera consultar sobre un cambio de talla.')}
          <a href="/atencion.html">${icon('ticket')} Mi solicitud</a>
          ${quick('help','Otra consulta','other','')}
          </div>`}
        <div class="premium-divider"><span>Historial</span></div>
        <p class="premium-empty" data-support-empty>Todavía no hay mensajes.</p>
        <div class="support-transcript" data-support-messages role="log" aria-label="Historial de mensajes"></div>
        ${expanded ? '' : `<a class="premium-ticket premium-ticket-link" href="/atencion.html" data-premium-ticket hidden>${icon('ticket')}<span><strong>Mi solicitud</strong><small data-premium-category></small></span><span class="premium-status" data-premium-state></span><span aria-hidden="true">›</span></a>`}
      </div>
      <form data-support-form class="premium-form">
        <input type="hidden" name="category" value="general">
        <div class="premium-compose">
          <textarea name="supportMessage" aria-label="Mensaje" maxlength="2000" rows="1" required placeholder="Escribe tu mensaje..."></textarea>
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
      <div class="premium-status-guide"><h3>¿Qué significa tu estado?</h3>
        <p><strong>Pendiente:</strong> recibimos tu solicitud y espera atención.</p>
        <details><summary>Ver todos los estados</summary><p><strong>Abierto:</strong> el equipo está atendiendo tu solicitud.</p><p><strong>Resuelto:</strong> el equipo cerró la solicitud.</p></details>
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
    '<section class="premium-thread" data-support-chat id="premium-conversation" aria-labelledby="premium-thread-title"' + (expanded ? '' : ' hidden') + '>' + thread(expanded) + '</section>' +
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
            const category = { general: 'Consulta general', events: 'Eventos', registration: 'Inscripciones', other: 'Otro tema' }[ticket?.category];
            card.hidden = !ticket;
            if (blank) blank.hidden = Boolean(ticket);
            host.querySelector('[data-premium-category]').textContent = category || 'No indicada';
            const badge = card.querySelector('[data-premium-state]');
            badge.dataset.status = ticket?.status || '';
            badge.textContent = { pending: 'Pendiente', in_progress: 'Abierto', resolved: 'Resuelto' }[ticket?.status] || '';
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

  const tick = createVisiblePoll(() => connection && !document.hidden && !panel.hidden,
    async () => { const poll = await connection; await poll?.(); });
  // Reads share the existing 100/hour capability bucket with messages.
  window.setInterval(tick, POLL_INTERVAL_MS);
})();
