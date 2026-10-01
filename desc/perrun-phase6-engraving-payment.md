# Perrun Phase 6 — individual engraving payment

## Scope and authority

Each eligible dog has an independent MXN 3500 Checkout payment. The browser sends only flow, main orderSessionId and dogIndex; it cannot select an arbitrary dog_id, amount or currency. Ownership requires the existing signed checkout cookie or a verified authenticated participant email. Same-origin requests are required.

The existing Phase 6A RPCs are the sole mutation authority: reserve_perrun_engraving_payment, record_perrun_engraving_state, finalize_perrun_engraving_payment and mark_perrun_engraving_email_sent. No migration, registration finalizer, BIB allocation or engraving sequence allocation is introduced.

## Checkout and routing

The existing /api/create-checkout-session accepts flow=perrun-engraving-v1. Reservation precedes Stripe creation. Dynamic price_data uses the database amount and currency, quantity 1, allowed card/OXXO methods and a generic description. Session and PaymentIntent metadata contain only flow, event_slug, payment_ref and order_session_id; no PII. No permanent Products/Prices are provisioned by the implementation.

Stripe's idempotency key uses the returned reservation UUID. A creation timeout or attachment failure preserves the same reservation and key. An uncertain unattached reservation older than 23 hours requires manual reconciliation; the application refuses blind creation after the provider's retention window.

Return URLs retain the MAIN checkout session and signed claim. The additional payment is never presented as a second registration.

The verified webhook routes engraving before either registration flow. Stored session identity also catches missing metadata after attachment. It retrieves authoritative TEST session/charge data and checks amount, currency, metadata, reservation, dog and PaymentIntent. Engraving never calls finalize_paid_order or finalize_perrun_paid_order.

## States, retries and refunds

OXXO completed but unpaid stays pending. async_payment_succeeded settles only when Stripe confirms paid. A card decline leaves the same open Checkout retryable. Definitive async failure or expiration permits a new independent attempt through the database RPC. Late paid delivery on an already terminal attempt returns a retryable reconciliation error rather than bypassing the Phase 6A contract.

Duplicate paid delivery is effective once. Full confirmed card refunds affect only the engraving payment, retain sequence/history and remove the pay CTA. Partial or unsuccessful refunds do not mark a full refund. OXXO does not support Stripe refunds; this integration does not invent an alternative refund mechanism.

## Read models and email

Confirmation, profile, admin and CSV derive per-dog paid/refunded state from the ledger. Historical engraving_free and engraving_payment_required flags are preserved. CSV appends engraving_paid and engraving_status. Profile exposes only the minimal dog presentation and CTA eligibility, never internal dog/payment IDs.

The paid email is MOCK ONLY, including outside QA. It has a deterministic per-payment mock provider ID and uses mark_perrun_engraving_email_sent. Provider retries use a stable email idempotency key. No real Resend call, main email flag change or CAPI event is made by this addon flow.

## Local QA

Use only .env.qa.local through the guarded QA launcher; it verifies local credential signature, loopback URL and Stripe TEST keys. The copied browser app replaces remote Supabase references, and the network guard blocks remote Supabase. Neither .env.local nor linked Vercel settings are imported.

The already-approved 20261001162118 migration was applied to LOCAL QA with scripts/perrun-qa-migrate-engraving.cjs. Main data fingerprint was unchanged. Existing tests remain: 4 humans, 6 dogs, BIBs 001–004, counter 301, initially zero engraving payments. Native SQL tests use a separate disposable cluster, not this QA database.

Readiness: node scripts/perrun-qa.cjs check
Server: node scripts/perrun-qa.cjs server
Listener (operator only): stripe listen --forward-to http://localhost:3000/api/stripe-webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,refund.created,refund.updated,charge.refunded

Retain the active listener's matching TEST signing secret in the ignored QA file. Restart the QA server after an operator changes that secret. This phase did not start a listener or perform any payment.

Open Test 4's existing confirmation URL with its valid checkout claim, or its authenticated owner profile. On dog sequence 301, select “Pagar grabado — $35 MXN”. Do not create another registration. Expected after an operator completes card TEST payment: one paid engraving ledger row for that dog, MXN 3500, mock email receipt, “Grabado pagado”, no CTA; still 4 humans, 6 dogs, BIBs 001–004 and counter 301. Original dog sequence/free/required flags remain historical.

## Validation

Baseline Node: 708/708. Phase 6 Node: 758/758. Native PostgreSQL: 146/146; 31 real two-connection concurrency scenarios. Build PASS. No remote database access, real email, Stripe payment, remote endpoint change, push or deploy performed.

Generated public assets are synchronized by the existing build, including previously stale generated copies; source checkout/pricing rules are unchanged.
