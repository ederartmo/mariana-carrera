function setupMenuToggle() {
  const menuToggle = document.getElementById("menuToggle");
  const nav = document.getElementById("siteNav");

  if (!menuToggle || !nav) return;

  menuToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });
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

setupMenuToggle();
setupRevealOnScroll();
setupCurrentYear();
setupEventFilters();
