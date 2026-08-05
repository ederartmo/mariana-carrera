(function (root) {
  const stageConfig = root.KineticHubStageConfig;

  root.KineticHubAxoloteEvent = {
    slug: "axolote-night-run",
    name: "Axolote Night Run 2026",
    titleLines: ["Axolote Night", "Run 2026"],
    eyebrow: "Running nocturno · Edición inaugural",
    subtitle: "La carrera nocturna más vibrante de la temporada",
    description: "Una experiencia nocturna en la Ciudad de México con recorrido iluminado, operación clara y una atmósfera diseñada para disfrutarse desde el registro hasta la meta.",
    date: {
      label: "31 de octubre",
      full: "Sábado 31 de octubre de 2026",
      iso: "2026-10-31",
    },
    time: {
      label: "18:00 h",
      start: "18:00",
      limit: null,
    },
    location: {
      name: "Pista de Remo y Canotaje Virgilio Uribe",
      city: "CDMX",
      start: "Pista de Remo y Canotaje Virgilio Uribe",
      finish: "Pista de Remo y Canotaje Virgilio Uribe",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Pista+de+Remo+y+Canotaje+Virgilio+Uribe+CDMX",
    },
    distances: ["5K"],
    quickFacts: [
      { label: "Distancia", value: "5K oficial" },
      { label: "Modalidad", value: "Ruta oficial" },
      { label: "Salida", value: "18:00 h" },
      { label: "Etapa", value: "Cupo limitado" },
      { label: "Para", value: "Todos los niveles" },
    ],
    modalities: [
      {
        distance: "5K",
        name: "Ruta oficial",
        description: "Recorrido nocturno con chip de cronometraje, salida por bloques y seguimiento oficial.",
        facts: [
          { label: "Formato", value: "Categoría única" },
          { label: "Salida", value: "18:00 h" },
          { label: "Cronometraje", value: "Chip oficial" },
          { label: "Operación", value: "Salida por bloques" },
        ],
      },
    ],
    pricing: {
      currency: "MXN",
      showStageStatus: true,
      stages: stageConfig ? stageConfig.AXOLOTE_STAGE_CATALOG : [],
      getCurrentStage: stageConfig && typeof stageConfig.getAxoloteStageByDate === "function"
        ? stageConfig.getAxoloteStageByDate
        : function () {
            return { key: "closed", label: "Inscripciones cerradas", amount: null, isOpen: false };
          },
      note: "La tarifa se asigna automáticamente según la etapa vigente. La inscripción es personal e intransferible.",
    },
    kitIncludes: [
      "Medalla finisher exclusiva",
      "Playera oficial del evento",
      "Morral conmemorativo",
      "Número de corredor",
      "Hidratación en ruta y meta",
      "Comunicación previa y logística",
    ],
    experience: [
      {
        title: "La playera oficial",
        description: "Diseño técnico incluido dentro de tu inscripción.",
        image: "assets/events/axolote-night-run/kit/playera_delante_detras.jpg",
        alt: "Playera oficial Axolote Night Run 2026",
      },
      {
        title: "El morral conmemorativo",
        description: "Mochila de entrega para participantes de esta edición.",
        image: "assets/events/axolote-night-run/kit/nueva_bolsa.jpg",
        alt: "Morral conmemorativo Axolote Night Run 2026",
      },
      {
        title: "La medalla finisher",
        description: "Pieza conmemorativa para quienes crucen la meta.",
        image: "assets/events/axolote-night-run/kit/nueva_medalla.jpg",
        alt: "Medalla oficial Axolote Night Run 2026",
      },
    ],
    experienceDetails: [
      {
        title: "Ruta nocturna",
        description: "Una ruta 5K para correr de noche con control de ruta y cronometraje oficial.",
        image: "assets/events/axolote-night-run/gallery/correr.jpg",
        alt: "Corredores durante una experiencia de Axolote Night Run",
      },
      {
        title: "Ambiente de carrera",
        description: "Una experiencia con recorrido iluminado y ambientación sonora.",
        image: "assets/events/axolote-night-run/gallery/banner_axolote.png",
        alt: "Ambiente de Axolote Night Run 2026",
      },
      {
        title: "Comunidad runner",
        description: "Una edición pensada para runners experimentados y personas que viven su primera noche de carrera.",
        image: "assets/events/axolote-night-run/gallery/correr-2.jpg",
        alt: "Comunidad runner de Axolote Night Run",
      },
    ],
    schedule: [
      {
        step: "1",
        icon: "package",
        title: "Entrega de kit",
        date: "30 de octubre",
        time: "11:00 a 17:30 h",
        description: "Recoge tu paquete con identificación oficial en Periférico Sur s/n, Col. Cuemanco, Alcaldía Xochimilco, CDMX.",
      },
      {
        step: "2",
        icon: "flag",
        title: "Inicio de carrera",
        date: "31 de octubre",
        time: "18:00 h",
        description: "Primera oleada competitiva con chip activo, control de ruta y cronometraje oficial.",
      },
      {
        step: "3",
        icon: "trophy",
        title: "Premiación y cierre",
        date: "31 de octubre",
        time: "20:30 h",
        description: "Anuncio de resultados, foto final y cierre de la edición inaugural.",
      },
    ],
    venue: {
      title: "Sede",
      startLabel: "Salida",
      start: "Pista de Remo y Canotaje Virgilio Uribe",
      finishLabel: "Meta",
      finish: "Pista de Remo y Canotaje Virgilio Uribe",
    },
    routeMap: {
      title: "Mapa del recorrido",
      image: null,
      href: null,
      cta: "Ver mapa",
      fallbackTitle: "5K oficial",
      fallbackDescription: "Mapa detallado pendiente de publicación",
    },
    packetPickup: {
      title: "Entrega de kit",
      date: "30 de octubre de 2026",
      time: "11:00 a 17:30 h",
      location: "Periférico Sur s/n, Col. Cuemanco, Alcaldía Xochimilco, CDMX.",
      note: "Presenta identificación oficial y consulta la convocatoria para los lineamientos de entrega.",
    },
    faqs: [
      {
        question: "¿Puedo participar si es mi primera carrera?",
        answer: "Sí. El evento está pensado tanto para runners experimentados como para personas que vivirán su primera noche de carrera.",
      },
      {
        question: "¿La carrera tiene una sola modalidad?",
        answer: "Sí. Esta edición está abierta únicamente en 5K, con cronometraje oficial y operación nocturna.",
      },
      {
        question: "¿La talla de playera se elige al pagar?",
        answer: "Sí. Durante el checkout se solicita la talla de playera disponible para asignar correctamente el kit.",
      },
      {
        question: "¿Hay guardarropa?",
        answer: "Por ahora no se contempla guardarropa en esta edición inaugural. Recomendamos llegar con lo esencial.",
      },
      {
        question: "¿Puedo transferir mi lugar a otra persona?",
        answer: "No. La inscripción es personal e intransferible por control operativo, asignación de kit y seguridad del evento.",
      },
      {
        question: "¿Cuándo recibiré mi confirmación?",
        answer: "Al completar el pago recibirás confirmación por correo con los siguientes pasos, información del kit y documentación necesaria.",
      },
      {
        question: "¿Cuándo estarán disponibles los resultados?",
        answer: "Los resultados oficiales se publicarán dentro de las 24 horas posteriores al evento.",
      },
    ],
    documents: [
      {
        label: "Ver convocatoria",
        href: "assets/events/axolote-night-run/legal/convocatoria.pdf",
      },
    ],
    images: {
      hero: "assets/events/axolote-night-run/gallery/banner_axolote.png",
      heroAlt: "Corredores de Axolote Night Run 2026",
      finalBanner: "assets/events/axolote-night-run/gallery/correr.webp",
      finalBannerAlt: "Comunidad de Axolote Night Run",
    },
    theme: {
      "--event-bg": "#061018",
      "--event-surface": "#0b1b2a",
      "--event-primary": "#00d8c7",
      "--event-secondary": "#dff8ff",
      "--event-accent": "#ff3db7",
      "--event-text": "#f3fbff",
      "--event-muted": "#a9bdca",
      "--event-border": "#21566a",
      "--event-heading-font": "'Sora', 'Inter', sans-serif",
      "--event-body-font": "'Inter', sans-serif",
      "--event-accent-font": "'Inter', sans-serif",
      "--event-hero-decoration": "'✦  •  ✦'",
      "--event-hero-overlay": "linear-gradient(90deg, rgba(4, 13, 25, 0.98) 0%, rgba(4, 13, 25, 0.9) 39%, rgba(4, 13, 25, 0.32) 66%, rgba(4, 13, 25, 0.12) 100%)",
      "--event-card-background": "linear-gradient(160deg, #0d2636, #081723)",
    },
    decorations: {
      snow: false,
    },
    copy: {
      kit: {
        eyebrow: "Tu inscripción incluye",
        title: "Todo listo para la noche de carrera",
        subtitle: "Un paquete completo para llegar listo, correr cómodo y recordar esta primera edición.",
      },
      experience: {
        eyebrow: "Vive la experiencia",
        title: "La noche se corre diferente",
        subtitle: "Ruta, ambiente y comunidad para vivir Axolote Night Run antes de cruzar la salida.",
      },
      modalities: {
        eyebrow: "Axolote Night Run 2026",
        title: "Una sola ruta oficial",
        subtitle: "5K nocturnos con salida por bloques y cronometraje oficial.",
      },
      pricing: {
        eyebrow: "Precios por etapa",
        title: "Asegura tu lugar por etapas",
        subtitle: "La tarifa vigente se confirma automáticamente al continuar al checkout.",
        currentStageLabel: "Etapa vigente",
        completedStageLabel: "Finalizada",
        futureStageLabel: "Próximamente",
      },
      schedule: {
        eyebrow: "Información operativa",
        title: "Tu noche, paso a paso",
        subtitle: "Horarios confirmados para planear tu entrega de kit y llegada al evento.",
      },
      information: {
        faqTitle: "Preguntas frecuentes",
        routePendingLabel: "Mapa detallado próximamente",
        documentsEyebrow: "Documentos oficiales",
        documentsTitle: "Consulta lo esencial antes de correr",
      },
      signoff: "Nos vemos el 31 de octubre para correr la noche con Axolote Night Run 2026.",
    },
    cta: {
      primary: "Inscribirme",
      secondary: "Ver qué incluye",
      finalLabel: "Asegurar mi lugar",
      finalTitle: "Tu noche de carrera empieza aquí",
      finalText: "Asegura tu lugar para vivir la edición inaugural de Axolote Night Run 2026.",
      closed: "Inscripciones cerradas",
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
