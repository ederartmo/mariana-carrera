# Agente de recepción V1 — fase segura

Este PR introduce **solo el motor determinista de mensajes de recepción**, sin conectarlo al chat, sin activar IA y sin escribir mensajes o tickets.

## Política aprobable
- Clasifica por la categoría **ya elegida** por el visitante (general, events, registration, other); no analiza texto libre ni presupone causas.
- Redacta un acuse informativo, identifica el folio solo si tiene formato correcto y pide conservar el chat.
- Solo declara horario de atención y objetivo de **primera respuesta en horas hábiles** cuando ambos datos hayan sido aprobados/configurados. No promete plazos de resolución; no cierra casos.
- La salida lleva `author: 'agent'`, nunca `admin` ni el UUID de un humano.
- No ejecuta acciones, envía correo, conecta proveedores de LLM ni accede a service role.

## Bloqueadores para integración de respuestas automáticas
1. **Contrato atómico de base de datos:** `support_messages.author` hoy permite solo `visitor/admin`; agregar identidad `agent` y evento de auditoría independiente, con inserción idempotente vinculada al ticket y al evento de origen. Nunca escribir como `admin`.
2. **Autorización:** no reutilizar sesiones humanas ni exponer RPC a `anon`/`authenticated`; el servidor debe usar un contrato limitado, con no-duplicación por ticket/evento y sin capacidades administrativas generales.
3. **Activación:** flag apagado por defecto; definir política real de horario (zona America/Mexico_City), calendario hábil y tiempo objetivo por categoría. No inventar horario ni SLA.
4. **Concurrencia:** pruebas de reintento, solicitudes simultáneas y fallos intermedios. Nunca introducir dos acuses por replay de `requestId`; no duplicar por recarga o sondeo.
5. **Compatibilidad:** leer el mensaje en web para visitante y administrador, conservar paginación/transcripción y no alterar el job de correo del operador.
6. **Evaluación humana:** probar con tickets ficticios y acceso de operador de soporte, sin escribir en tickets reales.

## Qué sigue
La siguiente revisión puede añadir la migración y la integración detrás del flag, con pruebas focalizadas del protocolo y después activar solo con aprobación explícita. La presencia de este módulo **no significa que el agente esté funcionando en Production**.
