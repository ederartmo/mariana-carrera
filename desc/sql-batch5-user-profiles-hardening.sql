-- desc/sql-batch5-user-profiles-hardening.sql - Batch 5 (NO EJECUTAR A CIEGAS).
-- Objetivo: browser → user_profiles solo puede leer/escribir SU fila y SOLO
-- columnas de perfil. bib_number y cualquier campo financiero/autoritativo
-- quedan fuera del alcance del navegador aunque DevTools los intente.
-- RLS limita FILAS; los GRANTs por columna limitan COLUMNAS. Ambos juntos.
-- service_role (bypassrls + grants completos) no se ve afectado.
-- NO borra datos, NO cambia schema de negocio, NO toca inscripciones/storage.
--
-- ORDEN OBLIGATORIO:
--   1) Ejecutar SECCIÓN A (solo lectura) en producción y guardar la salida.
--   2) Comparar con lo supuesto aquí; si hay drift (otra PK, otras columnas,
--      policies distintas), ADAPTAR la SECCIÓN B antes de aplicarla.
--   3) Aplicar SECCIÓN B en una transacción.
--   4) Ejecutar SECCIÓN C para verificar.
-- La protección en DB NO está completa hasta aplicar + verificar (C).

-- ============================================================
-- SECCIÓN A — INSPECCIÓN (solo lectura). Guardar salida completa.
-- ============================================================

-- A1. Columnas reales + tipos + nulabilidad.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'user_profiles'
 order by ordinal_position;

-- A2. PK, UNIQUEs y CHECKs reales (¿id o user_id como owner?).
select conname, contype,
       pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.user_profiles'::regclass
 order by conname;

-- A3. Owner de la tabla.
select c.relname as tabla,
       pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'user_profiles';

-- A4. Grants TABLE-level por rol (¿authenticated tiene UPDATE general?).
select grantee, privilege_type, is_grantable
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'user_profiles'
 order by grantee, privilege_type;

-- A5. Grants COLUMN-level existentes (si ya hay hardening parcial).
select grantee, privilege_type, column_name
  from information_schema.role_column_grants
 where table_schema = 'public' and table_name = 'user_profiles'
 order by grantee, privilege_type, column_name;

-- A6. Policies RLS efectivas.
select policyname, cmd, roles,
       qual as using_expr,
       with_check as with_check_expr
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
 order by cmd, policyname;

-- A7. ¿Existe bib_number u otra columna autoritativa en user_profiles?
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'user_profiles'
   and column_name in (
     'bib_number', 'payment_status', 'amount_paid',
     'stripe_session_id', 'order_session_id', 'payment_intent_id',
     'event_slug', 'distance'
   );

-- ============================================================
-- SECCIÓN B — MIGRACIÓN PROPUESTA (transaccional, idempotente).
-- PRECONDICIÓN: A confirma owner-column = user_id (uuid, FK a auth.users),
-- y existen las 21 columnas del frontend (ver profile-fields.js).
-- Si el owner real es `id`, sustituir user_id→id en policies/grants.
-- ============================================================

begin;

-- B1. RLS siempre activo (idempotente).
alter table public.user_profiles enable row level security;

-- B2. Quitar TODO acceso browser y re-otorgar mínimo por columnas.
-- (service_role conserva bypassrls + grants; no se toca.)
revoke all on public.user_profiles from anon, authenticated;

-- Lectura propia (RLS la acota a user_id = auth.uid()).
grant select on public.user_profiles to authenticated;

-- Escritura SOLO columnas de perfil. user_id incluido para permitir el
-- upsert onConflict(user_id); email para espejo de sesión; updated_at
-- para control. NADA de bib_number ni campos financieros.
grant insert (
  user_id, email,
  first_name, last_name, maternal_last_name, full_name,
  birth_date, gender, phone, weight_kg, height_cm, country, state,
  emergency_name, emergency_phone, emergency_relation, emergency_email,
  avatar_url, cover_url, cover_position_y,
  updated_at
) on public.user_profiles to authenticated;

grant update (
  user_id, email,
  first_name, last_name, maternal_last_name, full_name,
  birth_date, gender, phone, weight_kg, height_cm, country, state,
  emergency_name, emergency_phone, emergency_relation, emergency_email,
  avatar_url, cover_url, cover_position_y,
  updated_at
) on public.user_profiles to authenticated;

-- B3. Policies por fila (owner = user_id). Se dropean primero las
-- permisivas/legacy conocidas; si A6 muestra otras, dropearlas también.
drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can insert own profile" on public.user_profiles;
drop policy if exists "Admin can read all profiles" on public.user_profiles;
drop policy if exists "Enable all for authenticated" on public.user_profiles;

create policy "up_select_own"
  on public.user_profiles for select
  using (auth.uid() = user_id);

create policy "up_insert_own"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

create policy "up_update_own"
  on public.user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sin policy DELETE: el navegador no puede borrar filas propias.
-- (Si A6 mostraba una policy DELETE propia y se quiere conservar,
--  documentarlo aquí explícitamente en vez de asumir.)

commit;

-- ============================================================
-- SECCIÓN C — VERIFICACIÓN POST-MIGRACIÓN (solo lectura).
-- Esperado: authenticated = SELECT + INSERT/UPDATE solo 21 columnas,
-- anon = nada, policies = up_select_own/up_insert_own/up_update_own.
-- ============================================================

-- C1. Grants efectivos por rol y columna.
select grantee, privilege_type, count(*) as columnas,
       string_agg(column_name, ', ' order by column_name) as columnas_lista
  from information_schema.role_column_grants
 where table_schema = 'public' and table_name = 'user_profiles'
 group by grantee, privilege_type
 order by grantee, privilege_type;

-- C2. Que anon no tenga NADA (cero filas esperado).
select *
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'user_profiles'
   and grantee = 'anon';

-- C3. Policies finales.
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
 order by cmd, policyname;

-- ============================================================
-- SECCIÓN D — ROLLBACK (restaura baseline permisivo documentado).
-- SOLO si la migración rompe UX y tras guardar la salida de SECCIÓN A.
-- El rollback fiel 1:1 requiere re-aplicar los grants/policies EXACTOS
-- vistos en A4/A5/A6; lo de abajo es el baseline más probable.
-- ============================================================

-- begin;
-- revoke all on public.user_profiles from anon, authenticated;
-- grant select, insert, update on public.user_profiles to authenticated;
-- drop policy if exists "up_select_own" on public.user_profiles;
-- drop policy if exists "up_insert_own" on public.user_profiles;
-- drop policy if exists "up_update_own" on public.user_profiles;
-- create policy "Users can read own profile"
--   on public.user_profiles for select using (auth.uid() = user_id);
-- create policy "Users can insert own profile"
--   on public.user_profiles for insert with check (auth.uid() = user_id);
-- create policy "Users can update own profile"
--   on public.user_profiles for update using (auth.uid() = user_id);
-- commit;
