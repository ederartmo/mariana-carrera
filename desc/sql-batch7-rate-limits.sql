-- desc/sql-batch7-rate-limits.sql - Batch 7 (NO EJECUTAR A CIEGAS).
-- Rate limiting persistente para APIs públicas (Supabase = store compartido;
-- in-memory NO sirve en serverless). Solo guarda scope + key_hash (HMAC
-- del identificador); NUNCA IP/email/uid crudos. RLS + REVOKE dejan la tabla
-- y la RPC solo para service_role. NO ejecutar sin revisión humana.

-- ============================================================
-- SECCIÓN A — TABLA (idempotente).
-- ============================================================

create table if not exists public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start)
);

alter table public.api_rate_limits enable row level security;

-- Índice para que la limpieza acotada (expires_at <= now, limit 100) no se
-- degrade a scan creciente bajo abuso. Idempotente.
create index if not exists api_rate_limits_expires_at_idx
  on public.api_rate_limits (expires_at);

-- Sin policies: con RLS activo y cero policies, anon/authenticated no ven nada.
-- Cinturón adicional a nivel de grants:
revoke all on public.api_rate_limits from anon, authenticated;
grant all on public.api_rate_limits to service_role;

-- ============================================================
-- SECCIÓN B — RPC ATÓMICA (fixed window, sin race read-then-write).
-- Un solo INSERT ... ON CONFLICT DO UPDATE por llamada.
-- SECURITY DEFINER con search_path vacío y nombres calificados.
-- ============================================================

create or replace function public.consume_api_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = '' as $function$
declare
  v_now pg_catalog.timestamptz := pg_catalog.now();
  v_epoch bigint := pg_catalog.floor(extract(epoch from v_now))::bigint;
  v_start pg_catalog.timestamptz;
  v_expires pg_catalog.timestamptz;
  v_count integer;
begin
  if p_scope is null or pg_catalog.btrim(p_scope) = '' then
    raise exception 'scope requerido';
  end if;
  if p_key_hash is null or pg_catalog.btrim(p_key_hash) = '' then
    raise exception 'key_hash requerido';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'limit inválido';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'window inválida';
  end if;

  v_start := pg_catalog.to_timestamp((v_epoch / p_window_seconds) * p_window_seconds);
  v_expires := v_start + ((p_window_seconds || ' seconds')::pg_catalog.interval);

  -- Limpieza acotada: máximo 100 filas expiradas por llamada (sin crecimiento
  -- infinito; el resto expira lógicamente por expires_at aunque siga en tabla).
  delete from public.api_rate_limits
   where ctid in (
     select ctid from public.api_rate_limits
      where expires_at <= v_now
      limit 100
   );

  insert into public.api_rate_limits as r (scope, key_hash, window_start, request_count, expires_at)
  values (p_scope, p_key_hash, v_start, 1, v_expires)
  on conflict (scope, key_hash, window_start)
  do update set request_count = r.request_count + 1
  returning r.request_count into v_count;

  if v_count <= p_limit then
    allowed := true;
    remaining := p_limit - v_count;
    retry_after_seconds := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after_seconds := pg_catalog.greatest(
      0,
      pg_catalog.ceiling(extract(epoch from (v_expires - pg_catalog.now())))::integer
    );
  end if;
  return next;
end;
$function$;

-- EXECUTE es PUBLIC por defecto: revocar a todos salvo service_role.
revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;

-- ============================================================
-- SECCIÓN C — VERIFICACIÓN POST-APLICACIÓN (solo lectura).
-- ============================================================

-- C1. Tabla existe con PK compuesta.
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.api_rate_limits'::regclass;

-- C2. RLS activo.
-- select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relname='api_rate_limits';

-- C3. Grants de tabla: anon/authenticated sin nada; service_role con todo.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and table_name='api_rate_limits'
--  order by grantee, privilege_type;

-- C4. EXECUTE de la RPC: solo service_role (cero filas para anon/authenticated).
-- select grantee, privilege_type from information_schema.routine_privileges
--  where routine_schema='public'
--    and routine_name='consume_api_rate_limit'
--  order by grantee;

-- C5. Sin columnas de identificadores crudos (sensitive check).
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='api_rate_limits'
--  order by ordinal_position;
-- Esperado: scope, key_hash, window_start, request_count, expires_at.

-- C6. Comportamiento funcional (como service_role): 1ª→allowed,
-- límite+1→denied con retry_after>0; ventana nueva→allowed.
-- select * from public.consume_api_rate_limit('smoke', 'smoke-key', 1, 60);
-- select * from public.consume_api_rate_limit('smoke', 'smoke-key', 1, 60);
-- (Limpiar después: delete from public.api_rate_limits where scope='smoke';)

-- C7. Limpieza acotada presente en el cuerpo de la función.
-- select pg_get_functiondef('public.consume_api_rate_limit(text,text,integer,integer)'::regprocedure)
--   ilike '%limit 100%';

-- C8. Índice de expiración para el cleanup.
-- select indexname from pg_indexes
--  where schemaname='public' and tablename='api_rate_limits'
--    and indexname='api_rate_limits_expires_at_idx';
