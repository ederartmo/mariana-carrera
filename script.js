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
    cta.href = "index.html#raceRegisterBar";
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
      event.preventDefault();
      heroTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(triggerFormIndicator, 480);
    });
  });
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
          <svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M19.11 17.27c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.28-.47-2.44-1.5-.9-.8-1.5-1.8-1.68-2.1-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.1 4.5.71.31 1.27.49 1.7.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.4.25-.69.25-1.27.17-1.4-.07-.12-.27-.2-.57-.35Z"/>
            <path d="M16.27 3.2c-6.98 0-12.65 5.68-12.65 12.66 0 2.23.58 4.41 1.68 6.33L3.2 28.8l6.77-2.05a12.6 12.6 0 0 0 6.3 1.7h.01c6.98 0 12.66-5.68 12.66-12.66A12.65 12.65 0 0 0 16.27 3.2Zm0 22.99h-.01a10.3 10.3 0 0 1-5.26-1.45l-.38-.22-4.02 1.22 1.23-3.92-.24-.4a10.3 10.3 0 1 1 8.68 4.77Z"/>
          </svg>
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
      <svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.11 17.27c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.28-.47-2.44-1.5-.9-.8-1.5-1.8-1.68-2.1-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.1 4.5.71.31 1.27.49 1.7.63.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.4.25-.69.25-1.27.17-1.4-.07-.12-.27-.2-.57-.35Z"/>
        <path d="M16.27 3.2c-6.98 0-12.65 5.68-12.65 12.66 0 2.23.58 4.41 1.68 6.33L3.2 28.8l6.77-2.05a12.6 12.6 0 0 0 6.3 1.7h.01c6.98 0 12.66-5.68 12.66-12.66A12.65 12.65 0 0 0 16.27 3.2Zm0 22.99h-.01a10.3 10.3 0 0 1-5.26-1.45l-.38-.22-4.02 1.22 1.23-3.92-.24-.4a10.3 10.3 0 1 1 8.68 4.77Z"/>
      </svg>
    </a>
  `;

  document.body.appendChild(wrapper);
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
