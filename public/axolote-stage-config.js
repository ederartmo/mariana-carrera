(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }

  root.KineticHubStageConfig = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const AXOLOTE_STAGE_CATALOG = [
    {
      key: "early",
      label: "Etapa Early Bird",
      displayName: "Early Bird",
      amount: 480,
      period: "Hasta 31 de mayo de 2026",
      start: "2025-01-01",
      end: "2026-05-31",
    },
    {
      key: "regular",
      label: "Etapa Regular",
      displayName: "Regular",
      amount: 550,
      period: "1 de junio al 31 de julio de 2026",
      start: "2026-06-01",
      end: "2026-07-31",
    },
    {
      key: "extemporanea",
      label: "Etapa Extemporánea",
      displayName: "Extemporánea",
      amount: 600,
      period: "1 de agosto al 10 de octubre de 2026",
      start: "2026-08-01",
      end: "2026-10-10",
    },
  ];

  function toDateOnly(date) {
    const value = new Date(date);
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function parseIsoDate(value) {
    const parts = String(value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      return null;
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isDateInRange(date, startIso, endIso) {
    const current = toDateOnly(date);
    const start = parseIsoDate(startIso);
    const end = parseIsoDate(endIso);
    if (!start || !end) return false;
    return current >= start && current <= end;
  }

  function normalizeStage(stage) {
    return {
      key: stage.key,
      label: stage.label,
      displayName: stage.displayName,
      price: stage.amount,
      amount: stage.amount,
      period: stage.period,
      isOpen: true,
    };
  }

  function getAxoloteStageByDate(date) {
    const targetDate = date ? new Date(date) : new Date();

    for (const stage of AXOLOTE_STAGE_CATALOG) {
      if (isDateInRange(targetDate, stage.start, stage.end)) {
        return normalizeStage(stage);
      }
    }

    return {
      key: "closed",
      label: "Inscripciones cerradas",
      displayName: "Inscripciones cerradas",
      price: null,
      amount: null,
      period: "Convocatoria cerrada",
      isOpen: false,
    };
  }

  function getAxoloteStageCatalog() {
    return AXOLOTE_STAGE_CATALOG.map((stage) => ({ ...stage }));
  }

  return {
    AXOLOTE_STAGE_CATALOG: getAxoloteStageCatalog(),
    getAxoloteStageByDate,
  };
});