# Lista de cambios aplicados en la sesion (2026-05-09)

## Alcance
Esta lista incluye los cambios de rendimiento/orden que SI se aplicaron en esta sesion sobre la rama `reconstruccion-may01-may05`.

No incluye cambios funcionales previos que ya venian en el repo desde antes.

## 1) Optimizacion de imagenes (generacion de nuevos assets)

- [x] Se generaron versiones WebP de assets pesados.
- [x] Se generaron versiones AVIF de esos mismos assets.

Archivos nuevos creados:

- `banner.webp`
- `banner.avif`
- `banner-foto.webp`
- `banner-foto.avif`
- `banner3.webp`
- `banner3.avif`
- `evento1.webp`
- `evento1.avif`
- `evento1_1.webp`
- `evento1_1.avif`
- `post1blog.webp`
- `post1blog.avif`

## 2) Prioridad de carga y rendimiento percibido

- [x] Preload del hero principal en AVIF en home.
	- `index.html`: `<link rel="preload" as="image" href="banner.avif" ...>`
- [x] Optimizacion global de imagenes en runtime (lazy/decode/fetchPriority + transicion visual).
	- `script.js`: `setupImagePerformance()`

## 3) Fallback AVIF -> WebP -> original

- [x] Se aplico fallback progresivo en heroes y backgrounds principales usando `image-set(...)`.
- [x] Se conservaron fallbacks PNG/JPG para compatibilidad.

Archivos con fallback aplicado:

- `styles.css`
- `index.html`
- `eventos.html`
- `axolote-night-run.html`
- `blog.html`
- `checkout.html`

## 4) Requisito especifico solicitado

- [x] El hero de Axolote (`event-detail-hero axolote-hero`) quedo apuntando a `banner3` con fallback AVIF/WebP/PNG.
	- `styles.css`: bloque `.event-detail-hero.axolote-hero`

## 5) Limpieza/compatibilidad CSS

- [x] Se agrego propiedad estandar `mask` junto a `-webkit-mask`.
- [x] Se agrego propiedad estandar `line-clamp` junto a `-webkit-line-clamp`.
- [x] Se validaron errores y `styles.css` quedo sin errores de ese tipo.

## 6) Render diferido (mejora de first paint)

- [x] Se agrego `content-visibility: auto` y `contain-intrinsic-size` a secciones below-the-fold para bajar costo de render inicial.
	- `styles.css`

## 7) Refactor de reutilizacion (menos inline repetido)

- [x] Se movieron backgrounds inline a clases reutilizables:
	- `eventos.html`: `event-media media-axolote`
	- `index.html`: `home-blog-card-media media-evento1`
	- `index.html`: `home-blog-card-media media-evento1b`
- [x] Se agregaron variables CSS para centralizar banners:
	- `--hero-banner-image`
	- `--hero-banner-foto-image`
	- `--hero-banner3-image`
	- `--hero-evento1-image`
	- `--hero-evento1b-image`

## Archivos tocados en esta sesion (directamente)

- `styles.css`
- `script.js`
- `index.html`
- `eventos.html`
- `axolote-night-run.html`
- `blog.html`
- `checkout.html`
- assets nuevos listados en seccion 1

## Sugerencia para aplicar en main (cuando decidan hacerlo)

1. Llevar primero `styles.css` + assets nuevos.
2. Luego `index.html`, `eventos.html`, `blog.html`, `checkout.html`, `axolote-night-run.html`.
3. Al final `script.js`.
4. Probar home + eventos + checkout en local antes de deploy.

