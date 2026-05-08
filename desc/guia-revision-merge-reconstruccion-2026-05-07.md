# Guia de revision antes de merge

Fecha: 2026-05-07
Rama actual: reconstruccion-may01-may05
Base objetivo: main

## Objetivo
Tener una lista clara para revisar y decidir si hacer merge completo o parcial sin prisas.

## Estado actual
- La rama ya esta subida a remoto.
- main no ha sido modificado por este trabajo.
- Hay cambios funcionales sensibles (Stripe/Auth) y cambios visuales grandes (Home/Evento/Styles).

## Inventario de archivos que entrarian con merge full
- M .gitignore
- A 404.html
- A Expediente Axolote Night Run .pdf
- M admin-inscripciones.html
- M api/create-checkout-session.js
- M api/stripe-webhook.js
- M auth.html
- M axolote-night-run.html
- M cookies.html
- A desc/reporte-reconstruccion-2026-05-05.md
- A desc/sql-atomic-bib-number.sql
- M index.html
- M node_modules/.package-lock.json
- M perfil.html
- M privacidad.html
- M script.js
- A sitemap.xml
- M styles.css
- M succes.html
- D templateTest.html
- M terminos.html

## Resumen por area

### 1) Pagos y webhook (alta prioridad)
Archivos:
- api/create-checkout-session.js
- api/stripe-webhook.js
- desc/sql-atomic-bib-number.sql

Que cambia:
- Checkout deja de validar en Supabase si ya existe pago para el email.
- Checkout deja de mandar talla en metadata.
- Webhook ahora depende de RPC get_next_bib_number para bib atomico.
- Se agregan estados payment_failed, refunded y paid_no_email.
- Se agrega manejo de pago sin email y notificacion a admin.
- El email de confirmacion cambia de plantilla y liga al PDF oficial.

Riesgo:
- Alto (impacta cobros/registros live).

### 2) Auth y perfil (media-alta prioridad)
Archivos:
- auth.html
- perfil.html
- script.js

Que cambia:
- Se agrega UI para recuperar/cambiar contrasena.
- Se agregan validaciones de longitud minima en campos de password.
- Se ajusta flujo post-checkout para forzar que la sesion coincida con checkoutEmail.

Riesgo:
- Medio/alto: hay UI nueva de password, pero revisar que el JS este conectado completo antes de publicar.

### 3) Exoneracion / documento oficial (alta prioridad de negocio, baja tecnica)
Archivos:
- Expediente Axolote Night Run .pdf
- succes.html
- script.js
- api/stripe-webhook.js

Que cambia:
- Se usa un solo documento oficial de exoneracion.
- Success, perfil y correo apuntan al mismo PDF.

Riesgo:
- Bajo tecnico, alto si URL o nombre quedan mal escritos.

### 4) Home, evento y estilos (media prioridad)
Archivos:
- index.html
- axolote-night-run.html
- styles.css

Que cambia:
- Home pierde/recorta secciones (checklist, newsletter, testimonios, bloque editorial grande).
- Hero y layout de axolote-night-run cambian de forma importante.
- CSS global con ajustes grandes en componentes.

Riesgo:
- Medio (regresiones visuales/UX).

### 5) Legales, admin, SEO y soporte (baja-media)
Archivos:
- admin-inscripciones.html
- cookies.html
- privacidad.html
- terminos.html
- 404.html
- sitemap.xml
- .gitignore
- desc/reporte-reconstruccion-2026-05-05.md

Que cambia:
- Admin pasa de un correo fijo a lista ADMIN_EMAILS.
- Correos legales actualizados a hola@kinetichub.com.mx.
- Se agrega 404 y sitemap.
- Se ignora .vercel.

Riesgo:
- Bajo.

## Checklist de revision para manana (paso a paso)

### Paso 1 - Confirmar decision de alcance
- [ ] Definir si quieres merge FULL o PARCIAL.
- [ ] Si es parcial, separar Stripe/Auth de cambios visuales.

### Paso 2 - Validar pagos (obligatorio si merge full)
- [ ] Confirmar que la funcion SQL get_next_bib_number ya existe en Supabase.
- [ ] Revisar que webhook tenga variables de entorno correctas en produccion.
- [ ] Verificar que estado paid_no_email no rompa panel/reportes.
- [ ] Revisar ruta de correo de confirmacion y link al PDF.

### Paso 3 - Validar exoneracion
- [ ] Abrir URL final del PDF en web publica.
- [ ] Probar descarga desde success.
- [ ] Probar descarga desde perfil.
- [ ] Probar descarga desde link de correo (si hay forma controlada).

### Paso 4 - Validar auth/perfil
- [ ] Revisar login normal.
- [ ] Revisar registro normal.
- [ ] Revisar flujo post-checkout con checkoutEmail.
- [ ] Revisar si botones/form de recuperar/cambiar contrasena realmente funcionan de extremo a extremo.

### Paso 5 - Validar visual
- [ ] Home (index) secciones eliminadas/esperadas.
- [ ] Evento axolote en desktop.
- [ ] Evento axolote en mobile.
- [ ] Perfil en desktop y mobile.

### Paso 6 - Validar legales/SEO
- [ ] Correos legales correctos.
- [ ] 404 carga bien.
- [ ] sitemap.xml accesible.

### Paso 7 - Go/No-Go
- [ ] GO si Stripe/Auth pasan validacion minima.
- [ ] NO-GO si hay dudas en webhook o password flows.

## Plan recomendado de merge seguro
Opcion A (conservadora):
1. Merge primero cambios no sensibles (PDF + legales + 404 + sitemap + admin).
2. Merge despues Stripe/Auth cuando se validen en ventana controlada.

Opcion B (rapida):
1. Merge full.
2. Monitoreo inmediato de pagos/webhook y ruta de soporte activa.

## Nota rapida para retomar
Si mañana hay prisa, primero validar solo estos 4 puntos:
1) SQL de bib atomico aplicado.
2) webhook responde OK.
3) PDF oficial descarga en success/perfil/correo.
4) login/registro no roto.
