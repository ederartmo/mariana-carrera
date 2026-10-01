-- Perrun 6A: persistence only. No Stripe/API implementation or remote execution.
-- One dog per payment; MXN 3500 remains fixed. All historical migrations unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.perrun_engraving_payments
  alter column stripe_session_id drop not null,
  add column paid_event_id text unique,
  add column state_event_id text,
  add column confirmation_email_id text,
  add column confirmation_email_sent_at timestamptz;

-- A reservation precedes Stripe: never store a fake session ID in a Stripe field.
alter table public.perrun_engraving_payments
  drop constraint perrun_engraving_payments_status_check,
  drop constraint perrun_engraving_payments_check,
  add constraint perrun_engraving_payment_status_valid check (status in ('reserved','pending','paid','expired','failed','refunded')),
  add constraint perrun_engraving_payment_state_valid check (
    (status = 'reserved' and stripe_session_id is null and stripe_payment_intent_id is null and paid_at is null)
    or (status = 'pending' and stripe_session_id is not null and stripe_payment_intent_id is null and paid_at is null)
    or (status in ('failed','expired') and stripe_payment_intent_id is null and paid_at is null)
    or (status in ('paid','refunded') and stripe_session_id is not null and stripe_payment_intent_id is not null and paid_at is not null)
  ),
  add constraint perrun_engraving_event_trace check (
    (paid_event_id is null or paid_event_id ~ '^evt_[A-Za-z0-9_]{1,200}$')
    and (state_event_id is null or state_event_id ~ '^evt_[A-Za-z0-9_]{1,200}$')
  ),
  add constraint perrun_engraving_email_confirmation check (
    (confirmation_email_id is null and confirmation_email_sent_at is null)
    or (confirmation_email_id is not null and char_length(btrim(confirmation_email_id)) between 1 and 200
        and confirmation_email_sent_at is not null and status in ('paid','refunded'))
  );
create unique index perrun_one_active_engraving on public.perrun_engraving_payments(dog_id)
  where status in ('reserved','pending');
-- Existing perrun_one_settled_engraving (paid/refunded) remains unchanged.

-- Lock order: draft -> composite human -> dog -> payment. No counter/global BIB lock.
-- Private helper inherits the controlled definer context; service cannot execute it.
create function kinetic_perrun_private.lock_engraving_dog(p_dog_id uuid, p_order_session_id text, p_require_active boolean)
returns public.registration_dogs language plpgsql security invoker set search_path = '' as $$
declare v_dog public.registration_dogs; v_order public.perrun_checkout_orders; v_human public.inscripciones;
begin
  select * into strict v_dog from public.registration_dogs where id = p_dog_id;
  if p_order_session_id is not null and v_dog.order_session_id is distinct from p_order_session_id then
    raise exception 'Engraving dog/order identity mismatch';
  end if;
  select * into strict v_order from public.perrun_checkout_orders where order_session_id = v_dog.order_session_id for update;
  select * into strict v_human from public.inscripciones where id = v_dog.registration_id and email = v_dog.registration_email for update;
  select * into strict v_dog from public.registration_dogs where id = p_dog_id for update;
  if v_order.event_slug is distinct from 'perrun-2027' or v_human.event_slug is distinct from 'perrun-2027'
     or v_order.finalized_at is null or v_order.payment_status is distinct from 'paid'
     or not v_dog.engraving_requested or v_dog.engraving_free or not v_dog.engraving_payment_required
     or v_dog.engraving_payment_amount_cents <> 3500 then raise exception 'Dog is not eligible for paid engraving'; end if;
  if p_require_active and (v_human.payment_status is null or v_human.payment_status not in ('paid','paid_no_email') or v_human.registration_status is distinct from 'active') then
    raise exception 'Main registration must remain paid and active';
  end if;
  return v_dog;
end;
$$;

create function kinetic_perrun_private.reserve_perrun_engraving_payment(p_dog_id uuid, p_order_session_id text, p_payment_id uuid)
returns public.perrun_engraving_payments language plpgsql security definer set search_path = '' as $$
declare v_dog public.registration_dogs; v_payment public.perrun_engraving_payments;
begin
  if p_payment_id is null or p_order_session_id is null or btrim(p_order_session_id) = '' then raise exception 'Payment reference and main order required'; end if;
  v_dog := kinetic_perrun_private.lock_engraving_dog(p_dog_id,p_order_session_id,true);
  select * into v_payment from public.perrun_engraving_payments where id = p_payment_id for update;
  if found then
    if v_payment.dog_id is distinct from p_dog_id then raise exception 'Payment reference belongs to another dog'; end if;
    return v_payment;
  end if;
  if exists(select 1 from public.perrun_engraving_payments where dog_id = p_dog_id and status in ('paid','refunded')) then
    raise exception 'Engraving already settled; refunded is terminal';
  end if;
  select * into v_payment from public.perrun_engraving_payments where dog_id = p_dog_id and status in ('reserved','pending') for update;
  if found then return v_payment; end if;
  insert into public.perrun_engraving_payments(id,dog_id,status,amount_cents,currency)
    values(p_payment_id,p_dog_id,'reserved',3500,'mxn') returning * into v_payment;
  return v_payment;
end;
$$;

create function kinetic_perrun_private.finalize_perrun_engraving_payment(
  p_payment_id uuid, p_stripe_session_id text, p_payment_intent_id text,
  p_stripe_event_id text, p_confirmed_amount_cents integer, p_confirmed_currency text
) returns public.perrun_engraving_payments language plpgsql security definer set search_path = '' as $$
declare v_payment public.perrun_engraving_payments; v_dog public.registration_dogs;
begin
  if p_stripe_session_id is null or p_stripe_session_id !~ '^cs_[A-Za-z0-9_]{1,200}$'
     or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]{1,200}$'
     or p_stripe_event_id is null or p_stripe_event_id !~ '^evt_[A-Za-z0-9_]{1,200}$'
     or p_confirmed_amount_cents is distinct from 3500 or lower(p_confirmed_currency) is distinct from 'mxn' then
    raise exception 'Invalid confirmed engraving payment identity/amount/currency';
  end if;
  select * into strict v_payment from public.perrun_engraving_payments where id = p_payment_id;
  v_dog := kinetic_perrun_private.lock_engraving_dog(v_payment.dog_id,null,false);
  select * into strict v_payment from public.perrun_engraving_payments where id = p_payment_id for update;
  if v_payment.stripe_session_id is distinct from p_stripe_session_id then raise exception 'Stripe session does not match engraving reservation'; end if;
  if v_payment.status in ('paid','refunded') then
    if v_payment.stripe_payment_intent_id is distinct from p_payment_intent_id then raise exception 'PaymentIntent conflict'; end if;
    return v_payment;
  end if;
  -- A terminal failed/expired attempt cannot be revived after a new attempt has started.
  if v_payment.status <> 'pending' then raise exception 'Only attached pending engraving can settle'; end if;
  perform kinetic_perrun_private.lock_engraving_dog(v_payment.dog_id,null,true);
  update public.perrun_engraving_payments set status = 'paid', stripe_payment_intent_id = p_payment_intent_id,
    paid_event_id = p_stripe_event_id, state_event_id = p_stripe_event_id, paid_at = now()
    where id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

create function kinetic_perrun_private.record_perrun_engraving_state(
  p_payment_id uuid, p_stripe_session_id text, p_status text, p_stripe_event_id text default null, p_payment_intent_id text default null
) returns public.perrun_engraving_payments language plpgsql security definer set search_path = '' as $$
declare v_payment public.perrun_engraving_payments; v_dog public.registration_dogs;
begin
  if p_status is null or p_status not in ('pending','failed','expired','refunded') then raise exception 'Invalid engraving state'; end if;
  if p_stripe_event_id is not null and p_stripe_event_id !~ '^evt_[A-Za-z0-9_]{1,200}$' then raise exception 'Invalid Stripe event'; end if;
  select * into strict v_payment from public.perrun_engraving_payments where id = p_payment_id;
  v_dog := kinetic_perrun_private.lock_engraving_dog(v_payment.dog_id,null,false);
  select * into strict v_payment from public.perrun_engraving_payments where id = p_payment_id for update;
  if v_payment.stripe_session_id is not null and v_payment.stripe_session_id is distinct from p_stripe_session_id then raise exception 'Stripe session identity mismatch'; end if;
  if p_status = 'refunded' then
    if v_payment.status not in ('paid','refunded') or p_payment_intent_id is null
       or v_payment.stripe_payment_intent_id is distinct from p_payment_intent_id or p_stripe_event_id is null then
      raise exception 'Refund requires settled engraving PaymentIntent and event';
    end if;
    if v_payment.status = 'refunded' then return v_payment; end if;
    update public.perrun_engraving_payments set status = 'refunded', state_event_id = p_stripe_event_id where id = p_payment_id returning * into v_payment;
    return v_payment;
  end if;
  if v_payment.status in ('paid','refunded') then return v_payment; end if;
  if v_payment.status = p_status then return v_payment; end if;
  if v_payment.status in ('failed','expired') then raise exception 'Failed/expired attempts are terminal; reserve a new reference'; end if;
  if p_status = 'pending' then
    if p_stripe_session_id is null or p_stripe_session_id !~ '^cs_[A-Za-z0-9_]{1,200}$' then raise exception 'Valid Stripe session required'; end if;
    perform kinetic_perrun_private.lock_engraving_dog(v_payment.dog_id,null,true);
  elsif v_payment.stripe_session_id is null then
    if p_stripe_session_id is not null or p_payment_intent_id is not null then raise exception 'Unattached reservation has no Stripe identity'; end if;
  elsif p_stripe_event_id is null then raise exception 'Terminal attached state requires Stripe event';
  end if;
  update public.perrun_engraving_payments set status = p_status,
    stripe_session_id = case when p_status = 'pending' then p_stripe_session_id else stripe_session_id end,
    state_event_id = coalesce(p_stripe_event_id,state_event_id)
    where id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

create function kinetic_perrun_private.mark_perrun_engraving_email_sent(p_payment_id uuid, p_provider_id text)
returns public.perrun_engraving_payments language plpgsql security definer set search_path = '' as $$
declare v_payment public.perrun_engraving_payments;
begin
  if p_provider_id is null or char_length(btrim(p_provider_id)) not between 1 and 200 then raise exception 'Provider confirmation required'; end if;
  select * into strict v_payment from public.perrun_engraving_payments where id = p_payment_id for update;
  if v_payment.confirmation_email_sent_at is not null then
    if v_payment.confirmation_email_id is distinct from p_provider_id then raise exception 'Email provider identity conflict'; end if;
    return v_payment;
  end if;
  if v_payment.status <> 'paid' then raise exception 'Only paid engraving can confirm email'; end if;
  update public.perrun_engraving_payments set confirmation_email_id = p_provider_id, confirmation_email_sent_at = now()
    where id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

create function public.reserve_perrun_engraving_payment(p_dog_id uuid, p_order_session_id text, p_payment_id uuid)
returns public.perrun_engraving_payments language sql security invoker set search_path = '' as $$
  select kinetic_perrun_private.reserve_perrun_engraving_payment(p_dog_id,p_order_session_id,p_payment_id);
$$;
create function public.finalize_perrun_engraving_payment(p_payment_id uuid,p_stripe_session_id text,p_payment_intent_id text,p_stripe_event_id text,p_confirmed_amount_cents integer,p_confirmed_currency text)
returns public.perrun_engraving_payments language sql security invoker set search_path = '' as $$
  select kinetic_perrun_private.finalize_perrun_engraving_payment(p_payment_id,p_stripe_session_id,p_payment_intent_id,p_stripe_event_id,p_confirmed_amount_cents,p_confirmed_currency);
$$;
create function public.record_perrun_engraving_state(p_payment_id uuid,p_stripe_session_id text,p_status text,p_stripe_event_id text default null,p_payment_intent_id text default null)
returns public.perrun_engraving_payments language sql security invoker set search_path = '' as $$
  select kinetic_perrun_private.record_perrun_engraving_state(p_payment_id,p_stripe_session_id,p_status,p_stripe_event_id,p_payment_intent_id);
$$;
create function public.mark_perrun_engraving_email_sent(p_payment_id uuid,p_provider_id text)
returns public.perrun_engraving_payments language sql security invoker set search_path = '' as $$
  select kinetic_perrun_private.mark_perrun_engraving_email_sent(p_payment_id,p_provider_id);
$$;

-- Each new signature is revoked within this transaction before it becomes visible.
do $$
declare v_function regprocedure;
begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','kinetic_perrun_private') and p.proname in
      ('lock_engraving_dog','reserve_perrun_engraving_payment','finalize_perrun_engraving_payment','record_perrun_engraving_state','mark_perrun_engraving_email_sent')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
    if split_part(v_function::text,'.',2) not like 'lock_engraving_dog(%' and v_function::text not like 'lock_engraving_dog(%' then
      execute format('grant execute on function %s to service_role',v_function);
    end if;
  end loop;
end;
$$;
-- Table RLS and SELECT-only grants unchanged. No INSERT/UPDATE/DELETE/TRUNCATE grants.
commit;
