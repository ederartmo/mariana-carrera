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

  // Cover photo preview
  const coverUpload = document.getElementById("coverUpload");
  const profileCover = document.getElementById("profileCover");
  if (coverUpload && profileCover) {
    coverUpload.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      profileCover.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
    });
  }

  // Avatar photo preview
  const avatarUpload = document.getElementById("avatarUpload");
  const avatarInner = document.getElementById("profileAvatarInner");
  if (avatarUpload && avatarInner) {
    avatarUpload.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      avatarInner.style.backgroundImage = `url("${url}")`;
      avatarInner.style.backgroundSize = "cover";
      avatarInner.style.backgroundPosition = "center";
      avatarInner.innerHTML = "";
    });
  }

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
  const payBtn = document.getElementById("eventPayBtn");

  if (payBtn) {
    payBtn.href = "checkout.html";
    payBtn.target = "";
    payBtn.rel = "";
  }

  const applyState = (isLoggedIn) => {
    if (!title || !text || !cta) return;

    if (isLoggedIn) {
      title.textContent = "Continuar registro";
      text.textContent = "Ya iniciaste sesión. Completa tu inscripción y realiza el pago.";
      cta.textContent = "Completar inscripción";
      cta.href = "#";
      return;
    }

    title.textContent = "Registro rápido";
    text.textContent = "Reserva tu lugar y asegura tarifa vigente.";
    cta.textContent = "Ir al registro";
    cta.href = "auth.html?mode=register";
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

        const { error } = await client.auth.signUp({
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
          if (registerStatus) {
            registerStatus.textContent = error.message;
            registerStatus.classList.add("is-error");
          } else {
            alert(error.message);
          }
        } else {
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

      const PROFILE_TABLE = "user_profiles";
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

      const profileForm = document.querySelector(".profile-form");
      const saveBtn = profileForm?.querySelector(".profile-save-btn");

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
      });

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
          .select("first_name,last_name,maternal_last_name,birth_date,gender,phone,weight_kg,height_cm,country,state,full_name")
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

      if (!currentProfile.full_name) {
        currentProfile.full_name = composeFullName(currentProfile);
      }

      applyHeader(currentProfile);

      if (meta.avatar_url) {
        const avatarEl = document.getElementById("profileAvatarInner");
        if (avatarEl) {
          avatarEl.style.backgroundImage = `url("${meta.avatar_url}")`;
          avatarEl.style.backgroundSize = "cover";
          avatarEl.style.backgroundPosition = "center";
          avatarEl.innerHTML = "";
        }
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
            showStatus(
              "Se guardó en la cuenta, pero no en la tabla user_profiles. Revisa que exista la tabla y sus permisos.",
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

setupPageLoadIndicator();
setupMenuToggle();
setupActiveNavLink();
setupHeaderScrollState();
setupEventStickyBanner();
setupRevealOnScroll();
setupCurrentYear();
setupFooterNewsletter();
setupContactFormSubmission();
setupEventFilters();
setupHeroPosterSizing();
setupRegisterScrollLed();
setupEventModals();
setupNeonCardGlow();
setupWhatsAppButton();
setupEventRegistrationPanel();
setupAuthPage();
setupProfilePage();
setupBlogTabs();
setupSupabase();
