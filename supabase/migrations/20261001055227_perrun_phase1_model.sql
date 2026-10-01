-- LOCAL REVIEW ONLY. Do not apply remotely without explicit approval.
-- Dependency: existing public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb).
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
-- Fail closed on drift from the reviewed deployed finalizer and existing distance rule.
do $preflight$
begin
  if not exists (
    select 1 from pg_proc where oid = to_regprocedure('public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)')
      and md5(replace(prosrc,chr(13)||chr(10),chr(10))) = '2a46b817cd7b5d95be7f52d811847d0a'
  ) then raise exception 'Finalizer drift: review deployed definition before applying Perrun'; end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.inscripciones'::regclass
      and conname = 'inscripciones_distance_chk' and pg_get_constraintdef(oid) = $oldcheck$CHECK (((distance IS NULL) OR ((event_slug = 'axolote-night-run'::text) AND (distance = '5K'::text)) OR ((event_slug = 'cascanueces-run'::text) AND (distance = ANY (ARRAY['5K'::text, '10K'::text])))))$oldcheck$
  ) then raise exception 'Distance constraint drift: review before applying Perrun'; end if;
end;
$preflight$;

-- This schema is not exposed through PostgREST. Privileged implementation stays here.
create schema kinetic_perrun_private;
revoke all on schema kinetic_perrun_private from public, anon, authenticated, service_role;

create function kinetic_perrun_private.valid_dogs(p_dogs jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d jsonb; w numeric; n integer;
begin
  if p_dogs is null or jsonb_typeof(p_dogs) <> 'array' then return false; end if;
  n := jsonb_array_length(p_dogs);
  if n not between 1 and 2 then return false; end if;
  for d in select value from jsonb_array_elements(p_dogs) loop
    if jsonb_typeof(d) <> 'object'
       or jsonb_typeof(d->'name') is distinct from 'string'
       or char_length(btrim(d->>'name')) not between 1 and 80
       or jsonb_typeof(d->'weightKg') is distinct from 'number'
       or jsonb_typeof(d->'engravingRequested') is distinct from 'boolean' then return false; end if;
    w := (d->>'weightKg')::numeric;
    if w < 3 or w > 80 or (n = 2 and w > 25) then return false; end if;
    if d ? 'category' and d->>'category' is distinct from
      (case when w <= 10 then 'S' when w <= 25 then 'M' when w <= 50 then 'L' else 'XL' end) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function kinetic_perrun_private.valid_dogs(jsonb) from public, anon, authenticated, service_role;

-- Server-created immutable checkout input. It does NOT allocate free places.
-- Store after Stripe TEST session creation, before handing its URL to the browser.
create table public.perrun_checkout_orders (
  order_session_id text primary key check (btrim(order_session_id) <> ''),
  event_slug text not null default 'perrun-2027' check (event_slug = 'perrun-2027'),
  distance text not null check (distance in ('1K','3K','5K')),
  buyer_email text not null check (btrim(buyer_email) <> ''),
  participant jsonb not null check (jsonb_typeof(participant) = 'object' and not (participant ? 'whatsapp')),
  owner_phone text not null check (owner_phone ~ '^\+52[0-9]{10}$'),
  dogs jsonb not null check (kinetic_perrun_private.valid_dogs(dogs)),
  price_stage text not null check (price_stage in ('presale','general','late')),
  base_amount_cents integer not null,
  amount_cents integer not null,
  currency text not null default 'mxn' check (currency = 'mxn'),
  quoted_at timestamptz not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  payment_intent_id text unique,
  constraint perrun_stage_price check (base_amount_cents = case price_stage when 'presale' then 45000 when 'general' then 50000 else 55000 end),
  constraint perrun_main_price check (amount_cents = base_amount_cents + case jsonb_array_length(dogs) when 2 then 18000 else 0 end),
  constraint perrun_quote_time check (
    quoted_at < timestamptz '2027-01-25 16:00:00-06'
    and price_stage = case when quoted_at < timestamptz '2026-11-01 00:00:00-06' then 'presale'
      when quoted_at < timestamptz '2027-01-01 00:00:00-06' then 'general' else 'late' end),
  constraint perrun_finalization_pair check ((finalized_at is null) = (payment_intent_id is null))
);

create table public.perrun_paid_dog_counter (
  event_slug text primary key check (event_slug = 'perrun-2027'),
  last_sequence bigint not null default 0 check (last_sequence >= 0)
);
insert into public.perrun_paid_dog_counter(event_slug) values ('perrun-2027');

create table public.registration_dogs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null,
  registration_email text not null,
  foreign key (registration_id, registration_email) references public.inscripciones(id,email) on delete restrict on update cascade,
  order_session_id text not null references public.perrun_checkout_orders(order_session_id) on delete restrict,
  dog_index smallint not null check (dog_index in (1,2)),
  dog_name text not null check (char_length(btrim(dog_name)) between 1 and 80),
  weight_kg numeric not null check (weight_kg between 3 and 80),
  category text not null check (category = case when weight_kg <= 10 then 'S' when weight_kg <= 25 then 'M' when weight_kg <= 50 then 'L' else 'XL' end),
  engraving_requested boolean not null,
  engraving_sequence bigint not null unique check (engraving_sequence > 0),
  engraving_free boolean not null check (engraving_free = (engraving_sequence <= 300)),
  engraving_payment_required boolean not null check (engraving_payment_required = (engraving_requested and not engraving_free)),
  engraving_payment_amount_cents integer not null check (engraving_payment_amount_cents = case when engraving_payment_required then 3500 else 0 end),
  plate_status text not null default 'not_started' check (plate_status in ('not_started','preparing','engraved','skipped')),
  dog_name_for_plate text,
  owner_phone_for_plate text,
  plate_started_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_session_id, dog_index),
  unique(registration_id, registration_email, dog_index),
  constraint perrun_plate_snapshot check (
    (plate_started_at is null and dog_name_for_plate is null and owner_phone_for_plate is null and plate_status in ('not_started','skipped'))
    or (plate_started_at is not null and btrim(dog_name_for_plate) <> '' and btrim(owner_phone_for_plate) <> ''
      and dog_name_for_plate is not null and owner_phone_for_plate is not null and plate_status in ('preparing','engraved','skipped')))
);

-- One dog per add-on Checkout. Multiple attempts permitted, at most one paid attempt.
-- Future phase must confirm explicit user consent and verify Stripe amount/currency/signature.
create table public.perrun_engraving_payments (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.registration_dogs(id) on delete restrict,
  stripe_session_id text not null unique check (btrim(stripe_session_id) <> ''),
  stripe_payment_intent_id text unique,
  amount_cents integer not null default 3500 check (amount_cents = 3500),
  currency text not null default 'mxn' check (currency = 'mxn'),
  status text not null default 'pending' check (status in ('pending','paid','expired','failed','refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((status in ('paid','refunded') and paid_at is not null and stripe_payment_intent_id is not null)
    or (status in ('pending','expired','failed') and paid_at is null))
);
create unique index perrun_one_settled_engraving on public.perrun_engraving_payments(dog_id) where status in ('paid','refunded');
create index perrun_engraving_dog_lookup on public.perrun_engraving_payments(dog_id);

-- All access goes through authenticated server endpoints, never browser table grants.
alter table public.perrun_checkout_orders enable row level security;
alter table public.perrun_paid_dog_counter enable row level security;
alter table public.registration_dogs enable row level security;
alter table public.perrun_engraving_payments enable row level security;
revoke all on public.perrun_checkout_orders, public.perrun_paid_dog_counter,
  public.registration_dogs, public.perrun_engraving_payments from public, anon, authenticated, service_role;
grant select on public.perrun_checkout_orders, public.perrun_paid_dog_counter,
  public.registration_dogs, public.perrun_engraving_payments to service_role;
-- Draft insertion only via RPC; no direct writes to ledger, dogs or add-on payments.

-- Model-level guard only: no new API or public plate RPC is enabled.
create function kinetic_perrun_private.guard_plate_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_parent public.inscripciones; v_phone text;
begin
  if old.plate_started_at is not null then
    if new.plate_started_at is distinct from old.plate_started_at
      or new.dog_name_for_plate is distinct from old.dog_name_for_plate
      or new.owner_phone_for_plate is distinct from old.owner_phone_for_plate then
      raise exception 'Plate snapshot is immutable after preparation starts';
    end if;
  elsif new.plate_status = 'preparing' then
    select * into strict v_parent from public.inscripciones
      where id = old.registration_id and email = old.registration_email for update;
    if v_parent.payment_status is distinct from 'paid' or v_parent.registration_status is distinct from 'active'
      or not old.engraving_requested then raise exception 'Plate preparation is not eligible'; end if;
    if not old.engraving_free and not exists (
      select 1 from public.perrun_engraving_payments where dog_id = old.id and status = 'paid'
    ) then raise exception 'Separate engraving payment required'; end if;
    -- Order phone is immutable, preserved even when the legacy finalizer clears whatsapp.
    select owner_phone into strict v_phone from public.perrun_checkout_orders where order_session_id = old.order_session_id;
    new.dog_name_for_plate := new.dog_name;
    new.owner_phone_for_plate := v_phone;
    new.plate_started_at := now();
  elsif new.plate_status = 'engraved' then
    raise exception 'Plate must enter preparation before engraved';
  end if;
  return new;
end;
$$;
revoke all on function kinetic_perrun_private.guard_plate_snapshot() from public, anon, authenticated, service_role;
create trigger perrun_plate_snapshot_guard before update on public.registration_dogs
for each row execute function kinetic_perrun_private.guard_plate_snapshot();

create function kinetic_perrun_private.prepare_perrun_order(
  p_order_session_id text, p_distance text, p_buyer_email text, p_participant jsonb,
  p_dogs jsonb, p_price_stage text, p_quoted_at timestamptz
) returns public.perrun_checkout_orders
language plpgsql security definer set search_path = '' as $$
declare v_order public.perrun_checkout_orders; v_base integer; v_phone text;
begin
  if not kinetic_perrun_private.valid_dogs(p_dogs) then raise exception 'Invalid Perrun dogs'; end if;
  if p_participant is null or jsonb_typeof(p_participant) <> 'object' then raise exception 'One human required'; end if;
  v_phone := btrim(p_participant->>'whatsapp');
  if v_phone is null or v_phone !~ '^\+52[0-9]{10}$' then raise exception 'Valid Perrun owner phone required'; end if;
  v_base := case p_price_stage when 'presale' then 45000 when 'general' then 50000 when 'late' then 55000 else null end;
  insert into public.perrun_checkout_orders(order_session_id,distance,buyer_email,participant,owner_phone,dogs,price_stage,base_amount_cents,amount_cents,quoted_at)
    values(p_order_session_id,p_distance,p_buyer_email,p_participant - 'whatsapp',v_phone,p_dogs,p_price_stage,v_base,
      v_base + case jsonb_array_length(p_dogs) when 2 then 18000 else 0 end,p_quoted_at)
    on conflict (order_session_id) do nothing;
  select * into strict v_order from public.perrun_checkout_orders where order_session_id = p_order_session_id;
  if v_order.distance is distinct from p_distance or v_order.buyer_email is distinct from p_buyer_email
    or v_order.participant is distinct from (p_participant - 'whatsapp') or v_order.owner_phone is distinct from v_phone
    or v_order.dogs is distinct from p_dogs
    or v_order.price_stage is distinct from p_price_stage or v_order.quoted_at is distinct from p_quoted_at then
    raise exception 'Perrun checkout payload conflict';
  end if;
  return v_order;
end;
$$;

create function kinetic_perrun_private.finalize_perrun_paid_order(
  p_order_session_id text, p_payment_intent_id text, p_stripe_event_id text,
  p_confirmed_amount_cents integer, p_confirmed_currency text
) returns setof public.registration_dogs
language plpgsql security definer set search_path = '' as $$
declare v_order public.perrun_checkout_orders; v_parent public.inscripciones; v_last bigint; v_count integer;
begin
  -- Caller must have verified Stripe webhook signature AND paid status. No browser calls.
  if nullif(btrim(p_payment_intent_id),'') is null or nullif(btrim(p_stripe_event_id),'') is null then
    raise exception 'Confirmed Stripe identities required';
  end if;
  -- Same event lock as existing finalizer. Lock order is event -> draft -> counter.
  perform pg_catalog.pg_advisory_xact_lock(123456789, pg_catalog.hashtext('perrun-2027'));
  select * into strict v_order from public.perrun_checkout_orders where order_session_id = p_order_session_id for update;
  if p_confirmed_amount_cents is distinct from v_order.amount_cents or p_confirmed_currency is distinct from v_order.currency then
    raise exception 'Confirmed Stripe amount/currency mismatch';
  end if;
  if v_order.finalized_at is not null then
    if v_order.payment_intent_id is distinct from p_payment_intent_id then raise exception 'Payment identity conflict'; end if;
    return query select d.* from public.registration_dogs d where d.order_session_id = p_order_session_id order by d.dog_index;
    return;
  end if;
  if exists(select 1 from public.inscripciones where order_session_id = p_order_session_id and payment_status = 'paid') then
    raise exception 'Perrun paid order without dog ledger; reconciliation required';
  end if;
  -- Force one human ticket irrespective of any caller-supplied ticket index.
  perform public.finalize_paid_order(p_order_session_id,'perrun-2027',v_order.distance,
    v_order.amount_cents::numeric / 100,v_order.buyer_email,p_payment_intent_id,p_stripe_event_id,
    jsonb_build_array(v_order.participant || jsonb_build_object('ticketIndex',1,'ticket_index',1,'whatsapp',v_order.owner_phone)));
  select count(*) into v_count from public.inscripciones where order_session_id = p_order_session_id;
  if v_count <> 1 then raise exception 'Perrun requires exactly one human registration'; end if;
  select * into strict v_parent from public.inscripciones where order_session_id = p_order_session_id;
  if v_parent.event_slug <> 'perrun-2027' or v_parent.payment_status <> 'paid'
    or v_parent.ticket_index <> 1 or v_parent.ticket_count <> 1
    or v_parent.registration_status is distinct from 'active' then raise exception 'Invalid finalized Perrun human'; end if;
  select last_sequence into strict v_last from public.perrun_paid_dog_counter where event_slug = 'perrun-2027' for update;
  insert into public.registration_dogs(registration_id,registration_email,order_session_id,dog_index,dog_name,weight_kg,category,
    engraving_requested,engraving_sequence,engraving_free,engraving_payment_required,engraving_payment_amount_cents)
  select v_parent.id,v_parent.email,p_order_session_id,ordinality::smallint,btrim(d->>'name'),(d->>'weightKg')::numeric,
    case when (d->>'weightKg')::numeric <= 10 then 'S' when (d->>'weightKg')::numeric <= 25 then 'M'
      when (d->>'weightKg')::numeric <= 50 then 'L' else 'XL' end,
    (d->>'engravingRequested')::boolean,v_last+ordinality,v_last+ordinality <= 300,
    v_last+ordinality > 300 and (d->>'engravingRequested')::boolean,
    case when v_last+ordinality > 300 and (d->>'engravingRequested')::boolean then 3500 else 0 end
  from jsonb_array_elements(v_order.dogs) with ordinality as dogs(d,ordinality) order by ordinality;
  update public.perrun_paid_dog_counter set last_sequence = v_last + jsonb_array_length(v_order.dogs) where event_slug = 'perrun-2027';
  update public.perrun_checkout_orders set finalized_at = now(), payment_intent_id = p_payment_intent_id where order_session_id = p_order_session_id;
  return query select d.* from public.registration_dogs d where d.order_session_id = p_order_session_id order by d.dog_index;
end;
$$;

create function public.prepare_perrun_order(
  p_order_session_id text, p_distance text, p_buyer_email text, p_participant jsonb,
  p_dogs jsonb, p_price_stage text, p_quoted_at timestamptz
) returns public.perrun_checkout_orders language sql security invoker set search_path = '' as $$
  select kinetic_perrun_private.prepare_perrun_order(p_order_session_id,p_distance,p_buyer_email,p_participant,p_dogs,p_price_stage,p_quoted_at);
$$;
create function public.finalize_perrun_paid_order(
  p_order_session_id text, p_payment_intent_id text, p_stripe_event_id text,
  p_confirmed_amount_cents integer, p_confirmed_currency text
) returns setof public.registration_dogs language sql security invoker set search_path = '' as $$
  select * from kinetic_perrun_private.finalize_perrun_paid_order(p_order_session_id,p_payment_intent_id,p_stripe_event_id,p_confirmed_amount_cents,p_confirmed_currency);
$$;
grant usage on schema kinetic_perrun_private to service_role;
revoke all on function kinetic_perrun_private.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function kinetic_perrun_private.finalize_perrun_paid_order(text,text,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function kinetic_perrun_private.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz) to service_role;
grant execute on function kinetic_perrun_private.finalize_perrun_paid_order(text,text,text,integer,text) to service_role;

-- Historical rows cannot be deleted or edited by service_role. No plate write RPC yet.
-- Snapshot transition and add-on settlement intentionally belong to subsequent phases.
revoke all on function public.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.finalize_perrun_paid_order(text,text,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_perrun_order(text,text,text,jsonb,jsonb,text,timestamptz) to service_role;
grant execute on function public.finalize_perrun_paid_order(text,text,text,integer,text) to service_role;

-- Keep old race rules byte-for-byte in meaning; only admit the approved Perrun distances.
-- NOT VALID avoids a full scan: existing rows already satisfied the narrower old check.
-- New writes are checked immediately. VALIDATE may be done separately after approval.
alter table public.inscripciones drop constraint inscripciones_distance_chk;
alter table public.inscripciones add constraint inscripciones_distance_chk check (
  distance is null
  or (event_slug = 'axolote-night-run' and distance = '5K')
  or (event_slug = 'cascanueces-run' and distance in ('5K','10K'))
  or (event_slug = 'perrun-2027' and distance in ('1K','3K','5K'))
) not valid;

commit;
