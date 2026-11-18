# Support message history
Branch: feat/support-message-history; single draft candidate; runner: Node/PostgreSQL.
## Specs
- S1 “páginas de 50 mensajes, cursor UUID resuelto dentro del ticket autorizado, operaciones aditivas y compatibilidad con los clientes actuales.”
- S2 “Preservar la posición de lectura cuando se cargan mensajes antiguos.”
- S3 “No desplazar al usuario automáticamente al llegar mensajes nuevos si está leyendo el historial.”
- S4 “Controlar los límites de solicitudes y los errores 429 sin afectar el envío de mensajes.”
- S5 “Validar la integración futura con el PR #19 sin modificar esa rama.”
- S6 “Probar los RPC en PostgreSQL aislado con datos ficticios, incluyendo intentos de acceso entre cuentas.”
## Tasks
- T1 S1,S4,S6: inline RPC and API; independent verification after local checks.
- T2 S1–S5: inline shared client and UI; independent verification after QA.
## Log
- L1: Phase 1 only; no production, no changes to existing records/permissions, no merge. Deliver tests, proposed SQL, screenshots, risks and draft-PR recommendation.
- L2: Read-only RPCs and separately limited history requests implemented; desktop/mobile use an explicit reader with a scroll anchor, separate from live delivery. Both UI switches off pending authorized rollout. PostgreSQL 18.7 loopback with service-role BYPASSRLS model; separate connections verified stable cursor after a newer insert, and denied cross-account and foreign-cursor reads. 26 focused checks and isolated build pass. Independent review found no SQL or authorization blockers.
