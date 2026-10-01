# Perrun — Phase 5 post-purchase operations

Scope: feature/perrun-2027, local implementation only. No migration, remote database writes, deployment, Stripe payment or real email is part of this phase.

## Confirmation email

The Perrun webhook invokes the dedicated confirmation sender only after successful finalize_perrun_paid_order. Legacy finalization/payment logic remains unchanged. Pending/failed OXXO events cannot send a confirmation. A cancelled/refunded human is skipped even on a late paid-event retry.

The sender reads the confirmed human, draft and registration_dogs ledger. Event date/location and kit location come from perrun-event-data.js. Kit delivery: 12 February 2027, 10:00–16:00, Bosque de San Juan de Aragón. No start time is invented.

Existing inscripciones.email_sent, confirmation_email_id and confirmation_email_sent_at persist success. Webhook and admin retries use the same Resend key per checkout (SHA-256 session identity). Failed provider calls never mark email_sent; a failed DB mark returns retryable failure. Simultaneous requests use the same provider key. The provider key has a 24-hour retention window: if provider success cannot be persisted for more than 24 hours, reconcile the provider result before another manual retry. The existing schema does not provide a durable outbox transaction with the external provider; no exactly-once guarantee across that extended outage is claimed.

PERRUN_QA_LOCAL=1 skips the provider and DB email flag mutation. Tests use fake Resend, including the real isolated SQL finalizer integration. Perrun manual resend buttons retry a pending confirmation; they do not resend a confirmation already marked sent. The legacy resend routes retain their existing behavior.

## Admin and CSV

Admin list retains JWT + server allowlist authorization, existing status/search filters and bounded pagination; Perrun adds batched ledger enrichment. Phone is perrun_checkout_orders.owner_phone, not inscripciones.whatsapp. Composite human id/email binds each dog to its owner. A missing confirmed ledger fails closed.

One human row/BIB remains one human regardless of one/two dogs. Dog details show weight, category, sequence, requested/free/payment-required flags, minor-unit engraving amount and settlement/plate status. Refunds preserve historical dog sequences and BIB; the UI does not label a retained Perrun BIB as released.

GET /api/data?action=admin-export-perrun&status=all&search=... uses the same admin authorization and server filters. It exports all pages, always restricted to Perrun. One row per dog repeats human/BIB; UTF-8 BOM, quoted fields, escaped quotes and formula neutralization protect spreadsheet import. Phone fields starting with + receive a leading apostrophe for spreadsheet safety. engraving_payment_amount is MXN minor units (3500 means MXN 35). The export preserves refunded/cancelled rows when requested, never erases historical sequences, and includes snapshot fields. Cache-Control: no-store.

## Plate snapshots and operational limitation

Fase 1 already supplies dog_name_for_plate, owner_phone_for_plate, plate_started_at and plate_status. The existing trigger captures name + draft owner phone on transition to preparing and prevents subsequent snapshot changes. Before preparing, these snapshot fields intentionally remain NULL. The CSV includes current dog/owner values and the distinct frozen snapshot columns: it never presents an unfrozen value as a persisted snapshot.

For a future plate production file, use active paid registrations with engraving requested and either engraving_free or a settled paid engraving add-on. Sequence 301 with a pending MXN 35 payment is not eligible. This phase only reads/exports; it does not transition plates to preparing. Service role has SELECT only on registration_dogs; a future plate-write workflow needs separate design/authorization. No new grants or migration were added.

Legacy participant/email edits, manual cancellation, attempt archival and test hard-delete are unavailable in the Perrun UI. Participant/email edits, cancellation and deletion also return 409 server-side for Perrun. Legacy cancellation releases a BIB and legacy edits can separate draft/phone/snapshot identity; those operations need a Perrun-specific workflow before enabling them. Existing refund handling remains available and preserves the ledger. Unpaid Perrun attempts live in perrun_checkout_orders and cannot be forced into the legacy inscripciones archive flow.

## Profile

Existing validated-JWT ownership remains the authorization boundary. Perrun profile rows include only dog index/name/category and readable engraving status, without phone, sequence, payment IDs or plate snapshots. No Supabase Auth or Storage service was added to native QA. Handler authorization is tested with synthetic validated-user fixtures; read paths and actual templates are also checked against all four existing local QA payments. Live sign-in is not exercised against remote Supabase.

## Local QA evidence

Four existing humans/BIBs 001–004; six dogs; historical sequences 1,2,3,299,300,301; counter 301. The read-only PostgreSQL transaction and GET-only local PostgREST audit fingerprints all five relevant tables before/after. No QA row, email flag, payment or counter is changed. Private evidence/preview remain under ignored .qa/, never committed. Only localhost is allowed by the QA network guard; remote reads/writes during execution are zero.
