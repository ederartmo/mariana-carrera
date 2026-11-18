# Controlled one-shot notification — operator runbook

This is a temporary server CLI, not an HTTP API. It does not call the general claim/finish RPCs or read any message or unrelated ticket. The allowed ticket, Production project and recipient are hard-coded. No migration, new permission or cron is required.

## Before running (separate production authorization required)

1. Verify directly in Vercel Production that `SUPPORT_NOTIFICATIONS_ENABLED` is still exactly `false`; verify in cron-job.org that the job is disabled. Do not change either. Verify the fixed ticket is still the approved synthetic pending ticket and there is no job with `kind='new'` and `source_id='c1af3583-e738-4bb8-af30-2dbfd3910aac'`. If any check fails, stop.
2. On an approved operator machine, use the reviewed checkout with Node 22+ and dependencies installed. Inject existing authorized Production `SUPABASE_SERVICE_ROLE_KEY` and a Resend sending key as `RESEND_API_KEY` via a secure session-only channel; do not paste them into the command, log them or save them in the checkout. Use the approved verified Resend sender as `SUPPORT_NOTIFICATION_FROM`. Do not use the worker bearer. The CLI requires the exact Production project URL.
3. In that short-lived PowerShell session, run the following **once**:

   ```powershell
   $env:SUPABASE_URL = 'https://uycwzhlcnfijjyzkgkem.supabase.co'
   $env:SUPPORT_NOTIFICATIONS_ENABLED = 'false'
   $env:SUPPORT_NOTIFICATION_TEST_EXPIRES_AT = [DateTime]::UtcNow.AddMinutes(5).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
   node scripts/support-notification-one-shot.js --send-once
   ```

   The session flag is a local interlock, not evidence about Vercel. No ticket ID or recipient may be passed. The deadline is checked before both reserving and sending; the outbound POST has an eight-second timeout. No automatic retry.

## Verify and retire

- Before the POST, an atomic insert consumes the existing `(kind, source_id)` slot as a terminal `stopped` row. Only the caller that receives the inserted ID can send. A crash, timeout, uncertain write or duplicate run never makes the row leasable. Do not delete, reset or recreate the reservation or its fixture ticket during verification; the ticket FK cascades deletion.
- `provider_accepted` means Resend accepted and the specific row was marked `sent`. If acceptance was recorded by Resend but the database acknowledgement failed, the CLI returns `provider_accepted_record_unconfirmed`. For any uncertain result, inspect only the test row and the Resend dashboard for `[PRUEBA]` and the folio; never retry. Provider acceptance is not inbox delivery; verify receipt separately in the authorized mailbox.
- Close the operator session to discard credentials and the deadline; do not arm it again. Leave the queue record intact, worker off and cron disabled; remove the utility and its tests/runbook in a follow-up before any general rollout. Do not reopen the fixture under the normal notification flow.
