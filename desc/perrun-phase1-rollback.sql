-- REVIEW ONLY: never run against an active Perrun installation.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
-- Lock writers before checking emptiness; requires owner/admin SQL access.
lock table public.perrun_checkout_orders, public.registration_dogs,
  public.perrun_engraving_payments, public.perrun_paid_dog_counter in access exclusive mode;
do $$
begin
  if exists(select 1 from public.perrun_checkout_orders)
    or exists(select 1 from public.registration_dogs)
    or exists(select 1 from public.perrun_engraving_payments)
    or exists(select 1 from public.perrun_paid_dog_counter where last_sequence <> 0)
    or exists(select 1 from public.inscripciones where event_slug = 'perrun-2027') then
    raise exception 'Rollback refused: Perrun history exists. Preserve data and plan forward rollback.';
  end if;
end;
$$;
drop function public.finalize_perrun_paid_order(text,text,text,integer,text);
drop function public.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz);
drop function kinetic_perrun_private.finalize_perrun_paid_order(text,text,text,integer,text);
drop function kinetic_perrun_private.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz);
drop trigger perrun_plate_snapshot_guard on public.registration_dogs;
drop function kinetic_perrun_private.guard_plate_snapshot();
drop table public.perrun_engraving_payments;
drop table public.registration_dogs;
drop table public.perrun_paid_dog_counter;
drop table public.perrun_checkout_orders;
drop function kinetic_perrun_private.valid_dogs(jsonb);
drop schema kinetic_perrun_private;
-- Restore the exact old distance rule without removing existing payment data.
alter table public.inscripciones drop constraint inscripciones_distance_chk;
alter table public.inscripciones add constraint inscripciones_distance_chk CHECK (((distance IS NULL) OR ((event_slug = 'axolote-night-run'::text) AND (distance = '5K'::text)) OR ((event_slug = 'cascanueces-run'::text) AND (distance = ANY (ARRAY['5K'::text, '10K'::text]))))) not valid;
alter table public.inscripciones validate constraint inscripciones_distance_chk;
commit;
