# Batch 9 — Auditoría runtime navegador (auth singleton, flash, share-modal)

## A. Múltiples GoTrueClient: causa raíz

Cada `window.supabase.createClient(url, key)` crea un GoTrueClient con su
propio listener de sesión sobre la MISMA storage key. `script.js` lo llamaba
en ~10 sitios (nav móvil, contacto, registro de evento, perfil, checklists),
más 1 en `succes.html` y 1 en `admin-inscripciones.html`: cualquier página
cargaba 2+ clientes y el SDK advertía "Multiple GoTrueClient instances".

## B. Diseño singleton

`supabase-client.js` (UMD, IIFE, sin colisiones): `getClient()` cachea UNA
instancia por página (misma URL/key anon); `ensureClient()` espera al SDK si
hace falta; `resetClient()` solo tests. Sin `service_role` en el archivo.
`script.js` usa `getSharedSupabaseClient()/ensureSharedSupabaseClient()`;
`succes.html` y `admin-inscripciones.html` usan `window.KineticHubSupabase`
directo. Tags `<script src="supabase-client.js">` en las 16 páginas.
Comportamiento auth intacto (mismos flujos getSession/signOut/onAuthStateChange).

## C. Flash de perfil: causa y fix

`perfil.html` pintaba identidad con placeholders ("Nombre de usuario",
"correo@ejemplo.com", "55 0000 0000") antes de resolver `getSession()`.
Fix: shell autenticado (`#profileCover`, `#profileLayout`) inicia `hidden`
y solo hay un loader neutro ("Cargando perfil…"); `revealAuthenticatedProfile()`
se llama tras sesión válida + `applyHeader`; sin sesión, el redirect a login
existente se mantiene (returnTo intacto). Carreras muestran "Cargando tus
carreras…" hasta que llega la DB. Avatar/cover sin cambios funcionales.

## D. share-modal.js: proveniencia EXTERNA

Búsqueda global en repo (js/html/json, raíz + public/ generado): **cero**
coincidencias de `share-modal`, `shareModal` o `share_modal`; ningún archivo
`share-modal.js` existe en el proyecto ni lo referencia ningún HTML/build.
Conclusión: el `Uncaught TypeError ... share-modal.js:1` observado en
producción proviene de fuera de la app (extensión del navegador o toolbar de
Vercel Preview). NO se modifica código KineticHub para silenciarlo.
