# Administrative changes — follow-up delivery preparation

## Stage-one final technical review

Reviewed against baseline `ae8f54c` in isolated temporary snapshots. No production database or external delivery was used.

- Original focused checks: 34/34 passed. Final focused checks: 36/36; including admin-export and generated-asset checks: 51/51 passed.
- Final candidate suite: 1305 tests, 1281 passed, 24 failed. Baseline: 1292 tests, 1268 passed, 24 failed. Failing test names match exactly; no new failing test remains.
- Fixed a legacy NULL-distance regression: retain NULL by omitting distance, or explicitly choose a catalog distance. Explicit NULL assignment is rejected atomically. Added opening/submission and SQL regression tests.
- Synchronized the generated admin page and its newly referenced catalog dependency without running the full build. Catalog source was not changed.
- Admin authentication, restricted RPC grants, audit rollback, snapshot conflicts, protected columns and history rendering were checked independently.
- Native review mode lookup failed with `Access denied`; no native review receipt is claimed.

### Limitations and release prerequisites

The full repository suite is not green. Existing failures concern data dispatch, Perrun checkout/webhook and engraving V2 pricing/capacity/rollout. They are outside this delivery.

Duplicate retries with an old snapshot return a stale conflict and cannot apply twice; successful-response replay is not implemented. Old API clients omitting the optional snapshot retain compatibility but only receive lookup-to-write conflict protection. The updated browser always sends the loaded snapshot.

PGlite exercises serialized competing edits, not independent PostgreSQL connections. Row-locking was additionally reviewed statically. Paid cancelled rows retain the prior editor behavior; this delivery does not add a cancellation policy or ownership-transfer workflow.

The SQL migration must precede a future deployment of the endpoint. It has not been applied to production. Publishing and production validation require separate authorization.

This document records the scope to decide and approve for a later delivery. It does not implement request handling, approval workflows, deadlines, or notifications.

## Candidate scope for delivery two

1. **Change requests:** define who may request a participant change, which fields may be requested, and how a request is linked to the registration without changing it immediately.
2. **Approval:** identify the authorized reviewer, record approval or rejection with actor and time, and apply an approved request atomically with an auditable result.
3. **Deadlines:** define when requests open and close, timezone, late-request behavior, and what happens to requests already submitted when the window closes.
4. **Notifications:** define recipients, Spanish message content, delivery channel, retries/failure handling, and whether notifications are sent on submission, decision, or completion.

## Acceptance decisions required before implementation

- Confirm the allowed fields and whether different fields have different approval rules.
- Confirm requester identity, reviewer permissions, and whether self-approval is forbidden.
- Confirm deadline dates, timezone, extensions, and late-request policy.
- Confirm notification recipients, channel, message approval, and retry policy.
- Confirm audit retention and the user-visible request status history.

No request, approval, deadline, or notification behavior is part of delivery one until these decisions are approved and separately implemented.
