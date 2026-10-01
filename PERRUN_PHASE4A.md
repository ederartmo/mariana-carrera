# Perrun — Fase 4A: propuesta local de estado de pago

## Alcance y fuente de verdad

Repo: `C:\Users\EderArtMo\Documents\Projects\KineticHub`, branch `feature/perrun-2027`, HEAD base `ee029d0`. Sólo migración incremental local, rollback y tests/documentación. No se implementa el handler de Fase 4 ni se modifica código funcional de Fase 3. No se ejecuta db push, migración remota, Stripe listen, pagos, deploy ni push. Las llamadas a Supabase fueron SELECT de catálogos con project_id explícito `uycwzhlcnfijjyzkgkem`; no se consultaron payloads de clientes ni secretos.

Antes de escribir SQL se inspeccionó remotamente la tabla exacta (15 columnas, CHECKs, PK/UNIQUE, ausencia de FK, dos índices UNIQUE, RLS, permisos), los cuerpos/firmas/security/search_path/ACL de prepare_perrun_order y finalize_perrun_paid_order, públicos y privados. Coinciden con Fase 1. Sin policies ni triggers de usuario previos en perrun_checkout_orders; anon/authenticated/service_role no pueden UPDATE directo. Referencia de schema, sin datos, en tests/fixtures/perrun-phase4a-deployed-contract.json; consulta reproducible SELECT en tests/helpers/perrun-phase4a-contract.sql. La comparación normaliza CRLF y usa UTC para deparsing de timestamps. NOT NULL se compara mediante attnotnull porque PostgreSQL 18 también lo representa como constraint separado; esto no oculta diferencias de nullability.

Fase 1 permanece intacta: SHA256 `3bb61a68defced8c6aa5901c3d7787f81853ffb0b63ccfd07e5ef9a5bab74de2`. No se reemplaza ninguna RPC existente, tampoco finalize_paid_order legacy.

## SQL final para revisión

Migración generada localmente mediante Supabase CLI migration new:

`supabase/migrations/20261001113351_perrun_payment_state.sql`

SHA256 de los bytes del archivo: `a2c045bb19cb8bb8492f7087e850b9d613f1e5092baa35ec89c8831d29cef52d`.

No aplicar la referencia JSON ni el rollback como migración. El único SQL forward es el archivo anterior.

## Máquina de estados mínima

Tres columnas en public.perrun_checkout_orders:

| Columna | Tipo/default | Semántica |
|---|---|---|
| payment_status | text NOT NULL DEFAULT 'prepared' | prepared/pending/failed/paid |
| payment_failed_at | timestamptz nullable | Momento DB de primera transición aceptada a failed; no timestamp/payload completo de Stripe |
| payment_state_event_id | text nullable | Evento aceptado de la última transición pending/failed; se conserva como trazabilidad al pasar a paid |

payment_state_event_id no pretende ser un ledger de todos los eventos ni el ID del evento paid. La evidencia de pago sigue siendo finalized_at + payment_intent_id de Fase 1. No se reutiliza payment_intent_id para fallos. No se almacenan failure messages, códigos libres, teléfonos nuevos ni payloads Stripe.

Transiciones: prepared -> pending; prepared/pending -> failed; prepared/pending/failed -> paid exclusivamente cuando el finalizador autoritativo establece finalized_at. Repeticiones no crean UPDATE ni nuevas versiones de fila. pending tardío después de failed es no-op; todo pending/failed tardío después de paid es no-op. No se degrada paid ni se revierte su identidad/timestamp. No hay failed -> prepared/pending, pero failed -> paid válido sigue permitido: el modelo no decide si Stripe permite esa recuperación; el futuro webhook debe comprobar Session/pago autoritativos antes del finalizador.

CHECKs nuevos verifican valores permitidos, paid <=> finalized_at IS NOT NULL y trazabilidad coherente. Los CHECKs de Fase 1, índices, FKs y grants no se alteran. Un trigger BEFORE INSERT/UPDATE refleja paid desde finalized_at y preserva identidad/historial ya finalizado. El trigger no duplica finalización, no asigna inscripciones/dorsales/perros/posiciones ni toca otras tablas. Se actualiza únicamente payment_status de las órdenes ya finalizadas al aplicar el backfill; los demás campos permanecen intactos. Drafts antiguos no finalizados quedan prepared porque antes no existía evidencia persistida de pendiente/fallo.

## RPC y seguridad

Nueva RPC pública: `record_perrun_payment_state(p_order_session_id text, p_stripe_event_id text, p_payment_status text) RETURNS public.perrun_checkout_orders`. Acepta únicamente pending/failed; IDs event con formato evt_ y orden/session inequívoca existente. Una única RPC cubre ambos estados; no hay RPC adicional de paid ni de fallo separada.

Public wrapper SECURITY INVOKER, search_path=''. Implementación kinetic_perrun_private SECURITY DEFINER, search_path=''; tablas y funciones sensibles calificadas. Sólo EXECUTE service_role en ambas funciones; PUBLIC/anon/authenticated revocados explícitamente dentro de la transacción. RLS permanece habilitado; service_role mantiene SELECT y no obtiene UPDATE/INSERT/DELETE directo. Trigger SECURITY INVOKER y sin EXECUTE público/browser. La RPC de servidor presupone firma Stripe verificada y validación de Session/draft por el futuro handler; no recibe claims de navegador.

Locks: mismo advisory xact lock Perrun que el finalizador, después SELECT draft FOR UPDATE. Se respeta orden event -> draft; esta RPC no bloquea ni modifica contador, inscripciones, perros o pagos extra. Serializa también pendientes/fallos de distintas órdenes del mismo evento, coherente con Fase 1. Mantiene un solo registro de transición: un evento repetido o un segundo evento del mismo estado es no-op, no cambia timestamp/event ID/xmin. Un mismo ID reutilizado para una transición contradictoria tampoco cambia el estado ya aceptado.

## Compatibilidad e impacto de aplicación futura

Los cuerpos, firmas, SECURITY, search_path y ACL existentes de prepare/finalize no cambian. prepare devuelve el composite con columnas adicionales y preserva el estado ya registrado en reintentos. finalize acepta prepared/pending/failed; su UPDATE ya existente dispara el trigger y deriva paid transaccionalmente. El hotfix legacy y owner_phone siguen intactos. Axolote/Cascanueces, pricing, checkout, webhook, emails/CAPI y datos de inscripciones no se alteran.

BEGIN/COMMIT, lock_timeout=5s, statement_timeout=30s. ALTER requiere ACCESS EXCLUSIVE sólo sobre perrun_checkout_orders; el test con lectura concurrente verifica ese lock y rollback completo al timeout, sin ALTER/AccessExclusive en inscripciones. Backfill de paid y CHECKs escanean drafts; duración depende de volumen/contención. En PostgreSQL nativo aislado con datos sintéticos la aplicación medida fue 6 ms, sin garantía para remoto. No se añaden índices porque las búsquedas usan PK order_session_id. RLS/permisos de lectura previos se mantienen.

Cambios relevantes del changelog actual revisados: esta propuesta no usa ltree, cifrado PGP legacy, GiST de floats ni operadores personalizados. Referencias de DDL/locks: https://www.postgresql.org/docs/current/ddl-alter.html y https://www.postgresql.org/docs/current/explicit-locking.html. La verificación remota futura debe volver a comprobar identidad/schema antes de aplicar; esta fase sólo entrega SQL validado localmente.

## Rollback

Archivo independiente: desc/perrun-phase4a-payment-state-rollback.sql, marcado PRE-LAUNCH ONLY. Bloquea drafts y rechaza el rollback si existe pending/failed, payment_failed_at o payment_state_event_id, también después de recuperación a paid. Sin uso de estados 4A, retira exclusivamente RPC/trigger/checks/columnas nuevos; preserva todas las órdenes, pagos, perros, contador y finalizadores de Fase 1, incluidos pagos preexistentes. No usa CASCADE ni DELETE/TRUNCATE de datos.

POST-LAUNCH: desactivar/retroceder consumidores de estado si hace falta; conservar schema/historial y corregir hacia adelante. No ejecutar rollback destructivo ni borrar trazabilidad. Una migración fallida se revierte transaccionalmente; un archivo con historia de migración aplicada necesitará manejo explícito de esa historia en un procedimiento futuro aprobado.

## Pruebas reproducibles

Cargar .env.local antes de npm test; por ejemplo `node --env-file=.env.local --test tests/*.test.js`. Nuevos tests usan PGlite aislado, sin conexiones remotas. Total suite: 540/540 PASS, baseline 516; 24 pruebas 4A de schema real/compatibilidad/estados/idempotencia/cero efectos/permisos/rollback. Build PASS.

Native PostgreSQL 17.6: runner de Fase 1 conserva sus 19 checks sin cambios y añade extensión opcional `--payment-state`. Comando: `node tests/perrun-concurrency.pg.cjs <runtime-prefix-absoluto> <directorio-temporal-absoluto> <evidence.json> --payment-state`. Usa clúster temporal localhost, roles/órdenes sintéticos, dos backends independientes; no carga .env ni conecta Supabase. 36/36 PASS: 19 Fase 1 +17 4A. Prueba contención real mediante pg_blocking_pids, fallos iguales/distintos, pending/failed, failed/paid en ambos órdenes, doble finalización desde failed, fronteras 298/297, rollback transaccional inyectado, permisos y rollback seguro. Los seis escenarios concurrentes originales pasan y se comprueban carreras adicionales bajo 4A. Clúster detenido al finalizar.

Todos los tests de finalización se ejecutan sólo en PostgreSQL aislado, nunca se invoca una RPC remota. No hubo escrituras Supabase/Stripe, pagos, listener, despliegue ni aplicación remota. SAFE_TO_APPLY_REMOTE=YES para revisión técnica del archivo/hash citado; no es autorización para ejecutarlo.
