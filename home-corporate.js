(function (root) {
  const events = root.KineticHubFeaturedEvents || [];
  const helpers = root.KineticHubEventHelpers || {};
  const currency = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });

  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character]);

  const eventStage = (event) => event.getStage?.() || helpers.getClosedStage?.() || { isOpen: false };
  const eventDate = (event) => helpers.formatDate?.(event.date) || "Próximamente";
  const eventPrice = (event) => {
    const stage = eventStage(event);
    return stage.isOpen && (stage.amount || stage.price) ? currency.format(stage.amount || stage.price) : "Inscripciones cerradas";
  };

  function renderFeaturedEventCard(event) {
    const stage = eventStage(event);
    const status = stage.isOpen ? "Inscripciones abiertas" : "Inscripciones cerradas";
    return `
      <article class="corporate-event-card corporate-event-card--${escapeHtml(event.theme)} reveal">
        <a class="corporate-event-media" href="${escapeHtml(event.href)}" aria-label="Ver ${escapeHtml(event.name)}">
          <img src="${escapeHtml(event.image)}" alt="${escapeHtml(event.alt)}" loading="lazy" />
        </a>
        <div class="corporate-event-content">
          <span class="corporate-event-status ${stage.isOpen ? "is-open" : ""}">${status}</span>
          <h3>${escapeHtml(event.name)}</h3>
          <dl class="corporate-event-meta">
            <div><dt><i data-lucide="calendar-days"></i></dt><dd>${eventDate(event)}</dd></div>
            <div><dt><i data-lucide="map-pin"></i></dt><dd>${escapeHtml(event.location)}</dd></div>
            <div><dt><i data-lucide="footprints"></i></dt><dd>${escapeHtml(event.distance)}</dd></div>
          </dl>
          <div class="corporate-event-footer">
            <p>Desde <strong>${eventPrice(event)}</strong></p>
            <a href="${escapeHtml(event.href)}" class="corporate-event-cta">Ver carrera <i data-lucide="arrow-right"></i></a>
          </div>
        </div>
      </article>
    `;
  }

  function renderOpenEventsNotice(openEvents) {
    if (!openEvents.length) return "";
    return `
      <div class="open-events-widget" id="openEventsWidget">
        <aside class="open-events-notice" id="openEventsNotice" aria-label="Carreras con inscripciones abiertas">
          <button class="open-events-dismiss" type="button" aria-label="Minimizar carreras activas" data-open-events-dismiss><i data-lucide="x"></i></button>
          <p class="open-events-kicker"><i data-lucide="ticket"></i> ${openEvents.length} carreras con inscripciones abiertas</p>
          <div class="open-events-list">
            ${openEvents.map((event) => `
              <article class="open-event-row">
                <img src="${escapeHtml(event.image)}" alt="" />
                <div><strong>${escapeHtml(event.name)}</strong><small>${eventDate(event)} · ${escapeHtml(event.distance)} · ${eventPrice(event)}</small></div>
                <a href="${escapeHtml(event.href)}">Ver carrera</a>
              </article>
            `).join("")}
          </div>
        </aside>
        <button class="open-events-toggle" type="button" aria-label="Ver carreras con inscripciones abiertas" aria-expanded="true" aria-controls="openEventsNotice" data-open-events-toggle>
          <i data-lucide="ticket"></i><span class="open-events-count">${openEvents.length}</span>
        </button>
      </div>
    `;
  }

  function renderHome() {
    const main = document.getElementById("homeRoot");
    if (!main || !events.length) return;

    const openEvents = events.filter((event) => eventStage(event).isOpen);
    main.className = "corporate-home";
    main.innerHTML = `
      <section class="corporate-hero" aria-labelledby="corporateHeroTitle">
        <div class="corporate-hero-art" aria-hidden="true"></div>
        <div class="container corporate-hero-inner">
          <div class="corporate-hero-copy reveal">
            <p class="corporate-kicker">Eventos que te mueven</p>
            <h1 id="corporateHeroTitle">Tu siguiente carrera <span>comienza aquí</span></h1>
            <p>En Kinetic Hub creamos experiencias deportivas inolvidables. Vive la emoción de nuestras carreras temáticas, conecta con la comunidad runner y supera tus límites.</p>
            <div class="corporate-hero-actions">
              <a class="corporate-primary-action" href="#carreras">Explorar carreras <i data-lucide="arrow-right"></i></a>
              <a class="corporate-secondary-action" href="nosotros.html">Conocer Kinetic Hub <i data-lucide="circle-play"></i></a>
            </div>
            <ul class="corporate-hero-highlights" aria-label="Beneficios de Kinetic Hub">
              <li><i data-lucide="star"></i><span><strong>Carreras temáticas</strong><small>Eventos únicos todo el año</small></span></li>
              <li><i data-lucide="users-round"></i><span><strong>Comunidad runner</strong><small>Conecta, entrena y crece</small></span></li>
              <li><i data-lucide="chart-no-axes-combined"></i><span><strong>Resultados</strong><small>Sigue tu progreso</small></span></li>
            </ul>
          </div>
        </div>
      </section>

      <section class="corporate-section corporate-featured" id="carreras" aria-labelledby="featuredEventsTitle">
        <div class="container">
          <header class="corporate-section-heading reveal">
            <p>Eventos destacados</p>
            <h2 id="featuredEventsTitle">Carreras destacadas</h2>
            <span>Inscripciones abiertas para vivir experiencias inolvidables.</span>
          </header>
          <div class="corporate-events-grid">
            ${events.map(renderFeaturedEventCard).join("")}
          </div>
        </div>
      </section>

      <section class="corporate-section corporate-benefits" id="kinetic-experience" aria-labelledby="benefitsTitle">
        <div class="container">
          <header class="corporate-section-heading corporate-section-heading--left reveal">
            <p>La experiencia Kinetic Hub</p>
            <h2 id="benefitsTitle">Más que cruzar una meta</h2>
            <span>Diseñamos cada carrera para que la disfrutes desde el registro hasta el recuerdo final.</span>
          </header>
          <div class="corporate-benefit-grid">
            <article><i data-lucide="sparkles"></i><h3>Carreras temáticas</h3><p>Conceptos que transforman cada recorrido en una experiencia memorable.</p></article>
            <article><i data-lucide="package"></i><h3>Kits coleccionables</h3><p>Piezas conmemorativas que acompañan tu preparación y tu meta.</p></article>
            <article><i data-lucide="clipboard-check"></i><h3>Organización clara</h3><p>Información, documentos y horarios pensados para que llegues listo.</p></article>
            <article><i data-lucide="chart-no-axes-combined"></i><h3>Resultados y seguimiento</h3><p>Consulta la información de cada edición desde un mismo lugar.</p></article>
            <article><i data-lucide="heart-handshake"></i><h3>Comunidad runner</h3><p>Una comunidad para entrenar, compartir y celebrar cada logro.</p></article>
          </div>
        </div>
      </section>

      <section class="corporate-section corporate-steps" aria-labelledby="stepsTitle">
        <div class="container corporate-steps-layout">
          <header class="corporate-section-heading corporate-section-heading--left reveal">
            <p>Tu próxima experiencia</p>
            <h2 id="stepsTitle">Cómo funciona</h2>
            <span>Todo lo que necesitas para llegar a la línea de salida con claridad.</span>
          </header>
          <ol class="corporate-steps-list">
            <li><span>01</span><div><h3>Elige una carrera</h3><p>Encuentra la experiencia que quieres vivir.</p></div></li>
            <li><span>02</span><div><h3>Completa tu inscripción</h3><p>Registra tus datos y confirma tu lugar.</p></div></li>
            <li><span>03</span><div><h3>Recibe tu confirmación</h3><p>Te enviaremos los detalles al correo registrado.</p></div></li>
            <li><span>04</span><div><h3>Recoge tu kit</h3><p>Consulta la información de entrega de tu evento.</p></div></li>
            <li><span>05</span><div><h3>Vive la experiencia</h3><p>Corre, comparte y celebra tu meta.</p></div></li>
          </ol>
        </div>
      </section>

      <section class="corporate-section corporate-community" aria-labelledby="communityTitle">
        <div class="container">
          <header class="corporate-section-heading corporate-section-heading--left reveal">
            <p>Comunidad y eventos</p>
            <h2 id="communityTitle">Momentos que se quedan contigo</h2>
            <span>Ruta, comunidad, kits y recuerdos de las experiencias que construimos juntos.</span>
          </header>
          <div class="corporate-gallery">
            <img class="corporate-gallery-main" src="assets/events/axolote-night-run/gallery/correr.jpg" alt="Comunidad corriendo en un evento Kinetic Hub" loading="lazy" />
            <img src="assets/events/cascanueces-run/gallery/cascanueces_run_playera.png" alt="Playera conmemorativa Cascanueces Run" loading="lazy" />
            <img src="assets/events/axolote-night-run/kit/nueva_medalla.jpg" alt="Medalla de evento Kinetic Hub" loading="lazy" />
            <img src="assets/events/cascanueces-run/gallery/cascanueces_run_mochila.png" alt="Kit conmemorativo Cascanueces Run" loading="lazy" />
          </div>
        </div>
      </section>

      <section class="corporate-section corporate-content" aria-labelledby="contentTitle">
        <div class="container">
          <header class="corporate-section-heading corporate-section-heading--left reveal">
            <p>Contenido útil</p>
            <h2 id="contentTitle">Corre con más información</h2>
            <span>Ideas y recursos para disfrutar cada entrenamiento y cada evento.</span>
          </header>
          <div class="corporate-content-grid">
            <a href="blog.html" class="corporate-content-card"><img src="assets/blog/post-1/post-1.avif" alt="Consejos para corredores" loading="lazy" /><span>Comunidad runner</span><h3>Historias, consejos y novedades para tu próxima carrera</h3><b>Ver blog <i data-lucide="arrow-up-right"></i></b></a>
            <a href="eventos.html" class="corporate-content-card corporate-content-card--plain"><i data-lucide="calendar-search"></i><span>Explora eventos</span><h3>Encuentra la próxima experiencia que quieres vivir</h3><b>Ver carreras <i data-lucide="arrow-up-right"></i></b></a>
          </div>
        </div>
      </section>

      <section class="corporate-section corporate-faq" id="preguntas" aria-labelledby="generalFaqTitle">
        <div class="container corporate-faq-layout">
          <header class="corporate-section-heading corporate-section-heading--left reveal">
            <p>Información general</p>
            <h2 id="generalFaqTitle">Preguntas frecuentes</h2>
            <span>Resuelve lo esencial antes de elegir tu próxima carrera.</span>
          </header>
          <div class="home-faq corporate-faq-list">
            ${[
              ["¿Cómo me inscribo?", "Elige una carrera, revisa sus detalles y continúa al checkout para registrar tus datos."],
              ["¿Dónde recibo mi confirmación?", "La confirmación llega al correo que registraste al completar tu inscripción."],
              ["¿Puedo registrarme en varias carreras?", "Sí. Cada evento conserva su propio proceso y podrás consultar tus inscripciones desde tu perfil."],
              ["¿Dónde se publican los resultados?", "Los resultados y comunicaciones de cada edición se publican en los canales oficiales de Kinetic Hub."],
              ["¿Cómo contacto al equipo?", "Puedes escribirnos desde la página de contacto o por los canales oficiales de Kinetic Hub."],
            ].map(([question, answer], index) => `<article class="home-faq-item ${index === 0 ? "is-open" : ""}"><button class="home-faq-question" type="button" aria-expanded="${index === 0}"><span>${question}</span><span class="home-faq-icon" aria-hidden="true"></span></button><div class="home-faq-answer"><p>${answer}</p></div></article>`).join("")}
          </div>
        </div>
      </section>
      ${renderOpenEventsNotice(openEvents)}
    `;

    const widget = document.getElementById("openEventsWidget");
    const notice = document.getElementById("openEventsNotice");
    const toggle = widget?.querySelector("[data-open-events-toggle]");
    const dismiss = widget?.querySelector("[data-open-events-dismiss]");
    const experience = document.getElementById("kinetic-experience");
    const stateStorageKey = "kinetic-events-widget-state";
    const autoMinimizedStorageKey = "kinetic-events-widget-auto-minimized";
    let observer;

    if (widget && notice && toggle && dismiss) {
      const storedState = root.sessionStorage?.getItem(stateStorageKey);
      const autoMinimized = root.sessionStorage?.getItem(autoMinimizedStorageKey) === "true";

      const setWidgetState = (state, persist = true) => {
        const isExpanded = state === "expanded";
        widget.classList.toggle("is-expanded", isExpanded);
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute("aria-hidden", String(isExpanded));
        notice.setAttribute("aria-hidden", String(!isExpanded));
        if (persist) root.sessionStorage?.setItem(stateStorageKey, state);
      };

      const minimize = (isAutomatic = false) => {
        setWidgetState("minimized");
        if (isAutomatic) root.sessionStorage?.setItem(autoMinimizedStorageKey, "true");
      };

      setWidgetState(storedState === "minimized" || autoMinimized ? "minimized" : "expanded", false);

      toggle.addEventListener("click", () => {
        setWidgetState(widget.classList.contains("is-expanded") ? "minimized" : "expanded");
      });

      dismiss.addEventListener("click", () => minimize());

      const onKeydown = (event) => {
        if (event.key === "Escape" && widget.classList.contains("is-expanded")) {
          minimize();
          toggle.focus();
        }
      };
      document.addEventListener("keydown", onKeydown);

      if (experience && !autoMinimized && "IntersectionObserver" in root) {
        observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          minimize(true);
          observer?.disconnect();
        }, { threshold: 0.12 });
        observer.observe(experience);
      }

      root.addEventListener("pagehide", () => {
        observer?.disconnect();
        document.removeEventListener("keydown", onKeydown);
      }, { once: true });
    }

    root.lucide?.createIcons?.();
  }

  renderHome();
})(typeof window !== "undefined" ? window : globalThis);