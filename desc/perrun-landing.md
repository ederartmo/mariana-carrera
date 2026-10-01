# Perrun — photographic visual integration

Presentation only. Architecture, checkout, backend pricing, event rules, dates and URLs are preserved.

Five photoreal images generated with built-in image_gen from the supplied poster and logo. Original client logo is preserved. Exact prompts and source paths are in perrun-visual-assets.json. One image per block serves desktop and mobile; no separate variants were needed.

| Block | Asset under assets/events/perrun-2027/visuals | Dimensions |
| --- | --- | --- |
| Hero | perrun-hero.webp | 1448x1086 (4:3) |
| Dog kit | perrun-kit-perro.webp | 1000x1000 |
| Human kit | perrun-kit-humano.webp | 1000x1000 |
| Plate | perrun-placa.webp | 1000x1000 |
| Final CTA | perrun-cta-final.webp | 1600x900 |
| Client logo | perrun-logo-clienta.png | 286x155 |

Images use object-fit: cover and fill their containers to the top and bottom. The hero preserves its 4:3 ratio. Responsive framing retains the primary subjects and kit elements. Map remains a clearly labeled pending slot; no map was invented.

Perrun uses burgundy, gold, cream and natural green. Mobile CTA precedes the hero image, categories remain 2x2, and FAQ uses the existing accordion.

Validation: 679/679 tests PASS; build PASS. Browser widths 390/430/768/1440: no horizontal overflow, five photographs loaded, cover on every image, full container height, mobile CTA before image, FAQ opens, no page errors. Axolote and Cascanueces initialize with their original slugs.

The supplied PDFs were reviewed separately. Their presale end date differs from approved configuration (30 versus 31 October); no event configuration was changed. See perrun-documentos-revision.md.
