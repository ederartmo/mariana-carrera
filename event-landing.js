(function (root) {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function checkoutUrl(event, distance) {
    const params = new URLSearchParams({
      event: event.slug,
      distance,
    });
    return `checkout.html?${params.toString()}`;
  }

  function formatPrice(amount, currency) {
    if (!Number.isFinite(Number(amount))) return "Cerrado";
    return `$${Number(amount).toLocaleString("es-MX")} ${currency}`;
  }

  function icon(name, className = "") {
    return `<i data-lucide="${escapeHtml(name)}" class="event-landing-icon ${escapeHtml(className)}" aria-hidden="true"></i>`;
  }

  function renderVisual(visual, className) {
    if (visual.image) {
      return `<img class="${className}" src="${escapeHtml(visual.image)}" alt="${escapeHtml(visual.alt || visual.title)}" loading="eager" />`;
    }

    return `
      <div class="event-landing-placeholder ${className}" role="img" aria-label="Imagen pendiente: ${escapeHtml(visual.title)}">
        ${icon("image")}
        <strong>Imagen próximamente</strong>
      </div>
    `;
  }

  function renderSectionHeading(eyebrow, title, subtitle) {
    return `
      <header class="event-landing-section-heading reveal">
        ${eyebrow ? `<p class="event-landing-eyebrow">${escapeHtml(eyebrow)}</p>` : ""}
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </header>
    `;
  }

  function renderHero(event, stage) {
    const primaryHref = stage.isOpen ? checkoutUrl(event, event.distances[0]) : "contacto.html";
    const primaryLabel = stage.isOpen ? event.cta.primary : event.cta.closed;

    return `
      <section class="event-landing-hero" aria-labelledby="event-landing-title">
        <div class="event-landing-hero-copy reveal">
          <p class="event-landing-eyebrow event-landing-hero-eyebrow">${escapeHtml(event.eyebrow)}</p>
          <h1 id="event-landing-title">
            <span class="event-landing-title-primary">${escapeHtml(event.titleLines[0])}</span>
            <span>${escapeHtml(event.titleLines[1])}</span>
          </h1>
          <p class="event-landing-subtitle">${escapeHtml(event.subtitle)}</p>
          <dl class="event-landing-hero-meta">
            <div><dt>${icon("calendar-days")}</dt><dd>${escapeHtml(event.date.label)}</dd></div>
            <div><dt>${icon("clock-3")}</dt><dd>${escapeHtml(event.time.label)}</dd></div>
            <div><dt>${icon("map-pin")}</dt><dd>${escapeHtml(event.location.name)}, ${escapeHtml(event.location.city)}</dd></div>
          </dl>
          <div class="event-landing-hero-offer">
            <strong>${escapeHtml(event.distances.join(" y "))}</strong>
            <div class="event-landing-price-stamp">
              <span>${escapeHtml(stage.label)}</span>
              <b>${formatPrice(stage.amount, event.pricing.currency)}</b>
            </div>
          </div>
          <div class="event-landing-actions">
            <a class="event-landing-btn event-landing-btn-primary" href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)} ${icon("arrow-right")}</a>
            <a class="event-landing-btn event-landing-btn-secondary" href="#kit-participante">${escapeHtml(event.cta.secondary)} ${icon("arrow-right")}</a>
          </div>
        </div>
        <div class="event-landing-hero-visual reveal">
          <img src="${escapeHtml(event.images.hero)}" alt="${escapeHtml(event.images.heroAlt)}" />
        </div>
      </section>
    `;
  }

  function renderQuickFacts(event) {
    const factIcons = ["route", "users-round", "clock-3", "ticket", "star"];
    return `
      <section class="event-landing-facts" aria-label="Datos principales del evento">
        ${event.quickFacts.map((fact, index) => `
          <div class="event-landing-fact reveal">
            <span class="event-landing-fact-mark">${icon(factIcons[index] || "star")}</span>
            <strong>${escapeHtml(fact.value)}</strong>
            <small>${escapeHtml(fact.label)}</small>
          </div>
        `).join("")}
      </section>
    `;
  }

  function renderKit(event) {
    return `
      <section class="event-landing-section event-landing-kit" id="kit-participante">
        ${renderSectionHeading("Tu kit de participante", "Incluye todo para tu carrera", "Recibe piezas conmemorativas creadas para esta edición.")}
        <div class="event-landing-kit-grid">
          ${event.experience.map((item, index) => `
            <article class="event-landing-kit-card reveal">
              ${renderVisual(item, "event-landing-kit-media")}
              <div><span>0${index + 1}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></div>
            </article>
          `).join("")}
        </div>
        <ul class="event-landing-includes" aria-label="Otros servicios incluidos">
          ${event.kitIncludes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  function renderModalities(event, stage) {
    return `
      <section class="event-landing-section event-landing-modalities" id="modalidades">
        ${renderSectionHeading(`${event.name}`, "Elige tu distancia", event.subtitle)}
        <div class="event-landing-modality-grid">
          ${event.modalities.map((modality) => {
            const href = stage.isOpen ? checkoutUrl(event, modality.distance) : "contacto.html";
            const label = stage.isOpen ? `Elegir ${modality.distance}` : event.cta.closed;
            return `
              <article class="event-landing-modality-card reveal">
                <p class="event-landing-shoe">${icon("footprints")}</p>
                <h3>${escapeHtml(modality.distance)}</h3>
                <p class="event-landing-modality-name">${escapeHtml(modality.name)}</p>
                <p class="event-landing-modality-description">${escapeHtml(modality.description)}</p>
                <dl class="event-landing-modality-facts">
                  ${modality.facts.map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd></div>`).join("")}
                </dl>
                <a class="event-landing-btn event-landing-btn-primary" href="${escapeHtml(href)}">${escapeHtml(label)} ${icon("arrow-right")}</a>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderPricing(event, currentStage) {
    return `
      <section class="event-landing-pricing" id="precios">
        ${renderSectionHeading("Precios por etapa", "Inscríbete en el mejor momento", "El monto final se confirma automáticamente en checkout.")}
        <div class="event-landing-price-grid">
          ${event.pricing.stages.map((stage) => {
            const isCurrent = stage.key === currentStage.key;
            return `
              <article class="event-landing-price-card ${isCurrent ? "is-current" : ""} reveal">
                <span>${escapeHtml(stage.label)}</span>
                <strong>${formatPrice(stage.amount, event.pricing.currency)}</strong>
                <small>${escapeHtml(stage.period)}</small>
                ${isCurrent ? "<b>Etapa vigente</b>" : ""}
              </article>
            `;
          }).join("")}
        </div>
        <p class="event-landing-price-note">${escapeHtml(event.pricing.note)}</p>
        <div class="event-landing-event-summary reveal" aria-label="Resumen del evento">
          <div><span>${escapeHtml(event.name)}</span><strong>${escapeHtml(event.date.label)}</strong></div>
          <div><small>Sede</small><b>${escapeHtml(event.location.name)}, ${escapeHtml(event.location.city)}</b></div>
          <div><small>Salida</small><b>${escapeHtml(event.time.label)}</b></div>
          <div class="event-landing-event-summary-price"><small>Precio actual</small><strong>${formatPrice(currentStage.amount, event.pricing.currency)}</strong><em>${escapeHtml(currentStage.label)}</em></div>
        </div>
      </section>
    `;
  }

  function renderSchedule(event) {
    return `
      <section class="event-landing-section event-landing-day" id="cronograma">
        ${renderSectionHeading("Carrera recreativa", "Tu día, paso a paso", "Disfruta cada momento de Cascanueces Run 2026.")}
        <ol class="event-landing-timeline">
          ${event.schedule.map((item) => `
            <li class="event-landing-timeline-item reveal">
              <span class="event-landing-step">${escapeHtml(item.step)}</span>
              <div class="event-landing-timeline-icon">${icon(["package", "map-pin", "activity", "flag", "trophy", "party-popper"][Number(item.step) - 1] || "circle")}</div>
              <h3>${escapeHtml(item.title)}</h3>
              ${item.date ? `<strong>${escapeHtml(item.date)}</strong>` : ""}
              <time>${escapeHtml(item.time)}</time>
              <p>${escapeHtml(item.description)}</p>
            </li>
          `).join("")}
        </ol>
      </section>
    `;
  }

  function renderInformation(event) {
    const mapVisual = event.routeMap.image
      ? renderVisual({ image: event.routeMap.image, title: event.routeMap.title, alt: `Mapa del recorrido de ${event.name}` }, "event-landing-info-media")
      : `<div class="event-landing-route-art event-landing-info-media" aria-label="Recorrido de ${escapeHtml(event.distances.join(" y "))}"><span>5K / 10K</span><i aria-hidden="true"></i><small>Recorrido dentro del Bosque de San Juan de Aragón</small></div>`;

    return `
      <section class="event-landing-section event-landing-information" id="informacion">
        <div class="event-landing-info-grid">
          <article class="event-landing-info-card reveal">
            <span class="event-landing-info-symbol">${icon("map-pin")}</span>
            <h2>${escapeHtml(event.venue.title)}</h2>
            <dl>
              <div><dt>${escapeHtml(event.venue.startLabel)}</dt><dd>${escapeHtml(event.venue.start)}</dd></div>
              <div><dt>${escapeHtml(event.venue.finishLabel)}</dt><dd>${escapeHtml(event.venue.finish)}</dd></div>
            </dl>
            <a class="event-landing-text-link" href="${escapeHtml(event.location.mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir ubicación ${icon("arrow-up-right")}</a>
          </article>
          <article class="event-landing-info-card reveal">
            <span class="event-landing-info-symbol">${icon("map")}</span>
            <h2>${escapeHtml(event.routeMap.title)}</h2>
            ${mapVisual}
            ${event.routeMap.href ? `<a class="event-landing-text-link" href="${escapeHtml(event.routeMap.href)}">${escapeHtml(event.routeMap.cta)} ${icon("arrow-right")}</a>` : `<span class="event-landing-link-pending">Mapa detallado próximamente</span>`}
          </article>
          <article class="event-landing-info-card reveal">
            <span class="event-landing-info-symbol">${icon("package")}</span>
            <h2>${escapeHtml(event.packetPickup.title)}</h2>
            <strong>${escapeHtml(event.packetPickup.date)}</strong>
            <p>${escapeHtml(event.packetPickup.time)}</p>
            <p>${escapeHtml(event.packetPickup.location)}</p>
            <small>${escapeHtml(event.packetPickup.note)}</small>
          </article>
          <article class="event-landing-info-card event-landing-faq-card reveal">
            <span class="event-landing-info-symbol">${icon("circle-help")}</span>
            <h2>Preguntas frecuentes</h2>
            <div class="event-landing-faq-list">
              ${event.faqs.map((faq) => `
                <details>
                  <summary>${escapeHtml(faq.question)}${icon("chevron-right")}</summary>
                  <p>${escapeHtml(faq.answer)}</p>
                </details>
              `).join("")}
            </div>
          </article>
        </div>
        <div class="event-landing-documents reveal">
          <div><p class="event-landing-eyebrow">Documentos oficiales</p><h2>Todo listo antes de correr</h2></div>
          <div class="event-landing-document-links">
            ${event.documents.map((document) => `<a class="event-landing-btn event-landing-btn-secondary" href="${escapeHtml(document.href)}" target="_blank" rel="noopener noreferrer" ${document.download ? "download" : ""}>${icon(document.download ? "download" : "file-text")} ${escapeHtml(document.label)}</a>`).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderFinalCta(event, stage) {
    const href = stage.isOpen ? checkoutUrl(event, event.distances[0]) : "contacto.html";
    const label = stage.isOpen ? "Inscribirme ahora" : event.cta.closed;

    return `
      <section class="event-landing-final reveal" aria-labelledby="event-final-title">
        <div class="event-landing-final-image">
          <img src="${escapeHtml(event.images.finalBanner || event.images.hero)}" alt="${escapeHtml(event.images.finalBannerAlt || "")}" loading="eager" />
        </div>
        <div class="event-landing-final-copy">
          <h2 id="event-final-title">${escapeHtml(event.cta.finalTitle)}</h2>
          <p>${escapeHtml(event.cta.finalText)}</p>
          <div class="event-landing-final-offer">
            <div class="event-landing-price-stamp">
              <span>${escapeHtml(stage.label)}</span>
              <b>${formatPrice(stage.amount, event.pricing.currency)}</b>
            </div>
            <a class="event-landing-btn event-landing-btn-primary" href="${escapeHtml(href)}">${escapeHtml(label)} ${icon("arrow-right")}</a>
          </div>
          <small>${icon("shield-check")} Pago seguro y protegido</small>
        </div>
      </section>
    `;
  }

  function renderMobileCta(event, stage) {
    const href = stage.isOpen ? checkoutUrl(event, event.distances[0]) : "contacto.html";
    const label = stage.isOpen ? event.cta.primary : event.cta.closed;
    return `
      <div class="event-landing-mobile-cta">
        <div><small>${escapeHtml(stage.label)}</small><strong>${formatPrice(stage.amount, event.pricing.currency)}</strong></div>
        <a href="${escapeHtml(href)}">${escapeHtml(label)}</a>
      </div>
    `;
  }

  function applyTheme(rootElement, theme) {
    Object.entries(theme || {}).forEach(([property, value]) => {
      if (property.startsWith("--event-")) rootElement.style.setProperty(property, value);
    });
  }

  function EventLanding({ root: target, event }) {
    const rootElement = typeof target === "string" ? document.querySelector(target) : target;
    if (!rootElement || !event) return null;

    const currentStage = event.pricing.getCurrentStage(new Date());
    applyTheme(rootElement, event.theme);
    rootElement.classList.add("event-landing");
    rootElement.dataset.eventSlug = event.slug;
    rootElement.innerHTML = `
      <div class="event-landing-snow" aria-hidden="true"></div>
      <div class="event-landing-container">
        ${renderHero(event, currentStage)}
        ${renderQuickFacts(event)}
        ${renderKit(event)}
        ${renderModalities(event, currentStage)}
        ${renderPricing(event, currentStage)}
        ${renderSchedule(event)}
        ${renderInformation(event)}
        ${renderFinalCta(event, currentStage)}
        <p class="event-landing-signoff">Nos vemos el ${escapeHtml(event.date.label)} para correr juntos la carrera más mágica del año.</p>
      </div>
      ${renderMobileCta(event, currentStage)}
    `;

    if (root.lucide && typeof root.lucide.createIcons === "function") {
      root.lucide.createIcons({
        attrs: {
          "stroke-width": 1.75,
          "aria-hidden": "true",
        },
      });
    }

    return { root: rootElement, event, currentStage };
  }

  root.EventLanding = EventLanding;
})(typeof globalThis !== "undefined" ? globalThis : window);
