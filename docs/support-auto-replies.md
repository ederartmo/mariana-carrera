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
