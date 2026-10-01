# Perrun 2027 — local release candidate

## Integration and provenance

Integration worktree: C:/Users/EderArtMo/Documents/Projects/KineticHub, branch feature/perrun-2027.
Initial HEAD/merge-base for both feature branches: 9bc1e4d.
Landing tip: 0e18674 (clean); commits bc127c7, bc179c9, 0e18674 integrated preserving history.
Engraving tip: 4f1f041; da799ac Phase 6A is in history. Only its committed changes were integrated.
The uncommitted dependency-link repair in KineticHub-Engraving was read, left intact and excluded: QA launcher only, not production logic or a Phase 6 prerequisite. Integration already has a correct .qa/app/node_modules junction.
Other worktrees were not written, stashed or committed.

The overlap was generated public/catalog/config assets and public/eventos.html. That conflict was resolved by rebuilding from combined sources. Landing renderer changes are opt-in per event; legacy event data is preserved. Build outputs were regenerated together, preventing mixed landing/payment versions.
No new SQL migration was authored. The previously approved/applied 20261001162118 migration enters this branch unchanged through the engraving merge; all preceding migration sources remain unchanged.

## Public flow

Home and the lower-right active-events widget share featured-events.js. Its third event derives identity/date/location/distances/stage and detail URL from perrun-event-data.js. The events listing already consumes that same canonical Perrun data.
Entries: index.html#carreras, eventos.html, perrun-2027.html.
Landing offers explicit 1K/3K/5K links to checkout.html?event=perrun-2027&distance=<distance>.
Checkout return link now uses the canonical landing URL. Shared server prices/rules remain unchanged.
Canonical stages: 450 through 2026-10-31 23:59:59 CDMX, 500 general, 550 late; close 2027-01-25 16:00 CDMX. Event date 2027-02-14; Bosque de San Juan de Aragón. No departure times per distance are asserted.
Engraving copy explicitly says eligibility follows confirmed payment and a post-300 optional engraving is paid later in an independent MXN35 checkout per dog.

## Validation

Integrated Node suite: 767/767 PASS.
Native PostgreSQL: 146/146 PASS; 31 independent-connection concurrency scenarios.
Build: PASS. Native disposable cluster stopped after tests; shared QA data not reset.
Browser smoke: home/float show Perrun, landing links reach all three correct distances, active price 450, S/M second dog yields 630, L disables second dog, categories S/M/L observed. Mobile viewport overrides 390/430 and desktop1280 show no horizontal overflow. Countdown target/cutoff is verified by tests. Existing Axolote/Cascanueces regression suite passes.
Read-only QA remains 4 humans, 6 dogs, BIB001–004 and counter301. The Test4 HTTP summary shows BIB004, sequence301 and pending engraving CTA. No Stripe Checkout session or payment was created by these smoke tests.

## Production blockers — do not deploy

1. requireTestMode blocks VERCEL_ENV=production and non-TEST keys; main and addon webhook checks reject LIVE objects. Needs an explicitly authorized production-mode change with regression coverage, preserving local isolation. Do not simply delete the guard.
2. Production signing-secret binding cannot be proved from local files. Local keys are TEST; production-scoped keys, webhook secret, checkout summary/rate-limit secrets and account/destination identity need authorized read-only verification. No Vercel/Stripe remote settings were accessed or changed. .vercel/project.json currently has settings only, no projectId/orgId; local link is not valid proof of the target project. Expected project is mariana-carrera/prj_jxGcIbaFYc1eAqPtQ143cQthtu1e. Relink only after authorization.
3. Addon Stripe TEST end-to-end has not been completed. This blocks release of the MXN35 flow.
4. Addon email is intentionally MOCK ONLY; production delivery needs a separately approved real-provider implementation and verified Resend sender/configuration. Main confirmation has a real provider path outside QA, but production configuration was not verified and no real email was sent.
Supabase project-ref is uycwzhlcnfijjyzkgkem; remote migration alignment is reported by the user, not re-queried here. Local service configuration is present. Do not run tests against that remote URL.

Required events:
Main Perrun: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, payment_intent.payment_failed, refund.created, refund.updated, charge.refunded.
Engraving: the same plus checkout.session.expired. OXXO unpaid completion remains pending; card retry failures are not final closure. Full confirmed card refunds retain positions; OXXO does not support Stripe refunds.

## Final MXN35 QA — operator action only

The integrated server is on localhost:3001, deliberately separate from the existing engraving server on3000. No existing listener was modified or started.

PowerShell server, if not already running:
cd C:\Users\EderArtMo\Documents\Projects\KineticHub
$env:QA_HTTP_PORT='3001'
node scripts/perrun-qa.cjs server

In the existing listener terminal, stop its old forward with Ctrl+C before starting the matching TEST listener:
stripe listen --forward-to http://localhost:3001/api/stripe-webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,refund.created,refund.updated,charge.refunded

Use the audited KineticHub TEST sandbox. Put that listener's signing secret only in ignored .env.qa.local, then restart the QA server. Never copy a Production secret.

Open http://localhost:3001/qa/engraving-test-4.
This explicit loopback-only read-only helper selects the known BIB004/sequence301 QA fixture, issues the existing signed cookie and redirects to its main confirmation. It is NOT a deployed API route, not copied to public and cannot choose arbitrary ownership from browser input.
Press “Pagar grabado — $35 MXN”. Check amount MXN35 and TEST mode; only the user completes payment.
Expected: one paid engraving payment, stable idempotent mock email receipt, “Grabado pagado”, no pay CTA. Still 4 humans/6 dogs, BIB004 unchanged, sequence301/counter301 unchanged. Main paid amount45000 remains unchanged; historical engraving eligibility flags are retained. No remote writes.
After the user pays, perform a read-only audit before marking end-to-end PASS.

## Deferred

Evaluate a single registration+engraving checkout with temporary benefit reservations, covering expiration, abandonment, concurrency and OXXO. Do not redesign during this integration.
Further visual polish, official route map, document reconciliation and confirmed departure times remain deferred.

No push, deploy, main merge, remote DB write, remote Stripe configuration change, LIVE payment or real email occurred.
