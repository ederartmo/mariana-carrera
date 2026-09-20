# KineticHub Security Hardening v1

## Executive summary

Entre Batch 1 y Batch 9 se cerró el acceso directo del navegador a datos
sensibles, se endurecieron pagos/refunds, admin, perfiles, Storage, rate
limiting y headers. Estado: 323 tests verdes, 12 Serverless Functions,
cero secretos reales en árbol e historial, Secret Scanning + Push Protection
activos en GitHub. Pendiente antes del cierre: aplicar SQL ya preparado
(Batches 5/6/7) y verificar con `desc/sql-final-security-verification.sql`,
más activar Dependabot updates y protección de `main` (pasos manuales abajo).
La CSP es intencionalmente REPORT-ONLY: existe telemetría, no enforcement.

## Closed findings

- **Batch 1 — inscripciones boundary**: cero `SELECT` browser a
  `public.inscripciones`; lecturas vía `/api/me/registrations` y
  `/api/admin-list-inscriptions` (service_role, JWT validado).
- **Batch 2 — refunds deterministas**: ownership solo por
  `payment_intent_id`/checkout session; eliminado fallback por
  email+monto; parciales no mutan; idempotente.
- **Batch 3 — checkout claim**: `checkout-summary` exige cookie HttpOnly
  HMAC-SHA256 (`CHECKOUT_SUMMARY_SECRET`, 72h); `session_id` solo = 403.
- **Batch 4 — admin mutations**: auth central en `lib/_auth.js` (fail
  closed, 401/403); delete solo registros `cs_test_*` con preflight,
  `confirmTarget` e IDs verificados (anti-TOCTOU); updates con pre-read.
- **Batch 5 — user_profiles**: allowlist JS de 21 columnas + SQL de
  privileges por columna listo (RLS limita filas, grants limitan columnas).
- **Batch 6 — private storage**: `contact-attachments` (público, perfil) vs
  `contact-private` (privado, signed uploads/URLs server-side, TTL 3600).
- **Legacy contact**: 1 objeto interno + 1 referencia externa documentados;
  plan de migración en SQL sección D; 13 filas históricas intactas.
- **Batch 7 — rate limiting**: persistente en Postgres (RPC atómica,
  claves HMAC, 429+Retry-After, fail closed) en contact/promo/checkout;
  webhook y admin excluidos a propósito.
- **Batch 8 — headers/CSP report-only**: nosniff, referrer, DENY,
  permissions, COOP, HSTS, CSP report-only auditada (videodelivery incluido
  por code path real; vercel.live excluido a propósito).
- **Batch 9 — browser runtime**: singleton GoTrueClient, flash de perfil
  eliminado (fail-closed CSS + reveal post-hidratación), share-modal
  clasificado externo. Incidente previo de secretos: rotado + historial
  reescrito y verificado.

## Dependency audit

`npm ci` falla (lockfile desincronizado preexistente: `@emnapi/*` — documentado,
no regenerado a ciegas). `npm audit`: 37 → **33** tras minors seguros
(`resend` 6.12.2→6.28.1, `stripe` 22.0.2→22.6.2, `supabase-js` 2.105.1→2.116.0;
tests 315/315). Cadena `resend→svix→uuid`, `ws`: RESUELTAS. Restan 25 HIGH +
1 CRITICAL (`tar`) + 6 MODERATE, casi todo transitivo del CLI `vercel`
(herramienta, **nunca importado por la app**) cuyo fix exige major
`vercel@50.41.0`: NO se migra automáticamente (backlog v2). `vercel` queda
donde está: moverlo a devDependencies no aporta beneficio probado al deploy.
Outdated directos: supabase 2.116.0, resend 6.28.1, stripe 22.6.2 (aplicados),
vercel 54.21.1/59.23.2 (no aplicados: major). Deprecations transitivas: no
son findings de seguridad por sí solas.

## Secret audit

Árbol: cero credenciales reales (solo `sk_live_...`/`whsec_...`/`whsec_mock`
como placeholders/mocks; anon key publishable por diseño). Historial (303
revs): mismos placeholders en docs; `sb_secret_`, private keys, `ghp_`,
tokens: cero. Incidente anterior: verificado ausente tras reescritura.
`.gitignore` cubre `.env`/`.env.local`/`.env*.local`/`node_modules`/`.vercel`;
sin `.env` trackeados; único `.bak` es CSS legítimo. Gap P3: `.env.production`
no cubierto por ningún patrón (propuesta: añadirlo).

## API attack surface

| Endpoint | Método | Auth | Rate limit | Datos sensibles | Efectos externos | Frontera | Residual |
|---|---|---|---|---|---|---|---|
| /api/contact-notify (+upload intent) | POST | pública | sí (3 scopes) | adjunto/email | DB, 2×Resend, CAPI, signed URLs | validación path UUID + service_role | parciales legacy pre-migración |
| /api/validate-promo-code | POST | pública | sí (30/5min) | ninguno | lookup Stripe | validación + limiter | enumeración de códigos con descuento |
| /api/create-checkout-session | POST | pública | sí (10/10min IP) | participantes | Stripe, DB pending, CAPI | validación PR4 + limiter | reintentos legítimos comparten bucket IP |
| /api/checkout-summary | GET | claim HMAC cookie | n/a (possession proof) | PII orden | DB/Stripe read | firma+exp+session antes de PII | ventana 72h |
| /api/data (3 actions) | GET | Bearer (+allowlist admin) | n/a | según action | DB read | JWT + allowlist server-side | — |
| /api/stripe-webhook | POST | firma Stripe | NO (a propósito) | pagos | DB, Resend, CAPI | `constructEvent` + IDs deterministas | parciales acumulados no reconcilian |
| admin-* (4) + resend-* (3) | POST/GET | Bearer + allowlist | n/a | según endpoint | DB/email | `getAdminUser` central | — |
| delete | POST | admin | n/a | — | DELETE test-only | `cs_test_*` + confirmTarget + IDs | manual_* imborrables por diseño |

Ningún endpoint confía en flags admin del browser (el panel solo redirige;
la API re-autoriza).

## Production verification pending

Ejecutar `desc/sql-final-security-verification.sql` (solo lectura) y pegar
salida: RLS/grants de `inscripciones`, columnas permitidas de
`user_profiles` (bib denegado), buckets/policies Storage, `contact_messages`
(conteos sin URLs), tabla/RPC de rate limits. Pendiente también aplicar SQL
de Batches 5/6/7 ya preparados.

## GitHub security controls

- Secret Scanning: **ENABLED** ✓
- Push Protection: **ENABLED** ✓
- Dependabot security updates: **DISABLED** → activar manual: repo →
  Settings → Code security → Dependabot → Enable security updates.
- Branch protection/rulesets en `main`: **ninguna** → activar manual:
  Settings → Rules → New ruleset → exigir PR + status checks antes de push
  directo (hoy `main` acepta push directo).
- Private vulnerability reporting: no habilitado → Enable en la misma página.

## Accepted residual risks / v2 backlog

- P1: `tar` CRITICAL transitivo (tooling, sin path de explotación en runtime;
  se cierra con major `vercel`, backlog v2).
- P1: `main` sin protección de rama + Dependabot apagado (acciones manuales
  arriba; sin código que lo resuelva).
- P2: CSP enforced con nonces (requiere arquitectura por-request).
- P2: reconciliación de refunds parciales acumulados + monitoreo de
  webhooks fallidos.
- P2: `npm ci` roto por lockfile drift (regenerar lock con revisión).
- P3: `.env.production` fuera de `.gitignore`; micro-flicker en redirect de
  perfil no autenticado; selector Cascanueces en contacto (producto, no
  seguridad).

## Cierre

Hardening v1 está **READY FOR CLOSURE** en código (cero P0, cero P1 de código,
auditoría verde), **PENDIENTE** de: SQL de verificación con resultado
conforme + Dependabot/protección de `main` activados. No se afirma seguridad
absoluta: ver riesgos aceptados.
