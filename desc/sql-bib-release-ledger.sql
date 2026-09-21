-- Historial explícito de BIBs liberados + listado de huecos disponibles.
-- Aplicada en Supabase el 2026-09-21.

create table if not exists public.bib_releases (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  event_slug text not null,
  bib_number text not null,
  source_type text not null,
  source_inscription_id uuid,
  source_order_session_id text,
  reason text,
  released_by text,
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bib_releases_event_slug_check
    check (event_slug in ('axolote-night-run', 'cascanueces-run')),
  constraint bib_releases_bib_number_check
    check (bib_number ~ '^[0-9]+$'),
  constraint bib_releases_source_type_check
    check (source_type in ('cancellation', 'test_deleted', 'manual_backfill'))
);

create index if not exists bib_releases_event_bib_idx
  on public.bib_releases (event_slug, bib_number);

alter table public.bib_releases enable row level security;
revoke all on public.bib_releases from anon, authenticated;

-- Backfill de anulaciones que ya conservaban cancelled_bib_number.
insert into public.bib_releases (
  source_key, event_slug, bib_number, source_type,
  source_inscription_id, source_order_session_id,
  reason, released_by, released_at
)
select
  'cancellation:' || i.id::text,
  i.event_slug,
  lpad((i.cancelled_bib_number::integer)::text, 3, '0'),
  'cancellation',
  i.id,
  i.order_session_id,
  i.cancellation_reason,
  i.cancelled_by,
  coalesce(i.cancelled_at, i.created_at, now())
from public.inscripciones i
where i.registration_status = 'cancelled'
  and i.cancelled_bib_number ~ '^[0-9]+$'
  and i.event_slug in ('axolote-night-run', 'cascanueces-run')
on conflict (source_key) do nothing;

create or replace function public.get_available_event_bibs(p_event_slug text)
returns table (
  bib_number text,
  availability_source text,
  released_at timestamptz,
  reason text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with normalized as (
    select lower(trim(p_event_slug)) as event_slug
  ),
  maxima as (
    select greatest(
      coalesce(max(i.bib_number::integer)
        filter (where i.bib_number ~ '^[0-9]+$'), 0),
      coalesce(max(i.cancelled_bib_number::integer)
        filter (where i.cancelled_bib_number ~ '^[0-9]+$'), 0),
      coalesce((
        select max(r.bib_number::integer)
        from public.bib_releases r, normalized n2
        where r.event_slug = n2.event_slug
          and r.bib_number ~ '^[0-9]+$'
      ), 0)
    ) as max_bib
    from public.inscripciones i, normalized n
    where i.event_slug = n.event_slug
  ),
  occupied as (
    select distinct i.bib_number::integer as bib_num
    from public.inscripciones i, normalized n
    where i.event_slug = n.event_slug
      and i.registration_status = 'active'
      and i.bib_number ~ '^[0-9]+$'
  ),
  latest_release as (
    select distinct on (r.bib_number::integer)
      r.bib_number::integer as bib_num,
      r.released_at,
      r.reason
    from public.bib_releases r, normalized n
    where r.event_slug = n.event_slug
      and r.bib_number ~ '^[0-9]+$'
    order by r.bib_number::integer, r.released_at desc, r.id desc
  ),
  candidates as (
    select generate_series(1, (select max_bib from maxima)) as bib_num
  )
  select
    lpad(c.bib_num::text, 3, '0') as bib_number,
    case when lr.bib_num is not null then 'released' else 'gap' end as availability_source,
    lr.released_at,
    lr.reason
  from candidates c
  left join occupied o using (bib_num)
  left join latest_release lr using (bib_num)
  where o.bib_num is null
  order by c.bib_num;
$$;

revoke all on function public.get_available_event_bibs(text) from public;
grant execute on function public.get_available_event_bibs(text) to service_role;
