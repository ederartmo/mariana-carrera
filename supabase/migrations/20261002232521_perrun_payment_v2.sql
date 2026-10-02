-- LOCAL ONLY: additive V2. Review/preflight required before any remote application.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.perrun_checkout_orders
 add column pricing_model_version smallint not null default 1 check(pricing_model_version in (1,2)),
 add column reservation_id uuid unique,
 add column second_dog_amount_cents integer not null default 0 check(second_dog_amount_cents>=0),
 add column engraving_amount_cents integer not null default 0 check(engraving_amount_cents>=0),
 drop constraint perrun_main_price,
 add constraint perrun_main_price check (
 (pricing_model_version=1 and amount_cents=base_amount_cents+case jsonb_array_length(dogs) when 2 then 18000 else 0 end and reservation_id is null)
 or (pricing_model_version=2 and reservation_id is not null and second_dog_amount_cents=case jsonb_array_length(dogs) when 2 then 18000 else 0 end and amount_cents=base_amount_cents+second_dog_amount_cents+engraving_amount_cents));

create table public.perrun_checkout_reservations (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null unique,
 pricing_model_version smallint not null default 2 check(pricing_model_version=2),
 payload jsonb not null, payload_digest text not null,
 source text not null check(source in ('stripe','manual_transfer')),
 price_stage text not null check(price_stage in ('presale','general','late')),
 base_amount_cents integer not null check(base_amount_cents in (45000,50000,55000)),
 second_dog_amount_cents integer not null check(second_dog_amount_cents in (0,18000)),
 engraving_amount_cents integer not null check(engraving_amount_cents in (0,3500,7000)),
 amount_cents integer not null check(amount_cents=base_amount_cents+second_dog_amount_cents+engraving_amount_cents),
 currency text not null default 'mxn' check(currency='mxn'),
 status text not null default 'reserved' check(status in ('reserved','creating','open','pending','consumed','released')),
 created_at timestamptz not null default now(), preparation_expires_at timestamptz not null,
 checkout_expires_at timestamptz, stripe_expires_at timestamptz, voucher_expires_at timestamptz,
 stripe_session_id text unique check(stripe_session_id is null or stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]+$'),
 order_session_id text unique, consumed_at timestamptz, released_at timestamptz,
 check((status='consumed')=(consumed_at is not null)), check((status='released')=(released_at is not null)),
 check(status not in ('open','pending') or stripe_session_id is not null)
 ,check(base_amount_cents=case price_stage when 'presale' then 45000 when 'general' then 50000 else 55000 end)
 ,check(preparation_expires_at>created_at)
 ,check(payload_digest=encode(sha256(convert_to(payload::text,'UTF8')),'hex'))
 ,check(jsonb_typeof(payload->'dogs')='array' and jsonb_array_length(payload->'dogs') in (1,2))
 ,check(second_dog_amount_cents=case jsonb_array_length(payload->'dogs') when 2 then 18000 else 0 end)
);
alter table public.perrun_checkout_orders add constraint perrun_order_reservation_fk foreign key(reservation_id) references public.perrun_checkout_reservations(id) on delete restrict;
create table public.perrun_checkout_reservation_dogs (
 reservation_id uuid not null references public.perrun_checkout_reservations(id) on delete restrict,
 dog_index smallint not null check(dog_index in (1,2)), dog jsonb not null,
 promo_slot smallint check(promo_slot between 1 and 300),
 engraving_requested boolean not null, surcharge_cents integer not null,
 primary key(reservation_id,dog_index),
 check(surcharge_cents=case when engraving_requested and promo_slot is null then 3500 else 0 end)
);
create table public.perrun_promo_slots (
 event_slug text not null default 'perrun-2027' check(event_slug='perrun-2027'),
 slot smallint not null check(slot between 1 and 300),
 status text not null default 'available' check(status in ('available','reserved','consumed')),
 reservation_id uuid, dog_index smallint, legacy_sequence bigint unique,
 primary key(event_slug,slot), unique(reservation_id,dog_index),
 foreign key(reservation_id,dog_index) references public.perrun_checkout_reservation_dogs(reservation_id,dog_index) on delete restrict,
 check((status='available' and reservation_id is null and dog_index is null and legacy_sequence is null)
 or (status in ('reserved','consumed') and reservation_id is not null and dog_index is not null and legacy_sequence is null)
 or (status='consumed' and reservation_id is null and dog_index is null and legacy_sequence is not null))
);
-- Only new inventory is initialized; historical rows/payments are never rewritten.
insert into public.perrun_promo_slots(slot,status,legacy_sequence)
select s,case when s<=least(c.last_sequence,300) then 'consumed' else 'available' end,
 case when s<=least(c.last_sequence,300) then s end
from generate_series(1,300) s cross join public.perrun_paid_dog_counter c where c.event_slug='perrun-2027';
do $$ begin if (select count(*) from public.perrun_promo_slots)<>300 then raise exception 'Perrun counter/inventory precondition failed'; end if; end;$$;
create index perrun_reservation_status_idx on public.perrun_checkout_reservations(status,preparation_expires_at);
create index perrun_slots_available_idx on public.perrun_promo_slots(slot) where status='available';
alter table public.perrun_checkout_reservations enable row level security;
alter table public.perrun_checkout_reservation_dogs enable row level security;
alter table public.perrun_promo_slots enable row level security;
revoke all on public.perrun_checkout_reservations,public.perrun_checkout_reservation_dogs,public.perrun_promo_slots from public,anon,authenticated,service_role;
grant select on public.perrun_checkout_reservations,public.perrun_checkout_reservation_dogs,public.perrun_promo_slots to service_role;

alter table public.registration_dogs
 add column pricing_model_version smallint not null default 1 check(pricing_model_version in (1,2)),
 add column promo_slot smallint check(promo_slot between 1 and 300),
 add column engraving_state text check(engraving_state in ('free','included_paid','not_requested')),
 drop constraint registration_dogs_check1, drop constraint registration_dogs_check2, drop constraint registration_dogs_check3,
 add constraint perrun_dog_engraving_version check(
 (pricing_model_version=1 and promo_slot is null and engraving_state is null
  and engraving_free=(engraving_sequence<=300) and engraving_payment_required=(engraving_requested and not engraving_free)
  and engraving_payment_amount_cents=case when engraving_payment_required then 3500 else 0 end)
 or (pricing_model_version=2 and engraving_state is not null and engraving_free=(promo_slot is not null) and not engraving_payment_required
  and engraving_state=case when not engraving_requested then 'not_requested' when promo_slot is not null then 'free' else 'included_paid' end
  and engraving_payment_amount_cents=case when engraving_state='included_paid' then 3500 else 0 end));

create function kinetic_perrun_private.guard_v2_reservation() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status in ('consumed','released') and new is distinct from old then raise exception 'Terminal reservation is immutable'; end if;
 if (to_jsonb(new)-array['status','checkout_expires_at','stripe_expires_at','voucher_expires_at','stripe_session_id','order_session_id','consumed_at','released_at'])
 is distinct from (to_jsonb(old)-array['status','checkout_expires_at','stripe_expires_at','voucher_expires_at','stripe_session_id','order_session_id','consumed_at','released_at']) then raise exception 'Reservation quote is immutable'; end if;
 if old.stripe_session_id is not null and new.stripe_session_id is distinct from old.stripe_session_id then raise exception 'Session identity is immutable'; end if;
 if old.checkout_expires_at is not null and new.checkout_expires_at is distinct from old.checkout_expires_at then raise exception 'Checkout expiry is immutable'; end if;
 if old.stripe_expires_at is not null and new.stripe_expires_at is distinct from old.stripe_expires_at then raise exception 'Provider expiry is immutable'; end if;
 if old.order_session_id is not null and new.order_session_id is distinct from old.order_session_id then raise exception 'Order identity is immutable'; end if;
 if new.status<>old.status and not ((old.status='reserved' and new.status in ('creating','consumed','released')) or (old.status='creating' and new.status in ('open','released')) or (old.status='open' and new.status in ('pending','consumed','released')) or (old.status='pending' and new.status in ('consumed','released'))) then raise exception 'Invalid reservation transition'; end if;
 return new;
end;$$;
create trigger perrun_v2_reservation_guard before update on public.perrun_checkout_reservations for each row execute function kinetic_perrun_private.guard_v2_reservation();
create function kinetic_perrun_private.guard_promo_slot() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (old.status='consumed' and new is distinct from old) then raise exception 'Consumed promotion cannot be recycled'; end if;
 return new;
end;$$;
create trigger perrun_v2_slot_guard before update or delete on public.perrun_promo_slots for each row execute function kinetic_perrun_private.guard_promo_slot();

-- Validate the circular ownership relation only after the whole RPC transaction completes.
create function kinetic_perrun_private.check_v2_coherence() returns trigger language plpgsql set search_path='' as $$
begin
 if (select count(*) from public.perrun_promo_slots)<>300 then raise exception 'Promotion inventory must contain exactly 300 slots'; end if;
 if exists(select 1 from public.perrun_checkout_reservation_dogs d join public.perrun_checkout_reservations r on r.id=d.reservation_id
   left join public.perrun_promo_slots s on s.slot=d.promo_slot
   where r.status<>'released' and d.promo_slot is not null and (s.reservation_id is distinct from d.reservation_id or s.dog_index is distinct from d.dog_index or s.status<>case when r.status='consumed' then 'consumed' else 'reserved' end)) then raise exception 'Promotion dog ownership mismatch'; end if;
 if exists(select 1 from public.perrun_checkout_reservations r where r.amount_cents<>r.base_amount_cents+r.second_dog_amount_cents+(select coalesce(sum(d.surcharge_cents),0) from public.perrun_checkout_reservation_dogs d where d.reservation_id=r.id)
   or jsonb_array_length(r.payload->'dogs')<>(select count(*) from public.perrun_checkout_reservation_dogs d where d.reservation_id=r.id)) then raise exception 'Reservation component/dog mismatch'; end if;
 if exists(select 1 from public.perrun_promo_slots s join public.perrun_checkout_reservation_dogs d on d.reservation_id=s.reservation_id and d.dog_index=s.dog_index where d.promo_slot is distinct from s.slot)
 or exists(select 1 from public.perrun_checkout_reservation_dogs d join public.perrun_checkout_reservations r on r.id=d.reservation_id where d.dog is distinct from r.payload->'dogs'->(d.dog_index-1) or d.engraving_requested is distinct from (d.dog->>'engravingRequested')::boolean) then raise exception 'Reservation dog payload mismatch'; end if;
 return null;
end;$$;
create constraint trigger perrun_v2_coherence_slots after insert or update or delete on public.perrun_promo_slots deferrable initially deferred for each row execute function kinetic_perrun_private.check_v2_coherence();
create constraint trigger perrun_v2_coherence_dogs after insert or update or delete on public.perrun_checkout_reservation_dogs deferrable initially deferred for each row execute function kinetic_perrun_private.check_v2_coherence();
create constraint trigger perrun_v2_coherence_reservations after insert or update on public.perrun_checkout_reservations deferrable initially deferred for each row execute function kinetic_perrun_private.check_v2_coherence();

create function kinetic_perrun_private.guard_v2_dog_financials() returns trigger language plpgsql set search_path='' as $$
begin
 if old.pricing_model_version=2 and row(new.pricing_model_version,new.promo_slot,new.engraving_state,new.engraving_requested,new.engraving_free,new.engraving_payment_required,new.engraving_payment_amount_cents,new.engraving_sequence,new.order_session_id,new.dog_index,new.registration_id)
 is distinct from row(old.pricing_model_version,old.promo_slot,old.engraving_state,old.engraving_requested,old.engraving_free,old.engraving_payment_required,old.engraving_payment_amount_cents,old.engraving_sequence,old.order_session_id,old.dog_index,old.registration_id) then raise exception 'V2 dog financial ledger is immutable'; end if;
 return new;
end;$$;
create trigger perrun_v2_dog_financial_guard before update on public.registration_dogs for each row execute function kinetic_perrun_private.guard_v2_dog_financials();

create function kinetic_perrun_private.perrun_v2_tariff(p_at timestamptz)
returns table(stage text,amount_cents integer) language plpgsql set search_path='' as $$
begin
 if p_at is null or p_at>=timestamptz '2027-01-25 16:00:00-06' then raise exception 'Perrun sales closed'; end if;
 return query select case when p_at<timestamptz '2026-11-01 00:00:00-06' then 'presale' when p_at<timestamptz '2027-01-01 00:00:00-06' then 'general' else 'late' end,
 case when p_at<timestamptz '2026-11-01 00:00:00-06' then 45000 when p_at<timestamptz '2027-01-01 00:00:00-06' then 50000 else 55000 end;
end;$$;
revoke all on function kinetic_perrun_private.perrun_v2_tariff(timestamptz) from public,anon,authenticated,service_role;

create function kinetic_perrun_private.reserve_perrun_checkout_v2(p_attempt_id uuid,p_payload jsonb,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.perrun_checkout_reservations; d jsonb; idx smallint:=0; s smallint; available_count integer; legacy_budget integer; base integer; stage text; now_at timestamptz:=clock_timestamp(); fee integer:=0;
begin
 perform pg_advisory_xact_lock(123456789,hashtext('perrun-2027'));
 -- Only unstarted quotes can be reclaimed by time alone. Never creating/open/pending.
 for r in select * from public.perrun_checkout_reservations where status='reserved' and preparation_expires_at<=now_at for update loop
  update public.perrun_promo_slots set status='available',reservation_id=null,dog_index=null where reservation_id=r.id and status='reserved';
  update public.perrun_checkout_reservations set status='released',released_at=now_at where id=r.id;
 end loop;
 select * into r from public.perrun_checkout_reservations where attempt_id=p_attempt_id for update;
 if found then
  if r.payload is distinct from p_payload or r.source is distinct from p_source then raise exception 'Attempt payload conflict'; end if;
  if r.status='released' then raise exception 'Reservation released; use a new attempt'; end if;
  return to_jsonb(r)||(select jsonb_build_object('dogs',jsonb_agg(to_jsonb(x) order by dog_index)) from public.perrun_checkout_reservation_dogs x where reservation_id=r.id);
 end if;
 if p_attempt_id is null or p_source is null or p_source not in ('stripe','manual_transfer') or p_payload->>'eventSlug' is distinct from 'perrun-2027'
 or coalesce(p_payload->>'distance','') not in ('1K','3K','5K') or kinetic_perrun_private.valid_dogs(p_payload->'dogs') is not true
 or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or coalesce(p_payload#>>'{participant,whatsapp}','') !~ '^\+52[0-9]{10}$'
 or now_at>=timestamptz '2027-01-25 16:00:00-06' then raise exception 'Invalid V2 reservation'; end if;
 select t.stage,t.amount_cents into stage,base from kinetic_perrun_private.perrun_v2_tariff(now_at) t;
 -- Capacity for still-potentially-payable V1 drafts is protected conservatively.
 select coalesce(sum(jsonb_array_length(dogs)),0) into legacy_budget from public.perrun_checkout_orders where pricing_model_version=1 and finalized_at is null;
 select greatest(count(*)-legacy_budget,0) into available_count from public.perrun_promo_slots where status='available';
 select coalesce(sum(case when ordinality>available_count and (value->>'engravingRequested')::boolean then 3500 else 0 end),0) into fee from jsonb_array_elements(p_payload->'dogs') with ordinality;
 insert into public.perrun_checkout_reservations(attempt_id,payload,payload_digest,source,price_stage,base_amount_cents,second_dog_amount_cents,engraving_amount_cents,amount_cents,preparation_expires_at)
 values(p_attempt_id,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_source,stage,base,case jsonb_array_length(p_payload->'dogs') when 2 then 18000 else 0 end,fee,base+case jsonb_array_length(p_payload->'dogs') when 2 then 18000 else 0 end+fee,now_at+interval '5 minutes') returning * into r;
 for d in select value from jsonb_array_elements(p_payload->'dogs') loop
  idx:=idx+1; s:=null;
  if available_count>0 then select slot into s from public.perrun_promo_slots where status='available' order by slot limit 1 for update; available_count:=available_count-1; end if;
  insert into public.perrun_checkout_reservation_dogs values(r.id,idx,d,s,(d->>'engravingRequested')::boolean,case when s is null and (d->>'engravingRequested')::boolean then 3500 else 0 end);
  if s is not null then update public.perrun_promo_slots set status='reserved',reservation_id=r.id,dog_index=idx where slot=s; end if;
 end loop;
 return to_jsonb(r)||(select jsonb_build_object('dogs',jsonb_agg(to_jsonb(x) order by dog_index)) from public.perrun_checkout_reservation_dogs x where reservation_id=r.id);
end;$$;

create function kinetic_perrun_private.begin_perrun_checkout_v2(p_reservation_id uuid,p_payload jsonb)
returns public.perrun_checkout_reservations language plpgsql security definer set search_path='' as $$
declare r public.perrun_checkout_reservations;
begin
 perform pg_advisory_xact_lock(123456789,hashtext('perrun-2027'));
 select * into strict r from public.perrun_checkout_reservations where id=p_reservation_id for update;
 if r.payload is distinct from p_payload or r.source<>'stripe' then raise exception 'Reservation ownership/payload mismatch'; end if;
 if r.status='reserved' then
  if clock_timestamp()>=r.preparation_expires_at then raise exception 'Quote expired'; end if;
  update public.perrun_checkout_reservations set status='creating',checkout_expires_at=clock_timestamp()+interval '35 minutes' where id=r.id returning * into r;
 elsif r.status not in ('creating','open','pending','consumed') then raise exception 'Reservation unavailable'; end if;
 return r;
end;$$;

create function kinetic_perrun_private.attach_perrun_checkout_v2(p_reservation_id uuid,p_session_id text,p_expires_at timestamptz)
returns public.perrun_checkout_reservations language plpgsql security definer set search_path='' as $$
declare r public.perrun_checkout_reservations;
begin
 perform pg_advisory_xact_lock(123456789,hashtext('perrun-2027'));
 select * into strict r from public.perrun_checkout_reservations where id=p_reservation_id for update;
 if r.stripe_session_id is not null then
  if r.stripe_session_id<>p_session_id or r.stripe_expires_at is distinct from p_expires_at then raise exception 'Session attachment conflict'; end if;
  return r;
 end if;
 if r.status<>'creating' or r.source<>'stripe' or p_session_id is null or p_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]+$' or p_expires_at is null or abs(extract(epoch from (p_expires_at-r.checkout_expires_at)))>1 then raise exception 'Invalid V2 attachment'; end if;
 insert into public.perrun_checkout_orders(order_session_id,distance,buyer_email,participant,owner_phone,dogs,price_stage,base_amount_cents,amount_cents,quoted_at,pricing_model_version,reservation_id,second_dog_amount_cents,engraving_amount_cents)
 values(p_session_id,r.payload->>'distance',r.payload->>'email',(r.payload->'participant')-'whatsapp',r.payload#>>'{participant,whatsapp}',r.payload->'dogs',r.price_stage,r.base_amount_cents,r.amount_cents,r.created_at,2,r.id,r.second_dog_amount_cents,r.engraving_amount_cents);
 update public.perrun_checkout_reservations set status='open',stripe_session_id=p_session_id,order_session_id=p_session_id,stripe_expires_at=p_expires_at where id=r.id returning * into r;
 return r;
end;$$;

create function kinetic_perrun_private.record_perrun_reservation_v2(p_reservation_id uuid,p_state text,p_session_id text,p_voucher_expires_at timestamptz)
returns public.perrun_checkout_reservations language plpgsql security definer set search_path='' as $$
declare r public.perrun_checkout_reservations;
begin
 -- Server must retrieve provider truth; NEVER call release on an HTTP timeout.
 perform pg_advisory_xact_lock(123456789,hashtext('perrun-2027'));
 select * into strict r from public.perrun_checkout_reservations where id=p_reservation_id for update;
 if r.status='consumed' or r.status='released' then return r; end if;
 if p_state='pending' then
  if r.stripe_session_id is distinct from p_session_id or r.status not in ('open','pending') then raise exception 'Pending identity conflict'; end if;
  update public.perrun_checkout_reservations set status='pending',voucher_expires_at=coalesce(p_voucher_expires_at,voucher_expires_at) where id=r.id returning * into r;
 elsif p_state='released' then
  if r.status='reserved' then
   if clock_timestamp()<r.preparation_expires_at or p_session_id is not null then raise exception 'Unstarted reservation has not expired'; end if;
  elsif r.stripe_session_id is null or r.stripe_session_id is distinct from p_session_id then raise exception 'Uncertain creation requires reconciliation'; end if;
  update public.perrun_promo_slots set status='available',reservation_id=null,dog_index=null where reservation_id=r.id and status='reserved';
  update public.perrun_checkout_reservations set status='released',released_at=clock_timestamp() where id=r.id returning * into r;
 else raise exception 'Unknown reservation state'; end if;
 return r;
end;$$;

create function kinetic_perrun_private.finalize_perrun_reservation_v2(p_reservation_id uuid,p_session_id text,p_payment_intent_id text,p_stripe_event_id text,p_amount_cents integer,p_currency text,p_transfer_reference text,p_admin_user_id uuid,p_admin_email text)
returns setof public.registration_dogs language plpgsql security definer set search_path='' as $$
declare r public.perrun_checkout_reservations; o public.perrun_checkout_orders; h public.inscripciones; last_seq bigint; order_id text; rd public.perrun_checkout_reservation_dogs;
begin
 perform pg_advisory_xact_lock(123456789,hashtext('perrun-2027'));
 select * into strict r from public.perrun_checkout_reservations where id=p_reservation_id for update;
 if p_amount_cents is distinct from r.amount_cents or p_currency is distinct from r.currency then raise exception 'V2 confirmed amount/currency mismatch'; end if;
 if r.source='stripe' then
  if r.stripe_session_id is distinct from p_session_id or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]{1,200}$' or p_stripe_event_id !~ '^evt_[A-Za-z0-9_]{1,200}$' or p_payment_intent_id is null or p_stripe_event_id is null or p_admin_user_id is not null or p_transfer_reference is not null then raise exception 'V2 Stripe identity mismatch'; end if;
  order_id:=p_session_id;
 else
  if p_session_id is not null or p_payment_intent_id is not null or p_stripe_event_id is not null or p_admin_user_id is null or nullif(btrim(p_admin_email),'') is null or length(coalesce(p_transfer_reference,''))>80 then raise exception 'V2 manual identity mismatch'; end if;
  order_id:='manual_perrun_'||r.attempt_id::text;
 end if;
 if r.status='consumed' then
  select * into strict o from public.perrun_checkout_orders where order_session_id=order_id;
  if o.reservation_id<>r.id or o.payment_intent_id is distinct from p_payment_intent_id or (r.source='manual_transfer' and o.transfer_reference is distinct from nullif(btrim(p_transfer_reference),'')) then raise exception 'V2 retry identity conflict'; end if;
  return query select * from public.registration_dogs where order_session_id=order_id order by dog_index; return;
 end if;
 if r.source='stripe' and r.status not in ('open','pending') then raise exception 'V2 reservation cannot settle'; end if;
 if r.source='manual_transfer' then
  if r.status<>'reserved' or clock_timestamp()>=r.preparation_expires_at then raise exception 'Manual quote expired'; end if;
  insert into public.perrun_checkout_orders(order_session_id,distance,buyer_email,participant,owner_phone,dogs,price_stage,base_amount_cents,amount_cents,quoted_at,pricing_model_version,reservation_id,second_dog_amount_cents,engraving_amount_cents,payment_source,manual_payment_id,transfer_reference,manual_admin_user_id,manual_admin_email,manual_paid_at)
  values(order_id,r.payload->>'distance',r.payload->>'email',(r.payload->'participant')-'whatsapp',r.payload#>>'{participant,whatsapp}',r.payload->'dogs',r.price_stage,r.base_amount_cents,r.amount_cents,r.created_at,2,r.id,r.second_dog_amount_cents,r.engraving_amount_cents,'manual_transfer',r.attempt_id,nullif(btrim(p_transfer_reference),''),p_admin_user_id,lower(btrim(p_admin_email)),clock_timestamp());
 end if;
 select * into strict o from public.perrun_checkout_orders where order_session_id=order_id for update;
 if o.pricing_model_version<>2 or o.reservation_id<>r.id or o.distance is distinct from r.payload->>'distance' or o.buyer_email is distinct from r.payload->>'email'
 or o.dogs is distinct from r.payload->'dogs' or o.participant is distinct from (r.payload->'participant')-'whatsapp' or o.owner_phone is distinct from r.payload#>>'{participant,whatsapp}'
 or o.amount_cents is distinct from r.amount_cents or o.currency is distinct from r.currency or o.price_stage is distinct from r.price_stage then raise exception 'V2 order identity mismatch'; end if;
 perform public.finalize_paid_order(order_id,'perrun-2027',o.distance,o.amount_cents::numeric/100,o.buyer_email,p_payment_intent_id,p_stripe_event_id,jsonb_build_array(o.participant||jsonb_build_object('ticketIndex',1,'ticket_index',1,'whatsapp',o.owner_phone)));
 select * into strict h from public.inscripciones where order_session_id=order_id;
 if h.event_slug<>'perrun-2027' or h.payment_status<>'paid' or h.registration_status<>'active' or h.ticket_index<>1 or h.ticket_count<>1 or h.bib_number is null or h.amount_paid is distinct from r.amount_cents::numeric/100 or h.payment_intent_id is distinct from p_payment_intent_id then raise exception 'V2 human finalization mismatch'; end if;
 select last_sequence into strict last_seq from public.perrun_paid_dog_counter where event_slug='perrun-2027' for update;
 for rd in select * from public.perrun_checkout_reservation_dogs where reservation_id=r.id order by dog_index loop
  if rd.promo_slot is not null and not exists(select 1 from public.perrun_promo_slots where slot=rd.promo_slot and reservation_id=r.id and dog_index=rd.dog_index and status='reserved') then raise exception 'Promotion ownership lost'; end if;
  insert into public.registration_dogs(registration_id,registration_email,order_session_id,dog_index,dog_name,weight_kg,category,engraving_requested,engraving_sequence,engraving_free,engraving_payment_required,engraving_payment_amount_cents,pricing_model_version,promo_slot,engraving_state)
  values(h.id,h.email,order_id,rd.dog_index,rd.dog->>'name',(rd.dog->>'weightKg')::numeric,case when (rd.dog->>'weightKg')::numeric<=10 then 'S' when (rd.dog->>'weightKg')::numeric<=25 then 'M' when (rd.dog->>'weightKg')::numeric<=50 then 'L' else 'XL' end,rd.engraving_requested,last_seq+rd.dog_index,rd.promo_slot is not null,false,rd.surcharge_cents,2,rd.promo_slot,case when not rd.engraving_requested then 'not_requested' when rd.promo_slot is not null then 'free' else 'included_paid' end);
 end loop;
 update public.perrun_paid_dog_counter set last_sequence=last_seq+jsonb_array_length(r.payload->'dogs') where event_slug='perrun-2027';
 update public.perrun_promo_slots set status='consumed' where reservation_id=r.id and status='reserved';
 update public.perrun_checkout_orders set finalized_at=clock_timestamp(),payment_intent_id=p_payment_intent_id where order_session_id=order_id;
 update public.perrun_checkout_reservations set status='consumed',consumed_at=clock_timestamp(),order_session_id=order_id where id=r.id;
 return query select * from public.registration_dogs where order_session_id=order_id order by dog_index;
end;$$;

-- V1 late fulfillment consumes protected capacity, without changing its sequence semantics.
create function kinetic_perrun_private.consume_legacy_promo_slot() returns trigger language plpgsql security definer set search_path='' as $$
declare s smallint;
begin
 if new.pricing_model_version=1 and new.engraving_free then
  perform pg_advisory_xact_lock(123456789,hashtext('perrun-2027'));
  select slot into s from public.perrun_promo_slots where status='available' order by slot limit 1 for update;
  if s is null then raise exception 'Legacy promo capacity conflict'; end if;
  update public.perrun_promo_slots set status='consumed',legacy_sequence=new.engraving_sequence where slot=s;
 end if; return new;
end;$$;
create trigger perrun_legacy_promo_consume after insert on public.registration_dogs for each row execute function kinetic_perrun_private.consume_legacy_promo_slot();

-- Extend the already-approved snapshot trigger without changing its locks/contact semantics.
do $$ declare def text; anchor text:= 'if not old.engraving_free and not exists ('; begin
 select pg_get_functiondef('kinetic_perrun_private.guard_plate_snapshot()'::regprocedure) into def;
 if position(anchor in def)=0 then raise exception 'Plate trigger drift'; end if;
 execute replace(def,anchor,'if not old.engraving_free and not (old.pricing_model_version=2 and old.engraving_state=''included_paid'') and not exists (');
end;$$;

-- V1 may fulfill historical sessions only; it cannot be used as a shortcut for a V2 order.
do $$ declare def text; anchor text:='if p_confirmed_amount_cents is distinct from v_order.amount_cents'; begin
 select pg_get_functiondef('kinetic_perrun_private.finalize_perrun_paid_order(text,text,text,integer,text)'::regprocedure) into def;
 if position(anchor in def)=0 then raise exception 'V1 finalizer drift'; end if;
 execute replace(def,anchor,'if v_order.pricing_model_version<>1 then raise exception ''V2 requires its reservation finalizer''; end if; '||anchor);
end;$$;

-- Public RPCs are wrappers; only service_role can execute. Private schema is not exposed.
do $$ declare f record; args text; names text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kinetic_perrun_private' and p.proname in ('reserve_perrun_checkout_v2','begin_perrun_checkout_v2','attach_perrun_checkout_v2','record_perrun_reservation_v2','finalize_perrun_reservation_v2') loop
  select pg_get_function_arguments(f.oid),array_to_string(proargnames,',') into args,names from pg_proc where oid=f.oid;
  execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as $fn$ select * from kinetic_perrun_private.%I(%s); $fn$',f.proname,args,case when f.proname='finalize_perrun_reservation_v2' then 'setof public.registration_dogs' when f.proname='reserve_perrun_checkout_v2' then 'jsonb' else 'public.perrun_checkout_reservations' end,f.proname,names);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  execute format('grant execute on function %s to service_role',f.oid::regprocedure);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.%I(%s) to service_role',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
end;$$;
revoke all on function kinetic_perrun_private.guard_v2_reservation(),kinetic_perrun_private.guard_promo_slot(),kinetic_perrun_private.consume_legacy_promo_slot(),kinetic_perrun_private.check_v2_coherence(),kinetic_perrun_private.guard_v2_dog_financials() from public,anon,authenticated,service_role;
commit;
