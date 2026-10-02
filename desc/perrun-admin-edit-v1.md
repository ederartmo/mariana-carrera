# Perrun admin corrections V1 — production schema applied; application pending release

Workspace: C:/Users/EderArtMo/Documents/Projects/KineticHub. The production migration is applied. Admin Edit V1 frontend/backend remain local and are not available in production until push/deploy.

## Architecture and migration

New migration: supabase/migrations/20261002203402_perrun_admin_registration_edits.sql. Previous migrations stay untouched. Applied production/local version: 20261002203402_perrun_admin_registration_edits. Production schema and definitions were verified without drift.

Adds perrun_checkout_orders.admin_revision / ownership_revision and the private-access audit table public.perrun_registration_edits. It does not replace any payment finalizer. It replaces kinetic_perrun_private.lock_engraving_dog only to reread the cascading owner after waiting on the order lock (same RPC/security/eligibility), and kinetic_perrun_private.guard_plate_snapshot to capture current contact for newly started plates and fail fast on an inverted lock acquisition.

Current participant data lives in inscripciones. Current contact reuses inscripciones.whatsapp; no new parallel contact field is necessary. If older finalization cleared whatsapp, reads and plate creation fall back to the preserved original perrun_checkout_orders.owner_phone. Correction validates/normalizes the current phone and never overwrites that original.

Original order participant/dogs JSON, buyer_email, phone, Stripe/manual identities, amount, pricing stage and order_session_id remain unchanged. Regression tests compare every original order field except the two revision counters, including manual idempotent retries and Stripe finalizer retries.

## Authorization and transactional editing

GET /api/data?action=admin-perrun-registration&orderSessionId=... reads the modal. POST to the same action calls admin_update_perrun_registration. Both use validated Supabase admin JWT + ADMIN_EMAILS. The actor comes from that JWT, never the request body. RPC parameters are p_order_session_id, p_expected_revision, p_participant, p_dogs, p_reason, p_admin_user_id, p_admin_email.

Public wrapper SECURITY INVOKER delegates to a private SECURITY DEFINER implementation; both have empty search_path. Only service_role has EXECUTE. Browser roles have no RPC or audit access. Audit SELECT is service-role-only; no direct app INSERT/UPDATE/DELETE grant.

The RPC locks order -> human -> dogs (dog_index) -> engraving payments (id), validates the complete correction, atomically updates current participant identity and dog name/weight/category, increments revision and appends old/new audit JSON. Stale expectedRevision produces HTTP 409 and requires reopening/reloading. Any validation, constraint or audit failure rolls back everything.

Dog identities/count, distance, BIB, payment/source, price, engraving request/sequence/free/payment amounts and plate state/snapshots are not writable inputs. Two dogs must both remain <=25kg. A name changes only while plate_status=not_started and plate_started_at is null. Weight/category may still be corrected afterwards without changing the historical plate.

Plate preparation already holds a dog row lock when its trigger runs. Parent lock uses NOWAIT to avoid a cycle against the admin hierarchy; competing direct plate preparation gets PostgreSQL 55P03 and must retry. A future plate RPC should acquire order -> human -> dog before its UPDATE. Tests cover both acquisition orders.

## Email / profile ownership

Current inscripciones.email and buyer_email update together. The composite dogs FK cascades registration_email. Profile ownership continues to use validated JWT email; Supabase Auth is untouched. Future manual reemails read current recipient and names. Saving does not send an email or change email_sent.

An email correction increments ownership_revision permanently. Original checkout cookies then cease authorizing both checkout-summary and engraving checkout, including a summary request without the event query parameter. Current verified profile JWT is required. Claim format and all legacy authorization remain unchanged. Already-started external provider requests are not cancelled by an email correction.

## Review commands (no DB or provider access)

From the canonical repository:

    node scripts/perrun-admin-edit-preview.cjs

Open http://127.0.0.1:3014/?dogs=1 or http://127.0.0.1:3014/?dogs=2&plate=preparing. This uses the actual modal source with fictional data and CSP connect-src none. Save displays a synthetic payload only; no database, Stripe or email connection exists. It is not a substitute for authenticated QA against a separately migrated isolated cluster.

For automated local tests:

    node --env-file=.env.qa.local --test tests/*.test.js
    npm run build

Native PostgreSQL runner requires the existing native runtime directory and an absolute disposable test directory:

    node tests/perrun-concurrency.pg.cjs <native-runtime> <absolute-isolated-test-dir> <evidence.json> --payment-state --webhook --engraving --engraving-flow --manual --admin-edit

The runner creates/stops its own synthetic PostgreSQL 17 cluster; it never uses the shared QA database or Supabase remotely. All logs/evidence remain ignored under .qa/. Public assets are generated by build only.

## Release prerequisites

The additive migration is applied in production; its schema was verified without drift. Admin Edit V1 frontend/backend still require push/deploy before production availability. Deployment remains a separate step. No cancellation, refund or plate-production administration is introduced in V1.

## Validation results / files

Local closing Node suite: 938/938 PASS (including the UI polish). PostgreSQL 17 native: 206/206 PASS, including 36 concurrent scenario runs across two independent backend PIDs. Build PASS. Browser review of the real modal using fictional data: 390px, 430px and desktop; one/two dogs, plate name disabled with explanation, current versus original contact, ISO DOB payload and derived category verified. No horizontal overflow. Local tests sent no external email; production migration verification used read-only queries after application.

Source files changed: admin-inscripciones.html; api/data.js; api/checkout-summary.js; lib/_perrun-checkout.js; lib/_perrun-engraving.js; lib/_perrun-operations.js; lib/admin-archive-attempt.js.

New sources: admin-perrun-edit-ui.js; lib/admin-perrun-registration.js; lib/_perrun-current-ownership.js; scripts/perrun-admin-edit-preview.cjs; this document; supabase/migrations/20261002203402_perrun_admin_registration_edits.sql.

Tests: tests/perrun-admin-edit.test.js; tests/perrun-admin-edit-model.test.js; tests/perrun-admin-edit-native.cjs; tests/helpers/perrun-admin-edit-cases.cjs; tests/perrun-concurrency.pg.cjs (new optional hook).

public/admin-inscripciones.html and public/admin-perrun-edit-ui.js are build products. Other existing uncommitted public artifacts were present before this work; they were preserved/generated from existing sources, not newly implemented here. Secrets/env files, node_modules, .vercel and .qa stay ignored. The application sources are prepared locally for separate commits; push/deploy have not occurred.

Final migration SHA256: 61ca5741947452e3c8a57c897d860768bac8ba99fe4a590de6dee18e010d7000
