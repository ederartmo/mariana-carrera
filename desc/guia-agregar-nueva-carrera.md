# Guia para agregar una nueva carrera

Esta guia describe el proceso actual para incorporar una carrera al flujo multi-evento de Kinetic Hub sin afectar las carreras existentes.

## Arquitectura actual

- Todas las carreras comparten la tabla `public.inscripciones`.
- `event_slug` separa las carreras y `distance` guarda la modalidad.
- Los dorsales se calculan de forma independiente por `event_slug` mediante `get_next_event_bib_number`.
- Un mismo correo puede comprar carreras diferentes y varios tickets en una misma orden.
- El backend calcula etapa, precio y total. Nunca se debe confiar en un precio enviado por el navegador.
- Stripe Test se usa en Preview y Stripe Live se conserva exclusivamente para Production.
- Los archivos dentro de `public/` son generados por `npm run build`; no deben editarse directamente.

## 1. Preparar la ficha del evento

Definir estos datos antes de programar:

| Dato | Ejemplo |
| --- | --- |
| Slug estable | `nueva-carrera-run` |
| Nombre público | `Nueva Carrera Run 2027` |
| Fecha y hora | `14 MAR 2027 - 08:00 H` |
| Lugar | `Bosque..., CDMX` |
| Distancias | `5K`, `10K` |
| Tallas | `XS`, `S`, `M`, `L`, `XL` |
| Etapas | Nombre, inicio, fin y precio MXN |
| Entrega de kits | Fecha, horario y lugar |
| Exoneracion | Ruta publica al PDF |
| Convocatoria | Ruta publica al PDF |
| Imagen principal | Ruta dentro de `assets/events/<slug>/` |
| Limite de tickets | Actualmente 5 por orden |

Reglas para el slug:

- Usar minusculas y guiones.
- No incluir el año si el slug se reutilizara en varias ediciones.
- No cambiarlo despues de vender: queda guardado en Supabase y Stripe.

## 2. Crear una rama Preview

```bash
git switch -c preview/nueva-carrera-checkout
npm install
```

En Vercel, configurar para Preview:

- `STRIPE_SECRET_KEY`: clave `sk_test_...`.
- `STRIPE_WEBHOOK_SECRET`: secreto del webhook Test.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: proyecto correcto.
- `RESEND_API_KEY`: cuenta autorizada para el remitente.
- Variables de Meta CAPI, si se probaran eventos de conversion.

No cambiar ni copiar las claves Stripe Live de Production.

## 3. Agregar pagina y recursos

1. Crear `assets/events/<slug>/` con imagenes, convocatoria y exoneracion.
2. Crear la pagina del evento en la raiz, tomando como referencia `cascanueces-run.html`.
3. Enlazar cada modalidad al checkout:

```html
<a href="checkout.html?event=nueva-carrera-run&amp;distance=5K">Inscribirme a 5K</a>
```

4. Agregar la carrera a `eventos.html` y a cualquier navegacion o listado donde deba aparecer.
5. Actualizar `sitemap.xml` si la pagina sera publica e indexable.

## 4. Crear la configuracion de etapas

Crear `<slug>-stage-config.js` en la raiz. Debe funcionar tanto en navegador como en Node, siguiendo el patron de `cascanueces-stage-config.js`.

Cada etapa debe contener:

```js
{
  key: "preventa",
  label: "Preventa",
  amount: 400,
  period: "1 de enero, 11:00 h a 31 de enero, 12:00 h",
  start: "2027-01-01T11:00:00-06:00",
  end: "2027-01-31T12:00:00-06:00",
}
```

Consideraciones:

- Usar fecha ISO con zona horaria de la sede.
- Definir con precision si los limites son inclusivos.
- Fuera de las etapas, devolver `isOpen: false` y precio nulo.
- Probar un instante antes, exactamente en y un instante despues de cada frontera.

## 5. Registrar el evento en el codigo

Actualmente no existe un catalogo central; la carrera debe agregarse en todos los puntos siguientes.

### Checkout y precio

- `checkout.html`
  - Cargar el nuevo archivo de etapas.
  - Resolver `event` y `distance` desde la URL.
  - Configurar nombre, imagen, fecha, lugar, pagina de regreso y proveedor de etapas.
  - Definir `window.KineticHubCheckoutSelection` antes de cargar `script.min.js`.
- `api/create-checkout-session.js`
  - Importar el proveedor de etapas.
  - Agregar slug, nombre, distancias, distancia predeterminada y `getStage` a `EVENT_CATALOG`.
  - Mantener el calculo del precio en backend.
- `api/validate-promo-code.js`
  - Aceptar el nuevo slug y devolver su proveedor de etapas.
- `script.js`
  - Verificar que se envien `eventSlug` y `distance` al validar cupon y crear checkout.

### Pago, webhook y correo

- `api/stripe-webhook.js`
  - Agregar slug, nombre, distancia predeterminada, entrega de kits y exoneracion a `EVENT_CATALOG`.
  - Confirmar que correo, Meta CAPI y registros Supabase usen el evento resuelto desde metadata.
- `api/checkout-summary.js`
  - Agregar el nombre como fallback cuando Stripe no pueda recuperar metadata.
- `succes.html`
  - Mapear el slug a su exoneracion y al parametro usado para regresar al perfil.
- `api/resend-confirmations.js` y `api/resend-single-confirmation.js`
  - Normalmente no requieren un catalogo nuevo: delegan el contenido a `sendConfirmationEmail` del webhook.
  - Probar de todos modos el reenvio individual y masivo.

### Perfil y administracion

- `script.js`
  - Agregar nombre, fecha/lugar, detalle, exoneracion y convocatoria a `PROFILE_EVENT_CATALOG`.
  - Confirmar que el perfil renderice todas las inscripciones del correo, no solo la carrera mas reciente.
- `admin-inscripciones.html`
  - Agregar la carrera al filtro y al formulario de transferencia manual.
  - Agregar su nombre visible y sus distancias permitidas.
- `api/admin-manual-transfer.js`
  - Agregar el slug a `ALLOWED_EVENT_SLUGS`.
  - Agregar modalidades a `EVENT_DISTANCES`.

## 6. Actualizar Supabase

No crear una tabla por carrera. Extender la restriccion de distancia en `public.inscripciones`:

```sql
begin;

alter table public.inscripciones
  drop constraint if exists inscripciones_distance_chk;

alter table public.inscripciones
  add constraint inscripciones_distance_chk
  check (
    distance is null
    or (event_slug = 'axolote-night-run' and distance = '5K')
    or (event_slug = 'cascanueces-run' and distance in ('5K', '10K'))
    or (event_slug = 'nueva-carrera-run' and distance in ('5K', '10K'))
  );

commit;
```

Verificaciones SQL:

```sql
-- Debe aceptar una modalidad valida.
select public.get_next_event_bib_number('nueva-carrera-run');

-- El contador se calcula solo con dorsales de la carrera indicada.
select event_slug, max(bib_number::integer)
from public.inscripciones
where bib_number ~ '^[0-9]+$'
group by event_slug;
```

Notas importantes:

- La funcion de dorsales de `desc/sql-event-bib-number.sql` ya es generica; no necesita otra funcion por carrera.
- El indice `(event_slug, distance)` ya sirve para cualquier slug.
- No volver a ejecutar `desc/sql-prevent-duplicate-paid-registrations.sql`: su indice unico por correo/evento bloquea el modelo multi-ticket. `desc/sql-multi-ticket-order-model.sql` elimina ese indice.

## 7. Configurar Stripe

El checkout crea precios dinamicos con `price_data`; no hace falta crear un precio por etapa en Dashboard.

Para cupones:

1. Crear primero un Coupon en el entorno correcto.
2. Crear un Promotion Code con el texto que escribira el usuario.
3. Evitar restricciones de producto, salvo que los line items usen productos Stripe persistentes compatibles.
4. Probar el codigo mediante `/api/validate-promo-code` y tambien creando una sesion real.

Una respuesta correcta de validacion no garantiza que Stripe acepte el descuento al crear Checkout. Siempre comprobar subtotal, descuento y total dentro de la sesion Stripe.

Webhook Test de Preview:

```text
https://<alias-estable-preview>/api/stripe-webhook
```

Evento minimo requerido:

```text
checkout.session.completed
```

Conservar el webhook Live de Production sin cambios hasta el despliegue final.

## 8. Compilar

Editar solo los archivos fuente de la raiz y `api/`. Despues ejecutar:

```bash
npm run build
```

El build:

- Regenera `script.min.js` y `styles.min.css`.
- Elimina y vuelve a crear `public/`.
- Copia HTML, JS, CSS, recursos y PDFs permitidos.
- Sustituye `__ASSET_VERSION__` para evitar cache antiguo.

Nunca aplicar correcciones manuales unicamente dentro de `public/`; se perderan en el siguiente build.

## 9. Pruebas obligatorias en Preview

### Etapas y UI

- [ ] Antes, durante y despues de cada etapa se muestra el estado correcto.
- [ ] Nombre, imagen, fecha, lugar, regreso y distancia corresponden a la nueva carrera.
- [ ] Una distancia invalida es rechazada por el backend.
- [ ] El precio visible coincide con el calculado por el backend.

### Compra

- [ ] Compra individual sin cupon.
- [ ] Compra de dos tickets sin cupon.
- [ ] Compra de dos tickets con cupon.
- [ ] El subtotal, descuento y total coinciden en UI y Stripe.
- [ ] Cada ticket crea un participante y un dorsal distinto.
- [ ] La distancia queda persistida en todos los registros.
- [ ] Una sesion cancelada o expirada no queda como pagada.

### Correo y cuenta

- [ ] Llega el correo con evento, modalidad, participantes, dorsales, kit y exoneracion correctos.
- [ ] Reenvio individual funciona.
- [ ] Un correo que ya compro otra carrera puede comprar la nueva.
- [ ] El perfil del mismo correo muestra ambas carreras.
- [ ] Comprar con una sesion iniciada de otro correo no asocia la compra a la cuenta incorrecta.

### Success y administracion

- [ ] `succes.html` muestra carrera, distancia, monto y todos los participantes.
- [ ] El enlace de exoneracion corresponde a la carrera.
- [ ] Admin filtra la carrera y muestra distancia, monto y dorsales.
- [ ] Transferencia manual acepta solo las distancias configuradas.
- [ ] CSV incluye los datos correctos.

### Integraciones

- [ ] Webhook Test responde `2xx` y procesa `checkout.session.completed` una sola vez.
- [ ] Meta CAPI usa nombre, monto y slug correctos.
- [ ] Los registros fallidos se pueden reintentar sin duplicar dorsales.

## 10. Limpiar las pruebas

Antes de fusionar:

1. Expirar las sesiones Stripe Test que no se pagaron.
2. Eliminar solo registros `pending` o compras Test identificadas por `order_session_id`.
3. No borrar compras reales ni reiniciar dorsales de otras carreras.
4. Confirmar el siguiente dorsal del evento con `get_next_event_bib_number`.

## 11. Fusionar y verificar Production

```bash
git status --short
git diff --check
npm run build
git push -u origin preview/nueva-carrera-checkout
```

Despues de aprobar Preview:

1. Fusionar la rama a `main` mediante PR o merge acordado.
2. Confirmar que Production usa `sk_live_...` y su propio `whsec_...`.
3. Confirmar que el webhook Live sigue apuntando a `/api/stripe-webhook`.
4. Abrir la pagina publica y probar enlaces sin efectuar cobros innecesarios.
5. Revisar logs del primer pago real, Supabase, correo y dorsal.

## Criterio de terminado

Una carrera esta lista cuando pagina, checkout, precio backend, cupones, Stripe, webhook, Supabase, dorsal, correo, success, perfil y admin reconocen el mismo `event_slug`, y el flujo completo fue pagado al menos una vez en Stripe Test.

## Mejora recomendada

Los datos del evento estan duplicados en frontend y varias funciones API. Antes de incorporar muchas mas carreras conviene crear un catalogo compartido que centralice nombre, distancias, fechas, documentos y entrega de kits. Esto reduciria el alta futura y evitaria diferencias entre checkout, correo, perfil y admin.