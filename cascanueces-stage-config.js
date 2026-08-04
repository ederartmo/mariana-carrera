(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }

  root.KineticHubCascanuecesStageConfig = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CASCANUECES_STAGE_CATALOG = [
    {
      key: "preventa",
      label: "Preventa",
      amount: 400,
      period: "1 de agosto, 11:00 h a 31 de agosto, 12:00 h",
      start: "2026-08-01T11:00:00-06:00",
      end: "2026-08-31T12:00:00-06:00",
    },
    {
      key: "acceso_general",
      label: "Acceso General",
      amount: 450,
      period: "1 de septiembre, 11:00 h a 31 de octubre, 12:00 h",
      start: "2026-09-01T11:00:00-06:00",
      end: "2026-10-31T12:00:00-06:00",
    },
    {
      key: "ultimo_minuto",
      label: "Último minuto",
      amount: 500,
      period: "1 de noviembre, 11:00 h a 15 de noviembre, 12:00 h",
      start: "2026-11-01T11:00:00-06:00",
      end: "2026-11-15T12:00:00-06:00",
    },
  ];

  function getCascanuecesStageByDate(date) {
    const targetTime = (date ? new Date(date) : new Date()).getTime();
    const stage = CASCANUECES_STAGE_CATALOG.find((item) => {
      return targetTime >= new Date(item.start).getTime() && targetTime <= new Date(item.end).getTime();
    });

    if (!stage) {
      return {
        key: "closed",
        label: "Inscripciones cerradas",
        amount: null,
        price: null,
        period: "Fuera de una etapa de venta",
        isOpen: false,
      };
    }

    return {
      ...stage,
      price: stage.amount,
      isOpen: true,
    };
  }

  return {
    CASCANUECES_STAGE_CATALOG: CASCANUECES_STAGE_CATALOG.map((stage) => ({ ...stage })),
    getCascanuecesStageByDate,
  };
});