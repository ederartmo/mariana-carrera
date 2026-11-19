# Recepción V1: operación atómica de Supabase (inactiva)

Esta rama depende del PR #33, que contiene el generador determinista de acuses. La migración agrega un **contrato persistente**, pero no llama al contrato desde ninguna ruta o cron: **ningún cliente recibirá una respuesta automática al fusionarla**.

## Operación de base de datos

`support_agent_acknowledge_first(ticket, source_message, body, not_before)` es un RPC **SECURITY INVOKER**, con permisos de ejecución únicamente para `service_role`. Al recibir un ticket inicial pendiente y su primer mensaje de visitante, toma un bloqueo transaccional del ticket y verifica elegibilidad.

En **una misma transacción** escribe:
- un mensaje con `author='agent'` (no `admin`);
- un evento de auditoría `agent_acknowledged`, con actor `agent:intake-v1`;
- un registro `support_agent_acknowledgments` que relaciona exactamente el mensaje original, el acuse y su evento de auditoría.

La llave primaria `ticket_id` garantiza un acuse inicial como máximo por ticket. El reintento idéntico devuelve `already_created` sin insertar nuevos registros; un reintento con contenido distinto devuelve `conflict`. Si falla cualquier escritura, Postgres revierte las otras. No modifica estado, responsable ni contenidos previos. Los mensajes del agente se presentan con etiqueta propia en chat público y bandeja interna.

### Límites explícitos

- Solo nuevos tickets y **primer mensaje**. No incluye reaperturas, recordatorios, clasificador LLM, respuestas a mensajes posteriores ni escalamiento; se implementarán por separado.
- No garantiza entrega de email, que sigue gobernada por el worker actual.
- No hay API pública ni dispatcher nuevo. No se proporciona el rol de servicio al navegador ni se imita a un administrador.
- **No ejecutar en Production** la migración o el dispatcher sin pruebas SQL focalizadas, validación de funciones antiguas, revisión de seguridad y autorización explícita.
- Antes de activar una futura ruta, validar `SUPPORT_INTAKE_ENABLED` apagado por defecto y fecha de inicio en el servidor. Definir horario comercial y objetivo de primera respuesta; no inventarlos.

## Validación pendiente antes del merge

Ejecutar `node --test tests/support-agent-atomic.test.js tests/support-intake-policy.test.js` y `npm run build` en el worktree, más `git diff --check` y verificación de migración en PGlite. Revisar en especial el rollback inducido por trigger y la denegación para `anon/authenticated`. La revisión previa desde GitHub comprueba el código, pero no sustituye una ejecución de pruebas. Mantener PR #21 intacto.
