-- desc/sql-finalize-paid-order-pr4.sql - PR4 Parte B (NO APLICAR TODAVÍA EN PROD).
-- Objetivo por participante: birthDate, whatsapp (+52XXXXXXXXXX), state (oficial), borough (solo CDMX else NULL).
-- Reglas:
--  a) paid repetido preserva edición admin (sin error por divergencia, sin overwrite de email/buyer/bib/amount)
--  b) pending finaliza (asigna BIB, marca paid, conserva campos incl. OXXO/async)
--  c) multi-ticket funciona (1..5, consecutivos)
--  d) OXXO conserva campos (misma ruta RPC que card)
--  e) email/buyer_email/bib/amount no cambian en webhook repetido (early-return paid)
-- Firma intacta (8 params) para no romper callers. Edad calculada pero NO gatea (sin 5-120).
-- Correo sin birth_date/whatsapp (no se exponen en template; solo DB).

CREATE OR REPLACE FUNCTION public.finalize_paid_order(p_order_session_id text, p_event_slug text, p_distance text, p_amount_paid numeric, p_buyer_email text, p_payment_intent_id text, p_stripe_event_id text, p_participants jsonb)
 RETURNS SETOF inscripciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_ticket_count integer;
  v_existing_count integer;
  v_next_bib integer;
  v_now timestamptz := pg_catalog.now();
begin
  if p_order_session_id is null or btrim(p_order_session_id) = '' then
    raise exception 'order_session_id requerido';
  end if;

  if p_event_slug is null or btrim(p_event_slug) = '' then
    raise exception 'event_slug requerido';
  end if;

  if p_participants is null
     or jsonb_typeof(p_participants) <> 'array'
     or jsonb_array_length(p_participants) = 0 then
    raise exception 'participants debe ser un arreglo no vacío';
  end if;

  v_ticket_count := jsonb_array_length(p_participants);

  if v_ticket_count < 1 or v_ticket_count > 5 then
    raise exception 'participants debe tener entre 1 y 5 tickets';
  end if;

  create temporary table pg_temp.finalize_participants (
    ticket_index integer primary key,
    full_name text not null,
    email text,
    shirt_size text,
    birth_date date,
    whatsapp text,
    state text,
    borough text
  ) on commit drop;

  insert into pg_temp.finalize_participants (
    ticket_index,
    full_name,
    email,
    shirt_size,
    birth_date,
    whatsapp,
    state,
    borough
  )
  select
    coalesce(
      nullif(participant ->> 'ticketIndex', '')::integer,
      nullif(participant ->> 'ticket_index', '')::integer,
      ordinality::integer
    ) as ticket_index,
    btrim(coalesce(
      participant ->> 'fullName',
      participant ->> 'full_name',
      participant ->> 'name'
    )) as full_name,
    nullif(btrim(coalesce(
      participant ->> 'email',
      p_buyer_email
    )), '') as email,
    upper(nullif(btrim(coalesce(
      participant ->> 'shirtSize',
      participant ->> 'shirt_size'
    )), '')) as shirt_size,
    -- birthDate robusto: YYYY-MM-DD real -> date; inválida/imposible -> NULL.
    -- Jamás lanza cast exception (ej. 2026-02-30). La validación de abajo decide
    -- si una orden nueva/pending debe fallar con birthDate inválida.
    case
      when nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') is null then null
      when nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then null
      when (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 1 for 4))::int < 1900 then null
      when (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 6 for 2))::int not between 1 and 12 then null
      when (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 9 for 2))::int not between 1 and 31 then null
      when (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 6 for 2))::int in (4, 6, 9, 11)
        and (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 9 for 2))::int > 30 then null
      when (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 6 for 2))::int = 2
        and (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 9 for 2))::int > 29 then null
      when (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 6 for 2))::int = 2
        and (substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 9 for 2))::int = 29
        and not (
          ((substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 1 for 4))::int % 4 = 0)
          and (
            ((substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 1 for 4))::int % 100 <> 0)
            or ((substring(nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), '') from 1 for 4))::int % 400 = 0)
          )
        ) then null
      else (nullif(btrim(coalesce(participant ->> 'birthDate', participant ->> 'birth_date', '')), ''))::date
    end as birth_date,
    -- whatsapp crudo; se normaliza abajo a +52XXXXXXXXXX
    nullif(btrim(coalesce(
      participant ->> 'whatsapp',
      participant ->> 'phone'
    )), '') as whatsapp,
    nullif(btrim(coalesce(
      participant ->> 'state',
      participant ->> 'estado'
    )), '') as state,
    nullif(btrim(coalesce(
      participant ->> 'borough',
      participant ->> 'alcaldia',
      participant ->> 'alcaldía'
    )), '') as borough
  from jsonb_array_elements(p_participants) with ordinality as parsed(participant, ordinality);

  -- Normaliza whatsapp a +52XXXXXXXXXX en la tabla temporal
  update pg_temp.finalize_participants p set whatsapp = norm.normalized
  from (
    select
      ticket_index,
      case
        when digits_len = 10 and national ~ '^[1-9][0-9]{9}$' then '+52' || national
        else null
      end as normalized
    from (
      select
        ticket_index,
        regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g') as all_digits,
        case
          when length(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) = 12
            and left(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 2) = '52'
            then right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 10)
          when length(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) = 13
            and left(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 3) = '521'
            then right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 10)
          when left(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 4) = '0052'
            and length(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) = 16
            then right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 10)
          else regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')
        end as national,
        length(
          case
            when length(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) = 12
              and left(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 2) = '52'
              then right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 10)
            when length(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) = 13
              and left(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 3) = '521'
              then right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 10)
            when left(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 4) = '0052'
              and length(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) = 16
              then right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), 10)
            else regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')
          end
        ) as digits_len
      from pg_temp.finalize_participants
    ) s
  ) norm
  where p.ticket_index = norm.ticket_index;

  -- borough solo CDMX, else NULL (regla PR4)
  update pg_temp.finalize_participants
     set borough = null
   where state is null or state <> 'Ciudad de México';

  if exists (
    select 1
    from pg_temp.finalize_participants
    where ticket_index is null
       or ticket_index < 1
       or ticket_index > v_ticket_count
  ) then
    raise exception 'ticket_index inválido en participants';
  end if;

  if (
    select count(*)
    from pg_temp.finalize_participants
  ) <> v_ticket_count then
    raise exception 'participants tiene ticket_index duplicado o inválido';
  end if;

  if exists (
    select 1
    from generate_series(1, v_ticket_count) as expected(ticket_index)
    left join pg_temp.finalize_participants p using (ticket_index)
    where p.ticket_index is null
  ) then
    raise exception 'participants no contiene ticket_index consecutivos esperados';
  end if;

  if exists (
    select 1
    from pg_temp.finalize_participants
    where full_name is null
       or btrim(full_name) = ''
       or length(btrim(full_name)) < 2
  ) then
    raise exception 'fullName inválido en participants';
  end if;

  if exists (
    select 1
    from pg_temp.finalize_participants
    where shirt_size is not null
      and shirt_size not in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')
  ) then
    raise exception 'shirtSize inválido en participants';
  end if;

  perform pg_advisory_xact_lock(123456789, hashtext(p_event_slug));

  if exists (
    select 1
    from public.inscripciones i
    where i.order_session_id = p_order_session_id
      and i.payment_status <> 'paid'
      and i.bib_number is not null
  ) then
    raise exception 'Orden % tiene BIB asignado en estado no paid', p_order_session_id;
  end if;

  select count(*)
    into v_existing_count
  from public.inscripciones i
  where i.order_session_id = p_order_session_id;

  -- PR4 a+e) Idempotencia nueva: paid repetido preserva edición admin.
  -- Si ya hay N filas paid con BIB y mismo evento (y mismo PI si aplica),
  -- se devuelven tal cual SIN comparar full_name/shirt_size/birth_date/whatsapp/state/borough
  -- y SIN overwrite. Esto preserva email/buyer_email/bib/amount y cualquier edición manual.
  -- Defensa estructural conservada: exige EXACTAMENTE ticket_index 1..v_ticket_count
  -- (ni faltantes, ni sobrantes, ni fuera de rango). Ej. DB 1,3 vs espera 1,2 => NO idempotente.
  if v_existing_count = v_ticket_count
     and not exists (
       select 1
       from public.inscripciones i
       where i.order_session_id = p_order_session_id
         and (
           i.payment_status <> 'paid'
           or i.bib_number is null
           or i.event_slug <> p_event_slug
           or (
             p_payment_intent_id is not null
             and i.payment_intent_id is not null
             and i.payment_intent_id <> p_payment_intent_id
           )
         )
     )
     and not exists (
       select 1
       from generate_series(1, v_ticket_count) as expected(ticket_index)
       left join public.inscripciones i2
         on i2.order_session_id = p_order_session_id
        and i2.ticket_index = expected.ticket_index
       where i2.ticket_index is null
     )
     and not exists (
       select 1
       from public.inscripciones i3
       where i3.order_session_id = p_order_session_id
         and (
           i3.ticket_index is null
           or i3.ticket_index < 1
           or i3.ticket_index > v_ticket_count
         )
     )
  then
    return query
      select i.*
      from public.inscripciones i
      where i.order_session_id = p_order_session_id
      order by i.ticket_index;

    return;
  end if;

  if v_existing_count > v_ticket_count then
    raise exception 'Orden % tiene más filas existentes (%) que tickets esperados (%)',
      p_order_session_id, v_existing_count, v_ticket_count;
  end if;

  if exists (
    select 1
    from public.inscripciones i
    where i.order_session_id = p_order_session_id
      and i.event_slug is not null
      and i.event_slug <> p_event_slug
  ) then
    raise exception 'Orden % tiene event_slug distinto al recibido', p_order_session_id;
  end if;

  if exists (
    select 1
    from public.inscripciones i
    where i.order_session_id = p_order_session_id
      and p_payment_intent_id is not null
      and i.payment_intent_id is not null
      and i.payment_intent_id <> p_payment_intent_id
  ) then
    raise exception 'Orden % tiene payment_intent_id distinto al recibido', p_order_session_id;
  end if;

  -- PR4 b) Solo para filas NUEVAS/pending se exige birthDate/whatsapp/state (+borough si CDMX).
  -- Las filas ya paid (early-return de arriba) no pasan por aquí, así los 835 históricos con NULL siguen intactos.
  if exists (
    select 1
    from pg_temp.finalize_participants
    where birth_date is null
  ) then
    -- Si la orden ya está parcialmente paid, igual exigimos para los pendientes restantes
    -- salvo que la orden completa ya calificó como idempotente (retornada arriba).
    raise exception 'birthDate obligatoria en participants (YYYY-MM-DD)';
  end if;

  if exists (
    select 1
    from pg_temp.finalize_participants
    where whatsapp is null
       or whatsapp !~ '^\+52[1-9][0-9]{9}$'
  ) then
    raise exception 'whatsapp inválido en participants (debe ser +52XXXXXXXXXX)';
  end if;

  if exists (
    select 1
    from pg_temp.finalize_participants
    where state is null
      or state not in ('Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Ciudad de México','Coahuila de Zaragoza','Colima','Durango','Guanajuato','Guerrero','Hidalgo','Jalisco','Estado de México','Michoacán de Ocampo','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz de Ignacio de la Llave','Yucatán','Zacatecas')
  ) then
    raise exception 'state inválido en participants (nombre oficial)';
  end if;

  if exists (
    select 1
    from pg_temp.finalize_participants
    where state = 'Ciudad de México'
      and (borough is null or borough not in ('Álvaro Obregón','Azcapotzalco','Benito Juárez','Coyoacán','Cuajimalpa de Morelos','Cuauhtémoc','Gustavo A. Madero','Iztacalco','Iztapalapa','La Magdalena Contreras','Miguel Hidalgo','Milpa Alta','Tláhuac','Tlalpan','Venustiano Carranza','Xochimilco'))
  ) then
    raise exception 'borough inválido en participants (alcaldía CDMX)';
  end if;

  -- Rev. sin edad mínima: birthDate obligatoria, fecha real (tipo date), no futura, >=1900-01-01.
  -- Edad se calcula al día actual pero NO acepta/rechaza (sin gate 5-120).
  if exists (
    select 1
    from pg_temp.finalize_participants
    where birth_date is null
       or birth_date >= v_now::date
       or birth_date < date '1900-01-01'
  ) then
    raise exception 'birthDate inválida en participants (YYYY-MM-DD, no futura, >=1900-01-01)';
  end if;

  -- PR4 b+c+d) Upsert pending con nuevos campos; email/buyer se fijan al buyer actual (mismo que checkout).
  insert into public.inscripciones (
    full_name,
    email,
    buyer_email,
    event_slug,
    distance,
    amount_paid,
    payment_status,
    bib_number,
    shirt_size,
    birth_date,
    whatsapp,
    state,
    borough,
    email_sent,
    stripe_session_id,
    order_session_id,
    ticket_index,
    ticket_count,
    payment_intent_id,
    stripe_event_id,
    processed_at
  )
  select
    p.full_name,
    coalesce(p.email, p_buyer_email),
    p_buyer_email,
    p_event_slug,
    p_distance,
    p_amount_paid,
    'pending',
    null,
    p.shirt_size,
    p.birth_date,
    p.whatsapp,
    p.state,
    p.borough,
    false,
    case
      when p.ticket_index = 1 then p_order_session_id
      else p_order_session_id || '::' || p.ticket_index::text
    end,
    p_order_session_id,
    p.ticket_index,
    v_ticket_count,
    p_payment_intent_id,
    p_stripe_event_id,
    null
  from pg_temp.finalize_participants p
  on conflict (order_session_id, ticket_index)
  where order_session_id is not null
    and ticket_index is not null
  do update set
    full_name = excluded.full_name,
    email = excluded.email,
    buyer_email = excluded.buyer_email,
    event_slug = excluded.event_slug,
    distance = excluded.distance,
    amount_paid = excluded.amount_paid,
    shirt_size = excluded.shirt_size,
    birth_date = excluded.birth_date,
    whatsapp = excluded.whatsapp,
    state = excluded.state,
    borough = excluded.borough,
    ticket_count = excluded.ticket_count,
    payment_intent_id = coalesce(public.inscripciones.payment_intent_id, excluded.payment_intent_id),
    stripe_event_id = coalesce(public.inscripciones.stripe_event_id, excluded.stripe_event_id);
  -- Nota: en conflicto pending NO se tocan bib_number, payment_status, email_sent,
  -- confirmation_* ni processed_at. Esos solo cambian en el loop de abajo (pending->paid).

  for v_next_bib in
    select i.ticket_index
    from public.inscripciones i
    where i.order_session_id = p_order_session_id
      and i.payment_status <> 'paid'
      and i.bib_number is null
    order by i.ticket_index
  loop
    update public.inscripciones i
       set bib_number = (
             select lpad(
               (
                 coalesce(
                   max(nullif(existing.bib_number, '')::integer),
                   0
                 ) + 1
               )::text,
               3,
               '0'
             )
             from public.inscripciones existing
             where existing.payment_status = 'paid'
               and existing.event_slug = p_event_slug
               and existing.bib_number ~ '^[0-9]+$'
           ),
           payment_status = 'paid',
           payment_intent_id = coalesce(i.payment_intent_id, p_payment_intent_id),
           stripe_event_id = coalesce(i.stripe_event_id, p_stripe_event_id),
           processed_at = coalesce(i.processed_at, v_now)
     where i.order_session_id = p_order_session_id
       and i.ticket_index = v_next_bib
       and i.payment_status <> 'paid'
       and i.bib_number is null;
  end loop;

  if exists (
    select 1
    from public.inscripciones i
    where i.order_session_id = p_order_session_id
      and (
        i.payment_status <> 'paid'
        or i.bib_number is null
        or i.event_slug <> p_event_slug
      )
  ) then
    raise exception 'Orden % no quedó finalizada correctamente', p_order_session_id;
  end if;

  return query
    select i.*
    from public.inscripciones i
    where i.order_session_id = p_order_session_id
    order by i.ticket_index;
end;
$function$
;
