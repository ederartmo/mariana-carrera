# OXXO voucher email incident and recovery

## Status and scope

Based on freshly fetched origin/main `6c76d228772746c801f0cef8fbbe69bdfaabce45`, isolated in `.worktrees/oxxo-voucher-hotfix` on `fix/oxxo-voucher-email`. After publication preflight the user authorized a local hotfix commit only and explicitly withheld push because it could initiate an automatic Vercel deployment. No merge, deployment, real email, charge, voucher creation, production write, DNS, hosting, certificate, or credential inspection is authorized or performed. Historical read-only KineticHub Supabase and Resend investigation was explicitly authorized. Production Stripe remains pending access to KineticHub production.

## Root cause and flow audit

- Checkout creates OXXO-capable sessions in the existing standard and Perrun paths. This patch does not alter checkout, prices, fulfillment or webhooks.
- The signature-verified webhook invokes `sendOxxoVoucherEmail` for unpaid completed Checkout sessions. The sender retrieves fresh session/PaymentIntent state and checks the session-to-PI identity, `requires_action`, OXXO method and `oxxo_display_details`.
- The original sender required both voucher number and hosted URL but passed neither to `renderVoucherEmail`. Neither HTML nor plaintext included them. The original test explicitly asserted their absence, hiding a customer-visible defect behind a passing suite.
- This proves the omission in the application, not the current validity of any live voucher. Historical acceptance by this function implies that its then-current Stripe response passed the old gates; independent production Stripe confirmation is still required.
- A Stripe session metadata receipt (`oxxo_voucher_email_id`), a PI-scoped Resend idempotency key (`oxxo-voucher/<PI>`), and a 23-hour event-age cutoff protect against duplicate sends. No application DB, paid-registration or bib write occurs in this sender. Existing fulfillment remains webhook-owned.

## Patch

- Pass Stripe's `number`, `hosted_voucher_url` and `expires_after` into the renderer.
- Include an inline email button, `Descargar voucher oficial`, opening the existing official Stripe page for downloading/printing. Do not invent a direct PDF URL or attach a fabricated voucher.
- Display the URL visibly in HTML and in plaintext, the available reference, and the actual Stripe expiry in `America/Mexico_City`; never infer validity from Checkout/session creation or configured expiry days.
- Require a finite future Unix-seconds expiry and a safe HTTPS URL on `payments.stripe.com`, without credentials. Invalid/missing/expired data causes no send and no receipt write; direct rendering also refuses an unavailable voucher. The existing sender requirement for a reference number remains intact.
- Retain HTML escaping for customer fields, reference, displayed URL, expiry and link attribute. Preserve existing support copy, provider status/identity checks and duplicate safeguards.

## Read-only impact evidence (2026-11-14)

- The two candidate messages delivered on November 12 at 04:32 and 04:37 UTC share one recipient and show 500 and 1,000 MXN for Cascanueces 5K. Both bodies omit reference, voucher URL and expiry. Supabase rows matched by recipient/event/amount/time are `payment_status=pending`, `registration_status=active`, with no bib; `active` does not mean paid. Persisted `stripe_session_id` and `order_session_id` agree. Full IDs were supplied privately for user Dashboard verification, not written to this document.
- Resend returned 644 unique available messages from October 17 00:45 UTC through November 14 21:24 UTC. The exact OXXO subject appears in 52 messages across 45 unique recipients: 48 delivered and 4 bounced. Four sampled bodies (including the pair) confirm the same omission.
- These are message/recipient counts, not a count of unpaid participants or lost payments. One recipient can have multiple legitimate purchases; duplicate mailboxes do not establish duplicate orders. Do not infer unpaid status for the whole cohort from this pair.
- The available history does not cover October 12–16, although the template commit is dated October 12 (`00fc472`). Body inspection was sampled, not exhaustive. Treat the measured cohort as a lower bound for potentially affected messages, not a complete lifetime incident inventory.

## Tests and verification

Focused command: `node --test tests/oxxo-voucher-email.test.js`.

Baseline: 9/9 passing despite the omission. Before implementation the revised assertions produced three RED failures (content, expired-data refusal and renderer escaping). After implementation: 14/14 passing. Coverage includes official URL/reference/expiry in both bodies, timezone boundary, missing/expired/malformed data, unsafe URLs, HTML attribute escaping, preserved provider gates, repeated/concurrent delivery, old receipts, legacy-payload conflicts, Resend error/throw/missing receipt and receipt-write failure. Rejected sends assert unchanged session/PI data and zero receipt writes. `git diff --check` passed.

Independent scratch verification: candidate focused tests 14/14. Full baseline suite: 1321 tests, 1297 pass and 24 fail. Initial candidate suite: 1326 tests, 1300 pass and 26 fail. Exactly two additional failures used an old OXXO integration fixture without expires_after; the single bounded correction adds a future provider timestamp to that fixture only. Parent and independent blocker-only rechecks: 2/2 pass each. The verifier confirmed the production sender hash unchanged. Full suite is not green and was not rerun after the fixture correction. No meaningful production integration test is authorized because it would require live provider access or sending.

Existing baseline failures (not changed or repaired by this hotfix):

```text
data.js despacha me-registrations
data.js despacha admin-list-inscriptions
data.js despacha resend-emails-list
data.js action desconocida o ausente → 404 sin invocar handlers
Actual checkout page preserves all Perrun distances and explicitly asks when missing
6 actual webhook transport routes addon before registration/Resend
Perrun API rejects an incomplete participant before creating a Stripe session
V2 boundary 297: total 45000, slots 298
V2 boundary 298: total 63000, slots 299,300
V2 boundary 299: total 66500, slots 300,
V2 boundary 300: total 48500, slots
V2 boundary 300: total 70000, slots ,
Unrequested dogs consume benefits; sequence beyond 300 may still be free by slot
Pending OXXO holds slot, late paid consumes same quote; consumed can never release
V1 drafts retain capacity and original finalizer; no reprice or duplicate allocation
Manual uses real manual identity, exact total and one atomic finalization
Sales cutoff rejected at exact close; reserved tariff is immutable
Unrequested engraving after all slots consumed costs zero
V2 quote fixes 700 pesos before Stripe; one Session with dynamic price_data and safe metadata
OXXO pending holds benefit despite Checkout expiry; late succeeded consumes at original amount
Signed quote rejects payload modifications or arbitrary reservation ID; browser price not authoritative
Manual quote requires exact received amount; retry never repeats human; no Stripe call
V2 summary, admin/profile/CSV and mock email show included paid surcharge; no addon CTA
Rollout manual V1 retry stays V1 with flag enabled
```

## Recovery plan — not executed

1. Build a restricted case list keyed by persisted Checkout Session and PI, with event, amount/currency, recipient, participant quantity, original message ID/status, voucher expiry and payment/registration/bib state. Reconcile all supported event paths, not only this pair. Mark missing October 12–16 history as unresolved; seek approved retained logs/exports without changing retention settings.
2. For each existing session, inspect Stripe production via the user's Dashboard or a separately authorized read-only connection. Verify session and PI identities, session/payment statuses, amount/currency (50000/100000 MXN minor units for this pair), OXXO method, voucher reference, official URL and `expires_after`. Do not use a test-mode session as evidence. Do not share client secrets or API keys.
3. Classify before contact: (a) unpaid, `requires_action`, valid existing voucher: eligible for a proposed correction using that SAME voucher; (b) expired or missing voucher: no payment instructions claiming availability, no automatic new reference; (c) paid/succeeded: no payment request, investigate ordinary fulfillment without manual status/bib changes; (d) processing/ambiguous: reconcile first, especially if the customer has a store ticket. `pending` alone never authorizes a resend or a new payment.
4. Do not replay the webhook, erase the existing receipt marker, or change the production idempotency key as a recovery shortcut. Existing receipts suppress repeats; a changed payload under the old Resend key can conflict within its retention window. An incident correction would require its own reviewed, auditable, deduplicated send procedure and explicit authorization; no such sender is introduced in this patch.
5. Before any authorized correction, recheck live payment state and expiry, confirm recipient and purchase intent (do not ask a customer to pay both sessions blindly), preview the exact HTML/plaintext and have the operator approve each case. Handle bounced addresses through verified support contact rather than repeated sending. Record the original/corrective message correlation only under separate write authorization.
6. Publish this patch only after explicit commit/deployment authorization and applicable verification. Then, under separate email/production-write authorization, execute approved corrections and monitor acceptance/delivery. Never mark an unpaid registration paid or assign a bib to compensate for this email defect.

## Publication preflight (2026-11-14)

Reused the existing audited sender without any production-module edits. Added only two focused privacy tests with synthetic sentinels: provider client secrets/unrelated credential metadata never enter the email/receipt output, and success, transport failure, receipt failure and replay warning logs exclude voucher number, hosted URL and secret fields. No real credentials were read.

Fresh isolated verification after the integration-fixture correction:

| Command | Exit | Result |
| --- | --- | --- |
| Candidate focused OXXO tests | 0 | 16 tests, 16 pass |
| Fresh origin/main full npm test | 1 | 1321 tests, 1297 pass, 24 fail |
| Corrected candidate full npm test | 1 | 1328 tests, 1304 pass, 24 fail |
| Candidate npm run build | 0 | 53 static files and 2 directories |
| git diff --check | 0 | No whitespace errors |

Exact failure-name sets match between fresh baseline and candidate, and both match the earlier baseline: zero new failures and zero missing failures. The 24 names listed above remain the complete known failing set; the full suite is not green. No runner/session errors, skipped/cancelled tests or network attempts occurred. The build ran only in a fresh system-temp snapshot because it replaces public output; generated output is not part of the commit. Source/test hashes matched the worktree before and after checks, and the sender still matches the original audited candidate.

Fresh origin/main equals the worktree base, so no incoming changes or merge conflicts were found at preflight. A final read-only fetch is required immediately before local delivery if the remote may have moved.

The authorized read-only Vercel check confirmed Git deployment creation enabled, production branch main, and no ignored-build command. The local vercel.json has no branch exclusion. Pushing this branch could create an automatic preview deployment, so the user selected **local commit only; no push**. No Vercel setting was changed. Preparing a remote branch or PR remains pending a separately authorized no-deploy-safe path; do not infer deployment consent from commit consent.

Intended commit paths: lib/_oxxo-voucher-email.js, tests/oxxo-voucher-email.test.js, tests/stripe-webhook.test.js and this report. The internal task log contains instruction history and remains local, excluded from the publication commit. No checkout/webhook source, pricing or registration changes are included.

## Risks and limitations

Risk: items 3/4 — the webhook-used sender and duplicate-sensitive payload change. No checkout/webhook concurrency machinery is modified, but compatibility and retry behavior require independent verification. Existing recipients are not repaired automatically. Missing expiry now suppresses delivery intentionally rather than claiming a valid voucher; support must reconcile incomplete cases. A hosted Stripe URL provides access to a voucher and should not be published in logs or incident documents. No production voucher has yet been independently verified, so no individual resend is recommended.

Independent verification completed the two fixture-blocker rechecks successfully. Native assessment, after explicit selection of the two new documents, classified the candidate medium/under_budget with review_due=false; no native review, consent or approval was created. This assessment does not authorize publication. No formatter/normalizer is configured; final functional/source checks and git diff --check passed.

## Primary references

- [Stripe: accept an OXXO payment](https://docs.stripe.com/payments/oxxo/accept-a-payment?payment-ui=direct-api) — voucher generation, hosted URL, expiry and asynchronous payment state.
- [Stripe: PaymentIntent object](https://docs.stripe.com/api/payment_intents/object) — authoritative provider fields.
- [Resend: idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) — retention and retry constraints.
