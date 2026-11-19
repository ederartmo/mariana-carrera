# Support human takeover — PR 1

Migration: `20261119022000_support_human_takeover.sql`. Requires the support schema and `20261119021334_support_agent_atomic_ack.sql`. No OpenAI integration or new browser endpoint. Existing RPC signatures, role grants, RLS, browser session checks, operator permissions and origin checks are unchanged.

- A valid human reply is first inserted, then the reply and takeover are audited and the ticket is updated in the same locked transaction. Only `pending` becomes `in_progress`; resolved tickets stay resolved, and the assignee is untouched. The first human reply records `automation_paused` and sets `automation_paused_at`; later replies and visitor reopenings do not clear it. The current automatic acknowledgment RPC also checks the pause under the same ticket lock. A future AI publisher must check it again under that lock before inserting any output. Legacy tickets may have human replies but a NULL pause; exclude those tickets or check legacy human intervention explicitly before enabling future AI.
- Reuse the original `requestId` and payload on a retry. The existing request ledger and expected version are unchanged; a replay writes nothing, and a different operation using the stale version conflicts. Opening a new operation with a fresh request ID and current version is not a retry.
- New messages written through the current RPCs carry `visitor`, `human_operator` or `automatic_ack` provenance. The schema reserves `ai_generated` for a future publisher, but nothing writes it now. Existing message types and historical content are intact; legacy provenance is NULL. Both transcripts expose provenance additively. Pause time and activity are admin-only.

## Production status — applied; do not reapply

The separately authorized wrapper committed migration `20261119022000_support_human_takeover` on Supabase Production project `uycwzhlcnfijjyzkgkem`. A new connection verified it on 2026-11-19 at 12:23:56 UTC.

- Exactly one row records the version and the canonical SQL (SHA-256 `3caa64d439782730f57ce35740571fee093143b3dbc06fb174c3313df428ff12`). The prior acknowledgment, `20261119021334`, and the remaining history were unchanged.
- All four RPC bodies match the approved migration. Their signatures, ownership, settings and ACL were preserved. The two columns and expected constraints are present; RLS is still enabled on all six support tables.
- This PR does not apply a migration or enable an AI publisher. Do not reapply the wrapper, run a linked/global migration push, or repair history. A future deployment of the code still needs separate approval.


## Reverse without deleting history

If still uncommitted, roll back the migration transaction. After commit, first pause all automation and keep it paused until forward repair. Use a reviewed compensating migration with bounded lock and statement timeouts: restore only the saved pre-change `support_admin_action` body with its original signature and settings; preserve the schema additions, pause timestamps, provenance, event constraint admitting existing pause events, and guarded acknowledgment RPC. This reverses new automatic transitions, not previously committed ticket states or replies. Legacy reply writes during rollback have NULL provenance and do not create a pause; do not restart automation until that interval has been reviewed. Do not delete migration history, drop columns, restore an activity constraint that rejects existing events, or bulk-revert ticket statuses.
