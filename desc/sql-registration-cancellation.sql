-- Separa el estado operativo de la inscripción del estado del pago.
-- El pago permanece intacto (paid/refunded/etc.); una inscripción puede
-- anularse sin borrar el historial financiero.
--
-- Ejecutar una sola vez en Supabase SQL Editor ANTES de probar el preview.

begin;

alter table public.inscripciones
  add column if not exists registration_status text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_bib_number text;

update public.inscripciones
set registration_status = 'active'
where registration_status is null
   or trim(registration_status) = '';

alter table public.inscripciones
  alter column registration_status set default 'active',
  alter column registration_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inscripciones_registration_status_chk'
      and conrelid = 'public.inscripciones'::regclass
  ) then
    alter table public.inscripciones
      add constraint inscripciones_registration_status_chk
      check (registration_status in ('active', 'cancelled'));
  end if;
end
$$;

create index if not exists inscripciones_registration_status_idx
  on public.inscripciones (registration_status, event_slug);

commit;
