# Perrun production email audit

Uses the existing webhook-owned Resend SDK client and RESEND_API_KEY. Sender remains
Kinetic Hub <no-reply@kinetichub.com.mx>; no sender environment variable or reply-to
exists in this flow. No APP_URL is required by these emails. No new infrastructure,
Stripe settings or migrations are introduced.

## Paid registration
After finalize_perrun_paid_order succeeds, completed paid / async succeeded events
send the confirmed participant, distance, BIB, dogs and engraving state, persisted
amount_paid (MXN major units), 14 February 2027 and Bosque de San Juan de Aragón.
Pending requested engraving explicitly explains the optional subsequent $35 payment.
Unpaid, failed, cancelled and refunded registrations do not send paid confirmation.
No unconfirmed departure time is included.
A stable per-order Resend idempotency key covers concurrent retries; email_sent and
provider receipt persist the success. Provider or receipt write failures remain retryable.

## Paid engraving
Reuses the same Resend client, sender, existing template and payment ledger.
Stable per-payment provider key plus mark_perrun_engraving_email_sent.
Pending/failed/refunded payments send no paid confirmation. No BIB, sequence or
counter is changed by sending email. Provider errors do not persist a receipt.

## QA
PERRUN_QA_LOCAL=1 blocks the real transport even if a client is supplied.
Tests inject an explicit controlled mock. Main registration QA skips sending and
marking; engraving QA uses a local mock receipt as before. Never enable QA mode
against production data. Test execution also blocks all external network access.

## Existing legacy behavior
Axolote/Cascanueces use this same Resend client and fixed sender. Paid card and
async succeeded finalize before emailing. Unpaid / async failed do not send paid
confirmation; refunds do not trigger it. email_sent prevents sequential duplicates.
Legacy currently has no provider idempotency key for concurrent sends; unchanged.

## Production readiness
Operationally confirmed by the user: the correct Resend account is KineticHub,
recent Axolote/Cascanueces messages are Delivered, and RESEND_API_KEY exists in
Vercel Production. Sender/domain/key/infrastructure remain unchanged. No further
connector verification is required or performed.

Production requires the existing Stripe LIVE key and PERRUN_QA_LOCAL absent or
not 1. Perrun now validates sessions/events against the environment's mode:
Production LIVE, local/Preview TEST. QA marker additionally requires loopback
Supabase and rejects Production. The QA launcher network block remains unchanged.
Checkout, registration settlement/refunds and engraving settlement/refunds use
this same policy. No pricing, dog rules, SQL migrations or legacy flow changed.

The email implementation remains commit 71f4fd2. No deploy, real email, Stripe
configuration change or remote database write was performed. The pre-existing
uncommitted QA launcher adjustment is outside these production changes.
