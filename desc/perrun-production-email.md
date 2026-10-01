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

## Production readiness checks
- Confirm RESEND_API_KEY exists in Vercel Production and belongs to the sending account.
- Confirm kinetichub.com.mx is verified and enabled for sending in that account.
- PERRUN_QA_LOCAL must be absent or different from 1 in Production.
- Existing requireTestMode rejects VERCEL_ENV=production and Stripe LIVE. This audit
  deliberately does not change that payment guard. A separately authorized release
  change is required before actual production Perrun payments can trigger emails.
- No deploy, real email, Stripe change or remote database write was performed here.

The user reconnected the account labeled KineticHub - Resend. Earlier domain reads
returned an older account inventory; after reconnection the connector returned
Unknown tool. Direct credential-domain and Vercel project reads were unavailable.
Production key presence and sender-domain verification remain unconfirmed by this
audit; no conclusion about the newly connected account domain status is implied.

Validation: Node 781/781, native PostgreSQL 146/146, 31 concurrency scenarios, build PASS.
No real emails were sent. The pre-existing uncommitted QA launcher adjustment is
outside this email patch.
