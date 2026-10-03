# Perrun production batches

Production numbers are an operational identifier separate from the historical
runner BIB and the engraving sequence. This phase creates drafts first and
assigns numbers only when an administrator closes a batch.

## Data model

'perrun_production_batches' stores the event, draft/closed status, optimistic
revision, item count, and the actor and timestamp that closed the batch.
'perrun_production_items' stores the selected registration and a frozen JSON
snapshot. A draft item has no production number or snapshot. A closed item has
both, and both are immutable. The item keeps stable registration and order
UUIDs; it intentionally does not use the mutable '(id,email)' identity key.
The insert trigger verifies that the UUIDs belong to the same active Perrun
registration and order and that the BIB is numeric.

The migration does not backfill the five historical paid registrations and
does not create a batch automatically. Existing BIBs, engraving positions,
payments, and counters are untouched.

## Closing a batch

The close RPC locks the Perrun event advisory key, the selected orders, and
their human and dog rows in the same order used by Admin Edit. It rechecks
eligibility and membership, calculates the next number from the maximum
persisted closed number, and assigns numbers in numeric BIB order with stable
UUID tie-breakers. The entire operation is one transaction. A failure rolls
back the batch status, numbers, snapshots, and audit metadata; numbers are
never recycled. Repeating a close on an already closed batch returns the
existing result without incrementing anything.

Draft saves use the batch revision and replace the draft membership only after
revalidating each candidate. A stale revision, duplicate selection, changed
payment state, or overlap with a closed item rejects the complete operation.
The save path caps a batch at 1,000 registrations.

## Snapshots and CSV

The closed snapshot includes participant name, email, phone, shirt, distance,
BIB, amount/source, and every dog’s name, weight, derived category, engraving
sequence/state, plate status, printed name, printed phone, and production
number. The CSV is generated only from these snapshots, in persisted
production-number order, with a versioned header, UTF-8 BOM, CRLF rows, CSV
escaping, and spreadsheet-formula neutralization.

## Access and admin workflow

The browser can read the admin summary and submit save/close requests only
through the existing JWT admin guard. Public RPC wrappers are SQL-invoker
functions with EXECUTE granted only to service_role; tables have RLS enabled,
no browser policies, and no direct browser write grants. The server supplies
the authenticated actor identity; client payloads cannot supply actor, number,
BIB, snapshot, or payment fields.

The separate **Producción Perrun** panel lets an admin load candidates, create
or edit a draft, review the selected members, and explicitly confirm:

> Al cerrar este lote se asignarán números de producción definitivos. Los números y snapshots del lote ya no podrán renumerarse.

Closed batches show only their frozen snapshots and can export the stable CSV.
Admin Edit remains available for current contact and registration corrections,
but it never edits a production number. Its read-only status identifies a
registration already sent to production.

The additive migration was applied and verified in production as
20261003031429_perrun_production_batches. The local filename is reconciled as
supabase/migrations/20261003031429_perrun_production_batches.sql; its SQL content
is unchanged. The panel has not yet been published. No automatic production
numbering, inventory, cancellation,
renumbering, or payment behavior is included in this phase.
