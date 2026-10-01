-- PRE-LAUNCH ONLY. Refuse any engraving payment/reservation history; never delete it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.perrun_engraving_payments in access exclusive mode;
do $$ begin
  if exists(select 1 from public.perrun_engraving_payments) then
    raise exception 'Rollback refused: engraving payment/reservation history exists';
  end if;
end $$;
drop function public.reserve_perrun_engraving_payment(uuid,text,uuid);
drop function public.finalize_perrun_engraving_payment(uuid,text,text,text,integer,text);
drop function public.record_perrun_engraving_state(uuid,text,text,text,text);
drop function public.mark_perrun_engraving_email_sent(uuid,text);
drop function kinetic_perrun_private.reserve_perrun_engraving_payment(uuid,text,uuid);
drop function kinetic_perrun_private.finalize_perrun_engraving_payment(uuid,text,text,text,integer,text);
drop function kinetic_perrun_private.record_perrun_engraving_state(uuid,text,text,text,text);
drop function kinetic_perrun_private.mark_perrun_engraving_email_sent(uuid,text);
drop function kinetic_perrun_private.lock_engraving_dog(uuid,text,boolean);
drop index public.perrun_one_active_engraving;
alter table public.perrun_engraving_payments
  drop constraint perrun_engraving_payment_status_valid,
  drop constraint perrun_engraving_payment_state_valid,
  drop constraint perrun_engraving_event_trace,
  drop constraint perrun_engraving_email_confirmation,
  drop column paid_event_id,
  drop column state_event_id,
  drop column confirmation_email_id,
  drop column confirmation_email_sent_at,
  alter column stripe_session_id set not null,
  add constraint perrun_engraving_payments_status_check check (status in ('pending','paid','expired','failed','refunded')),
  add constraint perrun_engraving_payments_check check (
    (status in ('paid','refunded') and paid_at is not null and stripe_payment_intent_id is not null)
    or (status in ('pending','expired','failed') and paid_at is null)
  );
commit;
