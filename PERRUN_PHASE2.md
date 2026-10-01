# Perrun — Fase 2

Configuración compartida Node/browser: perrun-stage-config.js es la única fuente JS de etapas, precios y cierre; perrun-event-data.js reúne identidad, distancias, contenido confirmado y reglas de perros. lib/_perrun-rules.js consume esta configuración en lugar de duplicarla; sigue siendo un helper local no conectado al checkout. El SQL remoto de Fase 1 permanece intacto y es el contrato de persistencia.

Fronteras exclusivas en America/Mexico_City: preventa antes de 1 noviembre 2026 00:00 ($450); general antes de 1 enero 2027 00:00 ($500); extemporánea antes de 25 enero 2027 16:00 ($550). A las 16:00 exactas está cerrado. Strings sin zona o fechas inválidas se rechazan. El countdown futuro consumirá pricing.salesClose, no una fecha nueva.

Catálogo compartido event-catalog.js: resolveEvent reconoce Perrun y resolveEventSelection exige distancia explícita 1K/3K/5K. Sin default 5K para Perrun. API legacy reconoce el evento y rechaza su checkout antes de crear sesiones. El navegador conserva eventSlug y distancia, marca checkoutEnabled=false y vuelve al catálogo. No se habilita un formulario Perrun. Axolote y Cascanueces conservan sus stages, precios, distancias y flujo existente.

Catálogo visual de eventos consume los datos de Perrun y muestra Próximamente. Perfil consume identidad y distancias propias sin PDFs de otra carrera. No se incorpora a featured hasta que exista una landing real e imagen aprobada; no se crean enlaces rotos. Ningún horario de salida por distancia está publicado.

Reglas: S [3,10], M (10,25], L (25,50], XL (50,80]. Uno o dos perros; dos únicamente si ambos S/M. Segundo perro $180 constante. Grabado $35 opcional después de primeros 300 perros pagados; sólo constantes, sin cálculo de elegibilidad frontend. Kits y entrega 12 febrero 2027 10:00–16:00 modelados; sin emails, admin, webhook, pagos adicionales ni persistencia nueva.

Fase 3 deberá usar la configuración para validar el checkout y calcular importes autoritativamente en servidor, verificando Stripe TEST. SQL/migraciones Fase 1, refunds y BIBs no se modifican. No hay preguntas abiertas que impidan Fase 3; la asociación de horarios de salida con distancias permanece pendiente y no bloquea el checkout.

## Verificación final

Baseline: 400/400. Fase 2: 430/430 (30 nuevos), sin fallos ni skips. Build desde el repo canónico: PASS. Incluye paridad Node/browser, zonas horarias distintas del host, fronteras a milisegundos, selección explícita de distancia, categorías, constante de fees, rechazo de sesiones Stripe Perrun, perfil sin fallback y catálogo visual. script.min.js queda sincronizado con script.js porque las páginas existentes lo cargan. public/ se regeneró para comprobar el build y se restauró después: Vercel lo genera mediante build.js cuando se autorice un deploy futuro. No hubo deploy ni push.
