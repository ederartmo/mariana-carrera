(function (root) {
  const stageConfig = root.KineticHubCascanuecesStageConfig;

  root.KineticHubCascanuecesEvent = {
    slug: "cascanueces-run",
    name: "Cascanueces Run 2026",
    titleLines: ["Cascanueces", "Run 2026"],
    eyebrow: "Carrera recreativa",
    subtitle: "Corre, diviértete y vive la magia",
    description: "Una carrera navideña de 5K y 10K para disfrutar en familia, iniciar tu camino como corredor o buscar un nuevo desafío.",
    date: {
      label: "6 de diciembre",
      full: "Domingo 6 de diciembre de 2026",
      iso: "2026-12-06",
    },
    time: {
      label: "08:00 h",
      start: "08:00",
      limit: "1 hora 30 minutos",
    },
    location: {
      name: "Bosque de San Juan de Aragón",
      city: "CDMX",
      start: "Puerta del Bosque de San Juan de Aragón",
      finish: "Puerta 6 del Bosque de San Juan de Aragón",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Bosque+de+San+Juan+de+Aragon+CDMX",
    },
    category: {
      label: "Categoría única",
      branches: "Femenil y varonil",
    },
    distances: ["5K", "10K"],
    quickFacts: [
      { label: "Distancias", value: "5K / 10K" },
      { label: "Categoría", value: "Femenil y varonil" },
      { label: "Salida", value: "08:00 h" },
      { label: "Preventa", value: "$400 MXN" },
      { label: "Ideal para", value: "Corredores principiantes" },
    ],
    modalities: [
      {
        distance: "5K",
        name: "Recreativa",
        description: "Perfecta para disfrutar en familia o iniciar tu camino como corredor.",
        facts: [
          { label: "Categoría única", value: "Femenil y varonil" },
          { label: "Salida", value: "08:00 h" },
          { label: "Ideal para", value: "Corredores principiantes" },
          { label: "Ramas", value: "Femenil y varonil" },
        ],
      },
      {
        distance: "10K",
        name: "Competitiva",
        description: "Para quienes buscan un mayor desafío y mejorar su marca personal.",
        facts: [
          { label: "Categoría única", value: "Femenil y varonil" },
          { label: "Salida", value: "08:00 h" },
          { label: "Ideal para", value: "Corredores con experiencia" },
          { label: "Ramas", value: "Femenil y varonil" },
        ],
      },
    ],
    pricing: {
      currency: "MXN",
      stages: stageConfig ? stageConfig.CASCANUECES_STAGE_CATALOG : [],
      getCurrentStage: stageConfig && typeof stageConfig.getCascanuecesStageByDate === "function"
        ? stageConfig.getCascanuecesStageByDate
        : function () {
            return { key: "closed", label: "Inscripciones cerradas", amount: null, isOpen: false };
          },
      note: "El precio se asigna automáticamente según la etapa vigente y puedes aplicar tu cupón en el checkout.",
    },
    kit: [
      {
        name: "Playera oficial",
        image: "assets/events/cascanueces-run/kit/cascanueces_run_playera.jpeg",
        alt: "Playera oficial Cascanueces Run 2026",
      },
      {
        name: "Morral conmemorativo",
        image: "assets/events/cascanueces-run/kit/cascanueces_run_mochila.jpeg",
        alt: "Morral conmemorativo Cascanueces Run 2026",
      },
      {
        name: "Medalla finisher",
        image: "assets/events/cascanueces-run/kit/cascanueces_run_llavero.jpeg",
        alt: "Medalla finisher Cascanueces Run 2026",
      },
    ],
    kitIncludes: [
      "Número de competidor",
      "Hidratación en ruta y meta",
      "Servicio médico",
      "Resultados",
    ],
    experience: [
      {
        title: "El uniforme",
        description: "Llega listo para correr con la playera oficial de esta edición.",
        image: "assets/events/cascanueces-run/gallery/cascanueces_run_playera.png",
        alt: "Playera oficial de Cascanueces Run 2026",
      },
      {
        title: "El recuerdo",
        description: "Un morral conmemorativo para acompañarte antes y después de la meta.",
        image: "assets/events/cascanueces-run/gallery/cascanueces_run_mochila.png",
        alt: "Morral conmemorativo de Cascanueces Run 2026",
      },
      {
        title: "La meta",
        description: "Cruza la meta y recibe la medalla finisher de Cascanueces Run.",
        image: "assets/events/cascanueces-run/gallery/cascanueces_run_llavero.png",
        alt: "Medalla finisher de Cascanueces Run 2026",
      },
    ],
    schedule: [
      {
        step: "1",
        title: "Entrega de paquetes",
        date: "Viernes 4 de diciembre",
        time: "11:00 a 17:30 h",
        description: "Huerto Educativo del Bosque de San Juan de Aragón.",
      },
      {
        step: "2",
        title: "Llegada y concentración",
        time: "06:30 a 07:30 h",
        description: "Puerta del Bosque de San Juan de Aragón.",
      },
      {
        step: "3",
        title: "Calentamiento",
        time: "07:30 a 07:50 h",
        description: "Activa tu cuerpo y prepárate con música y dinámicas.",
      },
      {
        step: "4",
        title: "Salida",
        time: "08:00 h",
        description: "Empieza la carrera y enciende el recorrido.",
      },
      {
        step: "5",
        title: "Meta",
        time: "09:00 h aprox.",
        description: "Cruza la meta, celebra tu logro y recibe tu medalla.",
      },
      {
        step: "6",
        title: "Cierre del evento",
        time: "11:00 h aprox.",
        description: "Reconocimientos y cierre de la jornada.",
      },
    ],
    venue: {
      title: "Sede",
      startLabel: "Salida",
      start: "Puerta del Bosque de San Juan de Aragón",
      finishLabel: "Meta",
      finish: "Puerta 6 del Bosque de San Juan de Aragón",
    },
    routeMap: {
      title: "Mapa del recorrido",
      image: null,
      expectedPath: "assets/events/cascanueces-run/legal/mapa-recorrido.webp",
      href: null,
      cta: "Ver mapa interactivo",
    },
    packetPickup: {
      title: "Entrega de paquetes",
      date: "Viernes 4 de diciembre",
      time: "11:00 a 17:30 h",
      location: "Huerto Educativo del Bosque de San Juan de Aragón",
      note: "La entrega es personal. Lleva identificación oficial y exoneración firmada.",
    },
    faqs: [
      {
        question: "¿Qué incluye mi inscripción?",
        answer: "Número de competidor, playera, morral, hidratación en ruta y meta, servicio médico, resultados y medalla al cruzar la meta.",
      },
      {
        question: "¿Dónde recojo mi paquete?",
        answer: "En el Huerto Educativo del Bosque de San Juan de Aragón, el viernes 4 de diciembre de 11:00 a 17:30 h.",
      },
      {
        question: "¿Qué necesito para recogerlo?",
        answer: "Identificación oficial y exoneración firmada. Para menores de edad se requiere carta firmada por padre, madre o tutor.",
      },
      {
        question: "¿Cuánto tiempo tengo para terminar?",
        answer: "El tiempo límite de la carrera es de 1 hora 30 minutos.",
      },
    ],
    documents: [
      {
        label: "Ver convocatoria",
        href: "assets/events/cascanueces-run/legal/Cascanueces%20Run_convocatoria.pdf",
      },
      {
        label: "Descargar exoneración",
        href: "assets/events/cascanueces-run/legal/Cascanueces%20Run1.pdf",
        download: true,
      },
    ],
    images: {
      hero: "assets/events/cascanueces-run/gallery/cascanueces_run_banner.png",
      heroAlt: "Cascanueces Run en un bosque nevado",
      finalBanner: "assets/events/cascanueces-run/gallery/cascanueces_run_banner1.png",
      finalBannerAlt: "Cascanueces Run en un bosque nevado",
      character: null,
      characterExpectedPath: "assets/events/cascanueces-run/promo/cascanueces-corredor.webp",
    },
    theme: {
      "--event-bg": "#fbf7f0",
      "--event-surface": "#fffdf9",
      "--event-primary": "#980e15",
      "--event-secondary": "#0b2945",
      "--event-accent": "#c9903b",
      "--event-text": "#102b45",
      "--event-muted": "#6e6258",
      "--event-border": "#ead8c1",
      "--event-heading-font": "'Cormorant Garamond', Georgia, serif",
      "--event-body-font": "'Inter', sans-serif",
      "--event-accent-font": "'Cormorant Garamond', Georgia, serif",
    },
    cta: {
      primary: "Inscribirme",
      secondary: "Ver qué incluye",
      finalTitle: "¿Listo para vivir la magia?",
      finalText: "Corre, diviértete y vive una experiencia inolvidable en Cascanueces Run 2026.",
      closed: "Inscripciones cerradas",
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
