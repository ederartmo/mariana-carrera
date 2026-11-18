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


## Production execution without exporting credentials (temporary admin path)

The same reviewed `main(['--send-once'], process.env)` logic can now run inside a serverless Production function through `POST /api/data?action=admin-support-notification-one-shot`. The admin panel has a single-use button for this purpose. This route is **fail-closed** unless ALL conditions hold:

- `VERCEL_ENV=production`, worker flag `SUPPORT_NOTIFICATIONS_ENABLED=false`, exact Supabase Production URL;
- `SUPPORT_NOTIFICATION_TEST_EXPIRES_AT` is an exact ISO UTC timestamp in the **next five minutes**; absent/expired/future-distant value rejects before credentials are used;
- Request has Origin and Host matching official Kinetic Hub HTTPS domains, no request body or extra query;
- User has a valid Supabase access token and is in existing server-side `ADMIN_EMAILS` allowlist;
- Fixed fixture is pending; unique `(kind, source_id)` reservation does not exist.

**Activation:** verify the fixture and reservation in Production and the cron job is inactive; configure the temporary expiring variable in **Vercel Production** and deploy the reviewed commit. After Production READY, the admin clicks the explicit one-shot test button in the support panel within the five-minute window. Never activate the general worker; never rerun even if a call gives an uncertain result. No credentials are copied to an operator machine or browser; the browser sends only its existing admin session token.

**Retirement:** expiration automatically blocks the path. Remove the temporary expiry variable and redeploy, verify worker `false`, keep cron disabled, inspect exact reservation and Resend acceptance, then inbox receipt. Remove admin button/route and CLI after verification in a follow-up PR. Do not delete the terminal reservation or attempt a second send.

**Caution:** Vercel environment variables apply when deploying and are immutable for an existing deployment. Set the five-minute expiry as near as possible to creation/deployment; if it expires before READY, do not extend or refresh it without a fresh explicit authorized production preflight. This route is NOT enabled by this PR alone.
