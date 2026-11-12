# Cascanueces Run 2026: kit pickup update

## Operational information

Kit pickup: **sábado 5 de diciembre de 2026, 10:00 a 16:00 horas**, Huerto Educativo del Bosque de San Juan de Aragón, CDMX.
Race unchanged: **domingo 6 de diciembre de 2026, 08:00 horas**.

## Documents and stable URLs

The supplied files were copied byte-for-byte, not legally edited:

| Document | Existing URL path | Pages | SHA-256 |
| --- | --- | --- | --- |
| Convocatoria | `/assets/events/cascanueces-run/legal/Cascanueces%20Run_convocatoria.pdf` | 3 | `9790f7149c5b835d611759f4a8838cc40af985c9d8645fcba20912b6e0b5424e` |
| Exoneración | `/assets/events/cascanueces-run/legal/Cascanueces%20Run1.pdf` | 2 | `d8225180f917d2b7c1b29dd08dc95bcc4997694533a64ac0f3c8a3285f9dc224` |

Both source assets and `public/assets/` use those same bytes. All five pages rendered successfully and were visually inspected. The convocatoria states December 5, 10:00–16:00. The waiver states December 5 and race start 8 am, but does not specify pickup hours.

## Legal review pending Mariana — NOT legally approved

- Waiver page 1, section 1: refers to **“Santa Run”** despite its Cascanueces heading.
- Waiver page 2, section 6.1: refers to **“Axolote Night Run”**.
- Waiver page 2, signature: fixes the date as **31 de octubre de 2026**.

Ask Mariana for confirmation or corrected legal originals before legal approval. These inconsistencies were preserved as supplied; operational replacement is not legal approval.

## Scope and verification

Only Cascanueces pickup data, future confirmation-email copy, the four PDF assets, tests and review notes change. Public URLs, race date/time, other events, payment behavior and participant records remain untouched. Email tests use mocked Resend; no email delivery or remote database call is required.

Focused checks: `node --test tests/cascanueces-kit-pickup.test.js tests/stripe-webhook.test.js`.
Full suite: `npm test`. Build: run `node build.js` only in an isolated scratch copy, because it deletes and rebuilds `public/`.

No merge or deploy is authorized. Push to the feature branch and a prepared PR are separate from production publication.

## Observed results

- Focused tests: 60 passed, 0 failed, using mocked email delivery.
- Independent full suite: candidate 1,295 tests, 1,271 passed, 24 failed; baseline 1,292 tests, 1,268 passed, the exact same 24 failures. No candidate-only failures.
- Isolated build: exit 0; generated event data and both PDF assets match source bytes.
- Existing download URLs: local HTTP 200, `application/pdf`, expected SHA-256 for each.
- PDF visual inspection: all five pages inspected; legal inconsistencies retained.
- Website visual inspection: pending because the browser access host is unavailable.
- Native review: preflight only; no START, consent or approval. Untracked intended-file declaration is pending if review proceeds.

## Prepared PR

Title: `fix(cascanueces): update December 5 kit pickup and official PDFs`
Base: `main`; head: `fix/cascanueces-kit-dec5`.

Summary: update schedule, pickup block, FAQ and future confirmation copy; replace both documents without URL changes; preserve race December 6 at 08:00 and all payment/participant behavior. Legal approval remains pending Mariana.

Delivery is pending the user's decision on the existing suite failures and unavailable website visual proof. No commit, push, merge or deploy has been performed.
