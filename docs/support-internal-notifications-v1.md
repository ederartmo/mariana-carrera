# Internal support notifications V1

New pending tickets and the latest visitor-driven reopening (existing `visitor_reopened` activity) are the only alert signals. Messages, manual refresh, polling and repeated requests do not create independent alerts. A manual administrative status change is not treated as a visitor reopening. The worker derives jobs from persisted tickets/activity; saving or responding to a ticket does not depend on the queue, Resend or scheduler. A resolved/in-progress ticket, or an alert superseded by a later reopening, is not eligible when claimed.

Each worker invocation leases up to three jobs, with recovery after a two-minute lease. Unique source events and a stable Resend idempotency key prevent duplicates, including timeouts and uncertain acknowledgments. Retryable failures get exponential delay, at most five attempts. Jobs with permanent errors, a changed mail configuration after claiming, or an expired 23-hour retry window stop and need human investigation; never reset them automatically after the provider idempotency window. The queue retains stopped and sent states without storing email addresses, message body, provider payloads or credentials. It does not constitute an inbox delivery receipt: `sent` means Resend accepted the request.

## Activation (not performed)

1. Review and apply `20261118183000_support_internal_notifications.sql` only after explicit authorization. Verify table/RPC grants; no browser role may use them. Deploy code with the worker disabled.
2. Confirm the single administrative destination `SUPPORT_NOTIFICATION_TO` and a verified Resend sender `SUPPORT_NOTIFICATION_FROM`. Use existing `RESEND_API_KEY` only if its scope covers this sender. No fallback to contact recipients or visitor Reply-To. Require the official HTTPS origin in `SITE_URL`.
3. Configure a dedicated strong `SUPPORT_NOTIFICATION_WORKER_SECRET`, a fixed UTC activation cutover `SUPPORT_NOTIFICATION_START_AT` (do not backfill historical cases by default), and a separately approved server-side scheduler.
4. Enable `SUPPORT_NOTIFICATIONS_ENABLED=true` only after verifying the above. Scheduler sends `POST /api/data?action=support-notification-worker` with `Authorization: Bearer <worker secret>` and no body or extra query. No scheduler is configured in this change. No new Vercel function.
5. Check queue status and send counts without exposing data. To pause, disable the flag and scheduler. Keep queue rows and stable settings for recovery; do not blindly replay stopped jobs.
The email describes the state at detection/claim. A ticket may be handled before the recipient opens the protected inbox.
