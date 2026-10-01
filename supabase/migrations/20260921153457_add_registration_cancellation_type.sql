
alter table public.inscripciones
  add column if not exists cancellation_type text;

alter table public.inscripciones
  drop constraint if exists inscripciones_cancellation_type_check;

alter table public.inscripciones
  add constraint inscripciones_cancellation_type_check
  check (
    cancellation_type is null
    or cancellation_type in ('duplicate', 'refunded', 'participation_cancelled')
  );
;
