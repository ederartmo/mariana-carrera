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
    return label === "registrarse" || label === "registrate" || label === "regitrate";
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

setupMenuToggle();
setupActiveNavLink();
setupHeaderScrollState();
setupRevealOnScroll();
setupCurrentYear();
setupEventFilters();
setupHeroPosterSizing();
setupRegisterScrollLed();
setupEventModals();
