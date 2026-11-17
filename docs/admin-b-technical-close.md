# Module B technical closure

## Current reconciliation — 2026-11-16

Candidate branch: `fix/admin-b-technical-close-pr`, worktree `.worktrees/admin-b-pr`.
Current base: `a0908f66f8a73ff8bf967d0138a2a30df47a6e6c` (`origin/main`, fetched for this continuation).
The prior worktree and every one of its nine changed/untracked files were preserved byte-for-byte, with a verified backup outside the repository. Upstream changed only four Cascanueces schedule/test files since `4851334`; none overlaps this module-B patch. All nine files transferred with matching hashes; no merge/rebase/reset was used. Internal task notes are not part of the PR.

### Final diff inventory

- `api/admin-update-participant.js`: select registration status; deny cancelled POSTs before RPC and convert locked-RPC cancellation conflicts to HTTP 409. Authorized GET history remains available.
- `admin-inscripciones.html` and `public/admin-inscripciones.html`: invalidate old editor state during loads; guard cancellation; bind each asynchronous save to the captured registration/opening; ignore stale completion effects; prevent duplicate in-flight submission. Unrelated public asset versions are preserved.
- `supabase/migrations/20261115020000_admin_participant_cancellation_guard.sql`: replace only the existing RPC definition, adding a cancellation guard after `FOR UPDATE`; preserve its signature, snapshot and distance validation, protected fields, atomic audit, fixed search path and service-role execution restrictions.
- `tests/admin-update-participant.test.js`: cancelled/API/RPC-conflict and administrative authorization regressions.
- `tests/admin-participant-changes.test.js`: synthetic status fixture, additive SQL application and rejection/audit/financial invariants.
- `tests/admin-participant-editor.test.js`: stale load/auth/POST ordering, closed/replaced modal, duplicate submit, cancellation, search and visible conflict regressions.
- `scripts/test-admin-participant-contention.cjs`: opt-in real PostgreSQL two-backend contention and privilege regression, without production access.
- This report: scope, proof, migration consequences and publication prerequisites.

### Current test evidence

- Focused command: `node --test tests/admin-update-participant.test.js tests/admin-participant-changes.test.js tests/admin-participant-editor.test.js` — **49/49 passed**, repeated by the parent.
- Independent additional stale GET-error/POST-error VM probes: **2/2 passed**.
- Full pristine baseline: **1338 total / 1314 passed / 24 failed**. Full pristine candidate: **1351 total / 1327 passed / 24 failed**. Exact failing-name sets match; zero new/missing failures, skips or cancellations. Old counts below are historical, before current main's ten additional tests.
- Independent scratch build: `node build.js` exit **0**. Build and full-suite snapshots were separate; no build ran in either working tree.
- `git diff --check`: passed (line-ending warnings only).

### Real PostgreSQL concurrency proof

Run `node scripts/test-admin-participant-contention.cjs` from this repository with Docker access and the existing `postgres:17.11-bookworm` image. No packages/images are downloaded. The probe uses an empty temporary Docker configuration, a unique temporary container, `--network none`, no published ports/host mounts, tmpfs data and cleanup restricted to its own container. All data and identities are fictitious.

Five scenarios passed on PostgreSQL 17.11, both independently and in a parent rerun:

1. Distinct editor backends: B demonstrably waits on A's `Lock:transactionid`; after A commits, B rejects `40001`, with exactly one audit.
2. Cancellation commits while holding the same row lock: waiting editor rejects `22023`, without an edit or audit.
3. Cancellation rolls back: waiting editor succeeds and creates one audit.
4. Actual `SET ROLE anon`: RPC denied `42501`, row/audit unchanged.
5. Actual `SET ROLE authenticated`: RPC denied `42501`, row/audit unchanged.

Assertions compare the complete stored row, protected identifiers/payment fields and exact audit before/after values. Parent rerun observed backend pairs 147/154, 189/196 and 231/238; each wait named A as B's blocker. Probe exit 0, container absence confirmed. This supersedes the historical unavailable-PostgreSQL limitation below. It does not claim production-schema or HTTP-level concurrency acceptance.

### Migration and remaining authority

The additive migration performs no standalone INSERT/UPDATE/DELETE and no backfill. It does not alter the audit table, its data, RLS or table grants, and does not change payments/BIBs. Subsequent calls retain the existing participant UPDATE/audit INSERT transaction, now refusing cancelled registrations under the lock. Existing rows are not rewritten by migration application; future edits of cancelled rows become errors. Compatible prerequisites are the existing audit migration/RPC signature and `registration_status` column. The original already-applied migration remains unchanged and must not be reapplied.

Replacing a function requires its database DDL lock and can briefly wait for concurrent use. A production release must separately authorize this exact additive migration, execution timing/lock-timeout and rollback planning, then coordinated API/UI delivery and metadata/permission verification. Restoring the old function would reopen the cancellation race; rollback is not an automatic safe recovery.

No new functional defect was found in current independent acceptance. Existing 24 baseline failures, optional-snapshot compatibility and commercial gaps remain explicit limitations. Native review consent for this reconciled candidate is separate from functional acceptance; no native receipt or production completion is claimed.

## Historical implementation and verification (prior base)

## Candidate and scope

Base: origin/main 4851334159a69259afdc586cceca2f045f20010a, fetched before work. PR6 commit1570575 remains integrated and its editor/API/helper match the base. Worktree: .worktrees/admin-b-technical-close; branch: fix/admin-b-technical-close. Other dirty trees were preserved. No transfer-module, pricing, Stripe, email or real participant changes.

## Demonstrated defects and minimal fixes

1. Paid cancelled registrations passed the API and locked SQL editor. New RED tests demonstrated successful mutation where rejection was expected. The API now rejects cancelled POSTs with409; GET history remains available to authorized admins. A new additive local migration20261115020000_admin_participant_cancellation_guard.sql checks cancellation under the existing FOR UPDATE lock. The already-applied20261110090000 migration is unchanged and must not be reapplied. No migration has been applied remotely.
2. Opening B while A was loaded left A's form live; awaiting authentication or POST used mutable global editor identity. RED VM tests reproduced requests targeting B with A's values, stale cache updates, false failures after successful saves and stale completion enabling/closing another modal. Each submission now captures its editor identity/snapshot synchronously; new loads clear old state and disable Save; completion updates only the captured cache target and affects modal controls only while still owning that modal. Duplicate in-flight submit is ignored. Root/public editor regions match; unrelated generated asset-version text in public is preserved.

## Compatibility and business behavior

No new ownership transfer, request approval, deadline or notification policy is introduced. Existing optional expectedSnapshot compatibility remains: the current UI always sends the snapshot loaded from the server, and the locked RPC rejects stale snapshots. Older clients omitting expectedSnapshot retain the documented fallback; they do not provide the same protection against stale form data and should not be treated as equivalent to the current UI. Paid-cancelled rows are rejected, while historical NULL/undefined status compatibility is not broadened into a new status policy.

## Acceptance proof

Existing focused baseline:36/36 pass. Cancellation regression RED:3 failures (API, RPC and409 conflict presentation). UI regression RED:4 failures; the loading-control test was corrected to model an existing DOM button before its asserted RED failure. After minimal fixes and additional invariant tests:49/49 pass.

Runner: node --test tests/admin-update-participant.test.js tests/admin-participant-changes.test.js tests/admin-participant-editor.test.js, with existing dependencies through NODE_PATH. Tests use synthetic API/auth mocks, in-memory PGlite and VM DOM/fetch stubs, never real registrations or email.

Coverage: search by field/event; authorized/unauthorized GET+POST; valid/invalid participant details; paid/pending/cancelled states; Axolote/Cascanueces permitted distances and Perrun exclusion; protected financial/identity fields; unchanged state/audit on rejection; audit rollback; no-op and stale snapshot; UI GET/POST/auth ordering; modal-close during save; duplicate submit; visible409 conflict and preserved local rows. PGlite's concurrent promises are not independent PostgreSQL sessions; a real two-connection lock test requires separate local infrastructure proof and must not be inferred from those tests.

Independent verification completed:49/49 focused pass and2/2 additional stale-error VM probes pass. Full baseline:1328total,1304pass,24fail; candidate:1341total,1317pass,24fail. Exact failed-name sets match, zero new/missing; no runnererrors/skips/cancellations/network attempts. Scratch build exit0,53staticfiles2directories; git diff --check passes. A single cosmetic correction (inscripci?n to inscripción) was first reproduced with an exact-message assertion, then fixed in source/public and independently rechecked1/1; no new full sweep afterward. The complete suite is not green because of24pre-existing failures. No formatter is configured; source normalization is complete. Native high-risk review consent is pending, distinct from this independent functional verification.

## Authorized remote metadata inspection

User explicitly approved read-only metadata inspection through the configured KineticHub connector. Project identity was confirmed before SELECTs. No participant rows, secrets or credentials were requested.

- Table public.admin_participant_change_audit exists; RLS enabled, force-RLS false.
- anon/authenticated SELECT denied; service_role SELECT and INSERT allowed.
- RPC public.admin_update_participant_change(uuid,text,text,jsonb,jsonb,text) exists, SECURITY DEFINER, search_path=pg_catalog,public.
- anon/authenticated EXECUTE denied; service_role EXECUTE allowed.
- Additional effective privilege check: anon/authenticated audit-table SELECT/INSERT/UPDATE/DELETE all denied; sequence USAGE allowed. service_role has SELECT/INSERT/UPDATE/DELETE and sequence USAGE. Existing service-role privileges are broader than SELECT/INSERT; this session does not change them. Do not describe the original grants as an exhaustive least-privilege inventory.
- Returned RPC body matches the original local migration body after line-ending/outer-whitespace normalization. It contains the lock, snapshot, field/event/payment validation and audit transaction, but lacks the newly prepared cancellation guard.

This verifies schema compatibility with the integrated API, not deployment of the new candidate or acceptance of the live panel. RLS and existing grants must be preserved. The old remote migration registry name admin_participant_changes is not treated as an audit-table name. Do not reapply it.

## Release decision and remaining work

Candidate is for synthetic/local acceptance only until independent proof completes. Production release requires separate authorization and reviewed ordering for the additive SQL guard and API/UI, then a new read-only definition/permission check; this session authorizes neither migration execution nor deployment. Do not deploy only the API and claim the cancellation race is closed without the locked SQL guard.

Commercial gaps remain unchanged: participant-submitted requests, approval/rejection, deadlines, automatic notifications and ownership-transfer rules are not implemented by this closure. No commercial-completion claim is made.

The adjacent email-correction endpoint and admin listing both use getAdminUser. Listing defaults to paid+active. Email correction is a separate operation whose UI hides cancelled/unpaid rows but whose server checks authorization/target/Perrun, not those eligibility states; its business-policy reconciliation remains a separate decision, not a fixed property of this participant-editor patch. No changes made to email or transfer endpoints.

Independent PostgreSQL-session contention proof remains pending: Docker daemon unavailable; postgres/psql/pg_ctl and a PostgreSQL service not found. No installations or image pulls attempted. This limits the strength of concurrency proof, rather than proving a failing lock.

Risk: items1/2/3/4 — local privileged SQL function replacement, authorization boundary, shared admin API compatibility and async modal/cancellation races. No production effects performed.

## Exact pre-existing full-suite failures

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
