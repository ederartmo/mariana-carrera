# Support operator access

Use `/soporte.html` for ticket operations only. This page mounts the existing support client but does not load the registration dashboard, payment tools or notification test controls. The HTML grants nothing; every list, detail, reply or update is authenticated at `/api/admin-support`. Only that handler uses the support authorization. The general admin guard, notification worker and notification test routes are unchanged.

The server accepts existing general administrators and separately allows confirmed, non-anonymous Supabase Auth accounts with a valid authenticated UUID and an email listed in `SUPPORT_OPERATOR_EMAILS`. Assignee filters and assignment accept the union of current general administrators and support operators. The PR #30 actor UUID, display labels and historical records are unchanged. The roster is server-side; only authorized support staff receive the existing assignee identifiers needed for ticket assignment.

## Release and verification (not executed)

1. This is stacked on PR #30 to reuse its verified actor and display-label contract. Review/merge #30 separately when approved, then retarget/rebase this PR onto main if necessary and recheck the diff and permissions. Do not enable the role from the preview.
2. After explicit Production authorization, set the server-only `SUPPORT_OPERATOR_EMAILS` in Production, adding the approved account while preserving any existing operator entries. Do not change `ADMIN_EMAILS`, Supabase Auth, notification flags or cron. An absent list grants no operator access. Apply via a separately authorized Production deployment.
3. In the official origin, use the real support session and open `/soporte.html`; verify the ticket list returns HTTP 200. Verify the general dashboard still denies the operator and a read-only general API request returns 403 for that same session. Confirm a current general admin still sees both dashboards. Do not write tickets, export data, log tokens or capture personal data during this check.
4. Revoke by removing only that entry and deploying the resulting config; verify the same session loses support access. Retain all audit IDs and historical assignments. Do not use service credentials as proof of an operator's access.
