-- LOCAL REVIEW ONLY: additive admin corrections, no payment/ledger mutations.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
alter table public.perrun_checkout_orders
  add column admin_revision bigint not null default 0 check (admin_revision >= 0),
  add column ownership_revision bigint not null default 0 check (ownership_revision >= 0);
-- Current contact is existing inscripciones.whatsapp; owner_phone stays historical.
create table public.perrun_registration_edits (
  id uuid primary key default gen_random_uuid(),
  order_session_id text not null references public.perrun_checkout_orders(order_session_id) on delete restrict,
  registration_id uuid not null,
  admin_user_id uuid not null,
  admin_email text not null check (length(btrim(admin_email)) > 3),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null,
  unique (order_session_id, revision)
);
-- Stable registration_id deliberately has no mutable-email FK: audit must preserve original identities.
create index perrun_registration_edits_registration_idx on public.perrun_registration_edits(registration_id, created_at);
alter table public.perrun_registration_edits enable row level security;
revoke all on public.perrun_registration_edits from public, anon, authenticated, service_role;
grant select on public.perrun_registration_edits to service_role;

create function kinetic_perrun_private.admin_update_perrun_registration(
 p_order_session_id text, p_expected_revision bigint, p_participant jsonb, p_dogs jsonb,
 p_reason text, p_admin_user_id uuid, p_admin_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.perrun_checkout_orders; h public.inscripciones; d public.registration_dogs;
 v_count integer; item jsonb; w numeric; v_email text; before_values jsonb; after_values jsonb;
 v_birth date; v_reason text := btrim(p_reason);
begin
 if p_admin_user_id is null or p_admin_email is null or length(btrim(p_admin_email)) < 4
   or v_reason is null or length(v_reason) not between 3 and 500 then raise exception 'Admin actor and correction reason required'; end if;
 if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Expected revision required'; end if;
 if jsonb_typeof(p_participant) is distinct from 'object' or jsonb_typeof(p_dogs) is distinct from 'array' then raise exception 'Invalid correction payload'; end if;
 if exists(select 1 from jsonb_object_keys(p_participant) k where k not in ('fullName','email','shirtSize','birthDate','whatsapp','state','borough'))
   or not (p_participant ?& array['fullName','email','shirtSize','birthDate','whatsapp','state','borough']) then raise exception 'Participant fields are not editable'; end if;
 v_email := lower(btrim(p_participant->>'email'));
 if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email)>254
   or jsonb_typeof(p_participant->'fullName') is distinct from 'string'
   or coalesce(char_length(btrim(p_participant->>'fullName')),0) not between 3 and 80
   or coalesce(p_participant->>'shirtSize','') not in ('XS','S','M','L','XL','XXL','XXXL')
   or coalesce(p_participant->>'whatsapp','') !~ '^\+52[1-9][0-9]{9}$'
   or coalesce(p_participant->>'birthDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or not (coalesce(p_participant->>'state','') = any(array['Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Ciudad de México','Coahuila de Zaragoza','Colima','Durango','Guanajuato','Guerrero','Hidalgo','Jalisco','Estado de México','Michoacán de Ocampo','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz de Ignacio de la Llave','Yucatán','Zacatecas']::text[])) then raise exception 'Invalid participant correction'; end if;
 v_birth := (p_participant->>'birthDate')::date;
 if v_birth < date '1900-01-01' or v_birth >= current_date then raise exception 'Invalid birth date'; end if;
 if p_participant->>'state' = 'Ciudad de México' then
   if not (coalesce(p_participant->>'borough','') = any(array['Álvaro Obregón','Azcapotzalco','Benito Juárez','Coyoacán','Cuajimalpa de Morelos','Cuauhtémoc','Gustavo A. Madero','Iztacalco','Iztapalapa','La Magdalena Contreras','Miguel Hidalgo','Milpa Alta','Tláhuac','Tlalpan','Venustiano Carranza','Xochimilco']::text[])) then raise exception 'Invalid borough'; end if;
 elsif p_participant->'borough' is distinct from 'null'::jsonb then raise exception 'Borough only applies to CDMX'; end if;
 -- Same lock hierarchy as engraving payments: order -> human -> dogs -> payments.
 select * into strict o from public.perrun_checkout_orders where order_session_id=p_order_session_id for update;
 if o.admin_revision <> p_expected_revision then raise exception using errcode='P0001', message='PERRUN_REVISION_CONFLICT'; end if;
 if o.finalized_at is null or o.payment_status is distinct from 'paid' then raise exception 'Only finalized paid Perrun registrations can be corrected'; end if;
 select * into strict h from public.inscripciones where order_session_id=p_order_session_id and event_slug='perrun-2027' for update;
 if coalesce(h.payment_status,'') not in ('paid','paid_no_email') or h.registration_status is distinct from 'active' or h.ticket_count is distinct from 1 or h.ticket_index is distinct from 1 then raise exception 'Registration is not editable'; end if;
 perform id from public.registration_dogs where order_session_id=p_order_session_id order by dog_index for update;
 perform ep.id from public.perrun_engraving_payments ep join public.registration_dogs rd on rd.id=ep.dog_id
   where rd.order_session_id=p_order_session_id order by ep.id for update of ep;
 select count(*) into v_count from public.registration_dogs where order_session_id=p_order_session_id;
 if v_count not between 1 and 2 or jsonb_array_length(p_dogs)<>v_count or v_count<>jsonb_array_length(o.dogs) then raise exception 'Dog count is immutable'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_dogs))<>v_count then raise exception 'Dog identities are immutable'; end if;
 for item in select value from jsonb_array_elements(p_dogs) loop
   if jsonb_typeof(item) <> 'object' or not (item ?& array['id','name','weightKg'])
    or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','name','weightKg'))
    or jsonb_typeof(item->'weightKg') is distinct from 'number'
    or jsonb_typeof(item->'name') is distinct from 'string' then raise exception 'Dog fields are not editable'; end if;
   select * into strict d from public.registration_dogs where id=(item->>'id')::uuid and order_session_id=p_order_session_id;
   if d.registration_id<>h.id or d.registration_email<>h.email then raise exception 'Dog owner mismatch'; end if;
   w := (item->>'weightKg')::numeric;
   if w < 3 or w > 80 or (v_count=2 and w>25) or char_length(btrim(item->>'name')) not between 1 and 80 then raise exception 'Invalid dog weight/name'; end if;
   if btrim(item->>'name') is distinct from d.dog_name and (d.plate_status<>'not_started' or d.plate_started_at is not null) then raise exception 'Plate dog name is locked'; end if;
 end loop;
 select jsonb_build_object('participant',to_jsonb(h),'dogs',(select jsonb_agg(to_jsonb(rd) order by rd.dog_index) from public.registration_dogs rd where rd.order_session_id=p_order_session_id),
   'originalBuyerEmail',o.buyer_email,'originalOwnerPhone',o.owner_phone) into before_values;
 -- FK ON UPDATE CASCADE moves dog ownership with this single current identity update.
 update public.inscripciones set full_name=btrim(p_participant->>'fullName'), email=v_email, buyer_email=v_email,
  shirt_size=p_participant->>'shirtSize',birth_date=v_birth,whatsapp=p_participant->>'whatsapp',
  state=p_participant->>'state',borough=p_participant->>'borough' where id=h.id and email=h.email;
 for item in select value from jsonb_array_elements(p_dogs) loop
  w := (item->>'weightKg')::numeric;
  update public.registration_dogs set dog_name=btrim(item->>'name'),weight_kg=w,
   category=case when w<=10 then 'S' when w<=25 then 'M' when w<=50 then 'L' else 'XL' end
   where id=(item->>'id')::uuid and order_session_id=p_order_session_id;
 end loop;
 update public.perrun_checkout_orders set admin_revision=admin_revision+1,
  ownership_revision=ownership_revision+case when h.email is distinct from v_email then 1 else 0 end where order_session_id=p_order_session_id;
 select jsonb_build_object('participant',to_jsonb(i),'dogs',(select jsonb_agg(to_jsonb(rd) order by rd.dog_index) from public.registration_dogs rd where rd.order_session_id=p_order_session_id),
   'originalBuyerEmail',o.buyer_email,'originalOwnerPhone',o.owner_phone) into after_values from public.inscripciones i where id=h.id and email=v_email;
 insert into public.perrun_registration_edits(order_session_id,registration_id,admin_user_id,admin_email,reason,revision,old_values,new_values)
 values(p_order_session_id,h.id,p_admin_user_id,lower(btrim(p_admin_email)),v_reason,o.admin_revision+1,before_values,after_values);
 return jsonb_build_object('revision',o.admin_revision+1,'registrationId',h.id,'email',v_email);
end; $$;
create function public.admin_update_perrun_registration(p_order_session_id text,p_expected_revision bigint,p_participant jsonb,p_dogs jsonb,p_reason text,p_admin_user_id uuid,p_admin_email text)
 returns jsonb language sql security invoker set search_path = '' as $$
 select kinetic_perrun_private.admin_update_perrun_registration(p_order_session_id,p_expected_revision,p_participant,p_dogs,p_reason,p_admin_user_id,p_admin_email); $$;
revoke all on function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) to service_role;
grant execute on function public.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) to service_role;

create or replace function kinetic_perrun_private.guard_plate_snapshot()
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
      -- BEFORE UPDATE already owns the dog lock: fail fast rather than invert the admin lock order.
      where id = old.registration_id and email = old.registration_email for update nowait;
    if v_parent.payment_status is distinct from 'paid' or v_parent.registration_status is distinct from 'active'
      or not old.engraving_requested then raise exception 'Plate preparation is not eligible'; end if;
    if not old.engraving_free and not exists (
      select 1 from public.perrun_engraving_payments where dog_id = old.id and status = 'paid'
    ) then raise exception 'Separate engraving payment required'; end if;
    -- Current operational contact is used only for NEW plate snapshots.
    select coalesce(nullif(v_parent.whatsapp,''),owner_phone) into strict v_phone from public.perrun_checkout_orders where order_session_id = old.order_session_id;
    new.dog_name_for_plate := new.dog_name;
    new.owner_phone_for_plate := v_phone;
    new.plate_started_at := now();
  elsif new.plate_status = 'engraved' then
    raise exception 'Plate must enter preparation before engraved';
  end if;
  return new;
end;
$$;

create or replace function kinetic_perrun_private.lock_engraving_dog(p_dog_id uuid, p_order_session_id text, p_require_active boolean)
returns public.registration_dogs language plpgsql security invoker set search_path = '' as $$
declare v_dog public.registration_dogs; v_order public.perrun_checkout_orders; v_human public.inscripciones;
begin
  select * into strict v_dog from public.registration_dogs where id = p_dog_id;
  if p_order_session_id is not null and v_dog.order_session_id is distinct from p_order_session_id then
    raise exception 'Engraving dog/order identity mismatch';
  end if;
  select * into strict v_order from public.perrun_checkout_orders where order_session_id = v_dog.order_session_id for update;
  -- Email correction may have committed while waiting for the order lock.
  -- Refresh the cascading composite identity before locking the current human.
  select * into strict v_dog from public.registration_dogs where id = p_dog_id;
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

commit;
