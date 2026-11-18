# Internal support notifications V1

New pending tickets and the latest visitor-driven reopening (existing `visitor_reopened` activity) are the only alert signals. Messages, manual refresh, polling and repeated requests do not create independent alerts. A manual administrative status change is not treated as a visitor reopening. The worker derives jobs from persisted tickets/activity; saving or responding to a ticket does not depend on the queue, Resend or scheduler. A resolved/in-progress ticket, or an alert superseded by a later reopening, is not eligible when claimed.

Each worker invocation leases up to three jobs, with recovery after a two-minute lease. Unique source events and a stable Resend idempotency key prevent duplicates, including timeouts and uncertain acknowledgments. Retryable failures get exponential delay, at most five attempts. Jobs with permanent errors, a changed mail configuration after claiming, or an expired 23-hour retry window stop and need human investigation; never reset them automatically after the provider idempotency window. The queue retains stopped and sent states without storing email addresses, message body, provider payloads or credentials. It does not constitute an inbox delivery receipt: `sent` means Resend accepted the request.


## One-minute scheduler compatibility (prepared; not configured)

Use an external HTTPS scheduler that supports **POST**, custom **Authorization** headers and a one-minute interval. **Do not use Vercel Cron directly** for this route: Vercel Cron sends GET while this worker intentionally accepts POST only (GET returns 405). Do not weaken the worker to allow anonymous GET, put the secret in a query string, or expose it to the browser. GitHub Actions scheduled workflows are not a reliable one-minute replacement.

One documented compatible option is [cron-job.org](https://cron-job.org/en/faq/), which supports every-minute schedules, POST and custom headers. At activation time, configure **one** job in its protected account, initially **disabled**:

| Setting | Required value |
| --- | --- |
| Destination | `https://kinetichub.com.mx/api/data?action=support-notification-worker` |
| HTTP method | `POST` (not GET) |
| Interval | Every minute, UTC |
| Request body | Empty (no JSON body) |
| Request header | `Authorization: Bearer <SUPPORT_NOTIFICATION_WORKER_SECRET>` |
| Redirects | Disabled; request only the intended HTTPS host |
| Response logging | Minimize/disable saved response bodies where supported; do not log request credentials |
| Enabled | **No**, until database, deployment, secrets and controlled test are approved |

The placeholder in the authorization header is **not** a usable secret: generate a unique, strong secret in a secure environment and store exactly the same value in Production and in the scheduler's protected configuration. Never put the secret in Git, documentation, screenshots, PR comments, URL parameters, or participant-facing JavaScript. Consider that a third-party scheduler necessarily holds this credential: use a dedicated secret with no other privileges, protect its account with MFA and rotate/revoke on compromise.

Before enabling, verify the configured job with the feature flag disabled (expect 503, no database claims and no email), then use one authorized, synthetic test event after setting the UTC cutover. Check 401 on a deliberately missing/invalid header using nonsecret test inputs; check that a legitimate authenticated run returns only aggregate counts; confirm at most one email for the source event and no messages inside the email. A successful HTTP 200 means the worker completed its batch, **not** that the email reached the recipient. Confirm actual receipt separately. Set alerts for repeated 401/403/405/5xx, timeouts and jobs stopped after provider retries; do not automatically replay stopped jobs. Activate only after a separately approved change window.

If this scheduler provider is unsuitable for the account or security requirements, select another POST-capable scheduler and document its credential handling before activation. No scheduler account or job is created by this PR.

## Activation (not performed)

1. Review and apply `20261118183000_support_internal_notifications.sql` only after explicit authorization. Verify table/RPC grants; no browser role may use them. Deploy code with the worker disabled.
2. Confirm the single administrative destination `SUPPORT_NOTIFICATION_TO` and a verified Resend sender `SUPPORT_NOTIFICATION_FROM`. Use existing `RESEND_API_KEY` only if its scope covers this sender. No fallback to contact recipients or visitor Reply-To. Require the official HTTPS origin in `SITE_URL`.
3. Configure a dedicated strong `SUPPORT_NOTIFICATION_WORKER_SECRET`, a fixed UTC activation cutover `SUPPORT_NOTIFICATION_START_AT` (do not backfill historical cases by default), and a separately approved server-side scheduler.
4. Enable `SUPPORT_NOTIFICATIONS_ENABLED=true` only after verifying the above. Scheduler sends `POST /api/data?action=support-notification-worker` with `Authorization: Bearer <worker secret>` and no body or extra query. No scheduler is configured in this change. No new Vercel function.
5. Check queue status and send counts without exposing data. To pause, disable the flag and scheduler. Keep queue rows and stable settings for recovery; do not blindly replay stopped jobs.
The email describes the state at detection/claim. A ticket may be handled before the recipient opens the protected inbox.
