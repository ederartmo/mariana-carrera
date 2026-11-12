# Selective recovery evidence

Base: `5aeca1404c151415ba13fe777de324c1769af35e` (`origin/main` fetched before isolation).
Worktree: `.worktrees/visual-recovery`, branch `recovery/event-gallery-countdown`.
Approved public reference: https://mariana-carrera-71pg8t6dl-ederartmos-projects.vercel.app/
Historical SHA: `ee6279b3e238199f59df674a6d4092b7a767a459`; unavailable as a Git object. This recovers published frontend artifacts, not that commit or its backend.

## Inventory and provenance

`rescue-manifest.json` records all 109 requested resources: URL, HTTP status, content type, bytes, SHA-256, dependencies and differences against the committed base. The downloads were first preserved in a system temporary directory outside the repository.

| Recovered resource | Integration |
| --- | --- |
| `event-countdown-cta.js` | Original escaped countdown renderer |
| `event-memories.css` | Original visual rules; missing historical banner mapped to main's existing Cascanueces banner |
| `gallery-viewer.js` | Original native-dialog viewer, navigation, download and focus restoration |
| `axolote-galeria.html` | Published gallery; old SHA cache keys replaced with build placeholders |
| `featured-events.js` | Reviewed gallery/countdown/order changes applied to current file; Perrun target and label use current pricing config |
| `home-corporate.js` | Reviewed visual hunks: past/next cards, clocks and gallery link; clinic gallery and existing widgets retained |
| `script.js` | Only reviewed multi-clock/status function and filter display fix; not an old shared-script replacement |
| `event-landing.js` | Countdown CTA projection using current event date/time or Perrun sales close; existing calendar fallback retained |
| Main HTML pages | Targeted CSS/script includes, catalog clocks, closed Axolote/gallery access; existing unrelated catalog cards retained |

No historical `styles.min.css` was copied: it matched main. No API, webhook, Supabase, auth, admin, checkout, event configuration, PDF or mail implementation was replaced.

## All 96 photographs

48 full photographs plus 48 thumbnails, `axolote-01` through `axolote-48`, are present under `assets/events/axolote-night-run/photos/`.

**96/96 passed** HTTP 200, `image/webp`, nonzero length, SHA-256, Pillow `verify()` and full decode/load. Missing or invalid images: **0**. See each individual manifest entry for its dimensions, size and hash.

## Behavior

- Home and catalog: Cascanueces clock targets December 6, 2026 at 08:00 CDMX; Perrun clock uses `KineticHubPerrunEvent.pricing.salesClose` from main.
- Closed clocks show race-start or registration-closed messages rather than negative time.
- Axolote shows the completed-event state and gallery. Its existing server cutoff remains unchanged; historical participants are not modified.
- Cascanueces pickup remains December 5, 10:00–16:00; prices, stages, checkout, PDFs and future emails remain main's versions.
- Gallery keeps full-size fallback links; native dialog supports previous/next, arrow keys, Escape, download and focus return.
- `__ASSET_VERSION__` is resolved only by the existing build. Root sources are authored; corresponding `public/` files and `script.min.js` are generated in scratch and copied back selectively.

## Verification ledger

- RED observed before integration: new missing-resource/behavior tests failed.
- Focused source checks: `node --test tests/visual-recovery.test.js tests/cascanueces-countdown.test.js tests/cascanueces-kit-pickup.test.js tests/axolote-closing.test.js` — 22 passed.
- Baseline full suite: 1,308 tests, 1,284 passed, 24 failed, 0 skipped.
- Candidate full suite: 1,313 tests, 1,289 passed, the same 24 failed, 0 skipped. No candidate-only failures under the same sanitized/no-external-network runner.
- Isolated baseline and candidate builds: exit 0. No build runs in the primary or other worktrees.
- Independent verifier found one missing historical CSS image. A single correction mapped it to a current asset; the new resource-existence regression failed before correction and passed afterward.
- Headless Chrome local visual checks PASS at 1600x900 and 390x844. Both sizes: 48/48 thumbnails loaded, viewer 1 -> 2 -> 1 -> 48, Tab navigation, Escape closes and restores focus. No JavaScript console errors/exceptions or horizontal overflow; mobile modal width 352px.
- Captures in `evidence/`: desktop-comparison.jpg, mobile-comparison.jpg, gallery-desktop.png, gallery-viewer-desktop.png, candidate-mobile-gallery-grid.png and candidate-mobile-gallery-modal.png. JSON files contain machine observations.
- Comparisons stage the active-events widget minimized at both sizes. External fonts, Lucide, Supabase CDN and Meta are blocked before navigation; this proves local layout/interactions but not CDN typography/icons, live authentication/integrations or physical-device behavior.
- Actual landing-helper branch checks passed for Cascanueces target `2026-12-06T08:00:00-06:00` and Perrun target `2027-01-25T16:00:00-06:00`.
- Final post-correction targeted suite: 28/28; parent spot check: 22/22. Relevant generated assets copied back via an exact 111-path allowlist. Final preview build uses `recovery-ee6279b3-preview`; normal Vercel build still uses its own commit SHA.
- Native risk assessment: medium, review_due=false (`under_budget`); no review START, consent, authority or approval created. Independent verification completed. New files are marked intent-to-add only for diff visibility; no content commit is staged.

Implementation and QA performed no purchases, actual emails, production data operations, migrations, merges or deployments. Existing legal-document inconsistencies remain outside this visual recovery scope.

## Authorized branch publication

The user subsequently authorized final diff verification, one commit named `feat(home): recover event countdowns and Axolote gallery`, and push exclusively to `recovery/event-gallery-countdown`. No merge, manual deployment, production changes or PR creation is authorized. Before publication, origin/main was confirmed unchanged at the recorded base. The final independent audit covered all 242 files; four machine-evidence JSON files had absolute local paths replaced with portable evidence labels. Git's confirmed commit identity and push outcome are recorded in the delivery response and persistent task mirror, not inferred here. A Git-integrated hosting provider may create an automatic preview from a branch push; no manual deployment command is part of this delivery.
