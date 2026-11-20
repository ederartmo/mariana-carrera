# Automatic public support replies

The public chat keeps its current endpoint and UI. After a successful visitor
write, the server can process that exact request using the existing queue,
evaluator and quota ledger. No new public route or scheduler is required.
Read requests never run the agent. A processing failure does not undo the
visitor message.

Publication is off unless `SUPPORT_AI_AUTO_REPLY_ENABLED=true` and a valid UTC
`SUPPORT_AI_AUTO_REPLY_START_AT` are set, alongside the existing private and
shadow flags, trusted tenant, model, provider key and persisted quota. Only
tickets created at or after that cutover are eligible. An existing disabled
scope or human takeover is never undone.

The server resolves the response to approved source text, not model prose.
An intentional escalation uses a fixed notice, keeps the ticket pending and
pauses automation. Provider failures and uncertain usage do not retry the
inference or publish a guessed answer. SQL rechecks the source, ticket version
and takeover state at publication; finishing and inserting the chat message
commit atomically.

Before activation, install the reviewed SQL atomically with its ACL and
history entry, verify the shadow schema and quotas, and approve the model and
spend separately. Run the QA conversation through the real visitor UI and
verify isolation and cleanup. To stop publication, disable the auto-reply
flag and, if an immediate in-flight stop is needed, disable the tenant in the
quota table. Do not delete published history.

## Local QA validation

The browser origin exception is exact: `http://localhost:3142`, matching Host,
`VERCEL_ENV=development`, and the QA Supabase URL in the server process.
Use `vercel dev --listen localhost:3142` only with QA-only environment loading.
The checked-in browser Supabase client still defaults to Production: use a
disposable QA copy of the served assets with the QA URL and QA publishable key,
never the service role. In a fresh Chrome profile confirm that requests use only
the loopback API and QA Supabase before enabling inference. Do not deploy those
browser substitutions.

The public dispatcher budgets 8 seconds for reservation, provider, response read
and metering. The evaluator's default for other callers is unchanged. Verify
that the effective host request limit also leaves time for claim, publish, and
the final conversation read. The timing log includes only stage, duration in
milliseconds, and a fixed status/error classification.

## Live QA evidence

One synthetic visitor conversation in Chrome on the QA project
`lpujenjnxzszfbcjfrrb` returned the approved `perrun-kit` text automatically.
The message was visible after 4.196 seconds; the provider stage took 2.694
seconds. One Responses API inference used 180 input and 25 output tokens
(USD 0.000248 recorded in the quota ledger); the job completed and QA
automation was disabled again. The previous uncertain attempt was not retried.
This is QA evidence only, not authorization to enable Production.
