-- Review locally before remote application. No historical migrations are changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Fail closed: reuse only the exact finalizer validated by the repository fixture.
-- Nullable provider identities are intentional; stripe_session_id remains a compatibility key.
do $patch$
declare v_body text; v_definition text; v_old text := 'where existing.payment_status = ''paid''';
begin
  select prosrc, pg_get_functiondef(oid) into strict v_body, v_definition from pg_proc
    where oid = 'public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)'::regprocedure;
  if md5(replace(v_body,chr(13)||chr(10),chr(10))) <> '2a46b817cd7b5d95be7f52d811847d0a'
    or position(v_old in v_definition) = 0 then raise exception 'Finalizer drift: review before manual Perrun'; end if;
  -- Perrun refunds retain historical BIBs. Other events keep their exact paid-only rule.
  execute replace(v_definition,v_old,
    'where (existing.payment_status = ''paid'' or p_event_slug = ''perrun-2027'')');
end;
$patch$;

alter table public.perrun_checkout_orders
  add column payment_source text not null default 'stripe',
  add column manual_payment_id uuid unique,
  add column transfer_reference text,
  add column manual_admin_user_id uuid,
  add column manual_admin_email text,
  add column manual_paid_at timestamptz,
  drop constraint perrun_finalization_pair,
  add constraint perrun_payment_source_valid check (payment_source in ('stripe','manual_transfer')),
  add constraint perrun_manual_identity check (
    (payment_source = 'stripe' and manual_payment_id is null and transfer_reference is null
      and manual_admin_user_id is null and manual_admin_email is null and manual_paid_at is null
      and ((finalized_at is null) = (payment_intent_id is null)))
    or (payment_source = 'manual_transfer' and manual_payment_id is not null
      and order_session_id = 'manual_perrun_' || manual_payment_id::text
      and manual_admin_user_id is not null and manual_admin_email is not null and btrim(manual_admin_email) <> ''
      and manual_paid_at is not null and payment_intent_id is null and payment_state_event_id is null
      and payment_failed_at is null and payment_status in ('prepared','paid'))),
  add constraint perrun_manual_reference_length check (transfer_reference is null or char_length(transfer_reference) <= 80);

create function kinetic_perrun_private.guard_payment_source()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.finalized_at is not null or old.payment_source = 'manual_transfer' then
    if new.payment_source is distinct from old.payment_source
      or new.manual_payment_id is distinct from old.manual_payment_id
      or new.transfer_reference is distinct from old.transfer_reference
      or new.manual_admin_user_id is distinct from old.manual_admin_user_id
      or new.manual_admin_email is distinct from old.manual_admin_email
      or new.manual_paid_at is distinct from old.manual_paid_at then
      raise exception using errcode = '23514', message = 'Perrun payment source is immutable';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kinetic_perrun_private.guard_payment_source() from public,anon,authenticated,service_role;
create trigger perrun_payment_source_guard before update on public.perrun_checkout_orders
for each row execute function kinetic_perrun_private.guard_payment_source();

-- Keep Stripe's existing finalizer intact except for an explicit origin guard.
do $stripe_guard$
declare v_definition text; v_anchor text := 'if p_confirmed_amount_cents is distinct from v_order.amount_cents';
begin
  select pg_get_functiondef('kinetic_perrun_private.finalize_perrun_paid_order(text,text,text,integer,text)'::regprocedure) into v_definition;
  if position(v_anchor in v_definition) = 0 then raise exception 'Perrun finalizer drift'; end if;
  execute replace(v_definition,v_anchor,
    'if v_order.payment_source <> ''stripe'' then raise exception ''Stripe finalizer requires Stripe order''; end if; ' || v_anchor);
end;
$stripe_guard$;

create function kinetic_perrun_private.register_perrun_manual_paid_order(
  p_manual_payment_id uuid, p_distance text, p_buyer_email text, p_participant jsonb, p_dogs jsonb,
  p_price_stage text, p_quoted_at timestamptz, p_confirmed_amount_cents integer,
  p_transfer_reference text, p_admin_user_id uuid, p_admin_email text
) returns setof public.inscripciones
language plpgsql security definer set search_path = '' as $$
declare v_id text; v_order public.perrun_checkout_orders; v_parent public.inscripciones;
  v_last bigint; v_count integer; v_stage text; v_now timestamptz;
  v_reference text := nullif(btrim(p_transfer_reference),'');
begin
  if p_manual_payment_id is null or p_admin_user_id is null or nullif(btrim(p_admin_email),'') is null
    or p_buyer_email is null or p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or not kinetic_perrun_private.valid_dogs(p_dogs) or p_participant is null
    or jsonb_typeof(p_participant) <> 'object' or char_length(coalesce(v_reference,'')) > 80 then
    raise exception using errcode = '22023', message = 'Invalid manual Perrun input';
  end if;
  v_id := 'manual_perrun_' || p_manual_payment_id::text;
  perform pg_catalog.pg_advisory_xact_lock(123456789,pg_catalog.hashtext('perrun-2027'));
  v_now := clock_timestamp();
  select * into v_order from public.perrun_checkout_orders where order_session_id = v_id for update;
  if found then
    if v_order.payment_source <> 'manual_transfer' or v_order.manual_payment_id <> p_manual_payment_id
      or v_order.distance is distinct from p_distance or v_order.buyer_email is distinct from p_buyer_email
      or v_order.participant is distinct from (p_participant - 'whatsapp')
      or v_order.owner_phone is distinct from (p_participant->>'whatsapp')
      or v_order.dogs is distinct from p_dogs or v_order.transfer_reference is distinct from v_reference then
      raise exception using errcode = '23505', message = 'Manual Perrun payload conflict';
    end if;
    -- Original actor/date/tariff are retained, including retries after a stage boundary.
    if v_order.finalized_at is null then raise exception 'Incomplete manual Perrun order'; end if;
    select count(*) into v_count from public.inscripciones where order_session_id = v_id;
    if v_count <> 1 or (select count(*) from public.registration_dogs where order_session_id = v_id) <> jsonb_array_length(v_order.dogs) then
      raise exception 'Incomplete manual Perrun ledger';
    end if;
    return query select i.* from public.inscripciones i where i.order_session_id = v_id;
    return;
  end if;
  -- Registration date is server-owned, never a retrospective paidAt from the browser.
  if p_quoted_at is null or p_quoted_at > v_now + interval '5 seconds'
    or p_quoted_at < v_now - interval '5 minutes' or v_now >= timestamptz '2027-01-25 16:00:00-06' then
    raise exception using errcode = '23514', message = 'Manual Perrun tariff timestamp expired';
  end if;
  v_stage := case when v_now < timestamptz '2026-11-01 00:00:00-06' then 'presale'
    when v_now < timestamptz '2027-01-01 00:00:00-06' then 'general' else 'late' end;
  if p_price_stage is distinct from v_stage then raise exception using errcode = '23514', message = 'Manual Perrun stage changed'; end if;
  v_order := kinetic_perrun_private.prepare_perrun_order(v_id,p_distance,p_buyer_email,p_participant,p_dogs,p_price_stage,p_quoted_at);
  if p_confirmed_amount_cents is distinct from v_order.amount_cents then
    raise exception using errcode = '23514', message = 'Manual Perrun amount mismatch';
  end if;
  update public.perrun_checkout_orders set payment_source = 'manual_transfer', manual_payment_id = p_manual_payment_id,
    transfer_reference = v_reference, manual_admin_user_id = p_admin_user_id,
    manual_admin_email = lower(btrim(p_admin_email)), manual_paid_at = v_now where order_session_id = v_id;
  if exists(select 1 from public.inscripciones where order_session_id = v_id) then raise exception 'Manual Perrun human conflict'; end if;
  -- Proven nullable identities: this is the generic human finalizer, never the Stripe Perrun finalizer.
  perform public.finalize_paid_order(v_id,'perrun-2027',v_order.distance,v_order.amount_cents::numeric / 100,
    v_order.buyer_email,null,null,jsonb_build_array(v_order.participant ||
      jsonb_build_object('ticketIndex',1,'ticket_index',1,'whatsapp',v_order.owner_phone)));
  select count(*) into v_count from public.inscripciones where order_session_id = v_id;
  if v_count <> 1 then raise exception 'Manual Perrun requires one human'; end if;
  select * into strict v_parent from public.inscripciones where order_session_id = v_id;
  if v_parent.event_slug <> 'perrun-2027' or v_parent.payment_status <> 'paid'
    or v_parent.registration_status <> 'active' or v_parent.ticket_index <> 1 or v_parent.ticket_count <> 1
    or v_parent.bib_number is null or v_parent.amount_paid is distinct from v_order.amount_cents::numeric / 100
    or v_parent.payment_intent_id is not null or v_parent.stripe_event_id is not null then
    raise exception 'Invalid manual Perrun human';
  end if;
  select last_sequence into strict v_last from public.perrun_paid_dog_counter where event_slug = 'perrun-2027' for update;
  insert into public.registration_dogs(registration_id,registration_email,order_session_id,dog_index,dog_name,weight_kg,category,
    engraving_requested,engraving_sequence,engraving_free,engraving_payment_required,engraving_payment_amount_cents)
  select v_parent.id,v_parent.email,v_id,ordinality::smallint,btrim(d->>'name'),(d->>'weightKg')::numeric,
    case when (d->>'weightKg')::numeric <= 10 then 'S' when (d->>'weightKg')::numeric <= 25 then 'M'
      when (d->>'weightKg')::numeric <= 50 then 'L' else 'XL' end,
    (d->>'engravingRequested')::boolean,v_last+ordinality,v_last+ordinality <= 300,
    v_last+ordinality > 300 and (d->>'engravingRequested')::boolean,
    case when v_last+ordinality > 300 and (d->>'engravingRequested')::boolean then 3500 else 0 end
  from jsonb_array_elements(v_order.dogs) with ordinality as dogs(d,ordinality) order by ordinality;
  update public.perrun_paid_dog_counter set last_sequence = v_last + jsonb_array_length(v_order.dogs) where event_slug = 'perrun-2027';
  update public.perrun_checkout_orders set finalized_at = v_now where order_session_id = v_id;
  return query select i.* from public.inscripciones i where i.order_session_id = v_id;
end;
$$;

create function public.register_perrun_manual_paid_order(
  p_manual_payment_id uuid,p_distance text,p_buyer_email text,p_participant jsonb,p_dogs jsonb,
  p_price_stage text,p_quoted_at timestamptz,p_confirmed_amount_cents integer,
  p_transfer_reference text,p_admin_user_id uuid,p_admin_email text
) returns setof public.inscripciones language sql security invoker set search_path = '' as $$
  select * from kinetic_perrun_private.register_perrun_manual_paid_order(p_manual_payment_id,p_distance,p_buyer_email,
    p_participant,p_dogs,p_price_stage,p_quoted_at,p_confirmed_amount_cents,p_transfer_reference,p_admin_user_id,p_admin_email);
$$;
revoke all on function kinetic_perrun_private.register_perrun_manual_paid_order(uuid,text,text,jsonb,jsonb,text,timestamptz,integer,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.register_perrun_manual_paid_order(uuid,text,text,jsonb,jsonb,text,timestamptz,integer,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function kinetic_perrun_private.register_perrun_manual_paid_order(uuid,text,text,jsonb,jsonb,text,timestamptz,integer,text,uuid,text) to service_role;
grant execute on function public.register_perrun_manual_paid_order(uuid,text,text,jsonb,jsonb,text,timestamptz,integer,text,uuid,text) to service_role;
commit;
