-- PRE-LAUNCH ONLY. DO NOT APPLY after payment-state events have been recorded.
-- Refuses to erase pending/failed history; never deletes orders, registrations or dogs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.perrun_checkout_orders in access exclusive mode;
do $$
begin
  if exists (select 1 from public.perrun_checkout_orders
    where payment_status in ('pending','failed') or payment_failed_at is not null or payment_state_event_id is not null) then
    raise exception 'Rollback refused: Perrun payment state history exists; retain schema and use a forward fix';
  end if;
end;
$$;
drop function public.record_perrun_payment_state(text,text,text);
drop function kinetic_perrun_private.record_perrun_payment_state(text,text,text);
drop trigger perrun_payment_state_guard on public.perrun_checkout_orders;
drop function kinetic_perrun_private.guard_payment_state();
alter table public.perrun_checkout_orders
  drop constraint perrun_payment_state_trace,
  drop constraint perrun_payment_status_finalization,
  drop constraint perrun_payment_status_valid,
  drop column payment_state_event_id,
  drop column payment_failed_at,
  drop column payment_status;
commit;
