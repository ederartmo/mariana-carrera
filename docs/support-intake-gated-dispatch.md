# Agente de recepción: conexión gradual, desactivada por defecto

Este cambio depende de PR #33 (política de recepción) y PR #34 (RPC atómico y autor agent). No activa IA, no usa modelos y no envía correos.

## Funcionamiento

Después de que `support_visitor_action('start')` haya guardado exitosamente el primer mensaje:
1. El servidor evalúa **`SUPPORT_INTAKE_ENABLED === 'true'`** y fecha ISO UTC `SUPPORT_INTAKE_START_AT` ya alcanzada. Ausencia o formato inválido = no enviar.
2. Calcula el texto con `lib/support-intake-policy.js`, usando únicamente la categoría persistida y un folio de la solicitud.
3. Invoca `support_agent_acknowledge_first` (RPC protegido del PR #34), que inserta en una transacción mensaje `author=agent`, evento `agent_acknowledged` y vínculo exacto al mensaje de origen; el SQL comprueba que es el primer contacto y posterior al corte.
4. Si el RPC confirma éxito, lee la conversación una vez para mostrar el acuse en el mismo chat. Si falla cualquier paso del acuse o la lectura adicional, conserva la respuesta correcta del ticket original. No envía nada externo.
5. Un nuevo intento del mismo ticket no crea otro acuse, gracias a la clave única y al bloqueo del PR #34.

Solo se ejecuta en `start`, no en `send` o `read`. La V1 no cubre reaperturas, mensajes sucesivos ni seguimientos de vencimientos. Si el acuse falla y el cliente no reintenta el `start`, queda pendiente de una futura estrategia de recuperación; no declarar entrega garantizada.

## Configuración (NO REALIZADA)

- `SUPPORT_INTAKE_ENABLED`: ausente/false por defecto; habilitar solo con aprobación y después de aplicar la migración validada.
- `SUPPORT_INTAKE_START_AT`: corte ISO UTC explícito; se usa en SQL para evitar contestar tickets antiguos.

Ninguna de estas variables habilita permisos a visitantes, cambia el acceso de operadores ni otorga un token a agentes.

## Verificaciones previas a activar

1. Ejecutar todas las pruebas focalizadas PGlite de PR #34 y las de política/dispatch de PR #33/#35. No considerar el check de build de Vercel equivalente a test SQL.
2. Revisión independiente de SQL, RLS, RPC, historial y cambio de versión del ticket.
3. En entorno aislado con tickets ficticios: inicio, reintento, concurrente, conflicto, rollback, flujo de visitante sin sesión, cuenta confirmada y vista de operador.
4. Revisión explícita del texto, horario de atención real y objetivo de primera respuesta por el negocio.
5. Integrar PR #33 → #34 → #35, aplicar la migración de manera aprobada y dejar flag false hasta pruebas finales.
6. Solo entonces habilitar el flag con corte futuro. Mantener PR #21 y el worker de notificaciones intactos.

## Alcance de privacidad y errores

El mensaje del visitante no se envía a ningún proveedor de IA en esta versión. Los errores internos no se filtran a las respuestas del cliente. Si el acuse falla, la solicitud sigue guardada y puede atenderse manualmente.
