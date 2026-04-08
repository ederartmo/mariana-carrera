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

  const phone = "525512345678";
  const message = encodeURIComponent("Hola, quiero informacion sobre Axolote Night Run.");
  const href = `https://wa.me/${phone}?text=${message}`;

  const wrapper = document.createElement("div");
  wrapper.className = "whatsapp-float";
  wrapper.innerHTML = `
    <div class="whatsapp-panel" aria-hidden="true">
      <div class="whatsapp-panel-top">
        <p>Necesitas ayuda?</p>
        <a class="whatsapp-panel-link" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Escribenos por WhatsApp">
          <img src="whatsapp_logo2.png" alt="WhatsApp" />
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
      <img src="whatsapp_logo2.png" alt="WhatsApp" />
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

function setupSupabase() {
  if (typeof window.supabase === "undefined") return;

  const SUPABASE_URL = "https://anwkqhxcarzfvfufhbyk.supabase.co";
  const SUPABASE_KEY = "sb_publishable_ARbEx2T-RYfWgIJEBj1NkQ_5i7wVzQP";
  const SITE = "https://cuddly-guacamole-r966wq79w462x95j-8080.app.github.dev";

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const renderSessionNav = (session) => {
    const navActions = document.querySelector(".nav-actions");
    if (!navActions) return;

    if (!session) {
      navActions.innerHTML = `
        <a class="ghost-link" href="auth.html?mode=login">Iniciar Sesion</a>
        <a class="btn btn-primary" href="auth.html?mode=register">Registrarse</a>
      `;
      return;
    }

    const user = session.user;
    navActions.innerHTML = `
      <a class="ghost-link" href="perfil.html">Mi perfil</a>
      <button class="btn btn-primary" id="navLogoutBtn" type="button">Cerrar sesion</button>
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
    // Si ya hay sesión activa → ir directo al perfil
    client.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.replace("perfil.html");
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
          window.location.href = "perfil.html";
        }
      });
    }

    // Registro con email
    const registerForm = document.querySelector('[data-auth-panel="register"] form');
    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("registerEmail")?.value.trim();
        const password = document.getElementById("registerPassword")?.value;
        const confirm = document.getElementById("registerConfirmPassword")?.value;
        const nombre = document.getElementById("registerName")?.value.trim();
        const apellido = document.getElementById("registerLastName")?.value.trim();

        if (password !== confirm) {
          alert("Las contraseñas no coinciden.");
          return;
        }

        const { error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: `${nombre} ${apellido}`.trim() },
            emailRedirectTo: `${SITE}/auth.html?mode=login`,
          },
        });

        if (error) {
          alert(error.message);
        } else {
          alert("¡Revisa tu correo para confirmar tu cuenta y poder iniciar sesión!");
        }
      });
    }
  }

  // ── PERFIL PAGE ────────────────────────────────────
  const profileRoot = document.querySelector("[data-profile-page]");
  if (profileRoot) {
    client.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.replace("auth.html?mode=login");
        return;
      }

      const user = session.user;
      const meta = user.user_metadata || {};
      const displayName = meta.full_name || meta.name || "Atleta";

      // Datos en la cabecera de perfil
      const usernameEl = document.querySelector(".profile-username");
      const emailEl = document.querySelector(".profile-ident-meta");
      if (usernameEl) usernameEl.textContent = displayName;
      if (emailEl) emailEl.textContent = user.email;

      // Avatar de Google
      if (meta.avatar_url) {
        const avatarEl = document.getElementById("profileAvatarInner");
        if (avatarEl) {
          avatarEl.style.backgroundImage = `url("${meta.avatar_url}")`;
          avatarEl.style.backgroundSize = "cover";
          avatarEl.style.backgroundPosition = "center";
          avatarEl.innerHTML = "";
        }
      }

      // Nav: reemplazar botones por email + cerrar sesión
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
}

setupMenuToggle();
setupActiveNavLink();
setupHeaderScrollState();
setupEventStickyBanner();
setupRevealOnScroll();
setupCurrentYear();
setupEventFilters();
setupHeroPosterSizing();
setupRegisterScrollLed();
setupEventModals();
setupNeonCardGlow();
setupWhatsAppButton();
setupAuthPage();
setupProfilePage();
setupSupabase();
