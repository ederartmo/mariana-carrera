-- Genera dorsales independientes por evento sin separar la tabla inscripciones.
-- Ejecutar una vez en Supabase SQL Editor antes de desplegar este cambio.

create or replace function public.get_next_event_bib_number(p_event_slug text)
returns integer
language plpgsql
as $$
declare
  normalized_event_slug text := lower(trim(p_event_slug));
  next_num integer;
begin
  if normalized_event_slug is null or normalized_event_slug = '' then
    raise exception 'event_slug es obligatorio';
  end if;

  -- Un lock independiente por evento permite pagos concurrentes entre carreras.
  perform pg_advisory_xact_lock(123456789, hashtext(normalized_event_slug));

  select coalesce(max(bib_number::integer), 0) + 1
    into next_num
    from public.inscripciones
   where event_slug = normalized_event_slug
     and bib_number ~ '^[0-9]+$';

  return next_num;
end;
$$;

revoke all on function public.get_next_event_bib_number(text) from public;
grant execute on function public.get_next_event_bib_number(text) to service_role;