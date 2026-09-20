# Batch 8 — Auditoría CSP y reporte de orígenes (REPORT-ONLY)

Fecha: 2026-09-20. Fuente: código en raíz (sin `public/` generado).
La CSP está en modo **Report-Only**: nada se bloquea todavía.

## 1. Orígenes externos permitidos y por qué

| Origen | Directiva | Motivo (evidencia) |
|---|---|---|
| `cdn.jsdelivr.net` | script-src | SDK Supabase en todos los HTML (`<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">`) |
| `unpkg.com` | script-src | Lucide en `index.html:41`, `axolote-night-run.html:1799`, `cascanueces-run.html:34` |
| `connect.facebook.net` | script-src, connect-src | Bootstrap Meta Pixel (`fbq('init','917340277990899')` en ~16 páginas) |
| `www.facebook.com` | img-src, connect-src | Pixel `<noscript>` + `fbq track PageView` |
| `fonts.googleapis.com` | style-src | `<link>` de fuentes en todos los HTML |
| `fonts.gstatic.com` | font-src | Archivos de fuente del CSS de Google Fonts |
| `images.unsplash.com` | img-src | Imágenes de contenido (6 refs) |
| `*.supabase.co` | img-src | Avatares/portadas vía `getPublicUrl` del bucket |
| `uycwzhlcnfijjyzkgkem.supabase.co` (+`wss:`) | connect-src | API Supabase (anon key); `wss:` preventivo, sin realtime en uso |
| `iframe.videodelivery.net` | frame-src | **Hallazgo no previsto**: `script.js:4274-4378` crea iframes de Cloudflare Stream dinámicamente (tips). Sin `data-cf-id` en HTML hoy (placeholder), pero el code path es real |
| `data:` | font-src, img-src | Compatibilidad fuentes/imágenes embebidas |
| `blob:` | img-src, media-src, worker-src | Previews y optimización de imágenes (`URL.createObjectURL`, `script.js:3032/3501/3548`) |

Solo servidor (NO van a la CSP del navegador): `graph.facebook.com` (`lib/_meta-capi.js:92`, Meta CAPI server-side).

Solo navegación `<a href>` / redirects (CSP no los rige): `wa.me`, `instagram.com`, `tiktok.com`, `x.com`, `google.com/maps` (mapsUrl en event-data), `buy.stripe.com/test_…` (redirect legacy en `script.js:2287`, fuera de scope), `kinetichub.com.mx` (canónico propio). `www.w3.org` aparece solo en atributos `xmlns` de SVG (sin fetch de red).

## 2. Scripts inline (por archivo raíz)

Total ~22 bloques en 18 HTML: `admin-inscripciones.html:3`, `axolote-night-run.html:2`, `checkout.html:2`, `succes.html:2`, resto 1 c/u (`404,auth,blog,cascanueces,contacto,cookies,evento,eventos,index,nosotros,perfil,privacidad,terminos`). `Kinetichub - Manual 2026.html:0`.

## 3. Estilos inline

Bloques `<style>`: `404,admin-inscripciones,axolote-night-run,checkout,Manual` (1 c/u). Atributos `style="…"`: ~137 en total (top: `succes.html:33`, `admin-inscripciones.html:16`, `checkout.html:13`).

## 4. Handlers inline (`onclick=` etc.)

**Cero** en todo el repo. No hay `on*=` que migrar.

## 5. Bloqueadores para quitar `'unsafe-inline'`

1. ~22 bloques `<script>` inline (lógica de página: checkout-summary polling, admin panel, event stages). Requieren nonces por request o externalización.
2. 5 bloques `<style>` + ~137 atributos `style=` (requieren nonces/hashes o CSS externo).
3. Bootstrap de Meta Pixel inline (requiere nonce/hash propio o Tag Manager).
4. `script.js`/`script.min.js` monolíticos con `innerHTML` dinámico (compatible con CSP script, pero `style=` inyectado caería bajo style-src).

## 6. Seguimiento recomendado hacia CSP enforced

a) Revisar violaciones report-only en Preview en las 9 páginas del checklist.
b) Decidir `frame-src`: si los videos de tips no se usan, volver a `'none'` y eliminar la excepción `videodelivery`.
c) Nonces por request (requiere middleware/SSR o edge) para scripts de página + Pixel; mover estilos a CSS externo.
d) Solo entonces cambiar a `Content-Security-Policy` enforced, página por página.

## 7. Notas API

Los headers globales de Vercel también se envían en `/api/*`. La CSP en respuestas JSON/fetch no tiene efecto de bloqueo en navegadores (solo aplica a documentos/workers), así que el webhook Stripe y las APIs JSON no se ven afectados. No se tocó lógica de APIs.
