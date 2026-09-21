-- Soft cancellation for paid registrations.
-- Preserves payment history and releases the active BIB without deleting the row.

alter table public.inscripciones
  add column if not exists registration_status text not null default 'active',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_type text,
  add column if not exists cancelled_bib_number text;

alter table public.inscripciones
  drop constraint if exists inscripciones_registration_status_check;

alter table public.inscripciones
  add constraint inscripciones_registration_status_check
  check (registration_status in ('active', 'cancelled'));

alter table public.inscripciones
  drop constraint if exists inscripciones_cancellation_type_check;

alter table public.inscripciones
  add constraint inscripciones_cancellation_type_check
  check (
    cancellation_type is null
    or cancellation_type in ('duplicate', 'refunded', 'participation_cancelled')
  );

create unique index if not exists inscripciones_active_event_bib_unique
  on public.inscripciones (event_slug, bib_number)
  where registration_status = 'active'
    and bib_number is not null;
