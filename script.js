function setupMenuToggle() {
  const menuToggle = document.getElementById("menuToggle");
  const nav = document.getElementById("siteNav");

  if (!menuToggle || !nav) return;

  const closeMenu = () => {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  };

  menuToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.addEventListener("click", (event) => {
    const clickedLink = event.target.closest("a");
    if (clickedLink && window.matchMedia("(max-width: 760px)").matches) {
      closeMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    const clickedInsideNav = event.target.closest("#siteNav, #menuToggle");
    if (!clickedInsideNav) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 760px)").matches) {
      closeMenu();
    }
  });
}

function setupActiveNavLink() {
  const nav = document.getElementById("siteNav");
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll("a[href]"));
  if (!links.length) return;

  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  links.forEach((link) => {
    const linkPath = (link.getAttribute("href") || "").split("#")[0];
    const isHome = currentPath === "" || currentPath === "index.html";
    const shouldActivate = linkPath === currentPath || (isHome && linkPath === "index.html");

    if (shouldActivate) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });

  if (!nav.querySelector(".nav-mobile-cta")) {
    const cta = document.createElement("a");
    cta.href = "auth.html?mode=register";
    cta.className = "nav-mobile-cta";
    cta.textContent = "Registrarse";
    nav.appendChild(cta);
  }
}

function setupPageLoadIndicator() {
  if (document.querySelector(".page-load-bar")) return;

  const bar = document.createElement("div");
  bar.className = "page-load-bar is-visible is-animating";
  document.body.prepend(bar);

  const complete = () => {
    bar.classList.remove("is-animating");
    bar.classList.add("is-complete");

    window.setTimeout(() => {
      bar.classList.add("is-hidden");
    }, 180);

    window.setTimeout(() => {
      bar.remove();
    }, 520);
  };

  if (document.readyState === "complete") {
    complete();
    return;
  }

  window.addEventListener("load", complete, { once: true });
}

function setupHeaderScrollState() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const updateState = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 16);
  };

  window.addEventListener("scroll", updateState, { passive: true });
  updateState();
}

function setupEventStickyBanner() {
  const summaryCard = document.getElementById("raceRegisterBar");
  const stickyBanner = document.getElementById("eventStickyBanner");
  const header = document.querySelector(".site-header");
  if (!summaryCard || !stickyBanner) return;

  const setVisible = (isVisible) => {
    stickyBanner.classList.toggle("is-visible", isVisible);
    stickyBanner.setAttribute("aria-hidden", String(!isVisible));
  };

  const applyBannerOffset = () => {
    const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 76;
    document.documentElement.style.setProperty("--sticky-banner-offset", `${headerHeight + 8}px`);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;

      const leftViewport = entry.boundingClientRect.bottom <= 0 && !entry.isIntersecting;
      setVisible(leftViewport);
    },
    { threshold: 0 }
  );

  observer.observe(summaryCard);

  if (header && typeof ResizeObserver !== "undefined") {
    const headerResizeObserver = new ResizeObserver(() => applyBannerOffset());
    headerResizeObserver.observe(header);
  }

  window.addEventListener("resize", applyBannerOffset);
  applyBannerOffset();
}

function setupRevealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      });
    },
    { threshold: 0.16 }
  );

  items.forEach((item) => observer.observe(item));
}

function setupCurrentYear() {
  const yearNode = document.getElementById("yearNow");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }
}

function setupUnifiedFooter() {
  const footer = document.querySelector(".site-footer");
  if (!footer) return;

  const grid = footer.querySelector(".footer-grid");
  const links = footer.querySelector(".footer-links");

  if (grid) {
    grid.innerHTML = `
      <div>
        <div class="footer-brand-block">
          <a href="index.html" class="footer-brand" aria-label="Inicio Kinetic Hub">
            <img class="brand-logo" src="KineticHUB.png" alt="Kinetic Hub" />
          </a>
          <p class="footer-legend">Kinetic Hub conecta carreras, comunidad y experiencias que se viven antes, durante y despues de cada meta.</p>
          <div class="footer-social" aria-label="Redes sociales de Kinetic Hub">
            <a class="footer-social-link" href="https://wa.me/525530790944?text=Hola%2C%20quiero%20informacion%20de%20Kinetic%20Hub" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 21a8.9 8.9 0 0 1-4.28-1.1L3.5 21l1.16-4.05A8.95 8.95 0 1 1 12 21Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9.3 8.8c.25-.56.52-.58.78-.58.2 0 .43 0 .65.01.21 0 .5-.08.77.56.27.64.91 2.2.99 2.36.08.16.13.35.02.57-.1.22-.15.35-.3.53-.15.17-.31.39-.44.52-.15.15-.31.31-.13.62.17.3.78 1.28 1.67 2.08 1.15 1.02 2.1 1.34 2.4 1.49.3.15.48.13.66-.08.17-.2.73-.84.92-1.12.19-.29.39-.24.66-.14.27.1 1.69.8 1.98.95.29.15.48.22.55.35.07.13.07.77-.18 1.5-.25.73-1.47 1.4-2.05 1.49-.53.08-1.21.12-3.9-1.06-3.26-1.43-5.35-4.92-5.52-5.16-.17-.24-1.32-1.76-1.32-3.35 0-1.6.84-2.38 1.14-2.72Z" fill="currentColor"/>
              </svg>
            </a>
            <a class="footer-social-link" href="https://www.instagram.com/kinetic.hub" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" stroke-width="1.8"/>
                <circle cx="12" cy="12" r="3.6" stroke="currentColor" stroke-width="1.8"/>
                <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor"/>
              </svg>
            </a>
            <a class="footer-social-link" href="https://www.facebook.com/profile.php?id=100065314880446&mibextid=wwXIfr&rdid=KDtMnE3lJn9aQZkB&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F18ER76xC2i%2F%3Fmibextid%3DwwXIfr#" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M13.4 20v-6.1h2.3l.35-2.7H13.4V9.48c0-.79.22-1.32 1.35-1.32h1.44V5.75c-.25-.03-1.1-.1-2.08-.1-2.06 0-3.47 1.26-3.47 3.57v2h-2.33v2.7h2.33V20h2.72Z" fill="currentColor"/>
              </svg>
            </a>
            <a class="footer-social-link" href="https://www.tiktok.com/@kinetic.hub" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M14.55 4.5c.58 1.65 1.76 2.86 3.42 3.46v2.66a6.3 6.3 0 0 1-3.14-.88v5.1a4.84 4.84 0 1 1-4.84-4.84c.24 0 .47.02.7.06v2.74a2.35 2.35 0 1 0 1.43 2.16V4.5h2.43Z" fill="currentColor"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
      <div>
        <h3>Navegacion</h3>
        <a href="eventos.html">Explorar eventos</a>
        <a href="blog.html">Blog</a>
      </div>
      <div>
        <h3>Comunidad</h3>
        <a href="nosotros.html">Nosotros</a>
        <a href="contacto.html">Contacto</a>
        <a href="index.html#future">FAQ del evento</a>
      </div>
      <div>
        <h3>Newsletter</h3>
        <p>Te notificamos proximas carreras, aperturas, resultados y novedades de la comunidad.</p>
        <form class="footer-newsletter" action="#" method="post">
          <label for="footerMail" class="sr-only">Correo</label>
          <input id="footerMail" type="email" placeholder="Correo para notificaciones" required />
          <button class="btn btn-small" type="submit">Quiero avisos</button>
        </form>
      </div>
    `;
  }

  if (links) {
    links.innerHTML = `
      <a href="privacidad.html">Privacidad</a>
      <a href="terminos.html">Terminos</a>
      <a href="cookies.html">Cookies</a>
    `;
  }
}

function normalizeEmergencyContact(source = {}) {
  return {
    name: (source.name || "").trim(),
    phone: (source.phone || "").trim(),
    relation: (source.relation || "").trim(),
    email: (source.email || "").trim(),
  };
}

function hasCompleteEmergencyContact(contact) {
  return Boolean(contact.name && contact.phone && contact.relation && contact.email);
}

function emergencyContactFromProfile(profile = {}) {
  return normalizeEmergencyContact({
    name: profile.emergency_name,
    phone: profile.emergency_phone,
    relation: profile.emergency_relation,
    email: profile.emergency_email,
  });
}

function emergencyContactToProfileFields(contact = {}) {
  const normalized = normalizeEmergencyContact(contact);
  return {
    emergency_name: normalized.name,
    emergency_phone: normalized.phone,
    emergency_relation: normalized.relation,
    emergency_email: normalized.email,
  };
}

function formatEmergencyRelation(value) {
  const labels = {
    madre: "Madre",
    padre: "Padre",
    hermano: "Hermano/a",
    pareja: "Pareja",
    amigo: "Amigo/a",
    otro: "Otro",
  };

  return labels[value] || value || "Sin relación";
}

function setupFooterNewsletter() {
  const forms = document.querySelectorAll(".footer-newsletter");
  if (!forms.length) return;

  const SUPABASE_URL = "https://uycwzhlcnfijjyzkgkem.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IKwD3YtQwWzzEtE8QkVagA_OJGdV2e4";
  const NEWSLETTER_CONFIRM_ENDPOINT = `${SUPABASE_URL}/functions/v1/newsletter-confirmation`;

  const saveLocalBackup = (email) => {
    try {
      const key = "kinetic_newsletter_subscribers";
      const current = JSON.parse(localStorage.getItem(key) || "[]");
      const normalized = email.toLowerCase();
      if (!current.includes(normalized)) {
        current.push(normalized);
        localStorage.setItem(key, JSON.stringify(current));
      }
    } catch (_err) {
      // ignore localStorage failures (private mode, quota, etc.)
    }
  };

  const sendNewsletterConfirmation = async (email) => {
    try {
      const response = await fetch(NEWSLETTER_CONFIRM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          email: email.toLowerCase(),
          source_page: window.location.pathname,
        }),
      });

      return response.ok;
    } catch (_err) {
      return false;
    }
  };

  forms.forEach((form) => {
    const input = form.querySelector('input[type="email"]');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!input || !submitBtn) return;

    let status = form.querySelector(".footer-newsletter-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "footer-newsletter-status";
      status.setAttribute("aria-live", "polite");
      status.style.margin = "8px 0 0";
      status.style.fontSize = "0.85rem";
      form.appendChild(status);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const email = input.value.trim();
      if (!email || !input.checkValidity()) {
        status.textContent = "Ingresa un correo valido para suscribirte.";
        status.style.color = "#ff8a65";
        return;
      }

      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = "Enviando...";

      const confirmationSent = await sendNewsletterConfirmation(email);

      saveLocalBackup(email);

      if (confirmationSent) {
        status.textContent = "Gracias por registrarte. Te enviamos un correo de confirmacion.";
      } else {
        status.textContent = "No pudimos completar tu registro en este momento. Intenta de nuevo en unos minutos.";
        status.style.color = "#ff8a65";
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }
      status.style.color = "#ffffff";

      form.reset();
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    });
  });
}

function setupContactFormSubmission() {
  const form = document.getElementById("contactForm") || document.querySelector(".contact-form-shell");
  if (!form) return;

  const SUPABASE_URL = "https://uycwzhlcnfijjyzkgkem.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IKwD3YtQwWzzEtE8QkVagA_OJGdV2e4";
  const CONTACT_CONFIRM_ENDPOINT = `${SUPABASE_URL}/functions/v1/gracias-por-contactarnos`;

  const ensureSupabaseClient = async () => {
    if (typeof window.supabase !== "undefined") {
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    let sdkScript = document.querySelector('script[data-supabase-sdk="true"]');
    if (!sdkScript) {
      sdkScript = document.createElement("script");
      sdkScript.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      sdkScript.dataset.supabaseSdk = "true";
      document.head.appendChild(sdkScript);
    }

    await new Promise((resolve) => {
      if (typeof window.supabase !== "undefined") {
        resolve();
        return;
      }

      sdkScript.addEventListener("load", () => resolve(), { once: true });
      sdkScript.addEventListener("error", () => resolve(), { once: true });
    });

    if (typeof window.supabase === "undefined") return null;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  };

  let statusNode = form.querySelector(".contact-form-status");
  if (!statusNode) {
    statusNode = document.createElement("p");
    statusNode.className = "contact-form-status";
    statusNode.setAttribute("aria-live", "polite");
    statusNode.style.margin = "10px 0 0";
    statusNode.style.fontWeight = "700";
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn && submitBtn.parentElement) {
      submitBtn.parentElement.insertAdjacentElement("afterend", statusNode);
    } else {
      form.appendChild(statusNode);
    }
  }

  const sendContactConfirmation = async ({
    email,
    fullName,
    subject,
    eventName,
    reason,
    message,
  }) => {
    try {
      const response = await fetch(CONTACT_CONFIRM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          email,
          full_name: fullName,
          subject,
          event_slug: eventName,
          reason,
          message,
        }),
      });

      return response.ok;
    } catch (_err) {
      return false;
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const submitBtn = form.querySelector('button[type="submit"]');
    if (!submitBtn) return;

    const resetSubmit = (label) => {
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    };

    const eventName = document.getElementById("eventName")?.value || "";
    const reason = document.getElementById("contactReason")?.value || "";
    const fullName = document.getElementById("fullName")?.value?.trim() || "";
    const email = document.getElementById("email")?.value?.trim().toLowerCase() || "";
    const phone = document.getElementById("phone")?.value?.trim() || "";
    const subject = document.getElementById("subject")?.value?.trim() || "";
    const message = document.getElementById("requestDetails")?.value?.trim() || "";
    const supportFile = document.getElementById("supportFile")?.files?.[0] || null;

    if (!eventName || !reason || !fullName || !email || !phone || !subject || !message) {
      statusNode.textContent = "Completa todos los campos obligatorios para enviar tu solicitud.";
      statusNode.style.color = "#ff8a65";
      return;
    }

    if (typeof form.reportValidity === "function" && !form.reportValidity()) {
      statusNode.textContent = "Revisa el formulario. Hay campos con formato inválido.";
      statusNode.style.color = "#ff8a65";
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "Enviando...";

    const client = await ensureSupabaseClient();
    if (!client) {
      statusNode.textContent = "No se pudo conectar al servicio en este momento. Intenta de nuevo.";
      statusNode.style.color = "#ff8a65";
      resetSubmit(originalText);
      return;
    }

    let attachmentUrl = null;
    if (supportFile) {
      const safeFileName = supportFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `contact/${Date.now()}-${safeFileName}`;

      const { error: uploadError } = await client.storage
        .from("contact-attachments")
        .upload(filePath, supportFile, { upsert: false });

      if (uploadError) {
        statusNode.textContent = `No se pudo subir el archivo: ${uploadError.message || "error desconocido"}`;
        statusNode.style.color = "#ff8a65";
        resetSubmit(originalText);
        return;
      }

      const { data: fileData } = client.storage.from("contact-attachments").getPublicUrl(filePath);
      attachmentUrl = fileData?.publicUrl || null;
    }

    const { error } = await client.from("contact_messages").insert({
      event_slug: eventName,
      reason,
      full_name: fullName,
      email,
      phone,
      subject,
      message,
      attachment_url: attachmentUrl,
    });

    if (error) {
      console.error("Error insert contact_messages:", error);
      const isPolicyError = error.code === "42501" || /row-level security|permission denied/i.test(error.message || "");
      statusNode.textContent = isPolicyError
        ? "No hay permisos para guardar en contact_messages. Revisa las políticas RLS de Supabase."
        : `No se pudo enviar tu solicitud: ${error.message || "error desconocido"}`;
      statusNode.style.color = "#ff8a65";
      resetSubmit(originalText);
      return;
    }

    const confirmationSent = await sendContactConfirmation({
      email,
      fullName,
      subject,
      eventName,
      reason,
      message,
    });

    form.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 52px 24px 56px;
        gap: 0;
        font-family: 'Manrope', sans-serif;
      ">
        <div style="
          width: 68px;
          height: 68px;
          border-radius: 50%;
          background: linear-gradient(135deg, #19c88b 0%, #0fa870 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
          box-shadow: 0 8px 24px rgba(25,200,139,0.35);
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12.5 9.5 17 19 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <p style="
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #19c88b;
          margin: 0 0 10px;
        ">Mensaje recibido</p>

        <h2 style="
          font-family: 'Sora', sans-serif;
          font-size: 1.55rem;
          font-weight: 700;
          color: #111827;
          margin: 0 0 12px;
          line-height: 1.25;
        ">Gracias por comunicarte<br>con Kinetic Hub</h2>

        <p style="
          font-size: 0.95rem;
          color: #374151;
          max-width: 420px;
          line-height: 1.65;
          margin: 0 0 8px;
        ">Tu solicitud quedó registrada correctamente y nuestro equipo la revisará a la brevedad.</p>

        <p style="
          font-size: 0.85rem;
          color: #6b7280;
          max-width: 380px;
          line-height: 1.6;
          margin: 0 0 32px;
        ">${confirmationSent
            ? "Te enviamos un correo de confirmación al email que registraste."
            : "Tu solicitud se guardó. El correo de confirmación puede tardar unos minutos."
          }</p>

        <a href="index.html" style="
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #19c88b;
          color: #fff;
          font-family: 'Sora', sans-serif;
          font-weight: 700;
          font-size: 0.9rem;
          padding: 12px 28px;
          border-radius: 999px;
          text-decoration: none;
          transition: background 0.2s;
        ">Volver al inicio</a>
      </div>
    `;
  });
}

function setupEventFilters() {
  const filterForm = document.getElementById("eventFilters");
  if (!filterForm) return;

  const cards = Array.from(document.querySelectorAll("[data-event-card]"));
  const countNode = document.getElementById("resultCount");
  const sportField = document.getElementById("filterSport");
  const cityField = document.getElementById("filterCity");
  const typeField = document.getElementById("filterType");

  const applyFilters = () => {
    const selectedSport = sportField ? sportField.value : "";
    const selectedCity = cityField ? cityField.value : "";
    const selectedType = typeField ? typeField.value : "";

    let visible = 0;

    cards.forEach((card) => {
      const cardSport = card.dataset.sport || "";
      const cardCity = card.dataset.city || "";
      const cardType = card.dataset.type || "";

      const matchSport = !selectedSport || cardSport === selectedSport;
      const matchCity = !selectedCity || cardCity === selectedCity;
      const matchType = !selectedType || cardType === selectedType;
      const shouldShow = matchSport && matchCity && matchType;

      card.style.display = shouldShow ? "block" : "none";
      if (shouldShow) visible += 1;
    });

    if (countNode) {
      countNode.textContent = `${visible} evento${visible === 1 ? "" : "s"} disponibles`;
    }
  };

  filterForm.addEventListener("change", applyFilters);
  applyFilters();
}

function setupHeroPosterSizing() {
  const heroGrid = document.querySelector(".hero-grid");
  if (!heroGrid) return;

  const leftContent = heroGrid.querySelector(".hero-copy");
  const poster = heroGrid.querySelector(".event-poster");
  if (!leftContent || !poster) return;

  const applySize = () => {
    if (window.matchMedia("(max-width: 1100px)").matches) {
      poster.style.removeProperty("--hero-max-h");
      return;
    }

    const leftHeight = Math.floor(leftContent.getBoundingClientRect().height);
    if (leftHeight > 0) {
      poster.style.setProperty("--hero-max-h", `${leftHeight}px`);
    }
  };

  const resizeObserver = new ResizeObserver(() => applySize());
  resizeObserver.observe(leftContent);

  window.addEventListener("resize", applySize);
  applySize();
}

function setupRegisterScrollLed() {
  const heroTarget = document.getElementById("registro");
  const formTarget = document.getElementById("raceRegisterBar");
  if (!heroTarget || !formTarget) return;

  let indicatorTimeout;
  const normalizeText = (text) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const triggerFormIndicator = () => {
    formTarget.classList.remove("form-focus-indicator");
    void formTarget.offsetWidth;
    formTarget.classList.add("form-focus-indicator");

    if (indicatorTimeout) {
      clearTimeout(indicatorTimeout);
    }
    indicatorTimeout = setTimeout(() => {
      formTarget.classList.remove("form-focus-indicator");
    }, 2200);
  };

  const isRegisterAction = (node) => {
    const label = normalizeText(node.textContent || "");
    return (
      label === "registrarse" ||
      label === "registrate" ||
      label === "regitrate" ||
      label === "inscribirme"
    );
  };

  const candidates = document.querySelectorAll("a, button");
  candidates.forEach((node) => {
    if (!isRegisterAction(node)) return;

    node.addEventListener("click", (event) => {
      if (node.tagName === "A") {
        const href = node.getAttribute("href") || "";
        if (!href.startsWith("#")) {
          return;
        }
      }
      event.preventDefault();
      heroTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(triggerFormIndicator, 480);
    });
  });
}

function setupAuthPage() {
  const authRoot = document.querySelector("[data-auth-page]");
  if (!authRoot) return;

  const AUTH_RETURN_KEY = "kinetic_auth_return_to";
  const LAST_LOGIN_EMAIL_KEY = "kinetic_last_login_email";

  const tabs = Array.from(document.querySelectorAll("[data-auth-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-auth-panel]"));
  if (!panels.length) return;

  const activateMode = (mode) => {
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute("data-auth-tab") === mode;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    panels.forEach((panel) => {
      const isActive = panel.getAttribute("data-auth-panel") === mode;
      panel.classList.toggle("is-active", isActive);
    });

    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    window.history.replaceState({}, "", url);
  };

  const modeParam = new URLSearchParams(window.location.search).get("mode");
  const initialMode = modeParam === "register" ? "register" : "login";
  activateMode(initialMode);

  const searchParams = new URLSearchParams(window.location.search);
  const isValidReturnPath = (value) =>
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("auth.html");

  const returnToParam = searchParams.get("returnTo");
  if (isValidReturnPath(returnToParam)) {
    sessionStorage.setItem(AUTH_RETURN_KEY, returnToParam);
  } else {
    const referrer = document.referrer;
    if (referrer) {
      try {
        const referrerUrl = new URL(referrer);
        const sameOrigin = referrerUrl.origin === window.location.origin;
        const referrerPath = `${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`;
        if (sameOrigin && isValidReturnPath(referrerPath)) {
          sessionStorage.setItem(AUTH_RETURN_KEY, referrerPath);
        }
      } catch (_err) {
        // ignore invalid referrer url
      }
    }
  }

  const authCard = document.querySelector(".auth-card");
  const showGlobalStatus = (message, isError = false) => {
    if (!authCard || !message) return;

    let statusNode = document.getElementById("authGlobalStatus");
    if (!statusNode) {
      statusNode = document.createElement("p");
      statusNode.id = "authGlobalStatus";
      statusNode.className = "auth-global-status";
      authCard.insertBefore(statusNode, authCard.firstChild);
    }

    statusNode.textContent = message;
    statusNode.classList.toggle("is-error", isError);
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.getAttribute("data-auth-tab") || "login";
      activateMode(mode);
      if (mode === "login") {
        const stepEmailNode = document.querySelector('[data-login-step="email"]');
        const stepPasswordNode = document.querySelector('[data-login-step="password"]');
        if (stepEmailNode && stepPasswordNode) {
          stepEmailNode.classList.add("is-active");
          stepPasswordNode.classList.remove("is-active");
        }
      }
    });
  });

  document.querySelectorAll("[data-auth-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.getAttribute("data-auth-tab-target") || "login";
      activateMode(mode);
    });
  });

  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const googleRegisterBtn = document.getElementById("googleRegisterBtn");
  const loginUrl = authRoot.getAttribute("data-google-login-url") || "#";
  const registerUrl = authRoot.getAttribute("data-google-register-url") || "#";

  if (googleLoginBtn) googleLoginBtn.setAttribute("href", loginUrl);
  if (googleRegisterBtn) googleRegisterBtn.setAttribute("href", registerUrl);

  const loginForm = document.getElementById("loginForm");
  const stepEmail = loginForm?.querySelector('[data-login-step="email"]');
  const stepPassword = loginForm?.querySelector('[data-login-step="password"]');
  const loginContinueBtn = document.getElementById("loginContinueBtn");
  const loginEmailInput = document.getElementById("loginEmail");
  const loginPasswordInput = document.getElementById("loginPassword");
  const authEmailLock = document.getElementById("authEmailLock");
  const authChangeEmailBtn = document.getElementById("authChangeEmailBtn");
  const toggleLoginPassword = document.getElementById("toggleLoginPassword");

  const showEmailStep = () => {
    if (!stepEmail || !stepPassword) return;
    stepEmail.classList.add("is-active");
    stepPassword.classList.remove("is-active");
    if (loginEmailInput) {
      loginEmailInput.focus();
    }
  };

  const showPasswordStep = () => {
    if (!stepEmail || !stepPassword || !loginEmailInput) return;
    const email = loginEmailInput.value.trim();
    if (!email || !loginEmailInput.checkValidity()) {
      loginEmailInput.reportValidity();
      return;
    }

    if (authEmailLock) {
      authEmailLock.textContent = email;
    }

    stepEmail.classList.remove("is-active");
    stepPassword.classList.add("is-active");
    if (loginPasswordInput) {
      loginPasswordInput.focus();
    }
  };

  if (loginContinueBtn) {
    loginContinueBtn.addEventListener("click", showPasswordStep);
  }

  if (authChangeEmailBtn) {
    authChangeEmailBtn.addEventListener("click", showEmailStep);
  }

  if (loginEmailInput) {
    loginEmailInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        showPasswordStep();
      }
    });
  }

  if (toggleLoginPassword && loginPasswordInput) {
    toggleLoginPassword.addEventListener("click", () => {
      const nextType = loginPasswordInput.type === "password" ? "text" : "password";
      loginPasswordInput.type = nextType;
    });
  }

  const statusParam = searchParams.get("status");
  const emailParam = searchParams.get("email");
  if (statusParam === "check-email") {
    activateMode("login");
    showGlobalStatus("Gracias por registrarte. Revisa tu correo para confirmar tu cuenta y luego inicia sesión.");
    if (emailParam && loginEmailInput) {
      loginEmailInput.value = emailParam;
    }
  }

  if (statusParam === "confirmed") {
    activateMode("login");
    showGlobalStatus("Correo confirmado correctamente. Te estamos enviando a tu perfil...");
  }

  const rememberedEmail = localStorage.getItem(LAST_LOGIN_EMAIL_KEY);
  if (initialMode === "login" && rememberedEmail && loginEmailInput && !emailParam) {
    window.setTimeout(() => {
      const useRemembered = window.confirm(
        `Detectamos una cuenta usada recientemente: ${rememberedEmail}.\n\n¿Quieres iniciar sesión con esta cuenta?`
      );
      if (!useRemembered) return;
      loginEmailInput.value = rememberedEmail;
      showPasswordStep();
    }, 50);
  }

  showEmailStep();
}

function setupEventModals() {
  const overlays = Array.from(document.querySelectorAll(".modal-overlay"));
  if (!overlays.length) return;

  const openModal = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    modal.style.display = "grid";
    document.body.style.overflow = "hidden";
  };

  const closeModal = (modal) => {
    modal.hidden = true;
    modal.style.display = "none";
    if (overlays.every((item) => item.hidden)) {
      document.body.style.overflow = "";
    }
  };

  const closeAll = () => {
    overlays.forEach((modal) => {
      modal.hidden = true;
      modal.style.display = "none";
    });
    document.body.style.overflow = "";
  };

  document.addEventListener("click", (event) => {
    const openTrigger = event.target.closest("[data-modal-open]");
    if (openTrigger) {
      const targetId = openTrigger.getAttribute("data-modal-open");
      if (targetId) {
        event.preventDefault();
        openModal(targetId);
      }
      return;
    }

    const closeTrigger = event.target.closest("[data-modal-close]");
    if (closeTrigger) {
      const overlay = closeTrigger.closest(".modal-overlay");
      if (overlay) {
        event.preventDefault();
        closeModal(overlay);
      }
      return;
    }

    const overlay = event.target.closest(".modal-overlay");
    if (overlay && event.target === overlay) {
      closeModal(overlay);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAll();
    }
  });
}

function setupEventDetailAccordions() {
  const detailRoot = document.querySelector(".event-layout");
  if (!detailRoot) return;

  const keepExpanded = new Set([
    "sobre el evento",
    "distancias y modalidades",
    "costos e inscripcion",
  ]);

  const normalize = (text) =>
    (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const panels = Array.from(document.querySelectorAll(".event-layout > div > .event-panel"));

  panels.forEach((panel) => {
    const title = panel.querySelector(":scope > .content-title");
    if (!title) return;

    const panelName = normalize(title.textContent);
    const shouldStayOpen = keepExpanded.has(panelName);
    const contentNodes = Array.from(panel.children).filter((node) => node !== title);

    panel.classList.add("is-collapsible");
    panel.classList.toggle("is-open", shouldStayOpen);

    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-expanded", String(shouldStayOpen));

    contentNodes.forEach((node) => {
      node.hidden = !shouldStayOpen;
    });

    const togglePanel = () => {
      const nextOpen = !panel.classList.contains("is-open");
      panel.classList.toggle("is-open", nextOpen);
      title.setAttribute("aria-expanded", String(nextOpen));
      contentNodes.forEach((node) => {
        node.hidden = !nextOpen;
      });
    };

    title.addEventListener("click", togglePanel);
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        togglePanel();
      }
    });
  });

  const faqItems = Array.from(document.querySelectorAll(".event-layout > div > .event-panel .faq-item"));
  faqItems.forEach((item) => {
    const question = item.querySelector(":scope > strong");
    const answer = item.querySelector(":scope > p");
    if (!question || !answer) return;

    item.classList.add("is-collapsible");
    item.classList.remove("is-open");

    question.setAttribute("role", "button");
    question.setAttribute("tabindex", "0");
    question.setAttribute("aria-expanded", "false");
    answer.hidden = true;

    const toggleFaq = () => {
      const nextOpen = !item.classList.contains("is-open");
      item.classList.toggle("is-open", nextOpen);
      question.setAttribute("aria-expanded", String(nextOpen));
      answer.hidden = !nextOpen;
    };

    question.addEventListener("click", toggleFaq);
    question.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleFaq();
      }
    });
  });
}

function setupNeonCardGlow() {
  const cards = Array.from(document.querySelectorAll(".neon-card"));
  if (!cards.length) return;

  const toggleCard = (card) => {
    const isSelected = card.classList.toggle("is-selected");
    card.setAttribute("aria-pressed", String(isSelected));
  };

  cards.forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a")) return;
      toggleCard(card);
    });

    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleCard(card);
    });
  });
}

function setupNeonEventToggle() {
  const toggleBtn = document.querySelector("[data-neon-toggle]");
  const details = document.getElementById("neonEventDetails");

  if (!toggleBtn || !details) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let isAnimating = false;

  const setCollapsed = () => {
    details.classList.remove("is-expanded");
    details.style.maxHeight = "0px";
    details.style.opacity = "0";
    details.style.transform = "translateY(-10px)";
    details.hidden = true;
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.textContent = "Ver más";
  };

  const setExpanded = () => {
    details.hidden = false;
    details.classList.add("is-expanded");
    details.style.maxHeight = "none";
    details.style.opacity = "1";
    details.style.transform = "translateY(0)";
    toggleBtn.setAttribute("aria-expanded", "true");
    toggleBtn.textContent = "Ver menos";
  };

  const expandAnimated = () => {
    details.hidden = false;
    details.classList.add("is-expanded");
    details.style.maxHeight = "0px";
    details.style.opacity = "0";
    details.style.transform = "translateY(-10px)";
    toggleBtn.setAttribute("aria-expanded", "true");
    toggleBtn.textContent = "Ver menos";

    window.requestAnimationFrame(() => {
      details.style.maxHeight = `${details.scrollHeight}px`;
      details.style.opacity = "1";
      details.style.transform = "translateY(0)";
    });

    const onEnd = (event) => {
      if (event.propertyName !== "max-height") return;
      details.style.maxHeight = "none";
      details.removeEventListener("transitionend", onEnd);
      isAnimating = false;
    };

    details.addEventListener("transitionend", onEnd);
  };

  const collapseAnimated = () => {
    details.style.maxHeight = `${details.scrollHeight}px`;
    details.style.opacity = "1";
    details.style.transform = "translateY(0)";

    // Force reflow so the browser can animate from current height to 0.
    void details.offsetHeight;

    details.classList.remove("is-expanded");
    details.style.maxHeight = "0px";
    details.style.opacity = "0";
    details.style.transform = "translateY(-10px)";
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.textContent = "Ver más";

    const onEnd = (event) => {
      if (event.propertyName !== "max-height") return;
      details.hidden = true;
      details.removeEventListener("transitionend", onEnd);
      isAnimating = false;
    };

    details.addEventListener("transitionend", onEnd);
  };

  setCollapsed();

  toggleBtn.addEventListener("click", () => {
    if (isAnimating) return;

    const shouldExpand = details.hidden;

    if (reduceMotion) {
      if (shouldExpand) {
        setExpanded();
      } else {
        setCollapsed();
      }
      return;
    }

    isAnimating = true;
    if (shouldExpand) {
      expandAnimated();
      return;
    }

    collapseAnimated();
  });
}

function setupWhatsAppButton() {
  if (document.querySelector(".whatsapp-float")) return;

  const phone = "525530790944";
  const message = encodeURIComponent("Hola, quiero informacion sobre Axolote Night Run.");
  const href = `https://wa.me/${phone}?text=${message}`;

  const wrapper = document.createElement("div");
  wrapper.className = "whatsapp-float";
  wrapper.innerHTML = `
    <div class="whatsapp-panel" aria-hidden="true">
      <div class="whatsapp-panel-top">
        <p>Necesitas ayuda?</p>
        <a class="whatsapp-panel-link" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Escribenos por WhatsApp">
          <img src="whatsapp_icon.png" alt="WhatsApp" />
          Escribenos por Whatsapp
        </a>
      </div>
      <div class="whatsapp-panel-bottom">
        <strong>Atencion al atleta</strong>
        <span>Disponible 10am - 5pm</span>
        <small>Haz clic para iniciar chat</small>
      </div>
    </div>
    <a class="whatsapp-button" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Abrir chat de WhatsApp">
      <img src="whatsapp_icon.png" alt="WhatsApp" />
    </a>
  `;

  document.body.appendChild(wrapper);
}

function setupProfilePage() {
  if (!document.querySelector("[data-profile-page]")) return;

  // Sidebar section switching
  const navItems = Array.from(document.querySelectorAll(".profile-nav-item[data-section]"));
  const panels = Array.from(document.querySelectorAll(".profile-panel[data-section]"));

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const section = item.getAttribute("data-section");
      navItems.forEach((n) => n.classList.toggle("is-active", n === item));
      panels.forEach((p) => p.classList.toggle("is-active", p.getAttribute("data-section") === section));
    });
  });
}

function setupBlogTabs() {
  const tabs = document.querySelectorAll(".home-blog-tab");
  const cards = document.querySelectorAll(".home-blog-card");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Remove active class from all tabs
      tabs.forEach((t) => t.classList.remove("is-active"));
      // Add active class to clicked tab
      tab.classList.add("is-active");

      // Get the tab type (default to "todos")
      const tabText = tab.textContent.toLowerCase();
      let filterType = "todos";
      if (tabText.includes("video")) filterType = "video";
      if (tabText.includes("podcast")) filterType = "podcast";

      // Filter cards
      cards.forEach((card) => {
        const cardTypes = card.dataset.type || "todos";
        if (filterType === "todos" || cardTypes.includes(filterType)) {
          card.style.display = "";
        } else {
          card.style.display = "none";
        }
      });
    });
  });
}

function setupEventRegistrationPanel() {
  const panel = document.querySelector("[data-event-register-panel]");
  if (!panel) return;

  const title = document.getElementById("eventRegisterTitle");
  const text = document.getElementById("eventRegisterText");
  const cta = document.getElementById("eventRegisterCta");
  const checkoutHref = "checkout.html";
  const authHref = `auth.html?mode=register&returnTo=${encodeURIComponent(`/${checkoutHref}`)}`;

  const applyState = (isLoggedIn) => {
    if (!title || !text || !cta) return;

    if (isLoggedIn) {
      title.textContent = "Continuar registro";
      text.textContent = "Ya iniciaste sesión. Continúa al checkout para asegurar tu lugar en Axolote Night Run.";
      cta.textContent = "Completar inscripción";
      cta.href = checkoutHref;
      return;
    }

    title.textContent = "Regístrate para asegurar tu lugar";
    text.textContent = "Crea tu cuenta o inicia sesión para continuar con tu inscripción y pago.";
    cta.textContent = "Iniciar sesión o registrarme";
    cta.href = authHref;
  };

  applyState(false);

  const SUPABASE_URL = "https://uycwzhlcnfijjyzkgkem.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IKwD3YtQwWzzEtE8QkVagA_OJGdV2e4";

  const initSessionState = () => {
    if (typeof window.supabase === "undefined") return;

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    client.auth.getSession().then(({ data: { session } }) => {
      applyState(Boolean(session));
    });

    client.auth.onAuthStateChange((_event, session) => {
      applyState(Boolean(session));
    });
  };

  if (typeof window.supabase !== "undefined") {
    initSessionState();
    return;
  }

  let sdkScript = document.querySelector('script[data-supabase-sdk="true"]');
  if (!sdkScript) {
    sdkScript = document.createElement("script");
    sdkScript.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    sdkScript.dataset.supabaseSdk = "true";
    document.head.appendChild(sdkScript);
  }

  if (typeof window.supabase !== "undefined") {
    initSessionState();
    return;
  }

  sdkScript.addEventListener("load", initSessionState, { once: true });
}

function setupSupabase() {
  const SUPABASE_URL = "https://uycwzhlcnfijjyzkgkem.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IKwD3YtQwWzzEtE8QkVagA_OJGdV2e4";
  const SITE = window.location.origin;
  const PROFILE_TABLE = "user_profiles";
  const AXOLOTE_PAYMENT_URL = "checkout.html";
  const AXOLOTE_EVENT_URL = "axolote-night-run.html";
  const AXOLOTE_PAYMENT_STATE_KEY = "kinetic_axolote_payment_state";
  const AXOLOTE_POST_VERIFY_PROMPT_KEY = "kinetic_axolote_post_verify_prompt";

  const initSupabase = () => {
    if (typeof window.supabase === "undefined") return;

    const AUTH_RETURN_KEY = "kinetic_auth_return_to";
    const LAST_LOGIN_EMAIL_KEY = "kinetic_last_login_email";

    const isValidReturnPath = (value) =>
      typeof value === "string" &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("auth.html");

    const consumeReturnTarget = () => {
      const saved = sessionStorage.getItem(AUTH_RETURN_KEY);
      if (isValidReturnPath(saved)) {
        sessionStorage.removeItem(AUTH_RETURN_KEY);
        return saved;
      }
      return "perfil.html";
    };

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    const readEmergencyContactForUser = async (userId) => {
      if (!userId) return null;

      const { data, error } = await client
        .from(PROFILE_TABLE)
        .select("emergency_name,emergency_phone,emergency_relation,emergency_email")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        const expectedNoRow = error.code === "PGRST116";
        if (!expectedNoRow) {
          console.warn("No se pudo leer el contacto de emergencia:", error);
        }
        return null;
      }

      const contact = emergencyContactFromProfile(data || {});
      return hasCompleteEmergencyContact(contact) ? contact : null;
    };

    const saveEmergencyContactForUser = async ({ userId, email }, contact) => {
      if (!userId) return { error: new Error("Usuario no autenticado") };

      const row = {
        user_id: userId,
        email: email || null,
        ...emergencyContactToProfileFields(contact),
        updated_at: new Date().toISOString(),
      };

      const { error } = await client.from(PROFILE_TABLE).upsert(row, { onConflict: "user_id" });
      return { error: error || null };
    };

    const setupCheckoutEmergencyContact = async () => {
      const checkoutForm = document.getElementById("checkoutForm");
      const savedContainer = document.getElementById("checkoutSavedEmergency");
      const nameInput = document.getElementById("emergencyName");
      const phoneInput = document.getElementById("emergencyPhone");
      const relationInput = document.getElementById("emergencyRelation");
      const emailInput = document.getElementById("emergencyEmail");

      if (!checkoutForm || !nameInput || !phoneInput || !relationInput || !emailInput) return;
      if (checkoutForm.dataset.emergencyInitialized === "true") return;

      checkoutForm.dataset.emergencyInitialized = "true";

      const { data: { session } } = await client.auth.getSession();
      const userId = session?.user?.id;
      const userEmail = session?.user?.email || "";
      const storedContact = await readEmergencyContactForUser(userId);

      const setInputsDisabled = (disabled) => {
        [nameInput, phoneInput, relationInput, emailInput].forEach((input) => {
          input.disabled = disabled;
        });
      };

      const fillInputs = (contact) => {
        const normalized = normalizeEmergencyContact(contact);
        nameInput.value = normalized.name;
        phoneInput.value = normalized.phone;
        relationInput.value = normalized.relation;
        emailInput.value = normalized.email;
      };

      if (savedContainer && hasCompleteEmergencyContact(storedContact || {})) {
        savedContainer.hidden = false;
        savedContainer.innerHTML = `
          <div class="checkout-saved-emergency">
            <p class="checkout-saved-emergency-title">Ya tienes un contacto guardado en tu perfil</p>
            <p class="checkout-saved-emergency-copy">
              <strong>${storedContact.name}</strong><br />
              ${formatEmergencyRelation(storedContact.relation)} · ${storedContact.phone}<br />
              ${storedContact.email}
            </p>
            <label class="checkout-saved-emergency-toggle">
              <input type="checkbox" id="useSavedEmergencyContact" checked />
              <span>Usar este contacto guardado para esta inscripción</span>
            </label>
          </div>
        `;

        const useSavedToggle = document.getElementById("useSavedEmergencyContact");
        const applyToggleState = () => {
          const shouldUseSaved = Boolean(useSavedToggle?.checked);
          if (shouldUseSaved) {
            fillInputs(storedContact);
          }
          setInputsDisabled(shouldUseSaved);
        };

        useSavedToggle?.addEventListener("change", applyToggleState);
        applyToggleState();
      }

      checkoutForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!checkoutForm.reportValidity()) return;

        const payload = normalizeEmergencyContact({
          name: nameInput.value,
          phone: phoneInput.value,
          relation: relationInput.value,
          email: emailInput.value,
        });

        const normalizedUserEmail = (userEmail || "").trim().toLowerCase();
        const normalizedEmergencyEmail = (payload.email || "").trim().toLowerCase();
        if (normalizedUserEmail && normalizedEmergencyEmail === normalizedUserEmail) {
          alert("El correo del contacto de emergencia debe ser diferente al de tu cuenta.");
          emailInput.focus();
          return;
        }

        const redirectToStripe = () => {
          window.location.href = "https://buy.stripe.com/test_dRm6oG6Vr0ewd0S5Olak000";
        };

        if (!userId) {
          redirectToStripe();
          return;
        }

        saveEmergencyContactForUser({ userId, email: userEmail }, payload).then(({ error }) => {
          if (error) {
            console.warn("No se pudo guardar contacto de emergencia desde checkout:", error);
          }
          redirectToStripe();
        });
      });
    };

  const renderSessionNav = (session) => {
    const navActions = document.querySelector(".nav-actions");
    if (!navActions) return;

    if (!session) {
      const currentPage = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const loginHref = `auth.html?mode=login&returnTo=${encodeURIComponent(currentPage)}`;
      navActions.innerHTML = `
        <a class="ghost-link" href="${loginHref}">Iniciar sesión</a>
        <a class="btn btn-primary" href="auth.html?mode=register">Registrarse</a>
      `;
      return;
    }

    const user = session.user;
    navActions.innerHTML = `
      <a class="ghost-link" href="perfil.html">Mi perfil</a>
      <button class="btn btn-primary" id="navLogoutBtn" type="button">Cerrar sesión</button>
    `;

    document.getElementById("navLogoutBtn")?.addEventListener("click", async () => {
      await client.auth.signOut();
      window.location.href = "index.html";
    });
  };

    client.auth.getSession().then(({ data: { session } }) => {
      renderSessionNav(session);
    });

    client.auth.onAuthStateChange((_event, session) => {
      renderSessionNav(session);
    });

    setupCheckoutEmergencyContact();

  // ── AUTH PAGE ──────────────────────────────────────
    const authRoot = document.querySelector("[data-auth-page]");
    if (authRoot) {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasSignupCallback = hashParams.get("type") === "signup" && hashParams.has("access_token");

    const promptActiveSessionChoice = (email) =>
      new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "auth-session-overlay";
        overlay.innerHTML = `
          <div class="auth-session-modal" role="dialog" aria-modal="true" aria-labelledby="authSessionTitle">
            <h2 id="authSessionTitle">Sesión detectada</h2>
            <p>Ya tienes una sesión activa con:</p>
            <p class="auth-session-email">${email}</p>
            <p>¿Cómo quieres continuar?</p>
            <div class="auth-session-actions">
              <button type="button" class="auth-session-btn auth-session-btn-primary" data-auth-session="continue">Continuar con esta cuenta</button>
              <button type="button" class="auth-session-btn" data-auth-session="switch">Usar otro correo</button>
            </div>
          </div>
        `;

        const cleanup = () => {
          document.removeEventListener("keydown", onEsc);
          overlay.remove();
        };

        const onEsc = (event) => {
          if (event.key !== "Escape") return;
          cleanup();
          resolve(false);
        };

        overlay.addEventListener("click", (event) => {
          const target = event.target;
          const actionBtn = target.closest("[data-auth-session]");

          if (actionBtn) {
            const action = actionBtn.getAttribute("data-auth-session");
            cleanup();
            resolve(action === "continue");
            return;
          }

          if (target === overlay) {
            cleanup();
            resolve(false);
          }
        });

        document.addEventListener("keydown", onEsc);
        document.body.appendChild(overlay);
      });

    // Si ya hay sesión activa → preguntar si desea continuar con esa cuenta
    client.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;

      if (hasSignupCallback) {
        const url = new URL(window.location.href);
        url.hash = "";
        url.searchParams.set("mode", "login");
        url.searchParams.set("status", "confirmed");
        window.location.replace(url.toString());
        return;
      }

      if (searchParams.get("status") === "confirmed") {
        localStorage.setItem(AXOLOTE_POST_VERIFY_PROMPT_KEY, "1");
        window.setTimeout(() => {
          window.location.replace(consumeReturnTarget());
        }, 1400);
        return;
      }

      const activeEmail = session.user?.email || "tu cuenta";
      const continueWithSession = await promptActiveSessionChoice(activeEmail);

      if (continueWithSession) {
        window.location.replace(consumeReturnTarget());
        return;
      }

      client.auth.signOut().then(() => {
        const loginEmailInput = document.getElementById("loginEmail");
        if (loginEmailInput) {
          loginEmailInput.value = "";
          loginEmailInput.focus();
        }
      });
    });

    // Botones "Continuar con Google"
    ["googleLoginBtn", "googleRegisterBtn"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${SITE}/perfil.html` },
        });
        if (error) alert(error.message);
      });
    });

    // Login con email + contraseña
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("loginEmail")?.value.trim();
        const password = document.getElementById("loginPassword")?.value;
        if (!email || !password) return;
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          alert(error.message);
        } else {
          localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email);
          window.location.href = consumeReturnTarget();
        }
      });
    }

    // Registro con email
    const registerForm = document.querySelector('[data-auth-panel="register"] form');
    const registerStatus = document.getElementById("registerStatus");
    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (registerStatus) {
          registerStatus.textContent = "";
          registerStatus.classList.remove("is-error");
        }

        const email = document.getElementById("registerEmail")?.value.trim();
        const password = document.getElementById("registerPassword")?.value;
        const confirm = document.getElementById("registerConfirmPassword")?.value;
        const nombre = document.getElementById("registerName")?.value.trim();
        const apellido = document.getElementById("registerLastName")?.value.trim();
        const telefono = document.getElementById("registerPhone")?.value.trim();
        const nacimiento = document.getElementById("registerBirthDate")?.value;

        if (password !== confirm) {
          if (registerStatus) {
            registerStatus.textContent = "Las contraseñas no coinciden.";
            registerStatus.classList.add("is-error");
          } else {
            alert("Las contraseñas no coinciden.");
          }
          return;
        }

        const submitBtn = registerForm.querySelector('button[type="submit"]');
        const originalText = submitBtn?.textContent || "Registrarme";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Registrando...";
        }

        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: `${nombre} ${apellido}`.trim(),
              first_name: nombre || "",
              last_name: apellido || "",
              phone: telefono || "",
              birth_date: nacimiento || "",
            },
            emailRedirectTo: `${SITE}/auth.html?mode=login`,
          },
        });

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }

        if (error) {
          const isAlreadyRegistered = /already registered|already exists|user already/i.test(
            error.message || ""
          );

          if (registerStatus) {
            registerStatus.textContent = isAlreadyRegistered
              ? "Este correo ya está registrado. Inicia sesión para continuar."
              : error.message;
            registerStatus.classList.add("is-error");
          } else {
            alert(
              isAlreadyRegistered
                ? "Este correo ya está registrado. Inicia sesión para continuar."
                : error.message
            );
          }
        } else {
          const identities = Array.isArray(data?.user?.identities) ? data.user.identities : null;
          const maskedExistingUser = identities && identities.length === 0;

          if (maskedExistingUser) {
            if (registerStatus) {
              registerStatus.textContent = "Este correo ya está registrado. Inicia sesión para continuar.";
              registerStatus.classList.add("is-error");
            } else {
              alert("Este correo ya está registrado. Inicia sesión para continuar.");
            }
            return;
          }

          const redirectUrl = new URL(`${SITE}/auth.html`);
          redirectUrl.searchParams.set("mode", "login");
          redirectUrl.searchParams.set("status", "check-email");
          redirectUrl.searchParams.set("email", email || "");
          window.location.href = redirectUrl.toString();
        }
      });
    }
    }

    // ── PERFIL PAGE ────────────────────────────────────
    const profileRoot = document.querySelector("[data-profile-page]");
    if (profileRoot) {
      client.auth.getSession().then(async ({ data: { session } }) => {
        if (!session) {
          window.location.replace("auth.html?mode=login");
          return;
        }

      const user = session.user;
      const meta = user.user_metadata || {};

      const usernameEl = document.querySelector(".profile-username");
      const metaInfoEls = Array.from(document.querySelectorAll(".profile-ident-meta"));

      const pfNombre = document.getElementById("pfNombre");
      const pfApPat = document.getElementById("pfApPat");
      const pfApMat = document.getElementById("pfApMat");
      const pfNacimiento = document.getElementById("pfNacimiento");
      const pfGenero = document.getElementById("pfGenero");
      const pfTelefono = document.getElementById("pfTelefono");
      const pfPeso = document.getElementById("pfPeso");
      const pfEstatura = document.getElementById("pfEstatura");
      const pfPais = document.getElementById("pfPais");
      const pfEstado = document.getElementById("pfEstado");
      const coverUpload = document.getElementById("coverUpload");
      const profileCover = document.getElementById("profileCover");
      const coverAdjustToggle = document.getElementById("coverAdjustToggle");
      const avatarUpload = document.getElementById("avatarUpload");
      const avatarInner = document.getElementById("profileAvatarInner");

      const profileForm = document.querySelector(".profile-form");
      const saveBtn = profileForm?.querySelector(".profile-save-btn");
      const emergencyForm = document.getElementById("emergencyContactForm");
      const emergencyStatus = document.getElementById("emergencyContactStatus");
      const emergencyName = document.getElementById("emergencyContactName");
      const emergencyPhone = document.getElementById("emergencyContactPhone");
      const emergencyRelation = document.getElementById("emergencyContactRelation");
      const emergencyEmail = document.getElementById("emergencyContactEmail");
      const emergencySaveBtn = document.getElementById("emergencyContactSaveBtn");
      const emergencySavedCard = document.getElementById("profileEmergencySavedCard");
      const emergencySavedActions = document.getElementById("profileEmergencySavedActions");
      const emergencyEditBtn = document.getElementById("emergencyEditBtn");
      const emergencyCancelBtn = document.getElementById("emergencyCancelBtn");

      const fields = [
        { key: "first_name", node: pfNombre },
        { key: "last_name", node: pfApPat },
        { key: "maternal_last_name", node: pfApMat },
        { key: "birth_date", node: pfNacimiento },
        { key: "gender", node: pfGenero },
        { key: "phone", node: pfTelefono },
        { key: "weight_kg", node: pfPeso },
        { key: "height_cm", node: pfEstatura },
        { key: "country", node: pfPais },
        { key: "state", node: pfEstado },
      ].filter((field) => Boolean(field.node));

      fields.forEach(({ node }) => {
        if (node && node.tagName !== "SELECT") {
          node.dataset.defaultPlaceholder = node.placeholder || "";
        }
      });

      const composeFullName = (profile) =>
        [profile.first_name, profile.last_name, profile.maternal_last_name]
          .map((item) => (item || "").trim())
          .filter(Boolean)
          .join(" ")
          .trim();

      const normalizeProfile = (source) => ({
        first_name: (source?.first_name || "").trim(),
        last_name: (source?.last_name || "").trim(),
        maternal_last_name: (source?.maternal_last_name || "").trim(),
        birth_date: source?.birth_date || "",
        gender: source?.gender || "",
        phone: (source?.phone || "").trim(),
        weight_kg: source?.weight_kg || "",
        height_cm: source?.height_cm || "",
        country: source?.country || "mx",
        state: source?.state || "",
        full_name: (source?.full_name || "").trim(),
        avatar_url: (source?.avatar_url || "").trim() || null,
        cover_url: (source?.cover_url || "").trim() || null,
        emergency_name: (source?.emergency_name || "").trim() || null,
        emergency_phone: (source?.emergency_phone || "").trim() || null,
        emergency_relation: (source?.emergency_relation || "").trim() || null,
        emergency_email: (source?.emergency_email || "").trim() || null,
      });

      const PROFILE_MEDIA_BUCKET = "contact-attachments";
      const PROFILE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
      const PROFILE_MEDIA_LIMITS = {
        avatar: 2 * 1024 * 1024,
        cover: 4 * 1024 * 1024,
      };
      const PROFILE_MEDIA_OPTIMIZATION = {
        avatar: { maxWidth: 600, maxHeight: 600, quality: 0.86 },
        cover: { maxWidth: 1600, maxHeight: 900, quality: 0.82 },
      };

      const getSafeExtension = (fileName) => {
        const raw = (fileName || "").split(".").pop() || "jpg";
        const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
        return normalized || "jpg";
      };

      const mimeToExtension = (mimeType) => {
        if (mimeType === "image/png") return "png";
        if (mimeType === "image/webp") return "webp";
        return "jpg";
      };

      const validateProfileMediaFile = ({ file, type }) => {
        if (!file) {
          return "No se detectó archivo.";
        }

        if (!PROFILE_ALLOWED_MIME_TYPES.includes(file.type)) {
          return "Formato no permitido. Usa JPG, PNG o WEBP.";
        }

        const maxBytes = PROFILE_MEDIA_LIMITS[type] || PROFILE_MEDIA_LIMITS.avatar;
        if (file.size > maxBytes) {
          const maxMb = Math.round(maxBytes / (1024 * 1024));
          return `El archivo supera el límite de ${maxMb} MB.`;
        }

        return "";
      };

      const optimizeProfileMediaFile = async ({ file, type }) => {
        const config = PROFILE_MEDIA_OPTIMIZATION[type] || PROFILE_MEDIA_OPTIMIZATION.avatar;
        const objectUrl = URL.createObjectURL(file);

        try {
          const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("No se pudo procesar la imagen."));
            img.src = objectUrl;
          });

          const sourceWidth = image.naturalWidth || image.width;
          const sourceHeight = image.naturalHeight || image.height;
          const scale = Math.min(
            1,
            config.maxWidth / Math.max(sourceWidth, 1),
            config.maxHeight / Math.max(sourceHeight, 1)
          );

          const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
          const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          const context = canvas.getContext("2d");
          if (!context) {
            return file;
          }

          context.drawImage(image, 0, 0, targetWidth, targetHeight);

          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, "image/webp", config.quality);
          });

          if (!blob) {
            return file;
          }

          const baseName = (file.name || "imagen").replace(/\.[^.]+$/, "");
          return new File([blob], `${baseName}.webp`, {
            type: "image/webp",
            lastModified: Date.now(),
          });
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      const uploadProfileMedia = async ({ file, type }) => {
        if (!file) return null;

        const ext = mimeToExtension(file.type) || getSafeExtension(file.name);
        const objectPath = `${type}s/${user.id}/${type}.${ext}`;

        const { error: uploadError } = await client.storage
          .from(PROFILE_MEDIA_BUCKET)
          .upload(objectPath, file, {
            upsert: true,
            contentType: file.type || "image/jpeg",
          });

        if (uploadError) {
          return { error: uploadError };
        }

        const { data } = client.storage.from(PROFILE_MEDIA_BUCKET).getPublicUrl(objectPath);
        return { publicUrl: data?.publicUrl || null };
      };

      const coverPositionStorageKey = `kinetic_cover_position:${user.id}`;

      const readCoverPosition = () => {
        const raw = localStorage.getItem(coverPositionStorageKey);
        if (!raw) return null;
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) return null;
        return Math.max(0, Math.min(100, numeric));
      };

      const writeCoverPosition = (value) => {
        localStorage.setItem(coverPositionStorageKey, String(value));
      };

      const saveProfileMediaUrls = async (updates) => {
        const row = {
          user_id: user.id,
          email: user.email || null,
          ...updates,
          updated_at: new Date().toISOString(),
        };

        const { error } = await client.from(PROFILE_TABLE).upsert(row, { onConflict: "user_id" });
        return error || null;
      };

      const readCoverPositionFromTable = async () => {
        const { data, error } = await client
          .from(PROFILE_TABLE)
          .select("cover_position_y")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          return null;
        }

        const value = Number(data?.cover_position_y);
        if (!Number.isFinite(value)) return null;
        return Math.max(0, Math.min(100, value));
      };

      const saveCoverPositionToTable = async (positionY) => {
        const payload = {
          user_id: user.id,
          email: user.email || null,
          cover_position_y: positionY,
          updated_at: new Date().toISOString(),
        };

        const { error } = await client.from(PROFILE_TABLE).upsert(payload, { onConflict: "user_id" });
        return error || null;
      };

      const buildProfileFromForm = () => ({
        first_name: (pfNombre?.value || "").trim(),
        last_name: (pfApPat?.value || "").trim(),
        maternal_last_name: (pfApMat?.value || "").trim(),
        birth_date: pfNacimiento?.value || "",
        gender: pfGenero?.value || "",
        phone: (pfTelefono?.value || "").trim(),
        weight_kg: pfPeso?.value || "",
        height_cm: pfEstatura?.value || "",
        country: pfPais?.value || "mx",
        state: pfEstado?.value || "",
      });

      const applyHeader = (profile) => {
        const fullName = profile.full_name || composeFullName(profile) || meta.name || "Atleta";
        if (usernameEl) usernameEl.textContent = fullName;
        if (metaInfoEls[0]) metaInfoEls[0].textContent = user.email || "";
        if (metaInfoEls[1]) metaInfoEls[1].textContent = profile.phone || "";
      };

      const ensureStatusNode = () => {
        if (!profileForm) return null;
        let node = profileForm.querySelector(".profile-save-status");
        if (node) return node;
        node = document.createElement("p");
        node.className = "profile-save-status";
        node.setAttribute("aria-live", "polite");
        node.style.margin = "8px 0 0";
        node.style.fontWeight = "700";
        const actions = profileForm.querySelector(".profile-form-actions");
        if (actions) {
          actions.insertAdjacentElement("afterend", node);
        } else {
          profileForm.appendChild(node);
        }
        return node;
      };

      const statusNode = ensureStatusNode();
      const showStatus = (message, isError = false) => {
        if (!statusNode) return;
        statusNode.textContent = message;
        statusNode.style.color = isError ? "#ff8a65" : "#34d399";
      };

      const showEmergencyStatus = (message, isError = false) => {
        if (!emergencyStatus) return;
        emergencyStatus.textContent = message;
        emergencyStatus.classList.toggle("is-error", isError);
        emergencyStatus.classList.toggle("is-success", !isError && Boolean(message));
      };

      const populateEmergencyForm = (contact) => {
        if (!emergencyName || !emergencyPhone || !emergencyRelation || !emergencyEmail) return;
        const normalized = normalizeEmergencyContact(contact || {});
        emergencyName.value = normalized.name;
        emergencyPhone.value = normalized.phone;
        emergencyRelation.value = normalized.relation;
        emergencyEmail.value = normalized.email;
      };

      const clearEmergencyForm = () => {
        populateEmergencyForm({});
      };

      const renderSavedEmergencyCard = (contact) => {
        if (!emergencySavedCard) return;
        emergencySavedCard.innerHTML = `
          <div class="checkout-saved-emergency">
            <p class="checkout-saved-emergency-title">Contacto de emergencia guardado</p>
            <p class="checkout-saved-emergency-copy">
              <strong>${contact.name}</strong><br />
              ${formatEmergencyRelation(contact.relation)} · ${contact.phone}<br />
              ${contact.email}
            </p>
          </div>
        `;
      };

      const toggleEmergencyMode = ({ showForm, contact = null }) => {
        if (!emergencyForm) return;

        emergencyForm.hidden = !showForm;

        if (emergencySavedActions) {
          emergencySavedActions.hidden = showForm || !hasCompleteEmergencyContact(contact || {});
        }

        if (emergencySavedCard) {
          emergencySavedCard.hidden = showForm || !hasCompleteEmergencyContact(contact || {});
          if (!emergencySavedCard.hidden && contact) {
            renderSavedEmergencyCard(contact);
          }
        }

        if (emergencyCancelBtn) {
          emergencyCancelBtn.hidden = !showForm || !hasCompleteEmergencyContact(contact || {});
        }

        if (!showForm) {
          showEmergencyStatus("");
        }
      };

      const setReadOnlyMode = (profile) => {
        fields.forEach(({ key, node }) => {
          const value = profile[key] || "";
          if (!node) return;

          if (node.tagName === "SELECT") {
            node.value = value || (key === "country" ? "mx" : "");
            node.disabled = true;
            return;
          }

          node.value = "";
          node.placeholder = value || node.dataset.defaultPlaceholder || "";
          node.disabled = true;
        });

        if (saveBtn) {
          saveBtn.textContent = "Editar información";
          saveBtn.disabled = false;
        }
      };

      const setEditMode = (profile) => {
        fields.forEach(({ key, node }) => {
          if (!node) return;
          node.disabled = false;
          if (node.tagName === "SELECT") {
            node.value = profile[key] || (key === "country" ? "mx" : "");
            return;
          }
          node.placeholder = node.dataset.defaultPlaceholder || "";
          node.value = profile[key] || "";
        });

        if (saveBtn) {
          saveBtn.textContent = "Guardar cambios";
          saveBtn.disabled = false;
        }
      };

      const readProfileFromTable = async () => {
        const { data, error } = await client
          .from(PROFILE_TABLE)
          .select("first_name,last_name,maternal_last_name,birth_date,gender,phone,weight_kg,height_cm,country,state,full_name,avatar_url,cover_url,emergency_name,emergency_phone,emergency_relation,emergency_email")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          const expectedNoRow = error.code === "PGRST116";
          if (!expectedNoRow) {
            console.warn("No se pudo leer la tabla user_profiles:", error);
          }
          return null;
        }

        return data || null;
      };

      const saveProfileInTable = async (profile) => {
        const row = {
          user_id: user.id,
          email: user.email || null,
          ...profile,
          full_name: profile.full_name || composeFullName(profile),
          updated_at: new Date().toISOString(),
        };

        const { error } = await client.from(PROFILE_TABLE).upsert(row, { onConflict: "user_id" });
        return error || null;
      };

      const profileFromMeta = normalizeProfile(meta);
      const profileFromTable = await readProfileFromTable();
      let currentProfile = {
        ...profileFromMeta,
        ...(profileFromTable ? normalizeProfile(profileFromTable) : {}),
      };

      if (!profileFromTable) {
        const bootstrapError = await saveProfileInTable(currentProfile);
        if (bootstrapError) {
          console.warn("No se pudo crear el registro inicial en user_profiles:", bootstrapError);
        }
      }

      if (!currentProfile.full_name) {
        currentProfile.full_name = composeFullName(currentProfile);
      }

      applyHeader(currentProfile);

      let currentCoverPosition = readCoverPosition();
      const coverPositionFromTable = await readCoverPositionFromTable();
      if (coverPositionFromTable !== null) {
        currentCoverPosition = coverPositionFromTable;
      }
      if (currentCoverPosition === null) {
        currentCoverPosition = 12;
      }

      const applyAvatarVisual = (avatarUrl) => {
        if (!avatarInner || !avatarUrl) return;
        avatarInner.style.backgroundImage = `url("${avatarUrl}")`;
        avatarInner.style.backgroundSize = "cover";
        avatarInner.style.backgroundPosition = "center";
        avatarInner.innerHTML = "";
      };

      const applyCoverPositionVisual = (positionY) => {
        if (!profileCover) return;
        profileCover.style.backgroundPosition = `center ${positionY}%`;
      };

      const applyCoverVisual = (coverUrl) => {
        if (!profileCover || !coverUrl) return;
        profileCover.style.backgroundImage = `url("${coverUrl}")`;
        profileCover.style.backgroundSize = "cover";
        applyCoverPositionVisual(currentCoverPosition);
      };

      if (currentProfile.avatar_url) {
        applyAvatarVisual(currentProfile.avatar_url);
      } else if (meta.avatar_url) {
        applyAvatarVisual(meta.avatar_url);
      }

      if (currentProfile.cover_url) {
        applyCoverVisual(currentProfile.cover_url);
      }

      if (coverAdjustToggle) {
        coverAdjustToggle.hidden = !Boolean(currentProfile.cover_url);
      }

      let isCoverAdjustMode = false;
      const setCoverAdjustMode = (active) => {
        isCoverAdjustMode = active;
        if (!profileCover || !coverAdjustToggle) return;
        profileCover.classList.toggle("is-adjusting", active);
        coverAdjustToggle.textContent = active ? "Listo" : "Ajustar portada";
      };

      coverAdjustToggle?.addEventListener("click", () => {
        setCoverAdjustMode(!isCoverAdjustMode);
      });

      if (profileCover) {
        let dragStartY = 0;
        let dragStartPos = currentCoverPosition;
        let isDraggingCover = false;

        const stopCoverDrag = () => {
          if (!isDraggingCover) return;
          isDraggingCover = false;
          writeCoverPosition(currentCoverPosition);
          saveCoverPositionToTable(currentCoverPosition).then((error) => {
            if (error) {
              console.warn("No se pudo guardar posición de portada en user_profiles:", error);
            }
          });
        };

        profileCover.addEventListener("pointerdown", (event) => {
          if (!isCoverAdjustMode) return;
          if (event.target.closest(".profile-cover-btn, .profile-cover-adjust-btn, .profile-identity")) {
            return;
          }

          isDraggingCover = true;
          dragStartY = event.clientY;
          dragStartPos = currentCoverPosition;
          profileCover.setPointerCapture(event.pointerId);
          event.preventDefault();
        });

        profileCover.addEventListener("pointermove", (event) => {
          if (!isDraggingCover) return;

          const deltaY = event.clientY - dragStartY;
          const height = Math.max(profileCover.clientHeight || 1, 1);
          const deltaPercent = (deltaY / height) * 100;
          currentCoverPosition = Math.max(0, Math.min(100, dragStartPos + deltaPercent));
          applyCoverPositionVisual(currentCoverPosition);
        });

        profileCover.addEventListener("pointerup", (event) => {
          if (profileCover.hasPointerCapture(event.pointerId)) {
            profileCover.releasePointerCapture(event.pointerId);
          }
          stopCoverDrag();
        });

        profileCover.addEventListener("pointercancel", stopCoverDrag);
      }

      if (avatarUpload) {
        avatarUpload.addEventListener("change", async (event) => {
          const file = event.target?.files?.[0];
          if (!file) return;

          const initialValidationError = validateProfileMediaFile({ file, type: "avatar" });
          if (initialValidationError) {
            showStatus(`Foto de perfil: ${initialValidationError}`, true);
            avatarUpload.value = "";
            return;
          }

          const optimizedFile = await optimizeProfileMediaFile({ file, type: "avatar" });
          const validationError = validateProfileMediaFile({ file: optimizedFile, type: "avatar" });
          if (validationError) {
            showStatus(`Foto de perfil: ${validationError}`, true);
            avatarUpload.value = "";
            return;
          }

          const preview = URL.createObjectURL(optimizedFile);
          applyAvatarVisual(preview);

          const { publicUrl, error: uploadError } = await uploadProfileMedia({
            file: optimizedFile,
            type: "avatar",
          });

          URL.revokeObjectURL(preview);

          if (uploadError || !publicUrl) {
            showStatus("No se pudo subir la foto de perfil.", true);
            return;
          }

          const persistError = await saveProfileMediaUrls({ avatar_url: publicUrl });
          if (persistError) {
            showStatus("La foto se subió, pero no se pudo guardar en perfil.", true);
            return;
          }

          currentProfile.avatar_url = publicUrl;
          applyAvatarVisual(publicUrl);
          showStatus("Foto de perfil actualizada.");
        });
      }

      if (coverUpload) {
        coverUpload.addEventListener("change", async (event) => {
          const file = event.target?.files?.[0];
          if (!file) return;

          const initialValidationError = validateProfileMediaFile({ file, type: "cover" });
          if (initialValidationError) {
            showStatus(`Portada: ${initialValidationError}`, true);
            coverUpload.value = "";
            return;
          }

          const optimizedFile = await optimizeProfileMediaFile({ file, type: "cover" });
          const validationError = validateProfileMediaFile({ file: optimizedFile, type: "cover" });
          if (validationError) {
            showStatus(`Portada: ${validationError}`, true);
            coverUpload.value = "";
            return;
          }

          const preview = URL.createObjectURL(optimizedFile);
          currentCoverPosition = 50;
          applyCoverVisual(preview);

          const { publicUrl, error: uploadError } = await uploadProfileMedia({
            file: optimizedFile,
            type: "cover",
          });

          URL.revokeObjectURL(preview);

          if (uploadError || !publicUrl) {
            showStatus("No se pudo subir la portada.", true);
            return;
          }

          const persistError = await saveProfileMediaUrls({ cover_url: publicUrl });
          if (persistError) {
            showStatus("La portada se subió, pero no se pudo guardar en perfil.", true);
            return;
          }

          currentProfile.cover_url = publicUrl;
          applyCoverVisual(publicUrl);
          writeCoverPosition(currentCoverPosition);
          const coverPosError = await saveCoverPositionToTable(currentCoverPosition);
          if (coverPosError) {
            console.warn("No se pudo guardar cover_position_y en user_profiles:", coverPosError);
          }
          if (coverAdjustToggle) {
            coverAdjustToggle.hidden = false;
          }
          setCoverAdjustMode(true);
          showStatus("Portada actualizada.");
        });
      }

      if (emergencyForm && emergencyName && emergencyPhone && emergencyRelation && emergencyEmail) {
        const emergencyContact = emergencyContactFromProfile(currentProfile);

        if (hasCompleteEmergencyContact(emergencyContact)) {
          populateEmergencyForm(emergencyContact);
          if (emergencySaveBtn) emergencySaveBtn.textContent = "Actualizar contacto";
          toggleEmergencyMode({ showForm: false, contact: emergencyContact });
        } else {
          clearEmergencyForm();
          if (emergencySaveBtn) emergencySaveBtn.textContent = "Guardar contacto";
          toggleEmergencyMode({ showForm: true });
        }

        emergencyEditBtn?.addEventListener("click", () => {
          const savedContact = emergencyContactFromProfile(currentProfile);
          populateEmergencyForm(savedContact);
          if (emergencySaveBtn) emergencySaveBtn.textContent = "Actualizar contacto";
          toggleEmergencyMode({ showForm: true, contact: savedContact });
          emergencyName?.focus();
        });

        emergencyCancelBtn?.addEventListener("click", () => {
          const savedContact = emergencyContactFromProfile(currentProfile);
          if (!hasCompleteEmergencyContact(savedContact)) {
            toggleEmergencyMode({ showForm: true });
            return;
          }
          populateEmergencyForm(savedContact);
          if (emergencySaveBtn) emergencySaveBtn.textContent = "Actualizar contacto";
          toggleEmergencyMode({ showForm: false, contact: savedContact });
        });

        emergencyForm.addEventListener("submit", async (event) => {
          event.preventDefault();

          const payload = normalizeEmergencyContact({
            name: emergencyName.value,
            phone: emergencyPhone.value,
            relation: emergencyRelation.value,
            email: emergencyEmail.value,
          });

          if (!hasCompleteEmergencyContact(payload)) {
            showEmergencyStatus("Completa nombre, teléfono, relación y correo del contacto.", true);
            return;
          }

          const normalizedUserEmail = (user.email || "").trim().toLowerCase();
          const normalizedEmergencyEmail = (payload.email || "").trim().toLowerCase();
          if (normalizedEmergencyEmail && normalizedEmergencyEmail === normalizedUserEmail) {
            showEmergencyStatus(
              "El correo del contacto de emergencia debe ser diferente al de tu cuenta.",
              true
            );
            emergencyEmail?.focus();
            return;
          }

          if (emergencySaveBtn) {
            emergencySaveBtn.disabled = true;
            emergencySaveBtn.textContent = "Guardando...";
          }

          const { error } = await saveEmergencyContactForUser(
            { userId: user.id, email: user.email || "" },
            payload
          );

          if (emergencySaveBtn) {
            emergencySaveBtn.disabled = false;
            emergencySaveBtn.textContent = "Actualizar contacto";
          }

          if (error) {
            showEmergencyStatus("No se pudo guardar el contacto. Intenta de nuevo.", true);
            return;
          }

          currentProfile = {
            ...currentProfile,
            ...emergencyContactToProfileFields(payload),
          };

          showEmergencyStatus("Contacto de emergencia guardado correctamente.");
          populateEmergencyForm(payload);
          toggleEmergencyMode({ showForm: false, contact: payload });
        });
      }

      const navActions = document.querySelector(".nav-actions");
      if (navActions) {
        navActions.innerHTML = `
          <span class="ghost-link" style="cursor:default;font-size:0.85rem;">${user.email}</span>
          <button class="btn btn-primary" id="navLogoutBtn" type="button">Cerrar sesión</button>
        `;
        document.getElementById("navLogoutBtn")?.addEventListener("click", async () => {
          await client.auth.signOut();
          window.location.href = "index.html";
        });
      }

      const racesContainer = document.getElementById("profileRacesContainer");
      const reminder = document.getElementById("profileRaceReminder");
      const reminderPay = document.getElementById("profileRaceReminderPay");
      if (reminderPay) {
        reminderPay.href = AXOLOTE_PAYMENT_URL;
      }

      const profileUrl = new URL(window.location.href);
      const raceParam = profileUrl.searchParams.get("race");
      const paidParam = profileUrl.searchParams.get("paid");

      const readPaymentState = () => localStorage.getItem(AXOLOTE_PAYMENT_STATE_KEY) || "";
      const writePaymentState = (value) => {
        if (!value) {
          localStorage.removeItem(AXOLOTE_PAYMENT_STATE_KEY);
          return;
        }
        localStorage.setItem(AXOLOTE_PAYMENT_STATE_KEY, value);
      };

      if (raceParam === "axolote" && paidParam === "1") {
        writePaymentState("paid");
        localStorage.removeItem(AXOLOTE_POST_VERIFY_PROMPT_KEY);
        profileUrl.searchParams.delete("race");
        profileUrl.searchParams.delete("paid");
        window.history.replaceState({}, "", profileUrl.pathname + profileUrl.search + profileUrl.hash);
      }

      if (raceParam === "axolote" && paidParam === "0") {
        writePaymentState("pending");
        profileUrl.searchParams.delete("race");
        profileUrl.searchParams.delete("paid");
        window.history.replaceState({}, "", profileUrl.pathname + profileUrl.search + profileUrl.hash);
      }

      const renderRaces = (state) => {
        if (!racesContainer) return;

        if (state === "pending") {
          racesContainer.innerHTML = `
            <div class="profile-race-card">
              <article class="profile-race-item">
                <div class="profile-race-top">
                  <h3 class="profile-race-name">Axolote Night Run 2026</h3>
                  <span class="profile-race-status is-pending">Pendiente de pago</span>
                </div>
                <p class="profile-race-meta">31 OCT 2026 · Pista de Canotaje, CDMX · Categoría única 5K</p>
                <p class="profile-race-meta">Tu lugar está apartado. Completa el pago para asegurar tu inscripción.</p>
                <div class="profile-race-actions">
                  <a class="profile-race-pay-btn" href="${AXOLOTE_PAYMENT_URL}">Pagar para asegurar lugar</a>
                  <a class="profile-race-detail-btn" href="${AXOLOTE_EVENT_URL}">Ver detalle del evento</a>
                </div>
              </article>
            </div>
          `;
          return;
        }

        if (state === "paid") {
          racesContainer.innerHTML = `
            <div class="profile-race-card">
              <article class="profile-race-item">
                <div class="profile-race-top">
                  <h3 class="profile-race-name">Axolote Night Run 2026</h3>
                  <span class="profile-race-status is-paid">Inscripción pagada</span>
                </div>
                <p class="profile-race-meta">31 OCT 2026 · Pista de Canotaje, CDMX · Categoría única 5K</p>
                <p class="profile-race-meta">Incluye playera técnica oficial Axolote Night Run 2026 y medalla de finisher exclusiva.</p>
                <div class="profile-race-actions">
                  <a class="profile-race-detail-btn" href="${AXOLOTE_EVENT_URL}">Ver detalle del evento</a>
                </div>
              </article>
            </div>
          `;
          return;
        }

        racesContainer.innerHTML = `
          <div class="profile-card">
            <div class="profile-empty-state">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.7" />
                <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="1.7" />
              </svg>
              <p>
                Aún no tienes inscripciones.
                <a href="index.html" class="auth-link-btn">Explora eventos</a>
                y regístrate en tu próxima carrera.
              </p>
            </div>
          </div>
        `;
      };

      const syncReminder = (state) => {
        if (!reminder) return;
        reminder.hidden = state !== "pending";
      };

      const openRegisterModal = () => {
        const overlay = document.createElement("div");
        overlay.className = "profile-race-register-overlay";
        overlay.id = "profileRaceRegisterOverlay";
        overlay.innerHTML = `
          <div class="profile-race-register-modal" role="dialog" aria-modal="true" aria-labelledby="profileRaceRegisterTitle">
            <button class="profile-race-register-close" type="button" aria-label="Cerrar">&times;</button>
            <h3 id="profileRaceRegisterTitle">Registro confirmado para Axolote Night Run 2026</h3>
            <ul class="profile-race-register-copy">
              <li>Tu cuenta ya fue verificada.</li>
              <li>Tu lugar quedó apartado para la primera edición oficial de Kinetic Hub.</li>
              <li>Completa tu pago para asegurar tu inscripción en la categoría única 5K del 31 OCT 2026 en Pista de Canotaje, CDMX.</li>
            </ul>
            <div class="profile-race-register-highlights">
              <span>Incluye playera técnica oficial Axolote Night Run 2026.</span>
              <span>Incluye medalla de finisher exclusiva.</span>
            </div>
            <div class="profile-race-register-actions">
              <a class="profile-race-detail-btn" href="${AXOLOTE_EVENT_URL}">Ver detalle</a>
              <a class="profile-race-register-pay" href="${AXOLOTE_PAYMENT_URL}">Pagar para asegurar mi lugar</a>
            </div>
          </div>
        `;

        const closeModal = () => {
          overlay.remove();
          writePaymentState("pending");
          renderRaces("pending");
          syncReminder("pending");
        };

        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) {
            closeModal();
          }
        });

        overlay.querySelector(".profile-race-register-close")?.addEventListener("click", closeModal);
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Escape" && document.getElementById("profileRaceRegisterOverlay")) {
              closeModal();
            }
          },
          { once: true }
        );

        document.body.appendChild(overlay);
      };

      let paymentState = readPaymentState();
      const shouldPromptAfterVerify = localStorage.getItem(AXOLOTE_POST_VERIFY_PROMPT_KEY) === "1";

      if (shouldPromptAfterVerify && paymentState !== "paid") {
        writePaymentState("pending");
        localStorage.removeItem(AXOLOTE_POST_VERIFY_PROMPT_KEY);
        paymentState = "pending";
      }

      if (!paymentState && shouldPromptAfterVerify) {
        paymentState = "pending";
      }

      // For existing accounts without a confirmed payment, default to pending state.
      if (!paymentState) {
        writePaymentState("pending");
        paymentState = "pending";
      }

      if (paymentState === "pending") {
        renderRaces("pending");
        syncReminder("pending");
        openRegisterModal();
      } else if (paymentState === "paid") {
        renderRaces("paid");
        syncReminder("paid");
      } else {
        renderRaces("");
        syncReminder("");
      }

      let isEditing = false;
      setReadOnlyMode(currentProfile);

      if (profileForm) {
        profileForm.addEventListener("submit", async (event) => {
          event.preventDefault();

          if (!isEditing) {
            isEditing = true;
            showStatus("");
            setEditMode(currentProfile);
            return;
          }

          const originalBtnText = saveBtn?.textContent || "Guardar cambios";
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = "Guardando...";
          }

          const nextProfile = normalizeProfile(buildProfileFromForm());
          nextProfile.full_name = composeFullName(nextProfile);

          const { data: updatedData, error: updateError } = await client.auth.updateUser({
            data: nextProfile,
          });

          if (updateError) {
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = originalBtnText;
            }
            showStatus(updateError.message || "No se pudo actualizar el perfil.", true);
            return;
          }

          const tableError = await saveProfileInTable(nextProfile);
          if (tableError) {
            const reason = [tableError.code, tableError.message].filter(Boolean).join(" - ");
            showStatus(
              `Se guardó en la cuenta, pero falló user_profiles${reason ? `: ${reason}` : "."}`,
              true
            );
            console.warn("No se pudo guardar en user_profiles:", tableError);
          } else {
            showStatus("Perfil actualizado correctamente.");
          }

          const updatedMeta = updatedData?.user?.user_metadata || nextProfile;
          currentProfile = normalizeProfile({ ...nextProfile, ...updatedMeta });
          currentProfile.full_name = currentProfile.full_name || composeFullName(currentProfile);

          applyHeader(currentProfile);

          isEditing = false;
          setReadOnlyMode(currentProfile);
        });
      }
      });

      // Logout desde el sidebar
      const sidebarLogout = document.getElementById("sidebarLogout");
      if (sidebarLogout) {
        sidebarLogout.addEventListener("click", async (e) => {
          e.preventDefault();
          await client.auth.signOut();
          window.location.href = "index.html";
        });
      }
    }
  };

  if (typeof window.supabase !== "undefined") {
    initSupabase();
    return;
  }

  let sdkScript = document.querySelector('script[data-supabase-sdk="true"]');
  if (!sdkScript) {
    sdkScript = document.createElement("script");
    sdkScript.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    sdkScript.dataset.supabaseSdk = "true";
    document.head.appendChild(sdkScript);
  }

  if (typeof window.supabase !== "undefined") {
    initSupabase();
    return;
  }

  sdkScript.addEventListener("load", initSupabase, { once: true });
}

function setupTipsCarousel() {
  const section = document.querySelector(".tips-section");
  if (!section) return;

  const track = document.getElementById("tipsTrack");
  const prevBtn = section.querySelector(".tips-arrow-prev");
  const nextBtn = section.querySelector(".tips-arrow-next");
  const cards = Array.from(section.querySelectorAll(".tips-card"));
  const modal = document.getElementById("tipsModal");
  const modalClose = document.getElementById("tipsModalClose");
  const modalVideoShell = document.getElementById("tipsModalVideoShell");
  const modalUsername = document.getElementById("tipsModalUsername");
  const modalBio = document.getElementById("tipsModalBio");
  const modalAvatarRing = document.getElementById("tipsModalAvatarRing");
  const modalAvatarPlaceholder = document.getElementById("tipsModalAvatarPlaceholder");

  if (!track || !prevBtn || !nextBtn || !modal) return;

  // ── Carousel navigation ───────────────────────────────
  let currentIndex = 0;

  const getCardStep = () => {
    const card = cards[0];
    if (!card) return 224;
    const style = window.getComputedStyle(track);
    const gap = parseFloat(style.gap) || 14;
    return card.getBoundingClientRect().width + gap;
  };

  const getVisibleCount = () => {
    const vw = window.innerWidth;
    if (vw < 520) return 2;
    if (vw < 780) return 3;
    if (vw < 1060) return 4;
    return 5;
  };

  const getMaxIndex = () => Math.max(0, cards.length - getVisibleCount());

  const updateArrows = () => {
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= getMaxIndex();
  };

  const goTo = (index) => {
    currentIndex = Math.max(0, Math.min(index, getMaxIndex()));
    track.style.transform = `translateX(-${currentIndex * getCardStep()}px)`;
    updateArrows();
  };

  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));
  window.addEventListener("resize", () => goTo(Math.min(currentIndex, getMaxIndex())));

  updateArrows();

  // ── Hover preview (muted Cloudflare iframe) ───────────
  const isPlaceholderId = (id) =>
    !id || id.startsWith("CLOUDFLARE_VIDEO_ID") || id.startsWith("PLACEHOLDER");

  const buildPreviewSrc = (cfId) =>
    `https://iframe.videodelivery.net/${encodeURIComponent(cfId)}?autoplay=true&muted=true&controls=false&loop=true&preload=true`;

  const buildModalSrc = (cfId) =>
    `https://iframe.videodelivery.net/${encodeURIComponent(cfId)}?autoplay=true&muted=false&controls=true&preload=true`;

  cards.forEach((card) => {
    const cfId = card.dataset.cfId || "";
    if (isPlaceholderId(cfId)) return;

    const previewWrap = card.querySelector(".tips-card-preview-wrap");
    if (!previewWrap) return;

    let hoverTimer = null;

    card.addEventListener("mouseenter", () => {
      hoverTimer = setTimeout(() => {
        if (!previewWrap.querySelector("iframe")) {
          const iframe = document.createElement("iframe");
          iframe.src = buildPreviewSrc(cfId);
          iframe.setAttribute("allow", "autoplay; encrypted-media");
          iframe.setAttribute("loading", "lazy");
          iframe.title = "Vista previa del video";
          previewWrap.appendChild(iframe);
        }
      }, 220);
    });

    card.addEventListener("mouseleave", () => {
      clearTimeout(hoverTimer);
      const iframe = previewWrap.querySelector("iframe");
      if (iframe) previewWrap.removeChild(iframe);
    });
  });

  // ── Open / close modal ────────────────────────────────
  const openModal = (card) => {
    const cfId = card.dataset.cfId || "";
    const username = card.dataset.username || "";
    const bio = card.dataset.bio || "";
    const avatar = card.dataset.avatar || "";
    const initials = username.replace("@", "").slice(0, 2).toLowerCase();

    if (modalUsername) modalUsername.textContent = username;
    if (modalBio) modalBio.textContent = bio;

    // Avatar
    if (modalAvatarRing) {
      const existingImg = modalAvatarRing.querySelector("img");
      if (existingImg) existingImg.remove();
      if (avatar) {
        const img = document.createElement("img");
        img.src = avatar;
        img.alt = username;
        if (modalAvatarPlaceholder) modalAvatarPlaceholder.style.display = "none";
        modalAvatarRing.prepend(img);
      } else {
        if (modalAvatarPlaceholder) {
          modalAvatarPlaceholder.textContent = initials;
          modalAvatarPlaceholder.style.display = "";
        }
      }
    }

    // Video
    if (modalVideoShell) {
      modalVideoShell.innerHTML = "";
      if (!isPlaceholderId(cfId)) {
        const iframe = document.createElement("iframe");
        iframe.src = buildModalSrc(cfId);
        iframe.setAttribute(
          "allow",
          "autoplay; fullscreen; encrypted-media; picture-in-picture"
        );
        iframe.setAttribute("allowfullscreen", "");
        iframe.title = `Video de ${username}`;
        modalVideoShell.appendChild(iframe);
      } else {
        // Demo placeholder while IDs are not yet set
        const placeholder = document.createElement("div");
        placeholder.style.cssText =
          "display:flex;align-items:center;justify-content:center;height:100%;background:#111;color:rgba(255,255,255,0.4);font-size:0.82rem;text-align:center;padding:24px;";
        placeholder.textContent =
          "Asigna el ID de Cloudflare Stream en el atributo data-cf-id de la tarjeta.";
        modalVideoShell.appendChild(placeholder);
      }
    }

    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (modalClose) modalClose.focus();
  };

  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (modalVideoShell) modalVideoShell.innerHTML = "";
  };

  cards.forEach((card) => {
    card.addEventListener("click", () => openModal(card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal(card);
      }
    });
  });

  if (modalClose) modalClose.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });
}

setupPageLoadIndicator();
setupMenuToggle();
setupActiveNavLink();
setupHeaderScrollState();
setupEventStickyBanner();
setupRevealOnScroll();
setupUnifiedFooter();
setupCurrentYear();
setupFooterNewsletter();
setupContactFormSubmission();
setupEventFilters();
setupHeroPosterSizing();
setupRegisterScrollLed();
setupEventModals();
setupEventDetailAccordions();
setupNeonCardGlow();
setupNeonEventToggle();
setupWhatsAppButton();
setupEventRegistrationPanel();
setupAuthPage();
setupProfilePage();
setupBlogTabs();
setupTipsCarousel();
setupSupabase();
