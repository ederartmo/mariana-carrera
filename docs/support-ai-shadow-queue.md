# Support AI shadow queue (local candidate)

The existing visitor RPC signature and response are unchanged. A newly inserted visitor message can enqueue exactly one job within the same transaction, after the ticket version is incremented. An explicit ticket scope with verified history and both scope and tenant enabled is required. No scope is seeded, and no historic ticket is made eligible by its NULL pause. Legacy messages with unknown provenance and all admin messages prevent evaluation. Existing jobs only reference original messages; results never enter support_messages.

The worker is not wired to any API, scheduler or CLI. A trusted server would have to invoke runShadowOnce with both SUPPORT_AI_SHADOW_ENABLED and SUPPORT_AI_PRIVATE_ENABLED enabled, the server-selected tenant and model, a key and a server RPC client. Do not set these flags or provision an enabled scope as part of this candidate. The worker uses the existing evaluator with empty history; only the evaluator's minimized payload reaches its injected transport. Proposal rows store structured decisions, not generated free text or visitor bodies. Job keys bind the proposal to ticket, message, tenant, ticket version and the stable attempt UUID; join that UUID to the ledger for usage.

Claim transactions use SKIP LOCKED and 60-second leases. The ticket is locked before scope, job and tenant quota in the gate; reservation runs only with at least 15 seconds left in the lease, and the network stage has the existing maximum 10-second deadline. Finalization checks the fence and eligibility again. An expired lease can be recovered only when there is no durable reservation. A recorded reservation on an expired lease marks the job uncertain, even if usage exists; no second inference. The worker must use a client that resolves a reservation RPC only after server commit and never retries ambiguous mutations. No SQL lock is kept during inference. A ticket or scope change permanently invalidates stored current proposals; a late result is either obsolete or denied by the fence, never current.

No direct grants on the new tables. Only service_role may call the four exposed helper RPCs; the existing browser and operator sessions cannot exercise that role directly. Worker credentials are privileged across tenants and must not be shared or reused on the client. A future operator surface needs explicit ticket authorization, current scope/version checks and a dedicated narrowly granted read method. No publish action is included.

## Local verification

- node --test tests/support-shadow-queue.test.js tests/support-ai-evaluation.test.js tests/support-ai-private-eval.test.js tests/support-api.test.js tests/support-db.test.js tests/support-agent-atomic.test.js
- node scripts/test-support-shadow-postgres.js (local preinstalled PostgreSQL 17 image, no network/ports; independent connections and server-side latency sampling in synthetic transactions).
- npm run build in the isolated worktree; generated unrelated public files must not be included.

## Release risks

Migration adds a uniqueness constraint to existing messages; assess index size, lock duration and rollout before any remote application. Enqueue failure rolls back the visitor write when the feature is enabled; confirm operational alerting and keep feature off until approved. Cancelling after dispatch cannot revoke an already-started external request; finalization makes the result unusable, but cost may remain. This candidate adds no scheduler, retention policy, operator read UI, automatic enrolment or new credentials. Production and remote QA remain out of scope.
