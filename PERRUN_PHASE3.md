# Perrun — Fase 3: checkout validado

Repo canónico: `C:\Users\EderArtMo\Documents\Projects\KineticHub`; branch `feature/perrun-2027`.

## Alcance

Checkout local/Preview en Stripe TEST. Se amplía `api/create-checkout-session.js` mediante branching explícito Perrun y `lib/_perrun-checkout.js`. El flujo legacy mantiene validación, promos, OXXO, CAPI, emails y finalizador existentes. No hay migración ni modificación de datos/remotos; el SQL de Fase 1 no cambia.

El formulario se abre en `checkout.html?event=perrun-2027&distance=1K` (también 3K/5K). Sin distancia explícita pide selección, sin fallback Axolote/5K. El catálogo público conserva Próximamente hasta la fase de publicación; no se inventa una landing ni imagen. Un humano, un ticket, uno o dos perros. Peso obligatorio según autorización actual: categoría derivada de 3–10 S, (10,25] M, (25,50] L, (50,80] XL; dos perros sólo S/M. Cambiar a L/XL exige confirmar eliminación explícita del segundo perro y sus datos. PR4 valida humano/nacimiento/WhatsApp/ubicación/playera. Captura intención booleana de grabado; no cobra $35 ni promete elegibilidad gratuita.

## Cotización y precio

`action: quote` en el endpoint existente valida/normaliza los datos y devuelve una cotización firmada HMAC, con nonce UUID, timestamp de servidor y digest HMAC del payload normalizado. No contiene PII; no crea Stripe Session ni fila DB. Usa `CHECKOUT_SUMMARY_SECRET` existente con separación de dominios HMAC. Respuesta no-store. El navegador conserva el token sólo en memoria para reintentos de la misma página; editar payload invalida su caché.

`action: create` exige token válido, mismo payload, antigüedad menor a 15 minutos, etapa actual igual a la cotizada y ventas abiertas. Cambiar de etapa requiere nueva cotización; cierre exacto bloquea. Stage/fechas/precios vienen de `perrun-stage-config.js`: 450/500/550 MXN +180 si dos perros; 630/680/730 respectivamente. Se ignoran categorías, importes, beneficios y posiciones enviados como campos extra del cliente. Perrun rechaza promos. Datos de perros/participante se permiten mediante allowlist.

## Stripe / draft / reintentos

Antes de cotizar o crear, se exige clave `sk_test_`/`rk_test_` y entorno distinto de `VERCEL_ENV=production`; se rechaza una respuesta Stripe LIVE sin operar en esa sesión. Card/OXXO igual al checkout existente. `price_data` dinámico: línea base y segunda línea +180 cuando corresponde; quantity=1 en cada línea y ticket_count=1. No se crean Products/Prices/Payment Links por APIs separadas.

Metadata sólo `flow_version=perrun_v1`, `event_slug=perrun-2027`, `order_ref=<nonce de cotización>` y `ticket_count=1`. Para Fase 4, la relación autoritativa draft/sesión es `perrun_checkout_orders.order_session_id = session.id`; `order_ref` identifica la cotización, no sustituye ese PK. No incluye nombres de perros, teléfonos ni JSON de participantes. Email se entrega al campo normal customer_email de Stripe.

Idempotency-Key se deriva con HMAC del nonce firmado. El mismo token/payload reutiliza la misma Session y el mismo quoted_at. Sólo después de obtener Session TEST abierta con total/currency correctos se llama `prepare_perrun_order` con su firma aplicada de siete parámetros. La RPC conserva owner_phone, dogs/intenciones/etapa/precio y devuelve el draft; validamos session/event/total/finalized_at. No usamos INSERT/UPDATE directo. Sólo tras draft coherente se entrega URL y claim firmado HttpOnly de resumen. Sin Session no hay draft. Si falla prepare o el draft no coincide, no hay URL/cookie y se intenta expirar la Session TEST; un draft que sí persistió ante error de red queda sin finalización y se conserva como trazabilidad. Expiración/estado no abierto requiere nueva cotización; reintento tras incertidumbre de creación utiliza el token original. Nueva cotización (recarga/edición/TTL/etapa) inicia nueva identidad y puede dejar borradores abandonados, nunca consumir posiciones. No se garantiza deduplicación entre pestañas/cotizaciones independientes.

## Webhook: guard mínimo autorizado

Después de verificar firma Stripe, metadata Perrun sale antes del resolver/fulfillment legacy. `checkout.session.completed` pagado y `async_payment_succeeded` devuelven 503/deferred para conservar reintentos sin confirmar una finalización inexistente. Completion unpaid/OXXO y fallos devuelven 200/deferred sin escrituras. `payment_intent.payment_failed` también comprueba metadata de la Session obtenida por lookup. Defensa en resolver legacy rechaza Perrun explícitamente. Nunca ejecuta finalize_paid_order ni finalize_perrun_paid_order, no dorsal/inscripciones/perros/posiciones, emails ni CAPI para esos eventos. En Fase 4 se sustituirá esta rama por handler Perrun y se mantendrá else legacy. Este estado intermedio no se debe desplegar para cobrar: pagos Perrun no tienen fulfillment todavía.

Bug conocido de refunds (resolvePaymentIntentId async sin await) permanece sin cambios por alcance. Destinos kinetichub/memorable-voyage-thin y signing secrets no se alteraron; su revisión/configuración queda para Fase 4. No stripe listen.

## Resumen

`api/checkout-summary?event=perrun-2027&session_id=...` verifica el claim de ESTA Session antes de cualquier consulta; sólo SELECT al draft. Expone humano, distancia, categorías/intenciones de perros y importes base/segundo/total. Estado pending/prepared, sin dorsal, teléfono, posiciones ni beneficio gratuito. El navegador escapa el contenido, mantiene event en URL al retirar session_id para permitir refresh correcto y muestra $0 de grabado cobrado. El contrato legacy permanece intacto. Fase 4 debe ampliar estado de pago/finalización para Perrun.

## Verificación y QA posterior

Suite: ejecutar `node --env-file=.env.local --test tests/*.test.js` o cargar correctamente `.env.local` antes de `npm test`. Build: `npm run build`. Modelo aislado: `node tests/perrun-model.pg.cjs`. Concurrencia nativa de Fase 1 conserva su runner y requiere runtime PostgreSQL local según PERRUN_PHASE1.md. No se carga/configura ni llama Supabase/Stripe remoto para estas pruebas.

Baseline 430/430; la suite final incluye pruebas de precio, categorías, rechazo de payloads, firma/TTL/etapas/cierre, TEST y bloqueo Production, metadata, retries, fallo de prepare, resumen privado, frontend y guard de tres distancias. El adaptador checkout llama la RPC SQL real en PGlite aislado: un draft tras reintento, owner_phone preservado, cero inscripciones/perros/posiciones/finalizaciones.

Preview necesita su propio `CHECKOUT_SUMMARY_SECRET` (>=32), claves Stripe TEST y configuración Supabase correcta; no copiar secretos de Production. La prueba integrada contra servicios se pospone a QA autorizada. No completar pagos ni invocar el finalizador remoto en esta fase.

Resultados locales: Node 516/516 PASS (baseline 430), modelo PostgreSQL aislado 18/18 PASS, PostgreSQL nativo 17.6 con conexiones independientes 19/19 PASS y seis escenarios concurrentes, build PASS. Regresiones Axolote/Cascanueces/OXXO/promos/refunds/BIB/admin/email/CAPI/auth/rate-limit/summary PASS en la suite; el bug conocido de refunds no se corrige ni se declara resuelto. Hash SHA256 de migración Fase 1 intacto: 3bb61a68defced8c6aa5901c3d7787f81853ffb0b63ccfd07e5ef9a5bab74de2. Artefactos public del build restaurados; fuentes y script.min sincronizados. Cero escrituras/remotos y cero objetos Stripe creados.
