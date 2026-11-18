# Support phase one — local QA and deployment prerequisites

## Reproducing the schema in isolated QA

The first versioned migration assumes the legacy `public.inscripciones` composite type. The early setup guide at `daffe06` records manual creation, but its DDL is not the effective table definition. The rate-limit table and RPC were introduced in `0803846` under `desc/`, outside the migration directory. The QA tooling at `9bc1e4d` deliberately overlays the captured function definition instead of assuming the old reference is identical.

Use an authorized metadata-only snapshot matching the structure consumed by `scripts/perrun-qa-db.cjs`. Do not export records or credentials. The local QA replay used the preexisting git-ignored snapshot identified by SHA-256 `bec560588595fb4db90ab058ff6ee9470064fedd49866abe714d968db9c4c8c9`. This is archived metadata, not a new assertion about current production.

1. In a disposable, isolated PostgreSQL 17 cluster, pipe `node scripts/support-qa-baseline.cjs baseline <metadata.json>` into psql with ON_ERROR_STOP.
2. Apply the 19 migrations preceding `20261117145659_support_phase_one.sql` in filename order. Do not change historical migrations.
3. Pipe `node scripts/support-qa-baseline.cjs rate-limit <metadata.json>` into psql. The old SQL initializes its table and grants, and the captured CREATE OR REPLACE supplies the exact archived RPC implementation. This is a QA-only bootstrap, not a deployment command.
4. Apply the support migration and verify the five RLS-enabled support tables, constraints, indexes and RPC execution grants. Verify that preexisting public schema blocks are unchanged. No registrations or payment fixtures are necessary for this replay.

The visitor API uses the existing rate-limiter contract: consume_api_rate_limit(text, text, integer, integer), passed scope, keyed hash, limit, and window; expects allowed/retry_after_seconds/remaining. Verify its current definition, security and grants before a future production release. The endpoint fails closed if the dependency is missing or unavailable.

## Support API and security

- POST /api/support-chat: guest capability or server-verified account; no registration lookup; no public assignee metadata. Human request uses the existing idempotent start/send operation.
- GET /api/admin-support: server-authorized list or detail. List supports status, category, assignee (empty means unassigned), before and beforeId. It returns up to 50 tickets and nextCursor, ordered by immutable created_at and id descending.
- POST /api/admin-support: server-authenticated reply, status/category changes, and allowlisted assignment; expected version and request IDs protect writes.
- Conversations, tickets, messages, activity and idempotency records use separate tables with RLS and no direct anonymous/authenticated grants. Service-role RPCs mediate access. No Stripe, payment or inscription mutations.
- Changing filter/page clears old rows and selection and ignores obsolete responses. Ticket order is by creation, not last update. Filter membership may change while paging; refresh restarts the traversal. Ticket detail still shows a bounded recent history. A removed administrator can remain visible as a historical assignee but cannot receive new assignments.
- AI/WhatsApp are not enabled.

## Verification

15/15 focused API, SQL and UI tests; 125 synthetic tickets traversed exactly once (50/50/25); combined filters and admin grant tested. Independent pager review and recheck 7/7 UI tests. Isolated build and scoped public mirrors. PostgreSQL 17 replay of all 20 migrations plus QA bootstrap passed; five RLS tables, service-only list RPC, cross-owner denial, and two concurrent connections persisted one conversation, ticket and message. No production query or mutation.

## Vercel Hobby packaging

The preview log rejected 14 serverless entrypoints against the Hobby limit of 12. The static build validates public assets but does not enforce the serverless entrypoint limit. Both support URLs now rewrite to the existing api/data.js function; no extra support entrypoint remains under api/. The dispatcher removes its internal action selector before calling either support handler. Chat and inbox logic remain in separate lib/ modules with independent methods, authorization, visitor rate limiting and no-store responses. The browser URLs are unchanged.
