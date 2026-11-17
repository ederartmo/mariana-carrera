# Supplied Perrun documents and Cascanueces map

Base: `e93278b9883ce5dde42e60c6b7b234b703c2ace9`. Delivery is an isolated review PR, not a production release.

## Exact supplied sources

The user identified the two new PDFs in the original project directory. Names below use normalized Unicode; source files were not renamed, edited or removed.

| Source | Pages / size | SHA-256 |
| --- | --- | --- |
| Copia de Convocatoria Perrun.pdf | 6 / 977457 bytes | `5180f1b2cd6cb3377bf42c5da25fa59b2a109e16f31772576d9938715419710a` |
| ExoneraciónPerrun.pdf | 2 / 1040797 bytes | `1eef1814edbacef10c9c3f30078c8dd06415d8157001791568bdd7873bac1390` |
| bosque-aragon.jpeg | JPEG 1280x1109 / 162091 bytes | `e7a496b39d0885da5b99c3d4720f3471d1fad0920a3cd4485bdfd3eb366f5603` |

All eight PDF pages were rendered and visually inspected. No legal content was authored, corrected, flattened or recompressed. No source requested by the user is missing.

## Placement and existing consumers

- Replace only `assets/events/perrun-2027/docs/convocatoria-perrun-2027.pdf` and `exoneracion-perrun-2027.pdf`, plus their matching `public/` copies, using the exact supplied bytes.
- Perrun landing document buttons are rendered from `perrun-landing-data.js` and its public counterpart. Their existing paths and download attributes remain; query versions now match the new content hashes.
- The confirmation renderer's separate absolute `WAIVER_URL` has only its query version refreshed. No email was sent and no renderer, payment or registration logic changed.
- Existing generic profile/success waiver fallback behavior is outside scope and unchanged; no new flow was invented.
- The Cascanueces information section's existing map card now displays the supplied image at `assets/events/cascanueces-run/route/bosque-aragon.jpeg`, also copied to public. The "Ampliar mapa" link opens the same full-size original through the browser image viewer. It is not an interactive route or an invented distance overlay.
- Cascanueces-only inline CSS gives the map full grid width, preserves its aspect ratio and avoids cropping. No shared renderer, payment code, administrative panel or chatbot was modified.
- Narrow `.gitattributes` entries classify only the Perrun PDF directories as binary, preventing text conversion and misleading PDF text diffs.

## Verification

- RED observed before implementation: 6 map checks and 3 legal-document checks failed against absent map/old assets.
- Focused tests: **70/70 passed** across map, countdown, kit, legal documents, official info and Perrun operations. Parent separately observed **64/64** in the core subset.
- Full baseline: **1351 total / 1327 passed / 24 failed**. Initial candidate: **1360 total / 1335 passed / 25 failed**. The only added failure was a legacy assertion pinning the old waiver hash; corrected to the supplied hash and independently rechecked **1/1 passed**. Remaining 24 failures exactly matched the baseline. No full-suite rerun after this test-only correction; do not claim the complete suite is green.
- Isolated build passed; it never ran in the original dirty working tree or the implementation worktree.
- Source assets, generated public assets and localhost HTTP responses exactly matched the supplied SHA-256 values. Both PDF GETs and map-enlargement GET returned HTTP 200.
- Real isolated headless Chrome tested both event pages at **1440x1000** and **390x844**, using actual built HTML/CSS/renderer with external requests blocked. All page images loaded, download attributes remained, no horizontal overflow.
- Map rendered at 1000x866.406 desktop and 328x284.172 mobile, with natural 1280x1109 ratio and `object-fit: contain`. Four page screenshots and all-page PDF contact sheets were inspected.
- Verification used no production credentials, Stripe/Supabase operations or real emails.

## Content clarification before publication

The supplied convocatoria (page 5) lists package pickup as **10:00-16:00**. The supplied exoneración and existing landing/email list **11:00-17:00**. The supplied convocatoria also gives distance-specific start times while the existing landing still says the start time is to be confirmed.

These differences are reported for Mariana's review, not silently resolved. Supplied legal bytes and existing race configuration remain unchanged. Do not treat technical acceptance as legal approval or merge/deployment authorization.
