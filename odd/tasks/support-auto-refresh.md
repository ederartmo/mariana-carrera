# Support automatic refresh
Branch: fix/support-auto-refresh. Delivery: one draft. Runner: Node tests and Chrome fixtures.
## Specs
- S1 “Implementa actualización silenciosa de la bandeja administrativa y del ticket seleccionado, sin perder selección, borradores ni posición de lectura.”
- S2 “Añade actualización al recuperar el foco, respetando los límites existentes.”
- S3 “Maneja `429` y `Retry-After` sin bloquear el envío de mensajes.”
- S4 “Revisa también el polling del participante, sin introducir consultas innecesarias.”
- S5 “Ejecuta pruebas de concurrencia, cambios de sesión, escritorio y móvil.”
## Tasks
- T1 S1–S5: inline shared controller and scoped frontend patch; independent verification.
## Log
- L1: main includes PR19 merge 0dec793. No PR21, migrations, production, quota or authorization changes.
- L2: 39 focused checks, isolated build and diff check pass. Independent review found the authenticated initial-404 regression; fixed and rechecked. Chrome two synthetic sessions active at 1440x1000 and 390x844: focus delivery 17/19 ms and 12/12 ms; drafts/scroll preserved, session teardown verified. Baseline ~60 s participant, no admin poll.
