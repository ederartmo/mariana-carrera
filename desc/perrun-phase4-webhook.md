# Perrun 2027 — Fase 4: webhook y finalización

Repo canónico: `C:\Users\EderArtMo\Documents\Projects\KineticHub`.
Branch: `feature/perrun-2027`. Base: `36ddc13` (Fase 4A).
Supabase esperado: `uycwzhlcnfijjyzkgkem`. Vercel: `mariana-carrera`.

## Contrato y límites

Esta fase no incorpora SQL ni reemplaza funciones desplegadas. Se verificaron por SELECT los contratos de Fase 1 y `20261001113351_perrun_payment_state.sql`: coinciden con las migraciones locales. También se verificaron permisos de lectura y de UPDATE de los cuatro campos usados para reembolso en `inscripciones` para `service_role`.

`api/stripe-webhook.js` verifica firma antes de enrutar. Perrun se reconoce por `event_slug`, `flow_version` o identidad del draft ligado al ID de la Checkout Session. Los marcadores incompletos no permiten resolver Perrun 5K como Axolote. El PaymentIntent fallido usa la sesión asociada y la misma frontera de routing.

El handler recupera la Checkout Session desde Stripe TEST, compara snapshot firmado/Session actual y valida `livemode=false`, `mode=payment`, importe entero en centavos, moneda `mxn`, metadata `perrun_v1`, un ticket y draft con 1–2 perros. El ID de Session debe ser exactamente la PK `order_session_id` del draft. `order_ref` es un UUID de correlación del quote: no está persistido como una segunda PK en el schema actual. Se verifica formato y coincidencia snapshot/Stripe; la asociación autoritativa al draft es Session.id, no email, importe ni ese nonce.

No se recalcula el precio a la fecha del webhook: se verifica la cotización inmutable almacenada. Una entrega después de cerrar la preventa puede confirmar el importe original correcto.

| Evento | Perrun |
|---|---|
| `checkout.session.completed` con snapshot unpaid | `record_perrun_payment_state(pending)`; ninguna asignación, incluso si Stripe ahora muestra paid |
| `checkout.session.completed` paid | Stripe confirma paid → `finalize_perrun_paid_order` |
| `checkout.session.async_payment_succeeded` | Stripe confirma paid → mismo finalizador |
| `checkout.session.async_payment_failed` | `record_perrun_payment_state(failed)`; ninguna asignación |
| `payment_intent.payment_failed` | Busca Session; Perrun registra failed sin resolver legacy |
| `refund.created` / `refund.updated` | Solo succeeded y total verificado contra charge |
| `charge.refunded` | Solo total acumulado; mantiene regla legacy de parciales |

Pendiente/fallido nunca llama finalizador. Los estados terminales y transiciones están protegidos por la RPC 4A. Finalización: una persona, `ticket_index=1`, `ticket_count=1`, un dorsal y 1–2 perros. No se invoca directamente `finalize_paid_order` desde JavaScript Perrun; la dependencia interna SQL ya validada pertenece al finalizador Fase 1.

## Idempotencia y locks

La autoridad transaccional sigue en PostgreSQL: advisory lock de evento `pg_advisory_xact_lock(123456789, hashtext('perrun-2027'))` → draft `FOR UPDATE` → contador `FOR UPDATE`. El ledger se ordena por `dog_index`. No existe contador JavaScript ni bloqueo en memoria. Duplicados concurrentes y mezcla completed/async success retornan los mismos perros sin incrementar el contador de nuevo. Un fallo transaccional devuelve 503 y revierte humano, dorsal, perros, estado paid y contador.

Las posiciones históricas <=300 permiten grabado gratuito. Después de 300: si se solicitó grabado, queda pendiente de pago por 3500 centavos; si no se solicitó, 0. No se crea Checkout Session adicional ni pago de grabado automático.

## Reembolsos

Solo un reembolso total confirmado marca al humano `payment_status=refunded`, `registration_status=cancelled`, `cancellation_type=refunded`, `cancelled_at`. Se comprueban identidad del PaymentIntent, draft finalizado y humano/ticket únicos. El UPDATE limita orden, PaymentIntent, evento y estado pagado, de modo que duplicados no modifican la fecha de cancelación.

La cancelación es necesaria: el finalizador existente calcula el próximo dorsal sobre filas paid y existe un índice UNIQUE de dorsal para inscripciones active. Dejar refunded+active puede bloquear el siguiente pago. Perrun conserva el dorsal histórico y deja de ocuparlo como inscripción activa; esta fase no cambia el algoritmo legacy de dorsales. Las posiciones de grabado NO se reciclan. Draft pagado, identidad de pago, perros, contador y ledger de grabado no se modifican. Un webhook paid repetido no reactiva al humano reembolsado.

Un refund que llega antes de paid fulfillment devuelve 503 hasta poder aplicar la cancelación, en vez de perder el evento. Errores temporales de Stripe/Supabase retornan 503; contradicciones permanentes reconocidas retornan 200 con `rejected` y diagnóstico fijo. Los errores transitorios de lectura Stripe de charge/Session ahora también solicitan reintento; las reglas legacy de titularidad y total/parcial permanecen iguales.

El bug async de `resolvePaymentIntentId` se corrigió con `await` en refund.created/updated, incluyendo objetos expandidos y fallback al charge. Regresiones aisladas cubren tanto legacy como Perrun.

## Resumen

El resumen protegido por claim muestra pending/failed antes de pagar y datos persistidos (humano/dorsal/perros/grabado) después de finalizar. Para refunded muestra historia y reembolso. No expone teléfono ni snapshots de placa. No promete emails, perfil ni exoneración legacy para Perrun: esos módulos no se implementan en esta fase.

## Validación local

Baseline aceptado al abrir Fase 4: Node 540/540 (incluye 24 pruebas 4A). Validación final: Node 624/624; PostgreSQL nativo 46/46 (19 Fase 1 +17 Fase 4A +10 del handler). PostgreSQL 17.6, localhost, datos sintéticos, dos backends independientes y contención advisory observada.

Los 10 checks nuevos ejecutan el handler JS real con las RPC SQL reales: A 298+2/1 en ambos órdenes de lock; B misma orden completed/async success en ambos órdenes; C 297+2/2 en ambos órdenes; D fallo inyectado/rollback/reintento; failed vs success en ambos órdenes; refund concurrente con paid retry y una nueva orden posterior. Verifican ausencia de duplicados/huecos, umbral gratuito, una persona/dorsal, estados y preservación de historia.

Suite Node, cargando variables locales sin mostrarlas:

```powershell
node --env-file=.env.local --test tests/*.test.js
```

El equivalente `npm test` con `.env.local` heredado también se ejecutó completo. `npm run build` se ejecuta desde el repo; no se versionan copias regeneradas de `public/` ni salidas temporales. El build de Vercel las genera desde las fuentes.

Con el runtime nativo temporal documentado en Fase 1B/4A:

```powershell
node tests/perrun-concurrency.pg.cjs $nativeRuntime $isolatedWork $evidenceFile --payment-state --webhook
```

Los tres argumentos son rutas absolutas de herramientas/directorio/evidencia temporales fuera del repo. El runner crea y detiene un cluster aislado en 127.0.0.1; no carga `.env.local`. No sustituir por una URL Supabase ni por una base real.

## QA local de Stripe — siguiente fase, todavía NO ejecutada

No se inició servidor, listener, webhook remoto ni ningún pago TEST en Fase 4. Tampoco se hizo push/deploy ni escritura Supabase remota. Las únicas operaciones remotas fueron lecturas de catálogo.

Antes de QA, confirmar el sandbox **Entorno de prueba de Kinetic Hub S.A. de C.V.**, credencial local TEST, proyecto Supabase esperado y autorización para crear inscripciones sintéticas allí. No tocar inscripciones reales, contador manualmente, Production de Vercel ni destinos Stripe existentes. Los pagos QA posteriores sí pueden persistir filas sintéticas y posiciones históricas: la autorización de implementación de Fase 4 no ejecuta esos pagos.

Servidor futuro (desde el repo canónico, solo configuración local, bind localhost):

```powershell
node --env-file=.env.local node_modules/vercel/dist/index.js dev --local --listen 127.0.0.1:3000
```

Puerto: 3000. Verificar previamente que `VERCEL_ENV` no sea production. `--local` evita seleccionar/pullar configuración de un proyecto Vercel global durante QA.

Listener futuro, después de verificar sandbox CLI:

```powershell
stripe listen --forward-to http://localhost:3000/api/stripe-webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed,refund.created,refund.updated,charge.refunded
```

Signing secret temporal: guardar el `whsec` de ese listener únicamente en `.env.local` como `STRIPE_WEBHOOK_SECRET` y reiniciar el servidor. No copiar el signing secret de Production/destinos remotos, ni imprimirlo en reportes o versionarlo. Este documento no configura ningún secreto.

Primer test futuro: `http://localhost:3000/checkout.html?event=perrun-2027&distance=3K`, una persona, un perro de 10 kg, grabado solicitado, tarjeta oficial de prueba Stripe. Primero verificar draft y quote; después de la autorización de QA, completar la tarjeta y comprobar un humano/dorsal, un perro/posición y resumen paid. Luego OXXO pending→success/failed, duplicados y refunds según plan. No usar `stripe trigger` genérico para fulfillment: sus sesiones no contienen el draft/metadata Perrun autoritativos.

Referencias oficiales: [fulfillment Checkout](https://docs.stripe.com/checkout/fulfillment?payment-ui=checkout-form) y [OXXO Checkout](https://docs.stripe.com/payments/oxxo/accept-a-payment?payment-ui=checkout).

Consultas de verificación SOLO lectura, reemplazando el ID por la Session TEST de QA:

```sql
select order_session_id,event_slug,distance,amount_cents,currency,payment_status,
       payment_failed_at,finalized_at,payment_intent_id,jsonb_array_length(dogs) as dog_count
from public.perrun_checkout_orders where order_session_id='cs_test_REEMPLAZAR';

select order_session_id,event_slug,distance,payment_status,registration_status,
       ticket_index,ticket_count,bib_number,cancellation_type
from public.inscripciones where order_session_id='cs_test_REEMPLAZAR';

select dog_index,engraving_sequence,engraving_free,engraving_requested,
       engraving_payment_required,engraving_payment_amount_cents,plate_status
from public.registration_dogs where order_session_id='cs_test_REEMPLAZAR'
order by dog_index;

select event_slug,last_sequence from public.perrun_paid_dog_counter
where event_slug='perrun-2027';

select engraving_sequence,count(*) from public.registration_dogs
group by engraving_sequence having count(*)>1;
```

No ejecutar finalizadores ni RPCs mutantes manualmente para verificar un webhook. No resetear el contador después de QA ni borrar historia para repetir el umbral de 300; ese umbral ya está probado en la base aislada.
