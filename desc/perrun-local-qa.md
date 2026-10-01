# Perrun — QA local sin Docker

Este QA usa PostgreSQL 17.6 y PostgREST 16.4 nativos. No usa Docker ni el CRM.
Base `perrun_qa_real`, PostgreSQL `127.0.0.1:55322`, PostgREST interno `127.0.0.1:55325`, API compatible `/rest/v1` en `http://127.0.0.1:55321`.

## Estructura real, sin datos

La introspección de solo lectura de `uycwzhlcnfijjyzkgkem` se conserva en `.qa/remote-structure.json` (ignorado). No contiene filas de clientes. Captura columnas y defaults, constraints, índices, triggers, RLS, grants y definiciones de funciones.

El bootstrap de `inscripciones` proviene de esta introspección. Solo su constraint de distancia se restaura al estado histórico validado antes de ejecutar Fase 1. Se aplicaron las nueve migraciones reales de `supabase/migrations/`, incluyendo `20261001055227_perrun_phase1_model.sql` y `20261001113351_perrun_payment_state.sql`.

Las dependencias desplegadas `finalize_paid_order`, `get_next_event_bib_number` y `consume_api_rate_limit` se reproducen desde la introspección exclusivamente en LOCAL. La función rate-limit desplegada difiere en formato y uso de `greatest` de la referencia antigua; QA conserva la definición desplegada exacta. No se modifican referencias productivas ni migraciones.

La comparación final verificó las siete tablas necesarias, todos sus campos, constraints (incluido estado de validación), índices, triggers y RLS, y las trece definiciones de funciones. PostgREST concede acceso directo solo a las tres RPCs Perrun y rate-limit; el finalizador legacy permanece accesible internamente al propietario de las funciones SECURITY DEFINER. Los roles de navegador no pueden ejecutar RPCs Perrun.

## Entorno y comandos

Ejecutar desde `C:\Users\EderArtMo\Documents\Projects\KineticHub`.

```powershell
# Mantener abierto mientras se use QA, si todavía no está iniciado:
node scripts/perrun-qa-db.cjs

# Otra terminal:
node scripts/perrun-qa.cjs env
node scripts/perrun-qa.cjs check
node scripts/perrun-qa.cjs server
```

El servidor HTTP nativo usa los handlers actuales, sin Vercel CLI ni selección global de proyecto. Expone únicamente checkout, summary y webhook, además de assets. La copia estática está en `.qa/app`; URLs Supabase se sustituyen solo en esa copia. El servidor carga exclusivamente `.env.qa.local`, exige claves Stripe TEST y URL local, y precarga un bloqueo de conexiones remotas Supabase/Resend/Meta. CSP aplicada bloquea conexiones del navegador fuera de localhost. Si PostgREST cae, la API responde 503 y supabase-js devuelve error; no hay fallback remoto. La caída real y recuperación fueron probadas.

`.env.local` permanece intacto. `.env.qa.local` tiene credenciales DB locales y secretos locales independientes; `.qa/` guarda runtime y logs. Ambos están ignorados por Git. No se guarda una selección Vercel remota en el mirror. No usar `vercel dev` directamente en el repo para este QA.

Auth y Storage NO son necesarios para checkout/summary/webhook Perrun y no se reproducen. Perfil/admin autenticados quedan fuera del alcance de este QA. Envíos de correo y tracking remotos están bloqueados.

## Prueba controlada, sin Stripe

```powershell
node scripts/perrun-qa-validate.cjs
```

Esta prueba requiere base QA vacía y contador cero. Verifica schema, llama las tres RPCs por HTTP con fixtures sintéticos, prueba pending/failed, finalización e idempotencia, y elimina solo esos fixtures locales. No crea sesiones ni realiza llamadas a Stripe. Tras la prueba: contador 0, inscripciones 0, perros 0 y drafts 0.

## Listener futuro — NO ejecutado

Solo tras autorización para QA Stripe:

```powershell
stripe listen --api-key <sk_test_del_sandbox_KineticHub> --forward-to http://localhost:3000/api/stripe-webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed,refund.created,refund.updated,charge.refunded
```

Usar exclusivamente la clave TEST del sandbox de KineticHub, evitando el login global ambiguo de Stripe CLI. Guardar el signing secret local emitido por ese listener únicamente en `.env.qa.local` y reiniciar el servidor QA. No copiar signing secrets de destinos remotos. El campo local está vacío por ahora.

No se han ejecutado listener, Checkout ni pagos. Accesos remotos durante QA: cero lecturas y cero escrituras; únicamente hubo introspección previa autorizada. No ejecutar `db push`.
