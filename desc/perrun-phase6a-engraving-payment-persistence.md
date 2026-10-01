# Perrun Phase 6A — engraving payment persistence

Scope: `KineticHub-Engraving`, branch `feature/perrun-engraving-payment`. This phase adds database persistence and tests only. No Checkout, webhook routing, email delivery or frontend implementation is included. No remote migration has been applied. Historical migrations, existing RPC bodies and functional application code remain unchanged.

## Verified applied LOCAL schema

Compared the LOCAL PostgreSQL 17 catalog (127.0.0.1:55322, perrun_qa_real) with the versioned schema fixture and historical Phase 1/4A migrations. Columns/nullability/defaults, PKs, FKs/delete actions, UNIQUE/CHECK constraints, indexes, triggers, RLS/policies and privileges match for all three tables. PostgreSQL catalog NOT NULL representation and timestamptz timezone presentation were normalized only for comparison. No customer rows were copied into the isolated test cluster.

Read-only audit artifacts and raw native test evidence are local-only under `.qa/audits/`; the schema inventory below contains structure only. The original QA database is NOT migrated by this work: Tests 1–4 remain 4 humans, 6 dogs, BIBs 001–004, counter 301 and zero engraving payments. All 6A writes/tests use a separate native cluster on an ephemeral loopback port; it is stopped at completion.

## Existing model / additive change

One dog -> one independent MXN 3500 payment. Two eligible dogs -> two separate payments and eventual Checkout Sessions. Existing UNIQUE constraints retain separate session/PaymentIntent identity, and `perrun_one_settled_engraving` retains one `paid` OR `refunded` payment per dog. Refund therefore remains terminal per dog; no repurchase after refund is introduced.

Only `public.perrun_engraving_payments` is altered: `stripe_session_id` becomes nullable for a real pre-Stripe reservation; four nullable columns add paid/state event provenance and independent email provider receipt/timestamp. Two state CHECKs are replaced to support `reserved` and enforce state consistency; trace/email CHECKs and one partial active-attempt UNIQUE index are added. Existing amount/currency, PK/FK, unique Stripe IDs and settled index remain. No ALTER on inscripciones, registration_dogs, counters or existing constraints on those tables. No UPDATE/backfill/deletion of historical data.

The migration validates existing rows and indexes atomically. Unexpected historical pending rows with a stored PaymentIntent or duplicate active rows cause failure/rollback, never automatic cleanup. This migration intentionally does not silently repair incompatible data.

## State machine

- `reserved`: no Stripe Session, PaymentIntent or paid_at; server-owned reservation UUID is the persistent attempt reference.
- `reserved -> pending`: attach a real Session ID through the state RPC.
- `reserved -> failed/expired`: release an unattached attempt after an internal creation failure, with no invented Stripe identity.
- `pending -> paid`: confirmed exact session + PaymentIntent + Stripe event, amount 3500 and currency mxn.
- `pending -> failed/expired`: requires matching session and event. A new UUID can then reserve a subsequent attempt for the same dog.
- `paid -> refunded`: requires the matching settled PaymentIntent and refund event.
- `paid` never degrades to pending/failed/expired. Duplicate same settlement returns the persisted row/timestamp.
- Failed/expired are terminal per ATTEMPT. Replaying the old reference returns its existing terminal row; it must never initiate another Checkout. Late paid events for a failed/expired attempt are rejected for manual reconciliation instead of reviving an old attempt alongside a new one.
- Refunded is terminal per DOG; paid retries return the refunded row without resurrection. Partial-refund policy and authoritative Stripe event/session verification remain responsibilities of the later Phase 6 handler.

`engraving_payment_required` remains historical eligibility, not payment resolution. Main humans, BIBs, dog fields, engraving_sequence/free/required, main orders and perrun_paid_dog_counter are never updated by the new RPCs.

## RPC contract

All return one `public.perrun_engraving_payments` composite row. Public wrappers are SECURITY INVOKER, private implementations SECURITY DEFINER, all with empty search_path and qualified application relations. All signatures and grants are explicit in the migration.

| Public RPC | Parameters | Writes / behavior |
|---|---|---|
| reserve_perrun_engraving_payment | p_dog_id uuid, p_order_session_id text, p_payment_id uuid | Validate eligible dog and active paid main registration; return matching attempt or existing active attempt; otherwise INSERT one reserved row. |
| finalize_perrun_engraving_payment | p_payment_id uuid, p_stripe_session_id text, p_payment_intent_id text, p_stripe_event_id text, p_confirmed_amount_cents integer, p_confirmed_currency text | Confirm attached pending payment; UPDATE only its paid identity/status/timestamp. Reject amount/currency or identity mismatch. |
| record_perrun_engraving_state | p_payment_id uuid, p_stripe_session_id text, p_status text, p_stripe_event_id text DEFAULT NULL, p_payment_intent_id text DEFAULT NULL | Attach pending session or record failed/expired/refunded on only the addon row. |
| mark_perrun_engraving_email_sent | p_payment_id uuid, p_provider_id text | Persist provider receipt + timestamp only on paid addon; repeated same receipt is no-op, different receipt rejected. |

The private `lock_engraving_dog(uuid,text,boolean)` helper is SECURITY INVOKER and has no service/browser EXECUTE. It can run only within the controlled definer context.

## Locks / concurrency / integration obligations

Payment RPCs lock in consistent order: main draft -> composite human row -> dog -> addon payment. The initial dog/payment lookup only discovers immutable identity, then the rows are re-read under locks. The parent locks serialize cancellation/refund/finalization interactions; they DO NOT update the main registration. Different dogs of the same order briefly serialize on that order. Email receipt marking locks only the addon payment row and cannot create a reverse parent-lock dependency. There is no BIB/counter/advisory allocator lock in these new RPCs.

Partial UNIQUE `perrun_one_active_engraving` provides a second database safeguard for reserved/pending attempts. Concurrent references for one dog return the SAME payment UUID, not a second active row. Existing settled UNIQUE prevents double settlement.

For later Phase 6, EVERY Stripe Checkout creation must use the RETURNED payment UUID as its Stripe idempotency key and metadata reference. It must inspect the returned status and existing session before creating anything. A reservation alone cannot atomically coordinate an external Stripe API; do not use caller UUIDs or process memory as independent creation keys. The server must validate ownership/dog/order, TEST mode, signature and authoritative Stripe amount/currency/session/metadata before calling privileged RPCs. This phase does not implement or call Stripe.

Real PostgreSQL 17.6 two-connection scenarios prove: duplicate same/different reservation references, different dogs, duplicate settlement, paid-vs-failed in both lock orders, deliberate transaction rollback with a waiting reservation, refund-vs-paid retry, and simultaneous email receipt persistence. Blockers are observed via pg_blocking_pids, with distinct backend PIDs in local evidence. No claim of external Checkout/email exactly-once delivery is made by these DB tests.

## Email idempotence

Existing `inscripciones.email_sent`/confirmation columns and Phase 5 session-keyed email idempotency refer to the MAIN human purchase. Reusing them would incorrectly suppress the separate per-dog additional confirmation. Addon `confirmation_email_id` and `confirmation_email_sent_at` persist its own provider receipt as an atomic pair. No actual email was sent.

Future sender must use a stable provider idempotency key derived from payment UUID, skip a persisted receipt, and store the provider receipt via this RPC. Concurrent receipt writes are idempotent, but this does not itself reserve external delivery. A crash between provider send and DB receipt requires provider reconciliation; do not blindly retry after the provider idempotency retention expires. Implement that integration only in Phase 6.

## Security

RLS remains enabled with no browser policies. anon/authenticated have no table writes and no EXECUTE on any new public/private RPC. service_role keeps SELECT-only direct table access and can execute only the four controlled public RPCs and their four private implementations. The lock helper remains denied. Table owners/DB administrators remain privileged; this is the existing trust boundary. No keys/credentials are in the migration or this document.

## Migration safety and rollback

DDL takes ACCESS EXCLUSIVE on the ADDON payment table while adding columns/checks/indexes; it does not take DDL locks on inscripciones. Long-running addon reads/writes may wait or make the migration fail. lock_timeout=5s and statement_timeout=30s ensure atomic abort rather than indefinite blocking. Measured isolated native migration: ~6.53 ms; production duration is not guaranteed and depends on size/concurrent activity. Do not apply remotely without separate authorization.

PRE-LAUNCH rollback: `desc/perrun-phase6a-rollback.sql`, tested on native PostgreSQL and PGlite. It restores the exact previous addon constraints/nullability and removes only new objects, preserving existing human/paid-race data. It refuses ANY addon payment/reservation history; it never deletes it. POST-LAUNCH: disable addon creation/handlers if needed, retain all payment/history columns and use a reviewed forward repair migration. Never use destructive rollback after addon usage.

## Validation

- Node: 708/708 PASS (673 baseline + 35 new).
- Native PostgreSQL: 91/91 PASS (46 baseline + 45 Phase 6A).
- Real concurrent scenarios: 23 PASS (14 baseline + 9 Phase 6A).
- Build: PASS; generated outputs were restored to their original worktree state.
- Full Node/build use .env.qa.local, with external network blocked. No .env.local load, Supabase remote access, Stripe API, Checkout, real email, push, deploy or remote migration.

Native reproduction (isolated directory and evidence must remain under this worktree):

```text
node tests/perrun-concurrency.pg.cjs <native-pg-runtime> <absolute-worktree>/.qa/engraving-tests <absolute-worktree>/.qa/audits/phase6a-native.json --payment-state --webhook --engraving
```

The harness reconstructs the catalog fixture plus actual historical SQL and applies this incremental migration only to the new ephemeral native cluster. It never reuses the running QA data directory.

## Exact verified pre-6A LOCAL structure

Source: read-only PostgreSQL catalog; structure only, no customer data. All three tables match the versioned Phase 1/4A schema. This is the applied pre-6A schema, not a claim of remote introspection.

### public.perrun_engraving_payments

```json
{
  "columns": [
    {
      "num": 1,
      "name": "id",
      "type": "uuid",
      "not_null": true,
      "default_expr": "gen_random_uuid()"
    },
    {
      "num": 2,
      "name": "dog_id",
      "type": "uuid",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 3,
      "name": "stripe_session_id",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 4,
      "name": "stripe_payment_intent_id",
      "type": "text",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 5,
      "name": "amount_cents",
      "type": "integer",
      "not_null": true,
      "default_expr": "3500"
    },
    {
      "num": 6,
      "name": "currency",
      "type": "text",
      "not_null": true,
      "default_expr": "'mxn'::text"
    },
    {
      "num": 7,
      "name": "status",
      "type": "text",
      "not_null": true,
      "default_expr": "'pending'::text"
    },
    {
      "num": 8,
      "name": "created_at",
      "type": "timestamp with time zone",
      "not_null": true,
      "default_expr": "now()"
    },
    {
      "num": 9,
      "name": "paid_at",
      "type": "timestamp with time zone",
      "not_null": false,
      "default_expr": null
    }
  ],
  "constraints": [
    {
      "name": "perrun_engraving_payments_amount_cents_check",
      "type": "c",
      "definition": "CHECK ((amount_cents = 3500))",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_check",
      "type": "c",
      "definition": "CHECK ((((status = ANY (ARRAY['paid'::text, 'refunded'::text])) AND (paid_at IS NOT NULL) AND (stripe_payment_intent_id IS NOT NULL)) OR ((status = ANY (ARRAY['pending'::text, 'expired'::text, 'failed'::text])) AND (paid_at IS NULL))))",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_currency_check",
      "type": "c",
      "definition": "CHECK ((currency = 'mxn'::text))",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_dog_id_fkey",
      "type": "f",
      "definition": "FOREIGN KEY (dog_id) REFERENCES registration_dogs(id) ON DELETE RESTRICT",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_pkey",
      "type": "p",
      "definition": "PRIMARY KEY (id)",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_status_check",
      "type": "c",
      "definition": "CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'expired'::text, 'failed'::text, 'refunded'::text])))",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_stripe_payment_intent_id_key",
      "type": "u",
      "definition": "UNIQUE (stripe_payment_intent_id)",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_stripe_session_id_check",
      "type": "c",
      "definition": "CHECK ((btrim(stripe_session_id) <> ''::text))",
      "validated": true
    },
    {
      "name": "perrun_engraving_payments_stripe_session_id_key",
      "type": "u",
      "definition": "UNIQUE (stripe_session_id)",
      "validated": true
    }
  ],
  "indexes": [
    {
      "indexname": "perrun_engraving_dog_lookup",
      "indexdef": "CREATE INDEX perrun_engraving_dog_lookup ON public.perrun_engraving_payments USING btree (dog_id)"
    },
    {
      "indexname": "perrun_engraving_payments_pkey",
      "indexdef": "CREATE UNIQUE INDEX perrun_engraving_payments_pkey ON public.perrun_engraving_payments USING btree (id)"
    },
    {
      "indexname": "perrun_engraving_payments_stripe_payment_intent_id_key",
      "indexdef": "CREATE UNIQUE INDEX perrun_engraving_payments_stripe_payment_intent_id_key ON public.perrun_engraving_payments USING btree (stripe_payment_intent_id)"
    },
    {
      "indexname": "perrun_engraving_payments_stripe_session_id_key",
      "indexdef": "CREATE UNIQUE INDEX perrun_engraving_payments_stripe_session_id_key ON public.perrun_engraving_payments USING btree (stripe_session_id)"
    },
    {
      "indexname": "perrun_one_settled_engraving",
      "indexdef": "CREATE UNIQUE INDEX perrun_one_settled_engraving ON public.perrun_engraving_payments USING btree (dog_id) WHERE (status = ANY (ARRAY['paid'::text, 'refunded'::text]))"
    }
  ],
  "rls": true,
  "policies": null,
  "grants": [
    {
      "role": "anon",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "SELECT",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "UPDATE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "SELECT",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "UPDATE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "SELECT",
      "allowed": true
    },
    {
      "role": "service_role",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "UPDATE",
      "allowed": false
    }
  ],
  "triggers": null
}
```

### public.registration_dogs

```json
{
  "columns": [
    {
      "num": 1,
      "name": "id",
      "type": "uuid",
      "not_null": true,
      "default_expr": "gen_random_uuid()"
    },
    {
      "num": 2,
      "name": "registration_id",
      "type": "uuid",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 3,
      "name": "registration_email",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 4,
      "name": "order_session_id",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 5,
      "name": "dog_index",
      "type": "smallint",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 6,
      "name": "dog_name",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 7,
      "name": "weight_kg",
      "type": "numeric",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 8,
      "name": "category",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 9,
      "name": "engraving_requested",
      "type": "boolean",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 10,
      "name": "engraving_sequence",
      "type": "bigint",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 11,
      "name": "engraving_free",
      "type": "boolean",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 12,
      "name": "engraving_payment_required",
      "type": "boolean",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 13,
      "name": "engraving_payment_amount_cents",
      "type": "integer",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 14,
      "name": "plate_status",
      "type": "text",
      "not_null": true,
      "default_expr": "'not_started'::text"
    },
    {
      "num": 15,
      "name": "dog_name_for_plate",
      "type": "text",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 16,
      "name": "owner_phone_for_plate",
      "type": "text",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 17,
      "name": "plate_started_at",
      "type": "timestamp with time zone",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 18,
      "name": "created_at",
      "type": "timestamp with time zone",
      "not_null": true,
      "default_expr": "now()"
    }
  ],
  "constraints": [
    {
      "name": "perrun_plate_snapshot",
      "type": "c",
      "definition": "CHECK ((((plate_started_at IS NULL) AND (dog_name_for_plate IS NULL) AND (owner_phone_for_plate IS NULL) AND (plate_status = ANY (ARRAY['not_started'::text, 'skipped'::text]))) OR ((plate_started_at IS NOT NULL) AND (btrim(dog_name_for_plate) <> ''::text) AND (btrim(owner_phone_for_plate) <> ''::text) AND (dog_name_for_plate IS NOT NULL) AND (owner_phone_for_plate IS NOT NULL) AND (plate_status = ANY (ARRAY['preparing'::text, 'engraved'::text, 'skipped'::text])))))",
      "validated": true
    },
    {
      "name": "registration_dogs_check",
      "type": "c",
      "definition": "CHECK ((category =\nCASE\n    WHEN (weight_kg <= (10)::numeric) THEN 'S'::text\n    WHEN (weight_kg <= (25)::numeric) THEN 'M'::text\n    WHEN (weight_kg <= (50)::numeric) THEN 'L'::text\n    ELSE 'XL'::text\nEND))",
      "validated": true
    },
    {
      "name": "registration_dogs_check1",
      "type": "c",
      "definition": "CHECK ((engraving_free = (engraving_sequence <= 300)))",
      "validated": true
    },
    {
      "name": "registration_dogs_check2",
      "type": "c",
      "definition": "CHECK ((engraving_payment_required = (engraving_requested AND (NOT engraving_free))))",
      "validated": true
    },
    {
      "name": "registration_dogs_check3",
      "type": "c",
      "definition": "CHECK ((engraving_payment_amount_cents =\nCASE\n    WHEN engraving_payment_required THEN 3500\n    ELSE 0\nEND))",
      "validated": true
    },
    {
      "name": "registration_dogs_dog_index_check",
      "type": "c",
      "definition": "CHECK ((dog_index = ANY (ARRAY[1, 2])))",
      "validated": true
    },
    {
      "name": "registration_dogs_dog_name_check",
      "type": "c",
      "definition": "CHECK (((char_length(btrim(dog_name)) >= 1) AND (char_length(btrim(dog_name)) <= 80)))",
      "validated": true
    },
    {
      "name": "registration_dogs_engraving_sequence_check",
      "type": "c",
      "definition": "CHECK ((engraving_sequence > 0))",
      "validated": true
    },
    {
      "name": "registration_dogs_engraving_sequence_key",
      "type": "u",
      "definition": "UNIQUE (engraving_sequence)",
      "validated": true
    },
    {
      "name": "registration_dogs_order_session_id_dog_index_key",
      "type": "u",
      "definition": "UNIQUE (order_session_id, dog_index)",
      "validated": true
    },
    {
      "name": "registration_dogs_order_session_id_fkey",
      "type": "f",
      "definition": "FOREIGN KEY (order_session_id) REFERENCES perrun_checkout_orders(order_session_id) ON DELETE RESTRICT",
      "validated": true
    },
    {
      "name": "registration_dogs_pkey",
      "type": "p",
      "definition": "PRIMARY KEY (id)",
      "validated": true
    },
    {
      "name": "registration_dogs_plate_status_check",
      "type": "c",
      "definition": "CHECK ((plate_status = ANY (ARRAY['not_started'::text, 'preparing'::text, 'engraved'::text, 'skipped'::text])))",
      "validated": true
    },
    {
      "name": "registration_dogs_registration_id_registration_email_dog_in_key",
      "type": "u",
      "definition": "UNIQUE (registration_id, registration_email, dog_index)",
      "validated": true
    },
    {
      "name": "registration_dogs_registration_id_registration_email_fkey",
      "type": "f",
      "definition": "FOREIGN KEY (registration_id, registration_email) REFERENCES inscripciones(id, email) ON UPDATE CASCADE ON DELETE RESTRICT",
      "validated": true
    },
    {
      "name": "registration_dogs_weight_kg_check",
      "type": "c",
      "definition": "CHECK (((weight_kg >= (3)::numeric) AND (weight_kg <= (80)::numeric)))",
      "validated": true
    }
  ],
  "indexes": [
    {
      "indexname": "registration_dogs_engraving_sequence_key",
      "indexdef": "CREATE UNIQUE INDEX registration_dogs_engraving_sequence_key ON public.registration_dogs USING btree (engraving_sequence)"
    },
    {
      "indexname": "registration_dogs_order_session_id_dog_index_key",
      "indexdef": "CREATE UNIQUE INDEX registration_dogs_order_session_id_dog_index_key ON public.registration_dogs USING btree (order_session_id, dog_index)"
    },
    {
      "indexname": "registration_dogs_pkey",
      "indexdef": "CREATE UNIQUE INDEX registration_dogs_pkey ON public.registration_dogs USING btree (id)"
    },
    {
      "indexname": "registration_dogs_registration_id_registration_email_dog_in_key",
      "indexdef": "CREATE UNIQUE INDEX registration_dogs_registration_id_registration_email_dog_in_key ON public.registration_dogs USING btree (registration_id, registration_email, dog_index)"
    }
  ],
  "rls": true,
  "policies": null,
  "grants": [
    {
      "role": "anon",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "SELECT",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "UPDATE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "SELECT",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "UPDATE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "SELECT",
      "allowed": true
    },
    {
      "role": "service_role",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "UPDATE",
      "allowed": false
    }
  ],
  "triggers": [
    {
      "name": "perrun_plate_snapshot_guard",
      "definition": "CREATE TRIGGER perrun_plate_snapshot_guard BEFORE UPDATE ON public.registration_dogs FOR EACH ROW EXECUTE FUNCTION kinetic_perrun_private.guard_plate_snapshot()"
    }
  ]
}
```

### public.perrun_checkout_orders

```json
{
  "columns": [
    {
      "num": 1,
      "name": "order_session_id",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 2,
      "name": "event_slug",
      "type": "text",
      "not_null": true,
      "default_expr": "'perrun-2027'::text"
    },
    {
      "num": 3,
      "name": "distance",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 4,
      "name": "buyer_email",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 5,
      "name": "participant",
      "type": "jsonb",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 6,
      "name": "owner_phone",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 7,
      "name": "dogs",
      "type": "jsonb",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 8,
      "name": "price_stage",
      "type": "text",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 9,
      "name": "base_amount_cents",
      "type": "integer",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 10,
      "name": "amount_cents",
      "type": "integer",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 11,
      "name": "currency",
      "type": "text",
      "not_null": true,
      "default_expr": "'mxn'::text"
    },
    {
      "num": 12,
      "name": "quoted_at",
      "type": "timestamp with time zone",
      "not_null": true,
      "default_expr": null
    },
    {
      "num": 13,
      "name": "created_at",
      "type": "timestamp with time zone",
      "not_null": true,
      "default_expr": "now()"
    },
    {
      "num": 14,
      "name": "finalized_at",
      "type": "timestamp with time zone",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 15,
      "name": "payment_intent_id",
      "type": "text",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 16,
      "name": "payment_status",
      "type": "text",
      "not_null": true,
      "default_expr": "'prepared'::text"
    },
    {
      "num": 17,
      "name": "payment_failed_at",
      "type": "timestamp with time zone",
      "not_null": false,
      "default_expr": null
    },
    {
      "num": 18,
      "name": "payment_state_event_id",
      "type": "text",
      "not_null": false,
      "default_expr": null
    }
  ],
  "constraints": [
    {
      "name": "perrun_checkout_orders_buyer_email_check",
      "type": "c",
      "definition": "CHECK ((btrim(buyer_email) <> ''::text))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_currency_check",
      "type": "c",
      "definition": "CHECK ((currency = 'mxn'::text))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_distance_check",
      "type": "c",
      "definition": "CHECK ((distance = ANY (ARRAY['1K'::text, '3K'::text, '5K'::text])))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_dogs_check",
      "type": "c",
      "definition": "CHECK (kinetic_perrun_private.valid_dogs(dogs))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_event_slug_check",
      "type": "c",
      "definition": "CHECK ((event_slug = 'perrun-2027'::text))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_order_session_id_check",
      "type": "c",
      "definition": "CHECK ((btrim(order_session_id) <> ''::text))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_owner_phone_check",
      "type": "c",
      "definition": "CHECK ((owner_phone ~ '^\\+52[0-9]{10}$'::text))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_participant_check",
      "type": "c",
      "definition": "CHECK (((jsonb_typeof(participant) = 'object'::text) AND (NOT (participant ? 'whatsapp'::text))))",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_payment_intent_id_key",
      "type": "u",
      "definition": "UNIQUE (payment_intent_id)",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_pkey",
      "type": "p",
      "definition": "PRIMARY KEY (order_session_id)",
      "validated": true
    },
    {
      "name": "perrun_checkout_orders_price_stage_check",
      "type": "c",
      "definition": "CHECK ((price_stage = ANY (ARRAY['presale'::text, 'general'::text, 'late'::text])))",
      "validated": true
    },
    {
      "name": "perrun_finalization_pair",
      "type": "c",
      "definition": "CHECK (((finalized_at IS NULL) = (payment_intent_id IS NULL)))",
      "validated": true
    },
    {
      "name": "perrun_main_price",
      "type": "c",
      "definition": "CHECK ((amount_cents = (base_amount_cents +\nCASE jsonb_array_length(dogs)\n    WHEN 2 THEN 18000\n    ELSE 0\nEND)))",
      "validated": true
    },
    {
      "name": "perrun_payment_state_trace",
      "type": "c",
      "definition": "CHECK ((((payment_state_event_id IS NULL) OR (payment_state_event_id ~ '^evt_[A-Za-z0-9_]{1,200}$'::text)) AND ((payment_status <> ALL (ARRAY['pending'::text, 'failed'::text])) OR (payment_state_event_id IS NOT NULL)) AND ((payment_status <> 'failed'::text) OR (payment_failed_at IS NOT NULL)) AND ((payment_failed_at IS NULL) OR (payment_state_event_id IS NOT NULL)) AND ((payment_status <> 'prepared'::text) OR ((payment_failed_at IS NULL) AND (payment_state_event_id IS NULL))) AND ((payment_status <> 'pending'::text) OR (payment_failed_at IS NULL))))",
      "validated": true
    },
    {
      "name": "perrun_payment_status_finalization",
      "type": "c",
      "definition": "CHECK (((payment_status = 'paid'::text) = (finalized_at IS NOT NULL)))",
      "validated": true
    },
    {
      "name": "perrun_payment_status_valid",
      "type": "c",
      "definition": "CHECK ((payment_status = ANY (ARRAY['prepared'::text, 'pending'::text, 'failed'::text, 'paid'::text])))",
      "validated": true
    },
    {
      "name": "perrun_quote_time",
      "type": "c",
      "definition": "CHECK (((quoted_at < '2027-01-25 22:00:00+00'::timestamp with time zone) AND (price_stage =\nCASE\n    WHEN (quoted_at < '2026-11-01 06:00:00+00'::timestamp with time zone) THEN 'presale'::text\n    WHEN (quoted_at < '2027-01-01 06:00:00+00'::timestamp with time zone) THEN 'general'::text\n    ELSE 'late'::text\nEND)))",
      "validated": true
    },
    {
      "name": "perrun_stage_price",
      "type": "c",
      "definition": "CHECK ((base_amount_cents =\nCASE price_stage\n    WHEN 'presale'::text THEN 45000\n    WHEN 'general'::text THEN 50000\n    ELSE 55000\nEND))",
      "validated": true
    }
  ],
  "indexes": [
    {
      "indexname": "perrun_checkout_orders_payment_intent_id_key",
      "indexdef": "CREATE UNIQUE INDEX perrun_checkout_orders_payment_intent_id_key ON public.perrun_checkout_orders USING btree (payment_intent_id)"
    },
    {
      "indexname": "perrun_checkout_orders_pkey",
      "indexdef": "CREATE UNIQUE INDEX perrun_checkout_orders_pkey ON public.perrun_checkout_orders USING btree (order_session_id)"
    }
  ],
  "rls": true,
  "policies": null,
  "grants": [
    {
      "role": "anon",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "SELECT",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "anon",
      "privilege": "UPDATE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "SELECT",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "authenticated",
      "privilege": "UPDATE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "DELETE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "INSERT",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "REFERENCES",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "SELECT",
      "allowed": true
    },
    {
      "role": "service_role",
      "privilege": "TRIGGER",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "TRUNCATE",
      "allowed": false
    },
    {
      "role": "service_role",
      "privilege": "UPDATE",
      "allowed": false
    }
  ],
  "triggers": [
    {
      "name": "perrun_payment_state_guard",
      "definition": "CREATE TRIGGER perrun_payment_state_guard BEFORE INSERT OR UPDATE ON public.perrun_checkout_orders FOR EACH ROW EXECUTE FUNCTION kinetic_perrun_private.guard_payment_state()"
    }
  ]
}
```
