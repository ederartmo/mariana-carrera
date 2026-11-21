(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KineticHubSupport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const TOKEN_KEY = 'kinetichub-support-token';
  const PENDING_KEY = 'kinetichub-support-pending';
  const CATEGORIES = ['general', 'events', 'registration', 'other'];
  const accountLinks = /(https:\/\/www\.kinetichub\.com\.mx\/(?:auth\.html\?mode=login|perfil\.html|atencion\.html))(?=$|[\s.,;!?])/g;
  const loginReturn = '/atencion.html?from=support-login#premium-conversation';
  const accountActions = new Map([
    ['https://www.kinetichub.com.mx/auth.html?mode=login', ['Iniciar sesión', '/auth.html?mode=login&returnTo=' + encodeURIComponent(loginReturn)]],
    ['https://www.kinetichub.com.mx/perfil.html', ['Mis carreras', '/perfil.html']],
    ['https://www.kinetichub.com.mx/atencion.html', ['Atención', '/atencion.html']],
  ]);

  function renderAssistantReply(doc, body) {
    function textBlock(tag, content) {
      const block = doc.createElement(tag);
      for (const part of content.split(accountLinks)) {
        const action = accountActions.get(part);
        if (action) {
          const link = doc.createElement('a');
          link.className = 'support-reply-action';
          [link.textContent, link.href] = action;
          block.append(link);
        } else if (part) block.append(part);
      }
      return block;
    }
    const reply = doc.createElement('div');
    reply.className = 'support-reply';
    const procedure = body.match(/^([\s\S]*?)\s+1\.\s+([\s\S]+)$/);
    if (!procedure) {
      reply.append(textBlock('p', body));
      return reply;
    }
    reply.append(textBlock('p', procedure[1]));
    const list = doc.createElement('ol');
    for (const step of procedure[2].split(/\s+[2-9]\.\s+/)) list.append(textBlock('li', step));
    reply.append(list);
    return reply;
  }
  const json = response => response.json().catch(() => ({}));
  function uuid(cryptoApi) {
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error('Este navegador no puede generar identificadores seguros.');
  }
  function capability(cryptoApi) {
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') throw new Error('Este navegador no puede iniciar una sesión segura.');
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  }
  function retryDelayMs(value, now = Date.now()) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return 60000;
    if (/^\d+$/.test(text)) return Math.max(1000, Number(text) * 1000 || 1000);
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(1000, date - now) : 60000;
  }
  function createRefreshGate({ isVisible, refresh, minGapMs, onError = () => {}, now = Date.now }) {
    let pending = false, next = -Infinity;
    return async () => {
      if (pending || !isVisible() || now() < next) return;
      pending = true;
      next = now() + minGapMs;
      try { await refresh(); } catch (error) {
        if (error.status === 429) next = Math.max(next, now() + (error.retryDelayMs || 60000));
        onError(error);
      } finally { pending = false; }
    };
  }
  function scheduleRefresh({ doc, tick, intervalMs }) {
    const win = doc.defaultView;
    if (!win?.setInterval) return () => {};
    const wake = () => { if (!doc.hidden) void tick(); };
    const timer = win.setInterval(wake, intervalMs);
    doc.addEventListener('visibilitychange', wake);
    win.addEventListener('focus', wake);
    return () => {
      win.clearInterval(timer);
      doc.removeEventListener('visibilitychange', wake);
      win.removeEventListener('focus', wake);
    };
  }
  function uniqueMessages(messages) {
    const seen = new Set();
    return messages.filter(m => !m.id || (!seen.has(m.id) && seen.add(m.id)));
  }
  function preserveReading(scroller, render, { followEnd = false } = {}) {
    if (!scroller?.querySelectorAll || !scroller.getBoundingClientRect) return render();
    const nearEnd = followEnd && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 48;
    if (nearEnd) {
      render();
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return;
    }
    const read = () => [...scroller.querySelectorAll('[data-message-anchor]')];
    const top = scroller.getBoundingClientRect().top;
    const anchor = read().find(node => node.getBoundingClientRect().bottom > top);
    const offset = anchor?.getBoundingClientRect().top;
    const scroll = scroller.scrollTop;
    render();
    const next = anchor && read().find(node => node.dataset.messageAnchor === anchor.dataset.messageAnchor);
    scroller.scrollTop = next ? scroller.scrollTop + next.getBoundingClientRect().top - offset : scroll;
  }

  const DRAFT_HANDOFF_KEY = 'kinetichub-support-handoff-v1';
  function createDraftHandoff({ storage, ownerId, now = Date.now }) {
    return {
      clear() { try { storage.removeItem(DRAFT_HANDOFF_KEY); } catch {} },
      save(body, category) {
        try {
          storage.removeItem(DRAFT_HANDOFF_KEY);
          if (!body.trim()) return true;
          storage.setItem(DRAFT_HANDOFF_KEY, JSON.stringify({
            ownerId, body: body.slice(0,2000), category: CATEGORIES.includes(category) ? category : 'general',
            expiresAt: now() + 120000,
          }));
          return true;
        } catch { return false; }
      },
      take() {
        try {
          const raw = storage.getItem(DRAFT_HANDOFF_KEY);
          storage.removeItem(DRAFT_HANDOFF_KEY);
          const draft = raw && JSON.parse(raw);
          if (!draft || draft.ownerId !== ownerId || !Number.isFinite(draft.expiresAt) || draft.expiresAt <= now() ||
              typeof draft.body !== 'string' || !draft.body.trim() || draft.body.length > 2000 || !CATEGORIES.includes(draft.category)) return null;
          return { body: draft.body, category: draft.category };
        } catch { return null; }
      },
    };
  }

  function createPublicClient({ storage, fetch: fetcher, crypto: cryptoApi, makeRequestId, endpoint = '/api/support-chat' }) {
    const requestId = makeRequestId || (() => uuid(cryptoApi || globalThis.crypto));
    let token = storage.getItem(TOKEN_KEY);
    let pending = readPending();
    function readPending() { try { return JSON.parse(storage.getItem(PENDING_KEY) || 'null'); } catch { return null; } }
    function savePending(value) { pending = value; if (value) storage.setItem(PENDING_KEY, JSON.stringify(value)); else storage.removeItem(PENDING_KEY); }
    function ensureToken() { if (!token) { token = capability(cryptoApi || globalThis.crypto); storage.setItem(TOKEN_KEY, token); } return token; }
    async function request(action, operation) {
      const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token: ensureToken(), ...operation }) });
      const data = await json(response);
      if (!response.ok || data.ok !== true) { const error = new Error(data.error || 'No fue posible completar la solicitud.'); error.status = response.status; if (response.status === 429) error.retryDelayMs = retryDelayMs(response.headers?.get?.('Retry-After')); throw error; }
      return data;
    }
    async function beginOrSend(action, body, category) {
      if (pending) return retryPending();
      if (typeof body !== 'string' || !body.trim() || body.length > 2000) throw new Error('Escribe un mensaje de hasta 2000 caracteres.');
      if (action === 'start' && !CATEGORIES.includes(category)) throw new Error('Selecciona una categoría válida.');
      const operation = { requestId: requestId(), body: body.trim() };
      if (action === 'start') Object.assign(operation, { category, website: '' });
      savePending({ action, operation });
      const data = await request(action, operation);
      savePending(null);
      return data;
    }
    async function retryPending() {
      if (!pending) return read();
      const data = await request(pending.action, pending.operation);
      savePending(null);
      return data;
    }
    return {
      get token() { return token; },
      get hasPending() { return Boolean(pending); },
      get pendingBody() { return pending?.operation?.body; },
      start: ({ category, body }) => beginOrSend('start', body, category),
      send: body => beginOrSend('send', body),
      retryPending,
      read: () => request('read', {}),
      clear() { token = null; pending = null; storage.removeItem(TOKEN_KEY); storage.removeItem(PENDING_KEY); }
    };
  }

  function createAdminClient({ fetch: fetcher, getToken, makeRequestId, endpoint = '/api/admin-support' }) {
    const makeId = makeRequestId || (() => uuid(globalThis.crypto));
    async function call(url, options = {}) {
      const token = await getToken();
      if (!token) throw new Error('Tu sesión administrativa expiró. Inicia sesión nuevamente.');
      const response = await fetcher(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
      const data = await json(response);
      if (!response.ok || data.ok !== true) { const error = new Error(data.error || 'No fue posible cargar la atención.'); error.status = response.status; if (response.status === 429) error.retryDelayMs = retryDelayMs(response.headers?.get?.('Retry-After')); throw error; }
      return data;
    }
    return {
      list: (filters = {}, cursor = null) => {
        const query = new URLSearchParams();
        for (const key of ['status', 'category', 'assignee', 'order']) if (filters[key] !== undefined) query.set(key, filters[key]);
        if (cursor) { query.set('before', cursor.createdAt); query.set('beforeId', cursor.id); if (cursor.priority !== undefined) query.set('beforePriority', String(cursor.priority)); }
        return call(query.size ? endpoint + '?' + query : endpoint);
      },
      detail: id => call(`${endpoint}?id=${encodeURIComponent(id)}`),
      update: ({ id, expectedVersion, action, body, status, category, assignToMe, assignTo }) => call(endpoint, { method: 'POST', body: JSON.stringify({ id, requestId: makeId(), expectedVersion, action, ...(body === undefined ? {} : { body }), ...(status ? { status } : {}), ...(category ? { category } : {}), ...(assignToMe === undefined ? {} : { assignToMe }), ...(assignTo === undefined ? {} : { assignTo }) }) })
    };
  }
  function createSessionTransport({ ownerId, getSession, fetch: fetcher }) {
    async function checkedSession() {
      const session = await getSession();
      if ((session?.user?.id || null) !== ownerId || (ownerId && (typeof session?.access_token !== 'string' || !/^[^\s]+$/.test(session.access_token)))) {
        const error = new Error('La sesion cambio. Vuelve a abrir el chat.');
        error.status = 401;
        throw error;
      }
      return session;
    }
    return async (url, options = {}) => {
      const session = await checkedSession();
      const headers = Object.fromEntries(Object.entries(options.headers || {}).filter(([key]) => key.toLowerCase() !== 'authorization'));
      if (ownerId) headers.Authorization = 'Bearer ' + session.access_token;
      const response = await fetcher(url, { ...options, headers });
      await checkedSession();
      return response;
    };
  }

  async function connectPublicSupportChat({ document: doc = document, authClient, onTicket, fetch: fetcher = fetch } = {}) {
    const root = doc.querySelector('[data-support-chat]');
    if (!root) return;
    const getSession = async () => {
      if (!authClient) return null;
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    };
    const session = await getSession();
    const ownerId = session?.user?.id || null;
    const tabStorage = doc.defaultView.sessionStorage;
    // A guest capability proves access to a tab's history, not who signed in.
    // Retire it when entering an account so a later logout cannot reopen it.
    const retireGuestConversation = () => {
      tabStorage.removeItem(TOKEN_KEY);
      tabStorage.removeItem(PENDING_KEY);
    };
    if (ownerId) {
      retireGuestConversation();
      root.querySelector('[data-support-clear]').hidden = true;
      const loginNotice = root.querySelector('[data-support-login-return]');
      if (loginNotice && new URLSearchParams(doc.defaultView.location.search).get('from') === 'support-login') {
        loginNotice.hidden = false;
      }
    }
    let active = true;
    const clearTranscript = () => root.querySelector('[data-support-messages]').replaceChildren();
    doc.defaultView.addEventListener?.('pagehide', () => {
      active = false;
      clearTranscript();
    });
    doc.defaultView.addEventListener?.('pageshow', event => {
      if (event.persisted) doc.defaultView.location.reload();
    });
    const handoffMode = root.dataset?.draftHandoff;
    let draftHandoff;
    if (handoffMode) {
      try { draftHandoff = createDraftHandoff({ storage: doc.defaultView.sessionStorage, ownerId }); } catch {}
    }
    authClient?.auth.onAuthStateChange((_event, next) => {
      if (active && (next?.user?.id || null) !== ownerId) {
        active = false;
        root.hidden = true;
        clearTranscript();
        retireGuestConversation();
        draftHandoff?.clear();
        onTicket?.(null);
        doc.defaultView.location.reload();
      }
    });
    const memory = new Map();
    const storage = ownerId ? {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: key => memory.delete(key),
    } : tabStorage;
    return mountPublicSupportChat({ document: doc, root, storage, account: Boolean(ownerId), onTicket, draftHandoff, handoffMode, isActive: () => active,
      fetch: createSessionTransport({ ownerId, getSession, fetch: fetcher }) });
  }

  function mountPublicSupportChat({ document: doc = document, fetch: fetcher = fetch, storage = sessionStorage, crypto: cryptoApi = crypto, account = false, onTicket, draftHandoff, handoffMode, isActive = () => true, root: container = doc.querySelector('[data-support-chat]') } = {}) {
    if (!container) return null;
    const client = createPublicClient({ storage, fetch: fetcher, crypto: cryptoApi });
    const form = container.querySelector('[data-support-form]'); const bodyInput = container.querySelector('[name="supportMessage"]');
    const categoryInput = container.querySelector('[name="category"]'); const transcript = container.querySelector('[data-support-messages]');
    const notice = container.querySelector('[data-support-notice]'); const submit = form.querySelector('button[type="submit"]');
    const readButton = container.querySelector('[data-support-refresh]'); const clearButton = container.querySelector('[data-support-clear]');
    const humanButton = container.querySelector('[data-support-human]');
    const retry = container.querySelector('[data-support-retry]');
    const empty = container.querySelector('[data-support-empty]');
    const state = container.querySelector('[data-support-state]');
    if (handoffMode === 'receive') {
      const draft = draftHandoff?.take();
      if (draft && !bodyInput.value.trim()) {
        bodyInput.value = draft.body;
        categoryInput.value = draft.category;
      }
    }
    if (handoffMode) bodyInput.disabled = false;
    if (handoffMode === 'send') container.addEventListener('click', event => {
      const link = event.target.closest?.('[data-support-draft-link]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey ||
          event.metaKey || event.shiftKey || !isActive()) return;
      if (busy || client.hasPending) {
        event.preventDefault();
        message('Espera a que se confirme el envío antes de abrir el seguimiento.');
      } else if (bodyInput.value.trim() && !draftHandoff?.save(bodyInput.value, categoryInput.value)) {
        event.preventDefault();
        message('No pudimos transferir el borrador. Tu texto sigue aquí.');
      } else if (!bodyInput.value.trim()) draftHandoff?.clear();
    });
    function syncRetry() {
      if (retry) { retry.hidden = !client.hasPending; retry.disabled = busy; }
      submit.disabled = busy || client.hasPending;
    }
    function resetHistory() {
      rendered = '';
      onTicket?.(null);
      transcript.replaceChildren();
      if (empty) empty.hidden = false;
      if (state) state.hidden = true;
    }
    let readEpoch = 0, quietReading = false, readBackoffUntil = 0;
    let rendered = ''; let busy = false; let started = Boolean(client.token);
    const message = text => { notice.textContent = text; };
    function render(data) {
      const items = uniqueMessages(data.messages || []).slice(-100);
      const signature = JSON.stringify(items);
      if (rendered === signature) return;
      rendered = signature;
      if (empty) empty.hidden = Boolean(data.messages?.length);
      const fragment = doc.createDocumentFragment();
      for (const item of items) {
        const article = doc.createElement('article'); article.className = `support-message support-message--${item.author === 'visitor' ? 'visitor' : 'admin'}`;
        if (item.id) article.dataset.messageAnchor = item.id;
        const author = doc.createElement('strong'); author.textContent = item.author === 'agent' ? 'Asistente automático de Kinetic Hub' : item.author === 'admin' ? 'Equipo Kinetic Hub' : 'Tú';
        const body = item.body || '';
        const text = item.provenance === 'ai_generated' ? renderAssistantReply(doc, body) : doc.createElement('p');
        if (item.provenance !== 'ai_generated') text.textContent = body;
        const time = doc.createElement('time'); const date = new Date(item.created_at); time.textContent = item.created_at && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(date) : ''; if (item.created_at) time.dateTime = item.created_at;
        article.append(author, text, time); fragment.append(article);
      }
      { preserveReading(transcript.closest?.('.premium-scroll') || transcript, () => transcript.replaceChildren(fragment), { followEnd: true }); if (data.hasMore) message('Mostramos los últimos 100 mensajes. Hay mensajes anteriores disponibles al continuar cargando el historial.'); }
    }
    async function run(action) {
      if (busy || !isActive() || (action === 'read' && (quietReading || Date.now() < readBackoffUntil))) return;
      readEpoch++;
      if (action === 'human' && client.hasPending) { message('Confirma primero el envio pendiente.'); return; }
      const submitted = action === 'retry' ? client.pendingBody : bodyInput.value.trim();
      busy = true; syncRetry(); clearButton.disabled = true; readButton.disabled = true; if (humanButton) humanButton.disabled = true;
      try {
        let data;
        if (action === 'retry') data = await client.retryPending();
        else if (action === 'read') data = await client.read();
        else if (action === 'human') {
          const body = 'Solicito atencion humana.';
          data = started ? await client.send(body) : await client.start({ category: categoryInput.value, body });
        }
        else if (!started) data = await client.start({ category: categoryInput.value, body: bodyInput.value });
        else data = await client.send(bodyInput.value);
        if (!isActive()) return;
        started = true; render(data); onTicket?.(data.ticket || null);
        if ((action === 'send' || action === 'retry') && bodyInput.value.trim() === submitted) bodyInput.value = '';
        const status = { pending: 'Pendiente', in_progress: 'Abierto', resolved: 'Resuelto' }[data.ticket?.status];
        if (state) {
          state.hidden = !status;
          state.textContent = status ? 'Solicitud: ' + status : '';
        }
        message(action === 'read' ? 'Historial actualizado.' :
          action === 'human' ? 'Solicitud de atención recibida.' : 'Mensaje enviado al equipo de soporte.');
      } catch (error) {
        if (!isActive()) return;
        if (action === 'read' && error.status === 429) {
          readBackoffUntil = Date.now() + (error.retryDelayMs || 60000);
          message('Actualización en pausa por el límite temporal. Puedes seguir escribiendo.'); return;
        }
        if (error.status === 410) resetHistory();
        if (account && action === 'read' && error.status === 404) { started = false; message('Todavia no tienes una conversacion. Escribe un mensaje para empezar.'); return; }
        if (error.status === 401) { resetHistory(); started = false; }
        message(error.status === 404 || error.status === 410 ? 'La sesión de conversación venció o no está disponible. Puedes intentar de nuevo o borrar esta sesión para iniciar otra. Tu mensaje no se envió.' : `No pudimos confirmar la recepción: ${error.message} ${client.hasPending ? 'Usa “Reintentar envío” para repetir la misma solicitud de forma segura.' : ''}`);
      } finally { busy = false; syncRetry(); clearButton.disabled = false; readButton.disabled = false; if (humanButton) humanButton.disabled = false; }
    }
    form.addEventListener('submit', event => { event.preventDefault(); run('send'); });
    humanButton?.addEventListener('click', () => run('human'));
    readButton.addEventListener('click', () => run('read'));
    clearButton.addEventListener('click', () => {
      const pendingCopy = client.hasPending ? ' Hay un mensaje pendiente que no se confirmó; anótalo antes de continuar.' : '';
      if (!doc.defaultView.confirm(`Borrar esta sesión de este navegador? No borra la conversación del equipo y el historial anterior ya no estará disponible desde este dispositivo.${pendingCopy}`)) return;
      readEpoch++; draftHandoff?.clear(); client.clear(); started = false; resetHistory(); syncRetry(); bodyInput.value = ''; message('Sesión borrada. El historial anterior sigue en el sistema, pero no estará disponible desde este dispositivo.');
    });
    retry?.addEventListener('click', () => run('retry'));
    syncRetry();
    let refreshWarning = '';
    client.refresh = async () => {
      if (!(started || account) || busy || quietReading || client.hasPending || !isActive() || Date.now() < readBackoffUntil) return;
      const epoch = readEpoch;
      quietReading = true;
      try {
        const data = await client.read();
        if (epoch !== readEpoch || !isActive()) return;
        if (refreshWarning && notice.textContent === refreshWarning) message('');
        refreshWarning = '';
        started = true;
        render(data);
        onTicket?.(data.ticket || null);
      } catch (error) {
        if (epoch !== readEpoch || !isActive()) return;
        if ([401,404,410].includes(error.status)) {
          resetHistory(); started = false;
        }
        if (error.status === 404 && account) return;
        if (error.status === 429) readBackoffUntil = Date.now() + (error.retryDelayMs || 60000);
        refreshWarning = error.status === 429 ? 'La actualización está en pausa por el límite temporal.' :
          'No se pudo actualizar la conversación. Puedes actualizarla desde Opciones.';
        message(refreshWarning);
        throw error;
      } finally { quietReading = false; }
    };
    if ((started || account) && !client.hasPending) run('read');
    return client;
  }

  return { createRefreshGate, scheduleRefresh, retryDelayMs, uniqueMessages, preserveReading, createDraftHandoff, TOKEN_KEY, PENDING_KEY, createPublicClient, createAdminClient, createSessionTransport, connectPublicSupportChat, mountPublicSupportChat, renderAssistantReply, capability, uuid };
});
