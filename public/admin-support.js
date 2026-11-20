(function (root) {
  'use strict';
  const statuses = {
    pending: ['Pendiente', 'La solicitud fue recibida y espera atención.'],
    in_progress: ['En proceso', 'El equipo está atendiendo la solicitud.'],
    resolved: ['Resuelto', 'El equipo cerró la solicitud.'],
  };
  const subjects = {
    general: 'Consulta general', events: 'Consulta sobre eventos',
    registration: 'Consulta sobre inscripciones', other: 'Otra consulta',
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
      subject: label(subjects, ticket.category, 'Consulta sin categoría'), status, explanation,
    };
  }
  function assigneeLabel(email, labels = {}) {
    if (!email) return 'Sin asignar';
    return label(labels || {}, email, email);
  }
  function updateFields(ticket, status, category, assignee) {
    return { status, category, ...(assignee && assignee !== ticket?.assigned_to ? { assignTo: assignee } : {}) };
  }

  function mount({ document: doc = document, fetch: fetcher = fetch, getToken, isActive = () => true, root: container = doc.querySelector('[data-admin-support]') } = {}) {
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
    const filterStatus = container.querySelector('[data-ticket-filter-status]');
    const filterCategory = container.querySelector('[data-ticket-filter-category]');
    const filterAssignee = container.querySelector('[data-ticket-filter-assignee]');
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
    const say = value => { notice.textContent = value; };
    function setBusy(value) { busy = value; container.querySelectorAll('button, select, textarea').forEach(control => { control.disabled = value; }); renderPager(); }
    function textNode(tag, value, className) { const node = doc.createElement(tag); node.textContent = value || ''; if (className) node.className = className; return node; }
    function statusBadge(ticket, view) {
      const badge = textNode('span', view.status, 'support-ticket-status');
      badge.dataset.status = Object.hasOwn(statuses, ticket.status) ? ticket.status : 'unknown';
      return badge;
    }
    async function loadList(quiet = false) {
      if (busy || !isActive() || (quiet && listing)) return;
      const current = ++listSequence;
      const epoch = mutation;
      listing = true;
      if (!quiet) { listPayload = ''; refresh.disabled = true; list.textContent = 'Cargando solicitudes...'; renderPager(); }
      const filters = {order:'attention',status:filterStatus?.value || undefined,category:filterCategory?.value || undefined,
        assignee:filterAssignee?.value === '*' ? undefined : filterAssignee?.value};
      const cursor = cursors.at(-1);
      try {
        const data = await client.list(filters, cursor); if (!isActive() || current !== listSequence || epoch !== mutation) return;
        const payload = JSON.stringify(data);
        if (quiet && payload === listPayload) return;
        listPayload = payload;
        nextCursor = data.nextCursor || null;
        if (filterAssignee && doc.activeElement !== filterAssignee) {
          const selectedFilter = filterAssignee.value;
          filterAssignee.replaceChildren(new Option('Todos','*'), new Option('Sin asignar',''));
          for (const email of data.assignees || []) filterAssignee.add(new Option(assigneeLabel(email, data.assigneeLabels),email));
          filterAssignee.value = selectedFilter === '' || (data.assignees || []).includes(selectedFilter) ? selectedFilter : '*';
        }
        const fragment = doc.createDocumentFragment();
        for (const ticket of data.tickets || []) {
          const button = doc.createElement('button'); button.type = 'button'; button.className = 'support-ticket-row'; button.dataset.ticketId = ticket.id;
          if(ticket.status==='pending')button.dataset.needsAttention='true';
          const view = presentTicket(ticket);
          button.title = ticket.id;
          button.append(textNode('strong', view.subject), textNode('span', view.identity + (view.account ? ' · Cuenta autenticada' : '') + ' · ' + view.folio),
            statusBadge(ticket, view), textNode('small', 'Responsable: ' + assigneeLabel(ticket.assigned_to, data.assigneeLabels)),
            textNode('small', 'Actividad: ' + formatLocalDate(ticket.updated_at)));
          button.addEventListener('click', () => loadDetail(ticket.id)); fragment.append(button);
        }
        const listTop = list.scrollTop;
        const focusedId = list.contains?.(doc.activeElement) && doc.activeElement?.dataset?.ticketId;
        list.replaceChildren(fragment);
        list.scrollTop = listTop;
        if (focusedId) [...list.querySelectorAll('[data-ticket-id]')].find(row => row.dataset.ticketId === focusedId)?.focus({ preventScroll: true }); if (!data.tickets?.length) list.append(textNode('p', 'No hay solicitudes de atención.'));
        if (!quiet) say('Lista actualizada.');
      } catch (error) { if (quiet) throw error; if (isActive() && current === listSequence) { nextCursor = null; list.textContent = 'No se pudo cargar esta pagina.'; say(error.message); } }
      finally { if (current === listSequence) { listing = false; refresh.disabled = busy; renderPager(); } }
    }
    async function loadDetail(id, quiet = false) {
      if (!isActive() || (quiet && (detailReading || busy))) return;
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
          summary.replaceChildren(header, textNode('p', '', 'support-admin-meta'));
        }
        header.querySelector('h3').textContent = view.subject;
        header.querySelector('.support-ticket-identity').textContent = view.identity + (view.account ? ' · Cuenta autenticada' : '') + ' · ' + view.folio;
        const badge = header.querySelector('.support-ticket-status');
        badge.textContent = view.status; badge.dataset.status = Object.hasOwn(statuses, shown.status) ? shown.status : 'unknown';
        summary.querySelector('.support-admin-meta').textContent = view.explanation + ' Responsable: ' + assigneeLabel(shown.assigned_to, data.assigneeLabels) + ' · Última actividad: ' + formatLocalDate(shown.updated_at);
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
        if (!editing) { statusInput.value = selected.status; categoryInput.value = selected.category; }
      } catch (error) { if (quiet) throw error; if (isActive() && current === sequence) { emptyWorkspace(error.status === 404 ? 'La solicitud no está disponible.' : `No se pudo cargar el detalle: ${error.message}`); say(error.message); } }
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
    const resetList = () => {
      if (busy) return;
      clearSelection(); cursors = [null]; nextCursor = null; return loadList();
    };
    refresh.addEventListener('click', resetList);
    for (const filter of [filterStatus,filterCategory,filterAssignee]) filter?.addEventListener('change', resetList);
    previous?.addEventListener('click', () => { if (!busy && !listing && cursors.length>1) { clearSelection(); cursors.pop(); loadList(); } });
    next?.addEventListener('click', () => { if (!busy && !listing && nextCursor) { clearSelection(); cursors.push(nextCursor); loadList(); } });
    replyForm.addEventListener('submit', event => { event.preventDefault(); const body = replyInput.value.trim(); if (body) change('reply', { body }); });
    container.querySelector('[data-ticket-save]').addEventListener('click', () => change('update', updateFields(selected, statusInput.value, categoryInput.value, assignee?.value)));
    const tick = root.KineticHubSupport.createRefreshGate({
      isVisible: () => isActive() && !container.hidden && container.isConnected !== false &&
        !doc.hidden && !busy && !listing && !detailReading && container.getClientRects?.().length !== 0,
      minGapMs: 25000,
      async refresh() {
        const epoch = mutation, choice = sequence;
        await loadList(true);
        if (selected && sequence === choice && epoch === mutation && !busy && !doc.hidden) await loadDetail(selected.id,true);
        if (pollWarning && notice.textContent === pollWarning) say('');
        pollWarning = '';
      },
      onError(error) {
        if (!isActive()) return;
        pollWarning = error.status === 429 ? 'Actualización en pausa por el límite temporal.' : 'No se pudo actualizar automáticamente. Se volverá a intentar.';
        say(pollWarning);
      },
    });
    const stop = root.KineticHubSupport.scheduleRefresh({ doc, tick, intervalMs: 35000 });
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
    controller = mount({ document: doc, root: panel, isActive: () => active,
      getToken: async () => active ? (await getSession())?.access_token : null,
      fetch: async (...args) => {
        try {
          const response = await scoped(...args);
          const denied = response.status === 403 && typeof response.clone === 'function'
            ? await response.clone().json().catch(() => null) : null;
          if (response.status === 401 || (response.status === 403 && denied?.code !== 'origin_not_allowed')) {
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
  if (typeof module === 'object' && module.exports) module.exports = { mount, connect, presentTicket, formatLocalDate, updateFields, assigneeLabel };
})(typeof window !== 'undefined' ? window : globalThis);
