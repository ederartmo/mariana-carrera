# Perrun landing — visual pass 2

Presentation only: existing EventLanding, section order, event configuration, stage provider, countdown and checkout URLs are preserved. No event rules, pricing backend, engraving eligibility or dates changed.

## Image slots

All slots are visibly labeled as photography pending. No images were generated or added. Set the image path in perrun-landing-data.js; the renderer replaces the slot when an image is present.

| Slot | Property | Recommended image | Fit |
| --- | --- | --- | --- |
| Hero: runner + dog | images.hero | 1600×1200, 4:3 | contain, no distortion/cropping |
| Final banner | images.finalBanner | 1600×900, 16:9 | contain |
| Dog kit | experience[0].image | 1000×1000, 1:1 | contain |
| Human kit | experience[1].image | 1000×1000, 1:1 | contain |
| Plate / dog | engravingSections[0].media.image | 1000×1000, 1:1 | contain |
| Official map | routeMap.image | 1600×1200, 4:3 | contain |

Suggested asset directory: assets/events/perrun-2027/. Add descriptive alt text when installing real images. No map or departure time is fabricated.

## Composition

Hero: image takes 58% of desktop composition; mobile shows title, date/place, distances, live stage price and CTA before photography. Concept and second-dog sections use horizontal editorial compositions. Engraving uses a strong forest-green photo/copy block. Kit cards use square photography next to kit content. Categories use 2×2 on mobile. Distances and schedule are compact; existing native details/summary FAQ accordion remains in place.

Validation and screenshots are recorded after browser checks in this work pass.

Validation: 679/679 tests PASS with local fixture configuration; build PASS. Chromium 390/430/768/1440: no horizontal overflow, all six image slots present, hero measured at 4:3, mobile CTA before image, categories 2x2, and FAQ accordion opens/closes. No browser page errors. Mobile full-page height at 390px reduced from 12457px to 9496px (~24%). Approved kit/section/schedule/FAQ/modality content compared before/after and identical. Axolote and Cascanueces still initialize with their original slugs.
