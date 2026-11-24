(function (root) {
  'use strict';
  const statuses = {
    pending: ['Pendiente', 'La solicitud fue recibida y espera atención.'],
    in_progress: ['En proceso', 'El equipo está atendiendo la solicitud.'],
    resolved: ['Resuelto', 'El equipo cerró la solicitud.'],
  };
  const subjects = {
    general: 'Consulta general', events: 'Consulta sobre eventos',
    registration: 'Consulta sobre inscripciones', other: 'Otra consulta', test: 'Solicitud de prueba',
  };
  const categories = {
    general: 'General', events: 'Eventos', registration: 'Inscripciones', other: 'Otro', test: 'Prueba',
  };
  const actions = {
    visitor_reopened: 'El visitante reabrió la solicitud', admin_reply: 'Respuesta del equipo', agent_acknowledged: 'Acuse automático del agente',
    automation_paused: 'Automatizaci\u00f3n pausada por respuesta humana',
    status_changed: 'Cambio de estado', category_changed: 'Cambio de categoría', assigned: 'Asignación de responsable',
  };
  const label = (options, key, fallback) => Object.hasOwn(options, key) ? options[key] : fallback;
  const dateFormatter = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  function formatLocalDate(value) {
    const date = typeof value === 'string' && value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? dateFormatter.format(date) : '—';
  }
  function presentTicket(ticket) {
    const [status, explanation] = label(statuses, ticket.status, ['Estado desconocido', 'No se pudo determinar el estado.']);
    const account = ticket.identity?.authenticated === true;
    const displayName = typeof ticket.identity?.displayName === 'string' ? ticket.identity.displayName : '';
    return {
      identity: (account && displayName) || 'Visitante sin identificar', account, folio: '#' + ticket.id.slice(0, 8).toUpperCase(),
      subject: label(subjects, ticket.category, 'Consulta sin categoría'),
      category: label(categories, ticket.category, 'Sin categoría'), status, explanation,
    };
  }
  function assigneeLabel(email, labels = {}) {
    if (!email) return 'Sin asignar';
    return label(labels || {}, email, email);
  }
  function updateFields(ticket, status, category, assignee) {
    return { status, ...(category === 'test' && ticket?.category === category ? {} : { category }),
      ...(assignee && assignee !== ticket?.assigned_to ? { assignTo: assignee } : {}) };
  }

  function connectFilters(container, doc, onChange) {
    const block = container.querySelector('[data-ticket-filters]');
    const tabs = block?.querySelectorAll?.('[data-ticket-filter-tab]');
    if (!tabs?.length) return { values: () => ({}), updateAssignees() {} };
    const select = block.querySelector('[data-ticket-filter-select]');
    const chips = block.querySelector('[data-ticket-filter-chips]');
    const all = { status:'', category:'', assignee:'*' };
    const values = { ...all };
    const options = {
      status: [['','Todos'], ...Object.entries(statuses).map(([key,[name]]) => [key,name])],
      category: [['','Todas'], ...Object.entries(categories)],
      assignee: [['*','Todos'], ['','Sin asignar']],
    };
    let active = tabs[0];
    function renderSelect() {
      const key = active.dataset.ticketFilterTab;
      select.replaceChildren(...options[key].map(([value,name]) => new Option(name,value)));
      select.value = values[key];
      select.setAttribute('aria-label',active.textContent);
    }
    function renderChips() {
      const buttons = [];
      for (const tab of tabs) {
        const key = tab.dataset.ticketFilterTab;
        if (values[key] === all[key]) continue;
        const name = options[key].find(([value]) => value === values[key])?.[1] || values[key];
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = tab.textContent + ': ' + name + ' ×';
        button.setAttribute('aria-label','Quitar filtro ' + tab.textContent + ': ' + name);
        button.addEventListener('click', () => {
          values[key] = all[key];
          if (active === tab) select.value = values[key];
          renderChips();
          active.focus();
          onChange();
        });
        buttons.push(button);
      }
      chips.replaceChildren(...buttons);
    }
    for (const tab of tabs) tab.addEventListener('click', () => {
      if (tab === active) return;
      active.setAttribute('aria-pressed','false');
      active = tab;
      active.setAttribute('aria-pressed','true');
      renderSelect();
    });
    select.addEventListener('change', () => {
      values[active.dataset.ticketFilterTab] = select.value;
      renderChips();
      onChange();
    });
    renderSelect();
    return {
      values: () => Object.fromEntries(Object.entries(values).filter(([key,value]) => value !== all[key])),
      updateAssignees(assignees, labels) {
        const next = [['*','Todos'],['','Sin asignar'], ...assignees.map(email => [email,assigneeLabel(email,labels)])];
        if (JSON.stringify(options.assignee) === JSON.stringify(next)) return;
        options.assignee = next;
        if (active.dataset.ticketFilterTab === 'assignee') renderSelect();
        renderChips();
      },
    };
  }

  function createVisitorAlerts({ win, ownerId, channels, announce }) {
    const seen = new Set();
    let first = true, historyFloor = -Infinity;
    async function claim(channel, fresh) {
      const key = 'kinetichub-support-alert:' + ownerId + ':' + channel;
      const deliver = () => {
        if (!channels().includes(channel)) return;
        let unseen = fresh;
        try {
          const saved = JSON.parse(win.localStorage.getItem(key) || '[]');
          const claimed = new Set(Array.isArray(saved) ? saved : []);
          unseen = fresh.filter(id => !claimed.has(id));
          if (unseen.length) win.localStorage.setItem(key, JSON.stringify([...claimed, ...unseen].slice(-150)));
        } catch { /* This tab still deduplicates alerts when storage is unavailable. */ }
        if (unseen.length) announce(channel, unseen.length);
      };
      if (win.navigator?.locks?.request) await win.navigator.locks.request(key, deliver);
      else deliver();
    }
    return async messages => {
      const fresh = [];
      for (const message of messages) {
        const time = Date.parse(message.createdAt);
        if (!message.id || !Number.isFinite(time)) continue;
        if (!first && time >= historyFloor && !seen.has(message.id)) fresh.push(message.id);
        seen.add(message.id);
      }
      if (first) {
        const dates = messages.map(message => Date.parse(message.createdAt)).filter(Number.isFinite);
        if (dates.length) historyFloor = Math.min(...dates);
        first = false;
      }
      while (seen.size > 150) seen.delete(seen.values().next().value);
      if (fresh.length) await Promise.all(channels().map(channel => claim(channel, fresh)));
    };
  }

  function connectMonitor(container, doc, ownerId, isActive, wake) {
    const block = container.querySelector('[data-support-monitor]');
    const win = doc.defaultView;
    const sound = block?.querySelector?.('[data-monitor-sound]');
    if (!ownerId || !win || !sound?.setAttribute) return null;
    const desktop = block.querySelector('[data-monitor-desktop]');
    const status = block.querySelector('[data-monitor-status]');
    const counts = block.querySelector('[data-monitor-counts]');
    const Audio = win.AudioContext || win.webkitAudioContext;
    let audio, soundOn = false, desktopOn = false;
    sound.hidden = !Audio;
    desktop.hidden = !win.Notification;
    const channels = () => !isActive() ? [] : [
      ...(soundOn ? ['sound'] : []),
      ...(desktopOn && win.Notification.permission === 'granted' ? ['desktop'] : []),
    ];
    const receive = createVisitorAlerts({win,ownerId,channels,announce(channel, amount) {
      if (channel === 'sound') {
        if (audio?.state !== 'running') return;
        const tone = audio.createOscillator(), gain = audio.createGain();
        tone.frequency.value = 660;
        gain.gain.setValueAtTime(0.12,audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime + 0.18);
        tone.connect(gain).connect(audio.destination);
        tone.start();
        tone.stop(audio.currentTime + 0.18);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      } else {
        try {
          const notification = new win.Notification('KineticHub · Soporte', {
            body: amount === 1 ? 'Hay un mensaje nuevo de un visitante.' : 'Hay mensajes nuevos de visitantes.',
            tag: 'kinetichub-support-inbox',
            silent: true,
          });
          notification.onclick = () => { if (isActive()) win.focus(); notification.close(); };
        } catch { /* Desktop notifications are optional on platforms without constructor support. */ }
      }
    }});
    sound.addEventListener('click', async () => {
      try {
        if (!soundOn) {
          audio ||= new Audio();
          await audio.resume();
          if (!isActive()) return;
        }
        soundOn = !soundOn;
        sound.setAttribute('aria-pressed',String(soundOn));
        sound.textContent = soundOn ? 'Desactivar sonido' : 'Activar sonido';
        wake();
      } catch { sound.textContent = 'Sonido no disponible'; }
    });
    desktop.addEventListener('click', async () => {
      try {
        desktopOn = !desktopOn && (win.Notification.permission === 'granted' ||
          await win.Notification.requestPermission() === 'granted');
        if (!isActive()) return;
        desktop.setAttribute('aria-pressed',String(desktopOn));
        desktop.textContent = desktopOn ? 'Desactivar notificaciones' : 'Activar notificaciones';
        if (win.Notification.permission === 'denied') desktop.textContent = 'Notificaciones bloqueadas';
        wake();
      } catch { desktop.textContent = 'Notificaciones no disponibles'; }
    });
    return {
      background: () => channels().length > 0,
      setStatus: value => { status.textContent = value; },
      update(overview) {
        if (!overview) { this.setStatus('Monitoreo no disponible'); counts.textContent = ''; return; }
        this.setStatus('Monitoreo activo');
        const {pending,inProgress,resolved} = overview.counts;
        counts.textContent = `${pending} pendientes · ${inProgress} en proceso · ${resolved} resueltas`;
        void receive(overview.messages).catch(() => {});
      },
      stop() {
        soundOn = false;
        desktopOn = false;
        this.setStatus('Monitoreo en pausa');
        if (audio) void audio.close().catch(() => {});
      },
    };
  }

  const followupLabels = {
    none: 'Sin correo',
    pending: 'Pendiente de verificar',
    verified: 'Correo verificado · Las respuestas humanas pueden generar notificaciones.',
  };

  function mount({ document: doc = document, fetch: fetcher = fetch, getToken, ownerId, isActive = () => true, root: container = doc.querySelector('[data-admin-support]') } = {}) {
    if (!container || !root.KineticHubSupport) return null;
    const client = root.KineticHubSupport.createAdminClient({ fetch: fetcher, getToken });
    const list = container.querySelector('[data-ticket-list]'); const detail = container.querySelector('[data-ticket-detail]');
    const notice = container.querySelector('[data-admin-support-notice]'); const refresh = container.querySelector('[data-ticket-refresh]');
    const replyForm = container.querySelector('[data-ticket-reply]'); const replyInput = replyForm.querySelector('[name="reply"]');
    const statusInput = container.querySelector('[name="ticketStatus"]'); const categoryInput = container.querySelector('[name="ticketCategory"]');
    const summary = container.querySelector('[data-ticket-summary]');
    const placeholder = container.querySelector('[data-ticket-placeholder]');
    const messages = container.querySelector('[data-ticket-transcript]');
    const messageLimit = container.querySelector('[data-ticket-message-limit]');
    const editDrawer = container.querySelector('[data-ticket-edit]');
    const activityDrawer = container.querySelector('[data-ticket-activity]');
    const activityLog = container.querySelector('[data-ticket-activity-log]');
    const activityCount = container.querySelector('[data-ticket-activity-count]');
    let viewId = null;
    const emptyWorkspace = text => {
      viewId = null; detail.hidden = true; placeholder.hidden = false; placeholder.textContent = text;
      editDrawer.open = false; activityDrawer.open = false;
      summary.replaceChildren(); messages.replaceChildren(); activityLog.replaceChildren();
      messages.scrollTop = 0; activityLog.scrollTop = 0;
    };
    const assignee = container.querySelector('[name=ticketAssignee]');
    const filters = connectFilters(container, doc, resetList);
    const monitor = connectMonitor(container,doc,ownerId,isActive,() => void tick());
    const previous = container.querySelector('[data-ticket-page-prev]');
    const next = container.querySelector('[data-ticket-page-next]');
    let cursors = [null], nextCursor = null, listing = false;
    function renderPager() {
      if (previous) previous.disabled = busy || listing || cursors.length === 1;
      if (next) next.disabled = busy || listing || !nextCursor;
    }
    let listSequence = 0;
    let sequence = 0; let selected = null; let busy = false; let mutation = 0;
    let detailReading = false, listPayload = '', detailPayload = '', pollWarning = '', shownAssignee = '';
    let readBackoffUntil = 0;
    const noteReadError = error => {
      if (error.status === 429) readBackoffUntil = Date.now() + (error.retryDelayMs || 60000);
    };
    const say = value => { notice.textContent = value; };
    function setBusy(value) { busy = value; container.querySelectorAll('button, select, textarea').forEach(control => { control.disabled = value; }); renderPager(); }
    function textNode(tag, value, className) { const node = doc.createElement(tag); node.textContent = value || ''; if (className) node.className = className; return node; }
    function statusBadge(ticket, view) {
      const badge = textNode('span', view.status, 'support-ticket-status');
      badge.dataset.status = Object.hasOwn(statuses, ticket.status) ? ticket.status : 'unknown';
      return badge;
    }
    async function loadList(quiet = false) {
      if (busy || !isActive() || Date.now() < readBackoffUntil || (quiet && listing)) return;
      const current = ++listSequence;
      const epoch = mutation;
      listing = true;
      if (!quiet) { listPayload = ''; refresh.disabled = true; list.textContent = 'Cargando solicitudes...'; renderPager(); }
      const query = {order:'attention', ...filters.values(), ...(monitor ? { monitor:'1' } : {})};
      const cursor = cursors.at(-1);
      try {
        const data = await client.list(query, cursor); if (!isActive() || current !== listSequence || epoch !== mutation) return;
        const {monitor: overview, ...listData} = data;
        monitor?.update(overview);
        const payload = JSON.stringify(listData);
        if (quiet && payload === listPayload) return;
        listPayload = payload;
        nextCursor = data.nextCursor || null;
        filters.updateAssignees(data.assignees || [],data.assigneeLabels);
        const fragment = doc.createDocumentFragment();
        for (const ticket of data.tickets || []) {
          const button = doc.createElement('button'); button.type = 'button'; button.className = 'support-ticket-row'; button.dataset.ticketId = ticket.id;
          if(ticket.status==='pending')button.dataset.needsAttention='true';
          const view = presentTicket(ticket);
          button.title = ticket.id;
          const badges = textNode('span', '', 'support-ticket-badges');
          badges.append(statusBadge(ticket, view), textNode('span', view.category, 'support-ticket-category'));
          button.append(textNode('strong', view.subject), textNode('span', view.identity + (view.account ? ' · Cuenta autenticada' : '') + ' · ' + view.folio),
            badges, textNode('small', 'Responsable: ' + assigneeLabel(ticket.assigned_to, data.assigneeLabels)),
            textNode('small', 'Actividad: ' + formatLocalDate(ticket.updated_at)));
          button.addEventListener('click', () => loadDetail(ticket.id)); fragment.append(button);
        }
        const listTop = list.scrollTop;
        const focusedId = list.contains?.(doc.activeElement) && doc.activeElement?.dataset?.ticketId;
        list.replaceChildren(fragment);
        list.scrollTop = listTop;
        if (focusedId) [...list.querySelectorAll('[data-ticket-id]')].find(row => row.dataset.ticketId === focusedId)?.focus({ preventScroll: true }); if (!data.tickets?.length) list.append(textNode('p', 'No hay solicitudes de atención.'));
        if (!quiet) say('Lista actualizada.');
      } catch (error) {
        noteReadError(error);
        monitor?.setStatus('Monitoreo en pausa');
        if (quiet) throw error;
        if (isActive() && current === listSequence) { nextCursor = null; list.textContent = 'No se pudo cargar esta página.'; say(error.message); }
      }
      finally { if (current === listSequence) { listing = false; refresh.disabled = busy; renderPager(); } }
    }
    async function loadDetail(id, quiet = false) {
      if (!isActive() || Date.now() < readBackoffUntil || (quiet && (detailReading || busy))) return;
      const current = quiet ? sequence : ++sequence;
      const epoch = mutation;
      detailReading = true;
      if (!quiet) {
        detailPayload = ''; selected = null;
        if (viewId !== id) emptyWorkspace('Cargando solicitud…');
      }
      try {
        const data = await client.detail(id);
        if (!isActive() || current !== sequence || epoch !== mutation || (quiet && selected?.id !== id)) return;
        const payload = JSON.stringify(data);
        const editing = quiet && (statusInput.value !== selected.status || categoryInput.value !== selected.category ||
          (assignee && assignee.value !== shownAssignee) || [statusInput, categoryInput, assignee].includes(doc.activeElement));
        if (quiet && payload === detailPayload && !(selected.version !== data.ticket.version && !editing)) return;
        detailPayload = payload;
        if (!editing) selected = data.ticket;
        const shown = data.ticket;
        const sameView = viewId === id;
        if (assignee && !editing) {
          assignee.replaceChildren(new Option('Sin cambio de responsable', ''));
          for (const email of data.assignees || []) assignee.add(new Option(assigneeLabel(email, data.assigneeLabels), email));
          assignee.value = (data.assignees || []).includes(selected.assigned_to) ? selected.assigned_to : ''; shownAssignee = assignee.value;
        }
        const view = presentTicket(shown);
        let header = sameView && summary.querySelector('.support-ticket-heading');
        if (!header) {
          header = doc.createElement('div'); header.className = 'support-ticket-heading';
          const copy = textNode('button', 'Copiar UUID', 'btn-secondary'); copy.type = 'button';
          const ticketId = shown.id; copy.title = ticketId;
          copy.addEventListener('click', async () => {
            try { await doc.defaultView.navigator.clipboard.writeText(ticketId); if (isActive() && viewId === ticketId) say('UUID copiado.'); }
            catch { if (isActive() && viewId === ticketId) say('UUID: ' + ticketId); }
          });
          header.append(textNode('h3', ''), textNode('p', '', 'support-ticket-identity'), statusBadge(shown,view), copy);
          summary.replaceChildren(header, textNode('p', '', 'support-admin-meta'), textNode('p', '', 'support-email-indicator'));
        }
        header.querySelector('h3').textContent = view.subject;
        header.querySelector('.support-ticket-identity').textContent = view.identity + (view.account ? ' · Cuenta autenticada' : '') + ' · ' + view.folio;
        const badge = header.querySelector('.support-ticket-status');
        badge.textContent = view.status; badge.dataset.status = Object.hasOwn(statuses, shown.status) ? shown.status : 'unknown';
        summary.querySelector('.support-admin-meta').textContent = view.explanation + ' Responsable: ' + assigneeLabel(shown.assigned_to, data.assigneeLabels) + ' · Última actividad: ' + formatLocalDate(shown.updated_at);
        const email = summary.querySelector('.support-email-indicator');
        email.textContent = label(followupLabels,data.emailState,'');
        email.hidden = !email.textContent;
        email.dataset.state = data.emailState || '';
        summary.querySelector('.support-private-proposal')?.remove();
        if (data.ai) {
          const card = doc.createElement('aside');
          card.className = 'support-private-proposal';
          card.setAttribute('aria-label','Propuesta privada de IA');
          const proposal = data.ai.proposal;
          card.append(textNode('h4','Propuesta privada de IA'),
            textNode('p',data.ai.paused ? 'Procesamiento de IA: pausado' : 'Procesamiento de IA: habilitado'));
          if (proposal) {
            card.append(textNode('strong',proposal.state === 'current' ? 'Vigente' : 'Obsoleta'),
              textNode('p',proposal.text || (proposal.decision === 'escalate' ? 'Requiere revisión humana.' : 'La fuente aprobada ya no está disponible.')));
            if (proposal.source) card.append(textNode('p','Fuente aprobada: '+proposal.source));
            if (proposal.state !== 'current') card.append(textNode('p','Solo para consulta histórica.'));
          } else card.append(textNode('p','Todavía no hay una propuesta.'));
          summary.append(card);
        }
        viewId = id; detail.hidden = false; placeholder.hidden = true;
        const entries = doc.createDocumentFragment();
        for (const item of root.KineticHubSupport.uniqueMessages(data.messages || []).slice(-100)) {
          const article = doc.createElement('article'); article.className = item.author === 'visitor' ? 'support-admin-message--visitor' : 'support-admin-message--team'; if (item.id) article.dataset.messageAnchor = item.id; article.append(textNode('strong', item.author === 'agent' ? 'Asistente automático' : item.author === 'admin' ? 'Equipo' : 'Visitante'), textNode('p', item.body), textNode('time', formatLocalDate(item.created_at))); entries.append(article);
        }
        root.KineticHubSupport.preserveReading(messages, () => messages.replaceChildren(entries));
        messageLimit.hidden = !data.hasMore;
        const events = doc.createDocumentFragment();
        for (const event of data.activity || []) {
          const actor = event.actor === 'visitor' ? view.identity : (event.actor || 'Sistema');
          events.append(textNode('p', [label(actions, event.action, 'Actividad registrada'), actor, formatLocalDate(event.created_at)].join(' · ')));
        }
        const count = (data.activity || []).length;
        activityCount.textContent = count + (count === 1 ? ' evento' : ' eventos');
        if (!count) events.append(textNode('p', 'Todavía no hay actividad registrada.'));
        const activityTop = activityLog.scrollTop;
        activityLog.replaceChildren(events); activityLog.scrollTop = activityTop;
        if (!editing) {
          statusInput.value = selected.status;
          categoryInput.value = selected.category;
          const testOption = categoryInput.querySelector('option[value="test"]');
          if (testOption) testOption.disabled = !data.canSetTestCategory;
        }
      } catch (error) { noteReadError(error); if (quiet) throw error; if (isActive() && current === sequence) { emptyWorkspace(error.status === 404 ? 'La solicitud no está disponible.' : `No se pudo cargar el detalle: ${error.message}`); say(error.message); } }
      finally { if (current === sequence) detailReading = false; }
    }
    async function change(action, fields) {
      if (busy || !selected || !isActive()) return;
      mutation++;
      setBusy(true);
      try {
        const data = await client.update({ id: selected.id, expectedVersion: selected.version, action, ...fields });
        if (!isActive()) return;
        selected = data.ticket;
        if (action === 'reply') replyInput.value = '';
        setBusy(false); await loadDetail(selected.id); await loadList(); say('Cambios guardados.');
      } catch (error) {
        if (error.status === 409) { const ticketId = selected?.id; say('Esta solicitud cambió en otra sesión. Actualizamos el detalle para evitar sobrescribir cambios.'); setBusy(false); if (ticketId) { await loadDetail(ticketId); await loadList(); } }
        else say(`No se guardó el cambio: ${error.message}`);
      } finally { setBusy(false); }
    }
    const clearSelection = () => {
      ++sequence; detailReading = false; selected = null;
      emptyWorkspace('Selecciona una solicitud.');
      replyInput.value = '';
    };
    function resetList() {
      if (busy || Date.now() < readBackoffUntil) return;
      clearSelection(); cursors = [null]; nextCursor = null; return loadList();
    }
    refresh.addEventListener('click', resetList);
    previous?.addEventListener('click', () => { if (!busy && !listing && Date.now() >= readBackoffUntil && cursors.length>1) { clearSelection(); cursors.pop(); loadList(); } });
    next?.addEventListener('click', () => { if (!busy && !listing && Date.now() >= readBackoffUntil && nextCursor) { clearSelection(); cursors.push(nextCursor); loadList(); } });
    replyForm.addEventListener('submit', event => { event.preventDefault(); const body = replyInput.value.trim(); if (body) change('reply', { body }); });
    container.querySelector('[data-ticket-save]').addEventListener('click', () => change('update', updateFields(selected, statusInput.value, categoryInput.value, assignee?.value)));
    const refreshGate = root.KineticHubSupport.createRefreshGate({
      isVisible: () => isActive() && !container.hidden && container.isConnected !== false &&
        (!doc.hidden || monitor?.background()) && !busy && !listing && !detailReading &&
        Date.now() >= readBackoffUntil && container.getClientRects?.().length !== 0,
      minGapMs: 12000,
      async refresh() {
        const epoch = mutation, choice = sequence;
        await loadList(true);
        if (selected && sequence === choice && epoch === mutation && !busy && !doc.hidden) await loadDetail(selected.id,true);
        if (pollWarning && notice.textContent === pollWarning) say('');
        pollWarning = '';
      },
      onError(error) {
        if (!isActive()) return;
        monitor?.setStatus('Monitoreo en pausa');
        pollWarning = error.status === 429 ? 'Actualización en pausa por el límite temporal.' : 'No se pudo actualizar automáticamente. Se volverá a intentar.';
        say(pollWarning);
      },
    });
    const tick = () => {
      if (doc.hidden && !monitor?.background()) monitor?.setStatus('Monitoreo en pausa');
      return refreshGate();
    };
    const stopRefresh = root.KineticHubSupport.scheduleRefresh({doc,tick,intervalMs:15000,allowHidden:() => Boolean(monitor)});
    const stop = () => { stopRefresh(); monitor?.stop(); };
    loadList();
    return { loadList, loadDetail, tick, stop };
  }
  async function connect({ document: doc = document, authClient, fetch: fetcher = fetch, onAccessDenied } = {}) {
    const panel = doc.querySelector('[data-admin-support]');
    if (!panel) return null;
    const getSession = async () => {
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    };
    const initial = await getSession();
    const ownerId = initial?.user?.id;
    let controller;
    const invalidate = () => {
      controller?.stop();
      panel.hidden = true;
      panel.replaceChildren();
    };
    if (!ownerId || !initial.access_token) { invalidate(); return null; }
    let active = true;
    authClient.auth.onAuthStateChange((_event, next) => {
      if (next?.user?.id !== ownerId) { active = false; invalidate(); }
    });
    const scoped = root.KineticHubSupport.createSessionTransport({
      ownerId, fetch: fetcher, getSession: async () => active ? getSession() : null,
    });
    controller = mount({ document: doc, root: panel, ownerId, isActive: () => active,
      getToken: async () => active ? (await getSession())?.access_token : null,
      fetch: async (...args) => {
        try {
          const response = await scoped(...args);
          const denied = response.status === 403 && typeof response.clone === 'function'
            ? await response.clone().json().catch(() => null) : null;
          if (response.status === 401 || (response.status === 403 && !['origin_not_allowed', 'category_not_allowed'].includes(denied?.code))) {
            active = false; invalidate(); onAccessDenied?.(response.status);
          }
          return response;
        } catch (error) {
          if (error.status === 401) { active = false; invalidate(); onAccessDenied?.(401); }
          throw error;
        }
      },
    });
    return controller;
  }
  root.connectAdminSupport = connect;
  if (typeof module === 'object' && module.exports) module.exports = { mount, connect, presentTicket, formatLocalDate, updateFields, assigneeLabel, createVisitorAlerts };
})(typeof window !== 'undefined' ? window : globalThis);
