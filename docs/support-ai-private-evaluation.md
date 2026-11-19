# Private AI evaluation (PR 40)

No routes, schedules, chat integration or publication path. The default site never imports this code. The CLI is mock-only regardless of environment; it accepts only a new output file path and writes fixture IDs, decision, source ID, reason and pass/fail. It does not write prompt or response text, profiles or ticket data.

```sh
node scripts/support-ai-private-eval.js <new-private-output-file.json>
node --test tests/support-ai-evaluation.test.js tests/support-ai-private-eval.test.js
```

## Persistent quota and recovery

Production application of 20261119030000_support_ai_evaluation_quota.sql is not authorized by this PR. Do not apply it with supabase db push. The checked-in Vercel build runs node build.js and does not execute migrations.

The proposed additive migration 20261119030000 creates only support_ai_limits, support_ai_attempts and their two server-only RPCs. No tenant is seeded. A missing, disabled or mismatched model short-circuits before fetch. Reservation locks the tenant row, uses UTC, deduplicates on (tenant_id, attempt_id) across day boundaries and counts every reservation at full price for the day. Recorded usage is for estimates; there are no refunds or automatic retries, including on timeout or ambiguous database/provider outcomes. Writes contain only internal random attempt IDs, tenant, caps, rate snapshot, and usage. Do not delete ledger entries while replay is possible. On these new objects the service role receives RPC EXECUTE, not direct table access. The RPCs trust that role to supply the server-resolved tenant; a holder of that credential can call them for any configured tenant. Operational tenant configuration is a privileged action. The model receives neither DB credentials nor a tool.

Turning off the tenant row stops new reservations; remove the process enable flag or stop the runner as a second gate. An already-issued reservation or in-flight request is not atomically cancellable by changing a SQL flag. For a strict emergency stop, stop the runner and revoke the dedicated project key if necessary. This module is not an invoice cap: token estimates include transport overhead but are not a certified tokenizer, and prices can change. Do not use it live without validating the cap against the chosen model and setting independent provider-side controls and alerts.

## Before any real private call

1. Obtain explicit approval for a non-Production trial, model snapshot, rate card, daily cap, retention controls, and one synthetic test. GPT-5 mini supports Responses and Structured Outputs but is marked deprecated in its official model card. Compare a supported snapshot, starting with GPT-6.1 Terra as suggested by OpenAI. Use the adapter only through evaluatePrivately (the engine owns the deadline and AbortSignal). Pin the exact snapshot ID returned by Responses; alias-to-snapshot conversion is not implemented. Review pricing and limits immediately before activation. As a comparison, GPT-5 mini lists USD 0.25 input and 2.00 output per million uncached tokens; 2,200 input plus 96 output would be USD 0.000742. At Terra standard uncached rates of USD 1.00 input and 5.00 output per million, the same workload is USD 0.00268/request or USD 2.68/1,000 requests, excluding cache writes and other fees. These are illustrative estimates, not a current recommendation for GPT-5 mini.
2. Verify the exact migration version and catalog in an isolated environment. Apply only that file with a separately approved version-tracked procedure; never use a global db push. Verify RLS, EXECUTE/denials, stable tenant config, limits, concurrency and no other objects changed. Leave the tenant disabled until the remaining checks pass.
3. Provision a restricted project key via a process secret manager as SUPPORT_AI_OPENAI_API_KEY, never in a CLI argument, repository, browser, log or shared artifact. Provide SUPPORT_AI_TENANT, SUPPORT_AI_MODEL and only for the approved private process SUPPORT_AI_PRIVATE_ENABLED=true. Supply an authenticated server RPC client and a server-generated UUID retained across retries. No browser input can select the tenant. Initial context must be synthetic and history empty; do not substitute real tickets. The mock CLI never enables this private transport.
4. Review OpenAI's data controls: store:false prevents normal Responses application-state storage for this request but is not Zero Data Retention and does not by itself remove abuse-monitoring retention. Confirm project eligibility, retention settings and organizational policy. No tools, direct Supabase access or publication.
5. Confirm a single reservation and output with redacted metrics only. Disable the tenant/process immediately afterward. If usage is missing or outcome ambiguous, keep the reservation and do not resend. Before any future publication, derive authorized ticket context and historical verification server-side and recheck ownership, version and human pause atomically at write time.

Official references: https://developers.openai.com/api/docs/models/gpt-5-mini ; https://developers.openai.com/api/docs/models/gpt-6.1-terra ; https://developers.openai.com/api/docs/guides/your-data.
