# Premium support
Branch: feature/support-premium. Delivery: one draft PR and Preview. Runner: Node test.
## Specs
- S1 “Implementa el chat flotante en las páginas públicas correspondientes.”
- S2 “Implementa la vista expandida en `/atencion.html`.”
- S3 “Adapta el diseño para móviles.”
- S4 “Conserva la misma conversación y sesión entre ambas vistas.”
- S5 “Implementa actualización automática de mensajes sin recargar manualmente.”
- S6 “Reutiliza las API y el backend existentes.”
## Tasks
- T1 S1–S6: inline, shared UI; independent verification for auth and async behavior.
## Log
- L1: Approved references inspected: floating desktop, expanded tracking and mobile. No payments, registration, migrations, OpenAI or production deployment.
- L2: Implemented shared shell and preserved API/auth. Chrome fixture comparison found mobile clipping; adjusted the sheet to fit its containing viewport. Focused support suite: 23 PASS. Independent verification checked identity and polling guards; unrelated generated output excluded. Review Preview remains pending.
