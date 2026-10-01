-- Perrun 4A only: additive payment state; no webhook implementation or remote apply.
-- Existing prepare/finalize RPC bodies and Phase 1 migration remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.perrun_checkout_orders
  add column payment_status text not null default 'prepared',
  add column payment_failed_at timestamptz,
  add column payment_state_event_id text;

-- Backward-compatible with any already-finalized Phase 1 orders.
update public.perrun_checkout_orders set payment_status = 'paid' where finalized_at is not null;

alter table public.perrun_checkout_orders
  add constraint perrun_payment_status_valid check (payment_status in ('prepared','pending','failed','paid')),
  add constraint perrun_payment_status_finalization check ((payment_status = 'paid') = (finalized_at is not null)),
  add constraint perrun_payment_state_trace check (
    (payment_state_event_id is null or payment_state_event_id ~ '^evt_[A-Za-z0-9_]{1,200}$')
    and (payment_status not in ('pending','failed') or payment_state_event_id is not null)
    and (payment_status <> 'failed' or payment_failed_at is not null)
    and (payment_failed_at is null or payment_state_event_id is not null)
    and (payment_status <> 'prepared' or (payment_failed_at is null and payment_state_event_id is null))
    and (payment_status <> 'pending' or payment_failed_at is null)
  );

-- Derived paid status follows the authoritative Phase 1 finalization evidence.
-- No duplication/replacement of the transactional finalizer is necessary.
create function kinetic_perrun_private.guard_payment_state()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.finalized_at is not null then
    if new.finalized_at is distinct from old.finalized_at
      or new.payment_intent_id is distinct from old.payment_intent_id then
      raise exception using errcode = '23514', message = 'Perrun finalization identity cannot be reversed';
    end if;
    new.payment_failed_at := old.payment_failed_at;
    new.payment_state_event_id := old.payment_state_event_id;
  end if;
  if new.finalized_at is not null then
    new.payment_status := 'paid';
  elsif tg_op = 'UPDATE' then
    if (old.payment_status = 'failed' and new.payment_status <> 'failed')
      or (old.payment_status = 'pending' and new.payment_status = 'prepared') then
      raise exception using errcode = '23514', message = 'Perrun unpaid state cannot regress';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kinetic_perrun_private.guard_payment_state() from public, anon, authenticated, service_role;
create trigger perrun_payment_state_guard before insert or update on public.perrun_checkout_orders
for each row execute function kinetic_perrun_private.guard_payment_state();

-- Server caller must verify Stripe signature/session/draft before invoking this RPC.
-- Retains the first event of each accepted state transition; not a full event ledger.
create function kinetic_perrun_private.record_perrun_payment_state(
  p_order_session_id text, p_stripe_event_id text, p_payment_status text
) returns public.perrun_checkout_orders
language plpgsql security definer set search_path = '' as $$
declare v_order public.perrun_checkout_orders;
begin
  if p_order_session_id is null or pg_catalog.btrim(p_order_session_id) = ''
    or pg_catalog.length(p_order_session_id) > 255
    or p_stripe_event_id is null or p_stripe_event_id !~ '^evt_[A-Za-z0-9_]{1,200}$'
    or p_payment_status is null or p_payment_status not in ('pending','failed') then
    raise exception using errcode = '22023', message = 'Invalid Perrun payment state input';
  end if;
  -- Same order as finalization: event advisory lock -> draft row -> optional counter.
  -- This RPC never reads/writes the counter, registrations, dogs or engraving payments.
  perform pg_catalog.pg_advisory_xact_lock(123456789, pg_catalog.hashtext('perrun-2027'));
  select * into strict v_order from public.perrun_checkout_orders
    where order_session_id = p_order_session_id for update;
  if v_order.finalized_at is not null
    or v_order.payment_state_event_id = p_stripe_event_id
    or v_order.payment_status = 'failed'
    or v_order.payment_status = p_payment_status then
    return v_order;
  end if;
  update public.perrun_checkout_orders
    set payment_status = p_payment_status,
        payment_failed_at = case when p_payment_status = 'failed' then pg_catalog.clock_timestamp() else null end,
        payment_state_event_id = p_stripe_event_id
    where order_session_id = p_order_session_id
    returning * into v_order;
  return v_order;
end;
$$;

create function public.record_perrun_payment_state(
  p_order_session_id text, p_stripe_event_id text, p_payment_status text
) returns public.perrun_checkout_orders language sql security invoker set search_path = '' as $$
  select kinetic_perrun_private.record_perrun_payment_state(p_order_session_id,p_stripe_event_id,p_payment_status);
$$;
revoke all on function kinetic_perrun_private.record_perrun_payment_state(text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_perrun_payment_state(text,text,text) from public, anon, authenticated, service_role;
grant execute on function kinetic_perrun_private.record_perrun_payment_state(text,text,text) to service_role;
grant execute on function public.record_perrun_payment_state(text,text,text) to service_role;

-- Existing RLS, SELECT-only table grants, indexes, constraints and all other tables stay intact.
commit;
