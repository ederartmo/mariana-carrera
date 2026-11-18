(function (root) {
  'use strict';
  function mount({ document: doc = document, fetch: fetcher = fetch, getToken, root: container = doc.querySelector('[data-admin-support]') } = {}) {
    if (!container || !root.KineticHubSupport) return null;
    const client = root.KineticHubSupport.createAdminClient({ fetch: fetcher, getToken });
    const list = container.querySelector('[data-ticket-list]'); const detail = container.querySelector('[data-ticket-detail]');
    const notice = container.querySelector('[data-admin-support-notice]'); const refresh = container.querySelector('[data-ticket-refresh]');
    const replyForm = container.querySelector('[data-ticket-reply]'); const replyInput = replyForm.querySelector('[name="reply"]');
    const statusInput = container.querySelector('[name="ticketStatus"]'); const categoryInput = container.querySelector('[name="ticketCategory"]');
    const assign = container.querySelector('[data-ticket-assign]');
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
    let sequence = 0; let selected = null; let busy = false;
    const say = value => { notice.textContent = value; };
    function setBusy(value) { busy = value; container.querySelectorAll('button, select, textarea').forEach(control => { control.disabled = value; }); renderPager(); }
    function textNode(tag, value, className) { const node = doc.createElement(tag); node.textContent = value || ''; if (className) node.className = className; return node; }
    async function loadList() {
      if (busy) return;
      const current = ++listSequence;
      listing = true; refresh.disabled = true; list.textContent = 'Cargando solicitudes...'; renderPager();
      const filters = {status:filterStatus?.value || undefined,category:filterCategory?.value || undefined,
        assignee:filterAssignee?.value === '*' ? undefined : filterAssignee?.value};
      const cursor = cursors.at(-1);
      try {
        const data = await client.list(filters, cursor); if (current !== listSequence) return;
        nextCursor = data.nextCursor || null;
        if (filterAssignee) {
          const selectedFilter = filterAssignee.value;
          filterAssignee.replaceChildren(new Option('Todos','*'), new Option('Sin asignar',''));
          for (const email of data.assignees || []) filterAssignee.add(new Option(email,email));
          filterAssignee.value = selectedFilter === '' || (data.assignees || []).includes(selectedFilter) ? selectedFilter : '*';
        }
        const fragment = doc.createDocumentFragment();
        for (const ticket of data.tickets || []) {
          const button = doc.createElement('button'); button.type = 'button'; button.className = 'support-ticket-row'; button.dataset.ticketId = ticket.id;
          button.append(textNode('strong', `Solicitud ${ticket.id.slice(0, 8)}`), textNode('span', `${ticket.status === 'pending' ? 'Pendiente' : ticket.status === 'in_progress' ? 'En proceso' : 'Resuelto'} · ${ticket.category}`), textNode('small', `Actualizada: ${ticket.updated_at || '—'}`));
          button.addEventListener('click', () => loadDetail(ticket.id)); fragment.append(button);
        }
        list.replaceChildren(fragment); if (!data.tickets?.length) list.append(textNode('p', 'No hay solicitudes de atención.'));
        say('Lista actualizada.');
      } catch (error) { if (current === listSequence) { nextCursor = null; list.textContent = 'No se pudo cargar esta pagina.'; say(error.message); } }
      finally { if (current === listSequence) { listing = false; refresh.disabled = false; renderPager(); } }
    }
    async function loadDetail(id) {
      const current = ++sequence; selected = null; detail.textContent = 'Cargando solicitud…';
      try {
        const data = await client.detail(id); if (current !== sequence) return;
        selected = data.ticket; detail.replaceChildren();
        if (assignee) {
          assignee.replaceChildren(new Option('Selecciona un responsable', ''));
          for (const email of data.assignees || []) assignee.add(new Option(email, email));
          assignee.value = (data.assignees || []).includes(selected.assigned_to) ? selected.assigned_to : '';
        }
        detail.append(textNode('h3', `Solicitud ${selected.id}`), textNode('p', `Estado: ${selected.status} · Categoría: ${selected.category} · Responsable: ${selected.assigned_to || 'Sin asignar'}`, 'support-admin-meta'));
        const messages = doc.createElement('div'); messages.className = 'support-admin-messages';
        for (const item of (data.messages || []).slice(-100)) {
          const article = doc.createElement('article'); article.append(textNode('strong', item.author === 'admin' ? 'Equipo' : 'Visitante'), textNode('p', item.body), textNode('time', item.created_at || '')); messages.append(article);
        }
        if (container.getAttribute?.('data-support-history') === 'on') {
          const history = doc.createElement('div');
          detail.append(history);
          root.KineticHubSupport.mountMessageHistory({ doc, host: history,
            fetchPage: before => client.history(id,before), isActive: () => current === sequence && !container.hidden,
            setReading: reading => { messages.hidden = reading; } });
        }
        detail.append(messages);
        if (data.hasMore) detail.append(textNode('p', 'Se muestran los últimos 100 mensajes; existen mensajes anteriores.'));
        const activity = doc.createElement('section'); activity.append(textNode('h4', 'Historial de actividad'));
        for (const event of data.activity || []) activity.append(textNode('p', `${event.action} · ${event.actor || 'Sistema'} · ${event.created_at || ''}`));
        detail.append(activity); statusInput.value = selected.status; categoryInput.value = selected.category;
      } catch (error) { if (current === sequence) { detail.textContent = error.status === 404 ? 'La solicitud no está disponible.' : `No se pudo cargar el detalle: ${error.message}`; say(error.message); } }
    }
    async function change(action, fields) {
      if (busy || !selected) return;
      setBusy(true);
      try {
        const data = await client.update({ id: selected.id, expectedVersion: selected.version, action, ...fields });
        selected = data.ticket; replyInput.value = ''; setBusy(false); await loadDetail(selected.id); await loadList(); say('Cambios guardados.');
      } catch (error) {
        if (error.status === 409) { const ticketId = selected?.id; say('Esta solicitud cambió en otra sesión. Actualizamos el detalle para evitar sobrescribir cambios.'); setBusy(false); if (ticketId) { await loadDetail(ticketId); await loadList(); } }
        else say(`No se guardó el cambio: ${error.message}`);
      } finally { setBusy(false); }
    }
    const clearSelection = () => {
      ++sequence; selected = null;
      detail.textContent = 'Selecciona una solicitud.';
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
    container.querySelector('[data-ticket-save]').addEventListener('click', () => change('update', { status: statusInput.value, category: categoryInput.value }));
    assign.addEventListener('click', () => change('update', { assignToMe: true }));
    container.querySelector('[data-ticket-assign-other]')?.addEventListener('click', () => { if (assignee?.value) change('update', { assignTo: assignee.value }); });
    loadList();
    return { loadList, loadDetail };
  }
  async function connect({ document: doc = document, authClient, fetch: fetcher = fetch } = {}) {
    const panel = doc.querySelector('[data-admin-support]');
    if (!panel) return null;
    const getSession = async () => {
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    };
    const initial = await getSession();
    const ownerId = initial?.user?.id;
    const invalidate = () => {
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
    return mount({ document: doc, root: panel,
      getToken: async () => active ? (await getSession())?.access_token : null,
      fetch: async (...args) => {
        try {
          const response = await scoped(...args);
          if (response.status === 401 || response.status === 403) { active = false; invalidate(); }
          return response;
        } catch (error) {
          if (error.status === 401) { active = false; invalidate(); }
          throw error;
        }
      },
    });
  }
  root.connectAdminSupport = connect;
  if (typeof module === 'object' && module.exports) module.exports = { mount, connect };
})(typeof window !== 'undefined' ? window : globalThis);
