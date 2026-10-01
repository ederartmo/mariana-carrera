# Referencia canónica local de finalize_paid_order

`sql-finalize-paid-order-pr4.sql` representa la definición real leída en `uycwzhlcnfijjyzkgkem` y conciliada el 1 octubre 2026. Es una referencia y fixture de tests, no una migración pendiente ni una instrucción para ejecutar CREATE OR REPLACE en producción. La función ya está desplegada.

El hotfix `v_is_legacy_order` es intencional. Permite completar órdenes pendientes previas a PR4: si una fila de la orden tiene birth_date/whatsapp/state/borough todos NULL, mantiene NULL para todos los participantes y omite esas validaciones. No eliminar el gate ni poblar automáticamente esos campos como una supuesta limpieza: cambiaría comportamiento real. Órdenes nuevas siguen estrictas; reintentos paid preservan los datos existentes.

Regresiones ejecutables: `tests/finalize-paid-order-legacy.test.js`, dentro de `npm test`, con PostgreSQL aislado. Fixture de schema sin datos reales: `tests/fixtures/kinetic-inscripciones-schema.json`.

La ACL real permite EXECUTE a owner postgres y service_role; no a PUBLIC/anon/authenticated. pg_get_functiondef no serializa permisos. El fixture los reproduce explícitamente: no usar este archivo de referencia como bootstrap autónomo ni como reemplazo remoto de permisos.

Perrun conserva el teléfono capturado en su draft propio, fuera de `inscripciones.whatsapp`; su snapshot de placa se congela al iniciar preparación. Ver diseño y evidencia en `../PERRUN_PHASE1.md`.
