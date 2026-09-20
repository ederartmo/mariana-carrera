-- desc/sql-batch5-user-profiles-hardening.sql - Batch 5.
-- AJUSTADO A SCHEMA REAL DE PRODUCCIÓN (inspección confirmada; NO ejecutar
-- sin revisión humana en SQL Editor).
--
-- Estado real confirmado:
--   owner column: user_id (uuid NOT NULL, PK, UNIQUE, FK → auth.users(id)
--     ON DELETE CASCADE). Sin drift: NO hay columna `id` que adaptar.
--   RLS enabled = true, forced = false.
--   Policies YA CORRECTAS (NO tocar/recrear):
--     user_profiles_insert_own (INSERT, authenticated, WITH CHECK auth.uid()=user_id)
--     user_profiles_select_own (SELECT, authenticated, USING auth.uid()=user_id)
--     user_profiles_update_own (UPDATE, authenticated, USING+WITH CHECK auth.uid()=user_id)
--   22 columnas: las 21 de perfil + bib_number (legacy, SE CONSERVA, sin borrar).
--   Sin ACLs por columna; anon y authenticated con grants generales de tabla.
--
-- Objetivo final:
--   anon: ZERO privileges sobre user_profiles.
--   authenticated: SELECT/INSERT/UPDATE SOLO sobre las 21 columnas de perfil.
--   bib_number: sin SELECT/INSERT/UPDATE/DELETE desde anon/authenticated.
--   Sin DELETE/TRUNCATE/REFERENCES/TRIGGER browser. service_role/postgres intactos.
--
-- RLS limita FILAS; los GRANTs por columna limitan COLUMNAS. Ambos juntos.
-- NO borra datos, NO altera columnas/constraints, NO toca inscripciones/storage.
-- La protección en DB NO está completa hasta aplicar (B) + verificar (C).

-- ============================================================
-- SECCIÓN A — INSPECCIÓN/EVIDENCIA (solo lectura). Ya ejecutada una vez;
-- re-ejecutar antes de aplicar B para confirmar que nada cambió.
-- ============================================================

-- A1. Columnas reales + tipos + nulabilidad (esperado: 22 columnas).
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'user_profiles'
 order by ordinal_position;

-- A2. PK, UNIQUEs, FK y CHECKs reales.
select conname, contype,
       pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.user_profiles'::regclass
 order by conname;

-- A3. Owner + RLS (esperado: RLS enabled, forced=false).
select c.relname as tabla,
       pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'user_profiles';

-- A4. Grants TABLE-level por rol.
select grantee, privilege_type, is_grantable
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'user_profiles'
 order by grantee, privilege_type;

-- A5. Grants COLUMN-level (esperado: vacío antes de B).
select grantee, privilege_type, column_name
  from information_schema.role_column_grants
 where table_schema = 'public' and table_name = 'user_profiles'
 order by grantee, privilege_type, column_name;

-- A6. Policies RLS (esperado: las 3 user_profiles_*_own, sin más).
select policyname, cmd, roles,
       qual as using_expr,
       with_check as with_check_expr
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
 order by cmd, policyname;

-- ============================================================
-- SECCIÓN B — MIGRACIÓN FINAL (mínima, transaccional).
-- Solo REVOKE + GRANTs por columna. NO toca policies, roles
-- service_role/postgres, columnas, constraints ni datos.
-- ============================================================

begin;

-- B1. Quitar todo acceso browser heredado (table-level general).
revoke all on table public.user_profiles from anon, authenticated;

-- B2. Authenticated: SELECT solo 21 columnas (bib_number excluido).
grant select (
  user_id, email,
  first_name, last_name, maternal_last_name, full_name,
  birth_date, gender, phone, weight_kg, height_cm, country, state,
  emergency_name, emergency_phone, emergency_relation, emergency_email,
  avatar_url, cover_url, cover_position_y,
  updated_at
) on public.user_profiles to authenticated;

-- B3. Authenticated: INSERT solo 21 columnas (permite upsert onConflict user_id).
grant insert (
  user_id, email,
  first_name, last_name, maternal_last_name, full_name,
  birth_date, gender, phone, weight_kg, height_cm, country, state,
  emergency_name, emergency_phone, emergency_relation, emergency_email,
  avatar_url, cover_url, cover_position_y,
  updated_at
) on public.user_profiles to authenticated;

-- B4. Authenticated: UPDATE solo 21 columnas.
grant update (
  user_id, email,
  first_name, last_name, maternal_last_name, full_name,
  birth_date, gender, phone, weight_kg, height_cm, country, state,
  emergency_name, emergency_phone, emergency_relation, emergency_email,
  avatar_url, cover_url, cover_position_y,
  updated_at
) on public.user_profiles to authenticated;

commit;

-- ============================================================
-- SECCIÓN C — VERIFICACIÓN POST-MIGRACIÓN (solo lectura).
-- has_table_privilege / has_column_privilege evalúan como los roles
-- indicados (tercer argumento), sin cambiar de sesión.
-- ============================================================

-- C1. anon: ZERO privileges sobre la tabla.
select has_table_privilege('anon', 'public.user_profiles', 'SELECT') as anon_select,
       has_table_privilege('anon', 'public.user_profiles', 'INSERT') as anon_insert,
       has_table_privilege('anon', 'public.user_profiles', 'UPDATE') as anon_update,
       has_table_privilege('anon', 'public.user_profiles', 'DELETE') as anon_delete;
-- Esperado: f,f,f,f.

-- C2. authenticated: table-level residual (esperado: solo lo implícito por
-- columnas; sin privilegios generales).
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'user_profiles'
   and grantee = 'authenticated';

-- C3. authenticated: SELECT/INSERT/UPDATE exactamente en las 21 columnas.
select privilege_type, count(*) as columnas,
       string_agg(column_name, ', ' order by column_name) as columnas_lista
  from information_schema.role_column_grants
 where table_schema = 'public' and table_name = 'user_profiles'
   and grantee = 'authenticated'
 group by privilege_type
 order by privilege_type;
-- Esperado: 3 filas (INSERT/SELECT/UPDATE) con 21 columnas cada una,
-- sin bib_number en ninguna lista.

-- C4. bib_number: denegado en SELECT/INSERT/UPDATE para authenticated.
select has_column_privilege('authenticated', 'public.user_profiles', 'bib_number', 'SELECT') as bib_select,
       has_column_privilege('authenticated', 'public.user_profiles', 'bib_number', 'INSERT') as bib_insert,
       has_column_privilege('authenticated', 'public.user_profiles', 'bib_number', 'UPDATE') as bib_update;
-- Esperado: f,f,f.

-- C5. Sin DELETE ni TRUNCATE para authenticated.
select has_table_privilege('authenticated', 'public.user_profiles', 'DELETE') as can_delete,
       has_table_privilege('authenticated', 'public.user_profiles', 'TRUNCATE') as can_truncate;
-- Esperado: f,f.

-- C6. Las 3 policies siguen iguales.
select policyname, cmd, roles,
       qual as using_expr,
       with_check as with_check_expr
  from pg_policies
 where schemaname = 'public' and tablename = 'user_profiles'
 order by cmd, policyname;
-- Esperado: user_profiles_insert_own / _select_own / _update_own intactas.

-- C7. RLS sigue enabled.
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'user_profiles';
-- Esperado: true, false.

-- ============================================================
-- SECCIÓN D — ROLLBACK.
-- Restaura grants generales de tabla para authenticated (baseline previo
-- a B según inspección). anon queda sin nada (ya estaba revocado en B y
-- no hay evidencia de que tuviera acceso legítimo necesario).
-- Policies NO se tocaron, no hay nada que revertir ahí.
-- ============================================================

-- begin;
-- revoke all on table public.user_profiles from authenticated;
-- grant select, insert, update on public.user_profiles to authenticated;
-- commit;
--
-- Tras rollback, re-ejecutar C1–C7 para confirmar el estado.
