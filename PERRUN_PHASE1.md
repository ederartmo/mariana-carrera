# PERRUN — RECONCILIACIÓN + FASE 1B

Validación técnica local completada. No autoriza ni ejecuta una aplicación remota. No hubo migraciones remotas, CREATE OR REPLACE remoto, RPCs de negocio remotas, deploy, push, commit, Stripe remoto ni cambios a datos reales. Lecturas remotas: exclusivamente catálogos del proyecto uycwzhlcnfijjyzkgkem.

## finalize_paid_order

**Deployed vs local before:** misma firma, diferencia material: faltaba v_is_legacy_order y el gate del hotfix legacy.

**Local after:** desc/sql-finalize-paid-order-pr4.sql contiene el cuerpo de la definición desplegada completa, conservado exactamente, con una advertencia READ-ONLY / DO NOT APPLY fuera de ese cuerpo. Una nueva lectura de catálogo confirmó igualdad con producción; no se ejecutó la función remota. Es la referencia canónica local, NO una migración que deba repetirse en producción. Su SHA256 es `964ffc7378859cab597ec006f753ce806918181e1ce4671f03a88aa5bfff5c01`.

**Behavior preserved:** cuando existe una fila previa de la orden cuyos birth_date, whatsapp, state y borough son todos NULL, el hotfix pone esos cuatro valores en NULL para TODOS los participantes temporales y omite el gate PR4 estricto. Se conservan NULL incluso si el webhook aporta valores válidos. El código explica que esto permite finalizar órdenes pendientes anteriores a PR4; nuevas órdenes mantienen validación estricta. No se mejoró ni eliminó el hotfix.

**Tests added:** ocho regresiones SQL en npm test: orden moderna con los cuatro campos, legacy con valores entrantes válidos, legacy sin PR4, orden mixta donde una fila legacy activa el gate para toda la orden, rechazo estricto de nueva orden incompleta, reintento que preserva todos los campos, conflicto de PaymentIntent y compatibilidad por evento. Otras ocho pruebas verifican teléfono/snapshot Perrun. Se ejecutan realmente en PostgreSQL embebido; no son mocks del finalizador.

Firma preservada:

```sql
public.finalize_paid_order(
  p_order_session_id text, p_event_slug text, p_distance text,
  p_amount_paid numeric, p_buyer_email text, p_payment_intent_id text,
  p_stripe_event_id text, p_participants jsonb
) RETURNS SETOF inscripciones
```

SECURITY DEFINER; search_path=pg_catalog,public. ACL real leída: postgres y service_role tienen EXECUTE; PUBLIC/anon/authenticated no lo reciben. pg_get_functiondef no incluye ACL: el fixture reproduce explícitamente esos permisos; la referencia no debe usarse como bootstrap autónomo de una base nueva. Escribe inscripciones y tabla temporal de participantes; no escribe tablas Perrun. Dorsal e índices de ticket, estados, detección estructural e idempotencia siguen siendo los del cuerpo real. La preparación de una orden Perrun y su finalización pagada son RPCs nuevas separadas y aún no integradas al webhook.

## Perrun owner phone strategy

**Source:** perrun_checkout_orders.owner_phone, capturado de participant.whatsapp al crear el draft de esa sesión. Requiere formato +52 y diez dígitos nacionales. Se quita whatsapp del JSON participant al guardarlo: el teléfono existe una sola vez en el draft. Al llamar al finalizador se reconstruye su payload desde esa columna, sin cambiar la firma existente. Cambiar el teléfono en un reintento de la misma sesión provoca conflicto, no una sustitución silenciosa.

**Snapshot timing:** registration_dogs mantiene dog_name_for_plate, owner_phone_for_plate y plate_started_at en NULL hasta la primera transición a preparing. El trigger privado guard_plate_snapshot copia el nombre actual del perro y el owner_phone de su orden, fija el instante de preparación y rechaza modificaciones posteriores de esos tres campos. No se agregó una API ni una RPC pública de preparación.

**Why it survives legacy NULL behavior:** el finalizador legacy sólo escribe inscripciones; no toca el draft Perrun. La prueba creó una inscripción pending Perrun legacy, confirmó que los cuatro campos quedaron NULL, modificó posteriormente whatsapp y email de la persona y demostró que la placa usa/conserva el teléfono capturado para esa orden.

La primera preparación exige inscripción paid/active y grabado solicitado. Si la posición no es gratuita, exige un add-on paid. No se crean pagos adicionales reales ni sesiones Stripe. Cancelación o ausencia de solicitud impiden comenzar. Las transiciones operativas futuras se integrarán mediante backend autorizado; service_role no recibe UPDATE directo sobre perros.

## Regression

**Axolote:** contrato y comportamiento actual conservados; finalización y dorsal por evento probados con el cuerpo reconciliado.

**Cascanueces:** igual; sus distancias existentes 5K/10K permanecen permitidas.

**Webhook:** api/stripe-webhook.js no cambió. Sigue llamando finalize_paid_order con los mismos ocho parámetros. Sus tests de OXXO, email, archivado/reactivación, refunds y reintentos siguen pasando. El módulo de reglas Perrun aún no se importa desde producción.

**Dorsales:** no se cambió el algoritmo existente ni sus índices. El wrapper Perrun crea exactamente un ticket humano y un dorsal; cada perro obtiene únicamente su propia posición de grabado. El counter no cuenta tickets humanos.

Refund/idempotencia existentes no se modificaron. No se eliminaron ni cambiaron cupones de carreras existentes. Perrun no acepta cupones; checkout principal continúa diseñado como base de etapa + $180 por segundo perro, sin $35 anticipados.

## Tests

**Node:** 400/400 PASS, cero fallos, cero skips; antes de esta reconciliación eran 384. Se cargó .env.local mediante Node sin imprimir valores. @electric-sql/pglite=0.5.8 se agregó sólo como devDependency fijada, con lockfile.

**Build:** PASS de npm run build ejecutado desde C:\Users\EderArtMo\Documents\Projects\KineticHub, con versión del HEAD cca961af8a0e6207eae5f2afa698cd894403844e. Se verificó la salida public/index.html y se restauraron los archivos generados originales; no forman parte del commit de Fase 1.

**PostgreSQL nativo:** 19/19 comprobaciones PASS, versión 17.6, igual a la del proyecto real. Incluyen regresiones legacy/modernas, migración, locks, timeout, rollback, permisos reales y seis ejecuciones de concurrencia. El servidor temporal estaba limitado a 127.0.0.1 y se detuvo correctamente al finalizar. No se usó PGlite como prueba de concurrencia.

## Real concurrency

| Scenario | Result |
|---|---|
| A — 298 + orden de 2 perros y orden de 1 perro | PASS en ambos órdenes de adquisición del lock. Exactamente 299/300/301, sin duplicados/huecos; sólo <=300 gratuitas. |
| B — la misma orden simultáneamente | PASS: mismos IDs/perros/posiciones, una persona, dos perros y un único incremento del counter. |
| C — 297 + dos órdenes distintas de 2 perros | PASS en ambos órdenes de adquisición: primera obtiene 298/299 y segunda 300/301, por dog_index 1/2; sin duplicados/huecos. |
| D — fallo deliberado después de escribir persona/perros/counter | PASS: rollback íntegro; orden que esperaba obtiene 299. Reintento de la fallida obtiene 300/301; no se perdió ni consumió una posición por el fallo. |

Dos conexiones independientes con pg_backend_pid distintos. El harness verifica mediante pg_stat_activity/pg_blocking_pids que el segundo backend entra al RPC y espera realmente el advisory lock del primero antes de su commit. Un observador separado comprueba que el contador no revela cambios sin commit. La evidencia JSON incluye PIDs, locks y posiciones por perro.

Orden de locks de finalización: advisory transaccional (123456789,hashtext('perrun-2027')) → draft FOR UPDATE → finalizador existente → counter FOR UPDATE. El advisory reentrante coincide con la clave por evento del finalizador desplegado. La serialización hace atómica la asignación; restricciones UNIQUE añaden defensa contra duplicados. No hay COUNT(*)+1 ni reserva en Checkout.

La primera orden en adquirir el lock tiene prioridad; no hay prioridad fija por ID de orden, creación de Checkout ni por conexión A. dog_index define el orden dentro de la orden. Es el orden serializado de procesamiento de confirmaciones; no se reordena retroactivamente por timestamps Stripe ni se reciclan posiciones tras refund/cancelación.

## Migration validation

Schema de prueba: réplica de todas las columnas/tipos/nullability/defaults, constraints e índices de inscripciones obtenidos por lectura de catálogo, más el finalizador reconciliado. Una lectura final confirmó tipos/nullability/definiciones de constraints y que todas las constraints existentes estaban validadas. No se copió ninguna fila real. No se pretende que este fixture reproduzca toda la plataforma Supabase: sólo las dependencias de esta migración/finalizador; roles y permisos nuevos sí fueron ensayados.

Se corrigieron problemas reales que el fixture mínimo de Fase 1 no podía detectar:

- La PK real es (id,email), no id solo. registration_dogs usa FK compuesta (registration_id,registration_email), ON DELETE RESTRICT y ON UPDATE CASCADE. Su UNIQUE por persona incluye ambos campos. Esto preserva cambios autorizados de email sin modificar posiciones ni snapshot.
- inscripciones_distance_chk excluía Perrun. La migración LOCAL amplía únicamente esa CHECK con Perrun 1K/3K/5K, conservando exactamente las condiciones de Axolote/Cascanueces y distance NULL. No se renombra ninguna columna ni se cambian datos.
- El preflight compara la firma/cuerpo revisado del finalizador y la definición anterior de esa CHECK: si hay drift, aborta. Para Windows normaliza sólo CRLF→LF en el hash del cuerpo; no oculta diferencias de código. Esto se comprobó con una referencia local en CRLF.

La CHECK ampliada se agrega NOT VALID para evitar un escaneo del histórico. Comprueba inmediatamente INSERT/UPDATE nuevos; las filas previas ya satisfacían la CHECK anterior más restrictiva. Su validación completa puede hacerse después, separadamente y sólo con autorización. No se altera el finalizador real ni se incluye un CREATE OR REPLACE de él dentro de la migración Perrun.

### Tablas y permisos

| Tabla | PK / FKs | Unicidad e índices | CHECKs principales |
|---|---|---|---|
| perrun_checkout_orders | PK order_session_id; sin FKs | PaymentIntent único | Evento/distancia, una persona JSON sin whatsapp duplicado, teléfono válido, perros/pesos/S-M para dos, etapa/calendario/cierre, MXN, total base+segundo perro, par finalización/intento |
| perrun_paid_dog_counter | PK event_slug; sin FKs | Índice PK | Evento Perrun; last_sequence>=0 |
| registration_dogs | PK UUID; FK compuesta a inscripciones y FK a draft | Posición única; UNIQUE orden/dog_index; UNIQUE persona compuesta/dog_index | Nombre, peso/categoría, índice, beneficio <=300, obligación/importe de grabado, estados y snapshot coherente |
| perrun_engraving_payments | PK UUID; FK dog_id RESTRICT | Sesión/intento únicos; UNIQUE parcial dog_id para paid/refunded; índice dog_id | 3500 centavos, MXN, estados/fecha/PaymentIntent coherentes |

FK de perros→draft también RESTRICT. No hay DELETE en cascada de historial. Las cuatro tablas habilitan RLS sin políticas públicas. PUBLIC/anon/authenticated carecen de SELECT/INSERT/UPDATE/DELETE. service_role recibe sólo SELECT directo y EXECUTE de los dos RPCs; sus escrituras ocurren por las implementaciones privadas DEFINER. Owner/superuser conserva autoridad SQL. No se conceden escrituras directas de counter, perros, drafts ni add-ons.

### RPCs y trigger

| Objeto | Seguridad / retorno | Escrituras / locks | EXECUTE |
|---|---|---|---|
| public.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz) | INVOKER; devuelve draft; implementación privada DEFINER | Inserta draft inmutable; conflicto PK y comparación de payload/teléfono; cero posiciones | anon NO; authenticated NO; service_role YES |
| public.finalize_perrun_paid_order(text,text,text,integer,text) | INVOKER; SETOF registration_dogs; implementación privada DEFINER | Inscripción humana por finalizador existente, perros, counter y draft atómicos; locks descritos | anon NO; authenticated NO; service_role YES |
| kinetic_perrun_private.guard_plate_snapshot() | INVOKER, retorno trigger; no RPC pública | Snapshot sólo al comenzar preparing; bloquea persona para verificar estado; lee teléfono original de orden; congela snapshot | PUBLIC/anon/authenticated/service_role sin EXECUTE directo; lo activa una futura escritura autorizada por trigger |

search_path='' en wrappers, implementaciones y trigger. Implementaciones privadas no expuestas por defecto; EXECUTE sólo para service_role. valid_dogs tampoco recibe EXECUTE público. Navegador/anon/authenticated no pueden adjudicarse grabados ni alterar posiciones. Verificado con privilegios reales en PostgreSQL local; no se habilitó nada remoto.

### Locks de migración

Se observaron AccessExclusiveLock, ShareRowExclusiveLock y AccessShareLock sobre inscripciones durante la transacción DDL. Puede bloquear inscripciones existentes brevemente: no se promete cero bloqueo. Medición local de migración final: 30.37 ms; NO es una estimación para producción. lock_timeout=2s y statement_timeout=30s limitan esperas; con una escritura previa bloqueante abortó y revirtió todos los objetos tras 2032.39 ms. Otra prueba observó un finalizador Axolote esperando un lock de relación y funcionando al liberarlo por rollback.

## Rollback

**PRE-LAUNCH:** comprobado migration up → verificaciones sobre pagos existentes → rollback → fingerprint de schema previo idéntico → nueva finalización Axolote funcional. Conservó todas las filas de pago sintéticas anteriores. El rollback restaura la CHECK original y la valida; elimina sólo objetos nuevos si no existe ningún draft, perro, add-on, counter consumido o inscripción Perrun. Timeouts 2s/30s.

**POST-LAUNCH:** el script se niega a ejecutarse si existe historia. Prueba confirmó que rechaza borrar pagos/perros/posiciones y no cambia el schema ni los datos. Estrategia: detener integración Perrun, conservar datos/beneficios/snapshots y corregir hacia delante con respaldo/conciliación; nunca reciclar posiciones ni borrar inscripciones pagadas.

## Rules retained from the approved brief

Preventa $450 hasta terminar 31 octubre 2026; general $500 desde 1 noviembre hasta terminar 31 diciembre; extemporánea $550 desde 1 enero hasta cierre 25 enero 2027 16:00, Ciudad de México. Extender preventa al 31 octubre es la normalización explícita del hueco del brief original. Cierre exacto a las 16:00; cotización válida previa puede confirmarse después por OXXO, sin recalcular etapa al llegar webhook.

Un humano y uno/dos perros; dos sólo S/M. Peso S [3,10], M (10,25], L (25,50], XL (50,80] kg. Primeros 300 perros con inscripción confirmada, no reservas; segundo perro $180; grabado posterior solicitado fuera del beneficio $35, con compra explícita futura y separada. No cobro automático.

Evento 14 febrero 2027, Bosque de San Juan de Aragón, 1K/3K/5K recreativas sin premiación. Paquete 12 febrero, 10:00–16:00, mismo lugar. No se publican horarios de salida ambiguos ni requisitos veterinarios inventados. Preview necesitará su propio CHECKOUT_SUMMARY_SECRET antes de probar checkout en otra fase; no se modificó Vercel.

## Reproducibility

`npm ci` instala la dependencia de pruebas fijada. `npm test` necesita heredar .env.local para los tests existentes; no imprimir sus valores. Las nuevas regresiones SQL no usan red ni secretos. La concurrencia nativa está separada en tests/perrun-concurrency.pg.cjs y requiere un runtime TEMPORAL externo al repo con @embedded-postgres/windows-x64=17.6.0-beta.15 y pg=8.16.3. El harness crea/para su propio cluster, usa sólo 127.0.0.1 y nunca carga .env.local.

Los archivos locales sensibles continúan ignorados. Ningún archivo de entorno o clave se incluyó en estos entregables. Sólo se modificaron referencia SQL/documentación, modelo Perrun todavía no desplegado, tests/fixtures y devDependency/lockfile. APIs, checkout, webhook, librerías existentes y frontend funcional siguen sin cambios.

## BLOCKERS

Ninguno técnico pendiente para la aplicación del SQL final revisado. El blocker de referencia/legacy quedó reconciliado y la incompatibilidad de PK/distancias fue corregida y comprobada localmente.

La autorización remota continúa pendiente. Antes de cualquier ejecución autorizada debe verificarse identidad uycwzhlcnfijjyzkgkem y usar exactamente el archivo/hash revisado; el preflight abortará si el schema/finalizador cambiaron. Esta validación no autoriza db push, migration up, SQL remoto ni una fase de checkout/UI.

## SAFE_TO_APPLY_REMOTE

YES — validación técnica completada; NO aplicado y pendiente de autorización expresa.

## SQL final inequívoco

- Migración Perrun: `supabase/migrations/20261001055227_perrun_phase1_model.sql`, SHA256 `3bb61a68defced8c6aa5901c3d7787f81853ffb0b63ccfd07e5ef9a5bab74de2`.
- Referencia reconciliada (ya desplegada, NO reaplicar remotamente): `desc/sql-finalize-paid-order-pr4.sql`, SHA256 `964ffc7378859cab597ec006f753ce806918181e1ce4671f03a88aa5bfff5c01`.
- Rollback pre-launch: `desc/perrun-phase1-rollback.sql`, SHA256 `9ce2915c1b591df4a8b096da1bdbee4651238a3a5ece5718b9f6eaf335680510`.
- Permisos/RLS: incluidos en la migración final y detallados arriba.
- Evidencia reproducible: `tests/perrun-concurrency.pg.cjs`, ejecutado desde este repo con dos conexiones PostgreSQL nativas independientes. El JSON de resultados y el cluster son temporales y no se versionan.

Los archivos de este repo son la fuente canónica. La referencia del finalizador incluye una advertencia READ-ONLY / DO NOT APPLY fuera del cuerpo de la función; no se incorpora a la migración. No se requieren copias de outputs externos.

## Validación canónica previa al commit

Reejecutado desde KineticHub: Node 400/400, PostgreSQL nativo 19/19 y build PASS. El índice contiene únicamente 15 archivos de modelo, migración, referencia, rollback, documentación y tests/dependencia de pruebas. Sin cambios en APIs, checkout, webhook ni frontend. .env.local, .vercel/, supabase/.temp/ y node_modules/ permanecen ignorados y no trackeados. Se comentó una línea inválida en .env.local: comparación del entorno completo antes/después confirmó todos los valores idénticos; la CLI ya puede cargar la configuración.

Para reproducir Node con variables locales: `node --env-file=.env.local --test tests/*.test.js` (mismo comando subyacente de npm test). Build: `npm run build`. PostgreSQL nativo, con runtime temporal instalado: `node tests/perrun-concurrency.pg.cjs <runtime-absoluto> <directorio-temporal-absoluto> <evidencia-temporal.json>`. Runtime Windows: @embedded-postgres/windows-x64=17.6.0-beta.15 y pg=8.16.3; instalar fuera del repo con npm install --prefix <runtime-absoluto> --no-save --no-package-lock. El fixture y todo el SQL se leen siempre desde este repo.

Aplicación remota propuesta, NO ejecutada: `.\node_modules\.bin\supabase.cmd db push --linked --project-ref uycwzhlcnfijjyzkgkem --skip-vault`. Ejecutar desde el repo sólo tras autorización y confirmación de que la lista pendiente contiene exclusivamente 20261001055227_perrun_phase1_model.sql. No usar include-all/include-seed/include-roles. skip-vault evita sincronizar secretos de Vault. La autenticación/password de base debe resolverse en privado si la CLI lo solicita.
