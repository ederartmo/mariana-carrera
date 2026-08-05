(function (root) {
  const formatDate = (date) => new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date).replace(".", "").toUpperCase();

  const getClosedStage = () => ({
    label: "Inscripciones cerradas",
    amount: null,
    price: null,
    isOpen: false,
  });

  const events = [
    {
      id: "axolote-night-run",
      name: "Axolote Night Run",
      href: "axolote-night-run.html",
      date: new Date("2026-10-31T18:00:00-06:00"),
      location: "Ciudad de Mexico",
      distance: "5K",
      image: "assets/events/axolote-night-run/gallery/banner_axolote.png",
      alt: "Corredores de Axolote Night Run 2026",
      theme: "axolote",
      getStage() {
        return root.KineticHubStageConfig?.getAxoloteStageByDate?.() || getClosedStage();
      },
    },
    {
      id: "cascanueces-run",
      name: "Cascanueces Run 2026",
      href: "cascanueces-run.html",
      date: new Date("2026-12-06T08:00:00-06:00"),
      location: "Bosque de San Juan de Aragon, CDMX",
      distance: "5K y 10K",
      image: "assets/events/cascanueces-run/gallery/cascanueces_run_banner2.png",
      alt: "Cascanueces Run 2026",
      theme: "cascanueces",
      getStage() {
        return root.KineticHubCascanuecesStageConfig?.getCascanuecesStageByDate?.() || getClosedStage();
      },
    },
  ];

  root.KineticHubFeaturedEvents = events;
  root.KineticHubEventHelpers = { formatDate, getClosedStage };
})(typeof globalThis !== "undefined" ? globalThis : window);