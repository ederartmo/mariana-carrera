# Perrun Payment V2 — implementación local, sin activar ni aplicar remotamente

Repo canónico: `C:/Users/EderArtMo/Documents/Projects/KineticHub`. Migración nueva: `supabase/migrations/20261002232521_perrun_payment_v2.sql`. Las migraciones anteriores no cambian. No se han realizado pagos, envíos reales, escrituras SQL remotas, commits, push ni deploy durante esta implementación.

## Autoridad y modelo

PostgreSQL fija tarifa, segundo perro, beneficio por perro, recargo y total. JS valida identidad/datos, firma la cotización y comunica con Stripe; no decide ni redistribuye beneficios. El total es tarifa de etapa + $180 si hay segundo perro + $35 por cada grabado solicitado sin slot reservado. No se usa `engraving_sequence <= 300` para V2.

Tablas nuevas, con RLS sin políticas públicas y sin INSERT/UPDATE/DELETE para anon, authenticated ni service_role:

| Tabla | Identidad / restricciones | Propósito |
|---|---|---|
| perrun_checkout_reservations | UUID; attempt_id único; payload y SHA256; versión 2; MXN; total=sum(componentes); Session/order únicos; transiciones y términos inmutables | Cotización y reserva recuperable |
| perrun_checkout_reservation_dogs | PK reservation_id/dog_index; índice 1/2; payload canónico; surcharge 0/3500 según petición y slot | Beneficio y precio fijados por perro |
| perrun_promo_slots | PK event_slug/slot, rango 1..300; 300 filas; asignación única reserva/perro; FK; consumed irreversible | Inventario promocional separado de la secuencia definitiva |

Los constraints diferidos comprueban coherencia de slot, perro, payload y componentes al completar la transacción. Las FKs usan RESTRICT. Todos los perros consumen slot si existe, aunque no soliciten grabado. El inventario inicial consume hasta min(contador histórico,300), sin modificar registros históricos. Los drafts V1 no finalizados retienen conservadoramente capacidad; un estado DB failed no demuestra por sí solo que Stripe ya no pueda cobrar.

Cambios a tablas existentes: órdenes reciben pricing_model_version (default 1), reservation_id, second_dog_amount_cents y engraving_amount_cents. Perros reciben pricing_model_version (default 1), promo_slot y engraving_state. Se reemplazan los CHECKs monetario/de grabado por ramas explícitas V1/V2, conservando la semántica V1. No se alteran columnas de inscripciones ni sus constraints. No hay renombrados, borrados ni backfill de importes, BIBs, perros o snapshots.

RPCs nuevas, wrappers INVOKER públicos hacia implementaciones DEFINER privadas con search_path vacío; sólo service_role tiene EXECUTE:

- reserve_perrun_checkout_v2: evento lock → reserva; fija todo en una transacción, con prioridad dog_index 1.
- begin_perrun_checkout_v2: valida payload/reserva y fija la creación Stripe.
- attach_perrun_checkout_v2: vincula exclusivamente la Session real y su expires_at; crea draft V2, sin BIB.
- record_perrun_reservation_v2: pending o release controlado; nunca recicla consumed.
- finalize_perrun_reservation_v2: evento lock → reserva → orden → humano → contador; consume beneficio, crea un humano/BIB y perros/secuencias, atómicamente.

El mutex es el existente `pg_advisory_xact_lock(123456789, hashtext('perrun-2027'))`, compartido con V1. No se bloquean Axolote/Cascanueces mediante este mutex. Se conservan las reglas de contacto y snapshots. Sólo se amplía guard_plate_snapshot para aceptar included_paid; el finalizador Perrun V1 añade una precondición de versión para rechazar órdenes V2. finalize_paid_order genérico no se reemplaza en esta migración.

## Flujo Stripe

Validar → reservar/cotizar → mostrar desglose/beneficios y confirmar total → Session con price_data dinámico → adjuntar ID real → webhook firmado + lectura autoritativa de Stripe → finalizador V2 → confirmación existente.

Metadata: flow_version=perrun_v2, event_slug, reservation_ref y ticket_count=1. Sin PII. La única Session contiene inscripción, segundo perro y grabado incluido. No se crean Products/Prices permanentes ni un checkout de grabado secundario V2. El checkout secundario histórico rechaza perros V2; las RPCs históricas también los rechazan por elegibilidad.

El browser conserva identidad del intento por digest del formulario (sin guardar PII); Web Locks serializa su creación entre pestañas cuando está disponible. Reintentos con el mismo UUID/payload obtienen la misma reserva; UUIDs diferentes, incluso para el mismo email, siguen siendo compras independientes. Sólo una respuesta explícita de cotización vencida/liberada permite renovar el intento. Un timeout/503 conserva el intento.

## Máquina de estados y recuperación

reserved → creating → open → pending → consumed; open también puede ir directamente a consumed. Manual: reserved → consumed. reserved, creating, open y pending tienen rutas controladas a released; la RPC prohíbe liberar creating sin Session conocida. consumed/released son terminales.

- Quote sin comenzar: 5 minutos. Una nueva reserva recupera automáticamente sólo quotes reserved vencidas, sin Session/creación Stripe.
- Al comenzar: expires_at de tarjeta explícito a 35 minutos, preservado entre reintentos; se persiste el expires_at real devuelto por Stripe y se verifica contra el solicitado.
- Antes de vincular: Stripe usa la misma idempotency key `perrun-v2/<reservation UUID>` y parámetros persistidos. Un timeout no libera slots. El webhook puede recuperar la vinculación a partir de metadata verificada.
- Un retry no crea otra Session si ya existe una vinculada. Stripe puede recuperar una creación incierta por la misma key durante su retención. Después de 23 horas, o al agotarse la ventana mínima de creación, sólo se busca la Session existente mediante lecturas paginadas y metadata/importe verificados. Si no se puede demostrar una Session única, se bloquea la creación; no se intenta crear otra Session con la misma intención.
- Si la Session no se creó y la ventana de 30 minutos mínima de Stripe ya no permite crearla, se conserva creating para conciliación. No se inventa una expiración nueva ni se libera capacidad mientras la existencia del pago sea incierta. Para ese caso excepcional se necesita consulta operativa de Stripe antes de cualquier release/reinicio.
- No hay liberación de open/pending por reloj local. El webhook relee Session y PaymentIntent. Sólo Session expired, o complete con async failure y PaymentIntent terminal, permite liberar. Un fallo con Session abierta no libera.
- Un delivery tardío con Stripe realmente paid usa el importe/beneficio original; un duplicado no genera otro humano, BIB ni secuencia. Un pago que aparezca después de un release confirmado se devuelve a conciliación (503), sin cobrar más ni reutilizar silenciosamente un slot ya asignado.
- No se instala un cron ni se modifica el destino Stripe en esta fase. Antes de activar debe comprobarse entrega de checkout.session.expired y async failure/success; si no hay delivery, se retiene capacidad hasta conciliación, nunca se sobresuscribe.

## OXXO

Se conservan card/oxxo mediante payment_method_types del contrato Checkout del SDK instalado, sin cambiar configuraciones remotas. allowed_payment_method_types corresponde al contrato PaymentIntent/SetupIntent. expires_after_days=1 explícito. La expiración del Checkout no es la del voucher. Se persiste expires_after real del voucher; mientras PaymentIntent esté requires_action/processing se retiene el beneficio, incluso pasado el reloj local. Paid tardío finaliza con el precio original; failed/expired se libera exclusivamente según el estado real de Stripe. No se completó ningún voucher/pago real durante esta fase.

## Transferencia manual

Admin autenticado solicita quote/reserva con manualPaymentId UUID estable. Ve tarifa, segundo perro, beneficios y grabado $0/$35/$70. Debe capturar/confirmar el monto realmente recibido, exactamente igual al quote; la UI y backend rechazan diferencias. La operación SQL única consume reserva y registra/finaliza manual_transfer con ID manual real, sin Session, PaymentIntent ni Event ficticios. Repetirla conserva identidad/BIB/dogs. La confirmación usa el transporte existente y su protección QA.

## Compatibilidad y estado público

V1 se finaliza exclusivamente con su finalizador histórico. V2 con finalize_perrun_reservation_v2. Refunds conservan slot consumed, secuencias y contador. Los estados V2 son free, included_paid y not_requested; no se ofrece pago secundario. Resumen, perfil/admin/CSV y email muestran incluido en la inscripción para el grabado cobrado. Admin Edit V1 puede corregir datos autorizados sin modificar la reserva/ledger financiero ni snapshots ya iniciados.

Los lectores tienen una lectura V1 del mismo DB cuando faltan columnas V2 y el feature flag no está activo. No cambian URL ni credenciales, ni conectan con un DB alternativo. La activación con schema incompleto falla cerrada.

## Dos drafts históricos — auditoría sólo lectura

| Session | Creación DB UTC | Estado DB | Estado Stripe LIVE | Finalizador |
|---|---|---|---|---|
| cs_live_b1wj2Rq7kvGlmxDOdBOLc8q5q74vLwakL5BnGrN6YhAgCCf40EswLZSDlT | 2026-10-01 20:01:11.35425 | prepared, sin finalized_at/PaymentIntent | UNKNOWN | V1 |
| cs_live_a1jOcrljdxsRiDW2E60hOOlj4KdfSXyPBKjflOeJd4pZIU3ZRMip5WXHHd | 2026-10-02 12:58:41.63636 | prepared, sin finalized_at/PaymentIntent | UNKNOWN | V1 |

El conector disponible sólo expone el sandbox TEST. No se consultaron ni cancelaron Sessions LIVE desde una cuenta incorrecta. Ambas se consideran potencialmente pagables y conservan V1/capacidad protegida. Hace falta verificar su estado LIVE en la cuenta correcta antes de activar; no asumir que expiraron por su antigüedad.

## Validación y activación futura

Pruebas nuevas: fronteras/monetarios, precio por etapa/cierre, datos inmutables, slots sin grabado, orden de pago distinto al de reserva, varios intents/mismo email, ownership/cotización firmada, creación incierta, vinculación recuperada por webhook, OXXO pending/paid/failure/expiry, duplicados, refund, main summary/email mock/CSV/profile, permisos, Admin Edit/placas e histórico V1. PostgreSQL nativo usa conexiones independientes y evidencia de bloqueo real; no toca la base QA existente ni CRM.

Flag server-side opt-in: `PERRUN_PAYMENT_V2=1`. Ausente, `0` o cualquier otro valor mantiene las cotizaciones nuevas en V1. No se editó `.env.local`, `.env.qa.local` ni variables Vercel. Las reservas V2 y las cotizaciones V1 firmadas conservan su versión al reintentar aunque cambie el flag; el webhook verifica la versión persistida y no consulta el flag. Un fallo de lectura nunca deriva a otra versión. Local QA requiere Stripe TEST, Supabase localhost y mail mock; el launcher admite la selección explícita del flag. La DB QA debe tener la migración revisada antes de probar V2; esta tarea no la aplica a esa DB.

Preflight/rollout, 2 octubre 2026: esquema de producción verificado sin drift; aplicada exclusivamente la migración de hash `c2d8ec59336b13c726646eae10e2ff14fd7a522122bccdb3c146e7a5ed432b9e`, registrada remotamente como `20261002232521_perrun_payment_v2`. El archivo local está reconciliado como `20261002232521_perrun_payment_v2.sql`, con el SQL y su checksum intactos; no se creó una segunda migración. Verificación posterior: 5 órdenes pagadas, 2 prepared, BIBs 001–005, sequences 1–5 y contador 5; hashes históricos intactos. Inventario: 5 slots históricos consumidos, 295 disponibles, 0 reservados y ninguna reserva V2. V2 no fue activado ni desplegado. Antes de activación, revisar en Stripe LIVE las dos sesiones prepared y la suscripción/entrega de `checkout.session.expired`; el conector disponible sólo tiene acceso TEST.

Pruebas: `node --env-file=.env.qa.local --test tests/*.test.js`; build: `node build.js`. Concurrencia: runner existente perrun-concurrency.pg.cjs con --payment-state --webhook --engraving --engraving-flow --manual --admin-edit --payment-v2 y rutas a cluster/evidencia desechables. Resultados finales y hash se encuentran en el reporte de entrega; artefactos técnicos permanecen ignorados en .qa/.

Pendientes operativos, sin cambio de arquitectura aprobado: conciliar manualmente cualquier creación Stripe incierta fuera de su ventana, y verificar suscripciones/entrega de expiración antes de activar. No implementar todavía production_number, lotes, anulación ni eliminación de pruebas.

## Resultado local final — 2 octubre 2026

| Verificación | Resultado |
|---|---|
| Suite Node antes | 947/947 PASS |
| Suite Node final | 992/992 PASS (45 casos adicionales) |
| PostgreSQL 17 nativo | 221/221 PASS, incluye 15 comprobaciones V2 |
| Concurrencia real | 44 escenarios PASS; 8 adicionales V2 |
| Build | PASS, node build.js |
| diff --check | PASS |
| Regresiones | V1, admin/edit/contacto/snapshots, Axolote/Cascanueces y grabado histórico PASS |
| Migraciones anteriores modificadas | Ninguna |
| Credenciales locales en cambios | Ninguna detectada |
| SQL/escrituras remotas | 0; sólo auditoría previa autorizada de lectura |
| Pagos y emails externos | 0; proveedores MOCK en las pruebas |
| Git | main; HEAD c10d760; sin staging ni commit/push/deploy |

SHA256 de la migración: `c2d8ec59336b13c726646eae10e2ff14fd7a522122bccdb3c146e7a5ed432b9e`. Coincide con el SQL ejecutado por PostgreSQL nativo. El servidor aislado de pruebas quedó detenido. La DB QA existente y CRM no se modificaron. Los outputs generados public/ quedaron fuera del diff, con respaldo ignorado en .qa/; script.min.js es output del build, sin implementación manual paralela.

Archivos del cambio:

- Config/launcher: .env.example; scripts/perrun-qa.cjs.
- Backend: lib/_perrun-payment-v2.js; lib/_perrun-payment.js; lib/_perrun-checkout.js; lib/_perrun-manual-transfer.js; lib/_perrun-engraving.js; lib/_perrun-operations.js.
- UI: checkout.html; perrun-checkout.js; script.js; script.min.js (generado); succes.html; admin-inscripciones.html; admin-perrun-manual-ui.js.
- SQL/documentación: supabase/migrations/20261002232521_perrun_payment_v2.sql; desc/perrun-payment-v2.md.
- Tests/helpers: tests/helpers/perrun-payment-v2-fixture.cjs; tests/perrun-payment-v2-model.test.js; tests/perrun-payment-v2.test.js; tests/perrun-payment-v2-native.cjs; tests/perrun-concurrency.pg.cjs; tests/perrun-checkout.test.js; tests/perrun-manual-transfer-ui.test.js.

No se necesita otra decisión de negocio para la implementación local. El preflight y la aplicación del schema ya quedaron autorizados y completados según el registro de rollout anterior. Antes de activar, confirmar el estado LIVE de los dos drafts, revisar suscripciones/entrega de expiraciones y autorizar explícitamente la activación. No se publicó código ni se activó V2.
