-- LOCAL ONLY: update operational distance; preserve original checkout and production snapshots.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Keep the legacy public/private overloads until the post-deploy cleanup.
create function kinetic_perrun_private.admin_update_perrun_registration(
 p_order_session_id text, p_expected_revision bigint, p_distance text, p_participant jsonb, p_dogs jsonb,
 p_reason text, p_admin_user_id uuid, p_admin_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.perrun_checkout_orders; h public.inscripciones; d public.registration_dogs;
 v_count integer; item jsonb; w numeric; v_email text; before_values jsonb; after_values jsonb;
 v_birth date; v_reason text := btrim(p_reason);
begin
 if p_admin_user_id is null or p_admin_email is null or length(btrim(p_admin_email)) < 4
   or v_reason is null or length(v_reason) not between 3 and 500 then raise exception 'Admin actor and correction reason required'; end if;
 if p_distance is null or p_distance not in ('1K','3K','5K') then raise exception 'Invalid operational distance'; end if;
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
 update public.inscripciones set distance=p_distance,full_name=btrim(p_participant->>'fullName'), email=v_email, buyer_email=v_email,
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
create function public.admin_update_perrun_registration(p_order_session_id text,p_expected_revision bigint,p_distance text,p_participant jsonb,p_dogs jsonb,p_reason text,p_admin_user_id uuid,p_admin_email text)
 returns jsonb language sql security invoker set search_path = '' as $$
 select kinetic_perrun_private.admin_update_perrun_registration(p_order_session_id,p_expected_revision,p_distance,p_participant,p_dogs,p_reason,p_admin_user_id,p_admin_email); $$;
revoke all on function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,text,jsonb,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_update_perrun_registration(text,bigint,text,jsonb,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,text,jsonb,jsonb,text,uuid,text) to service_role;
grant execute on function public.admin_update_perrun_registration(text,bigint,text,jsonb,jsonb,text,uuid,text) to service_role;



-- Temporary compatibility: lock the order before reading current operational distance.
create or replace function kinetic_perrun_private.admin_update_perrun_registration(
 p_order_session_id text,p_expected_revision bigint,p_participant jsonb,p_dogs jsonb,
 p_reason text,p_admin_user_id uuid,p_admin_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_distance text;
begin
 perform order_session_id from public.perrun_checkout_orders where order_session_id=p_order_session_id for update;
 select distance into strict v_distance from public.inscripciones where order_session_id=p_order_session_id and event_slug='perrun-2027' for update;
 return kinetic_perrun_private.admin_update_perrun_registration(p_order_session_id,p_expected_revision,v_distance,p_participant,p_dogs,p_reason,p_admin_user_id,p_admin_email);
end; $$;
create or replace function public.admin_update_perrun_registration(p_order_session_id text,p_expected_revision bigint,p_participant jsonb,p_dogs jsonb,p_reason text,p_admin_user_id uuid,p_admin_email text)
 returns jsonb language sql security invoker set search_path = '' as $$
 select kinetic_perrun_private.admin_update_perrun_registration(p_order_session_id,p_expected_revision,p_participant,p_dogs,p_reason,p_admin_user_id,p_admin_email); $$;
revoke all on function public.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) to service_role;
grant execute on function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text) to service_role;

commit;

