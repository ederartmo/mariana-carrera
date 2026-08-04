-- Persiste la modalidad elegida para operación, perfil y administración.
-- Ejecutar una vez en Supabase SQL Editor antes de desplegar este cambio.

alter table public.inscripciones
  add column if not exists distance text;

update public.inscripciones
   set distance = '5K'
 where distance is null
   and event_slug = 'axolote-night-run';

alter table public.inscripciones
  drop constraint if exists inscripciones_distance_chk;

alter table public.inscripciones
  add constraint inscripciones_distance_chk
  check (
    distance is null
    or (event_slug = 'axolote-night-run' and distance = '5K')
    or (event_slug = 'cascanueces-run' and distance in ('5K', '10K'))
  );

create index if not exists inscripciones_event_distance_idx
  on public.inscripciones (event_slug, distance);