# Perrun — anular participación

Estado: migración aplicada en producción como 20261003113402. Implementación local validada; publicación del código pendiente de este cierre.
Migración: `20261003113402_perrun_annul_participation.sql`.

## Auditoría del modelo existente

`inscripciones.registration_status` ya admite active/cancelled/archived. Existen
cancelled_at, cancelled_by, cancellation_reason y cancellation_type, incluyendo
participation_cancelled. La operación legacy libera BIB y escribe bib_releases;
permanece prohibida para Perrun. Archive/delete legacy también excluyen Perrun.
La asignación de BIB Perrun considera el historial pagado, incluso anulados.

Se reutilizan los campos anteriores y se agrega únicamente cancelled_by_user_id
(UUID). No se agregan estados ni otra tabla. El historial append-only existente
perrun_registration_edits guarda old/new, motivo y actor verificado del servidor.
El UPDATE incrementa admin_revision una vez, sin cambiar ownership_revision.

## RPC / seguridad

`admin_annul_perrun_participation(p_order_session_id text,
p_expected_revision bigint,p_reason text,p_admin_user_id uuid,p_admin_email text)`
retorna jsonb. Pública INVOKER, privada DEFINER, search_path vacío; EXECUTE
únicamente service_role. El handler admin obtiene actor del JWT validado, exige
confirm=true, motivo de 3–500 caracteres y revision. Rechaza campos adicionales.

La primera anulación exige paid/active y revision vigente. Un segundo intento
retorna alreadyAnnulled sin modificar el actor, motivo, fecha, historial o revisión.
No hay reactivación. Guardar no envía correo ni llama Stripe.

## Locks / producción

Lock advisory de producción → orden → humano → perros; los borradores afectados
se actualizan bajo el mismo lock que save/close. Se eliminan sólo sus items draft,
se actualiza item_count y avanza su revision. Un cierre concurrente debe recargar.
Si el cierre ganó primero, su item, production_number, snapshot y CSV son intactos.
La lectura del lote añade registration_status actual fuera del snapshot, para
mostrar “Participación anulada después de producción”.

Admin Edit ya rechaza registros inactivos. La preparación de una placa nueva ya
requiere humano activo; el guard usa NOWAIT para no invertir locks de humano/perro.
Anulación espera una preparación ya iniciada y conserva su snapshot. Una preparación
que espera detrás de anulación termina rechazada sin snapshot. Placas preparing o
engraved permanecen intactas.

## Invariantes

Se conserva BIB, pago, importe, fuente, identidad Stripe/manual, orden original,
perros, engraving_sequence/free, counter, promo consumido, reservas V2, pagos
secundarios, snapshots y auditoría previa. No hay refunds ni ledger de BIB liberado.
El CSV operativo conserva registration_status; filtros paid requieren active y
“Anuladas”/“Todos” permiten localizar la historia. CSV cerrado usa sólo snapshot.
El endpoint de reenvío ya consulta paid/active; el renderer y sender existente
también rechazan/omiten inactivos. No se cambia infraestructura email.

## QA / publicación pendiente

Tests usan datos ficticios en PostgreSQL aislado y transporte mock, sin remoto.
Native runner requiere fases previas y flags --admin-distance --annul. Cubre
edición/anulación, cierre/anulación en ambos órdenes, doble admin y placas.
El preflight del schema real pasó sin drift y la migración está aplicada. La nueva UI
se publica con el código de este cierre; no se ejecutan anulaciones reales durante la validación.

## Archivos del patch

Sources: admin-inscripciones.html, admin-perrun-annul-ui.js,
admin-perrun-production-ui.js, api/data.js, lib/admin-perrun-annul.js,
lib/_perrun-operations.js.

SQL: supabase/migrations/20261003113402_perrun_annul_participation.sql.
Documentación: desc/perrun-annul-participation.md.

Tests: tests/helpers/perrun-annul-cases.cjs,
tests/helpers/perrun-annul-fixture.cjs, tests/perrun-annul-http-ui.test.js,
tests/perrun-annul-model.test.js, tests/perrun-annul-native.cjs,
tests/perrun-concurrency.pg.cjs.
