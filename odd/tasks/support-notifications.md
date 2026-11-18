# Internal support notifications V1
Branch: feat/support-internal-notifications. Single draft. Node/PGlite checks.
## Specs
- S1 “Avisar cuando un ticket requiera atención humana, sea nuevo o reabierto.”
- S2 “Evitar enviar una notificación por cada mensaje y evitar duplicados por reintentos, polling o concurrencia.”
- S3 “Cada aviso debe contener el folio, motivo, fecha, estado y un enlace seguro hacia la bandeja administrativa.”
- S4 “No incluir el contenido privado de conversaciones en el correo.” “No aceptar destinatarios de notificaciones proporcionados por el navegador.”
- S5 “Diseñar un mecanismo duradero de entrega e idempotencia” and “Evitar que errores de notificación impidan guardar mensajes.”
## Tasks
- T1 S1–S5 inline outbox/worker with contracts and tests; independent verification.
## Log
- L1: b55d649 main. Existing persisted signals are new tickets and visitor_reopened. No modifications to chat delivery path, contact, PR21, production, credentials, cron or settings.
- L2: 55/55 focused checks, isolated build, diff check, independent review and native PostgreSQL 18.7 2-connection single claim PASS. No provider or production calls; scheduler and worker disabled pending separate activation.
