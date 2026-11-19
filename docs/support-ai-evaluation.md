# Support AI evaluation — KineticHub pilot (PR 2)

This is an importable **server-side evaluator**, not a handler, a worker or a publisher. No runtime route imports it. It reads no database, API key, ticket, payment, registration or profile by itself. There is no real provider implementation, SDK call, network fallback, production configuration change or OpenAI charge in this delivery.

## Server contract

- Create one evaluator in a trusted server process with createEvaluationService({ env, provider, limits, now }). Set SUPPORT_AI_TENANT=kinetichub for evaluation only. Missing and unknown tenant configurations fail closed. Never put this value or any model credential in browser configuration. The only registered tenant is KineticHub, with its own instructions, public sources, empty tool list, and evaluation-only permission.
- evaluate({context, message, history, approvedSourceIds}) is for a trusted server caller. The caller must derive context and history from authorized data, not pass through a request or model-generated object. Context contains tenantId, status, automationPausedAt, humanIntervened and historyVerified. Verified history means the trusted caller checked legacy messages and audit for human intervention; NULL pause alone is insufficient. No DB context resolver is implemented in this PR. Any human intervention, pause, nonpending ticket, foreign tenant/history, or unverified history stops evaluation before the provider.
- reviewed source IDs optionally narrow, never extend, the tenant's source catalog. Unknown, ambiguous, unsupported, personal or expired topics escalate. Current routing is intentionally narrow (KineticHub contact and approved Perrun public FAQs). Missing categories or policies are listed in kinetichub-knowledge.js. Keep expiry and source anchors current as event content changes.
- No raw free text, session token, identifier, arbitrary context field or history text is sent to a provider. Free text is projected onto bounded public vocabulary after common identifier redaction; obvious instruction manipulation fails closed. Model output may only select the one approved candidate or escalate. The caller gets repository-backed text, not model free text. No prompt or body logging.
- The injected provider receives a Responses-style request and a separate trusted tenant/signal envelope. It returns a simulated Responses result. Only a completed single assistant output_text with a strict, valid decision and usage is accepted. Tools, refusals, incomplete responses, invalid source selections, exceptions and timeouts escalate; no retries.

## Limits and metrics

Input is conservatively bounded by UTF-8 payload bytes plus overhead (not a billing/tokenizer guarantee); the request sets max_output_tokens and validates reported usage. Calls reserve worst-case estimated cost before dispatch; failures and timeouts do not refund it. The default model and prices are synthetic evaluation values. The per-instance UTC rate and budget counters are suitable for tests, not production or multi-instance billing. Returned metrics contain tenant, model, knowledge version, token counts or reserved/estimated cost, not prompts. No telemetry sink is enabled.

## Connecting OpenAI later (not authorized by this PR)

1. Approve knowledge, minimization, model, actual tokenizer/input budget, per-model pricing, project data controls and a server-managed credential. Build a separate Responses transport that uses secrets isolated per tenant and forwards AbortSignal. Never add a public model endpoint. Keep structured validation and store:false. See [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) and [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): store:false does not imply Zero Data Retention or eliminate abuse-monitoring retention.
2. Build the server-owned eligibility/history resolver and bind it to verified tenant and authorized ticket data. Use a durable atomic rate/cost limit shared by all instances, telemetry without content, and explicitly authorize evaluation calls before enabling any real transport.
3. Keep proposals unpublished until a separate reviewed publish path can recheck ticket version, human intervention/pause and tenant ownership under the ticket lock. Do not give the provider tools that mutate payments, registrations or personal data.
4. Before a second tenant, require an approved source partition, per-tenant credentials and budget namespaces, and a demonstrated isolation boundary across the datastore, caches and job queue. The single tenant registry is not a multitenant authorization system.

## Local validation

Run node --test tests/support-ai-evaluation.test.js for simulation, followed by the targeted support regression suite and npm run build. Use only fabricated conversation content and simulated usage in all evaluation fixtures.
