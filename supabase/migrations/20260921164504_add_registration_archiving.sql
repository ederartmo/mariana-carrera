
alter table public.inscripciones
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archive_reason text;

alter table public.inscripciones
  drop constraint if exists inscripciones_registration_status_check;

alter table public.inscripciones
  add constraint inscripciones_registration_status_check
  check (registration_status in ('active', 'cancelled', 'archived'));
;
