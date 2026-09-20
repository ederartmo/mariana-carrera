-- desc/sql-final-security-verification.sql - Batch 10 cierre Hardening v1.
-- READ-ONLY ONLY. Sin INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/GRANT/REVOKE.
-- Pegar la salida completa para verificar el estado de producción.
-- Referencia de valores esperados en comentarios (post-Batches 1-7).

-- ============ 1. public.inscripciones ============
-- RLS activo.
select relrowsecurity as rls_enabled from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'inscripciones';

-- anon/authenticated SIN grants de tabla (cero filas esperado para ambos).
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'inscripciones'
and grantee in ('anon', 'authenticated');

-- Policies existentes (documentar nombres/roles).
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'inscripciones'
order by cmd, policyname;

-- RPC de dorsales: EXECUTE solo service_role (cero filas anon/authenticated).
select grantee from information_schema.routine_privileges
where routine_schema = 'public'
and routine_name in ('finalize_paid_order', 'get_next_event_bib_number', 'get_next_bib_number')
and grantee in ('anon', 'authenticated');

-- ============ 2. public.user_profiles ============
select relrowsecurity as rls_enabled from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'user_profiles';

select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'user_profiles'
order by cmd, policyname;
-- Esperado: user_profiles_insert_own / _select_own / _update_own.

select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'user_profiles'
and grantee = 'anon';
-- Esperado: cero filas.

select privilege_type, count(*) as columnas
from information_schema.role_column_grants
where table_schema = 'public' and table_name = 'user_profiles'
and grantee = 'authenticated'
group by privilege_type order by privilege_type;
-- Esperado: INSERT/SELECT/UPDATE con 21 columnas (ver lista en Batch 5).

select has_column_privilege('authenticated', 'public.user_profiles', 'bib_number', 'SELECT') as bib_select,
has_column_privilege('authenticated', 'public.user_profiles', 'bib_number', 'INSERT') as bib_insert,
has_column_privilege('authenticated', 'public.user_profiles', 'bib_number', 'UPDATE') as bib_update;
-- Esperado: f,f,f.

-- ============ 3. Storage buckets ============
select id, public, file_size_limit, allowed_mime_types from storage.buckets
where id in ('contact-attachments', 'contact-private');
-- Esperado: (true, 4MB, jpg/png/webp) y (false, 5MB, jpg/png/webp/pdf).

-- ============ 4. storage.objects policies ============
select policyname, cmd, roles from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by cmd, policyname;
-- Esperado: SOLO storage_profile_insert_own/update_own/select_own
-- (+ ajenas a este hardening si existen para otros buckets).
-- Prohibido: Allow public upload contact attachments,
-- contact_attachments_insert_anon, contact_attachments_select_anon,
-- authenticated delete own avatars covers, public read avatars covers,
-- authenticated upload/update own avatars covers, y CUALQUIER policy que
-- mencione contact-private para anon/authenticated.

-- ============ 5. contact_messages (SIN exponer URLs completas) ============
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'contact_messages'
and column_name in ('attachment_path', 'attachment_url');
-- Esperado: ambas columnas.

select conname, pg_get_constraintdef(oid) as definicion from pg_constraint
where conrelid = 'public.contact_messages'::regclass
and conname = 'contact_messages_attachment_path_chk';
-- Esperado: CHECK UUIDv4 presente.

-- attachment_url histórico puede ser URL pública completa
-- (.../storage/v1/object/public/contact-attachments/contact/...), no solo
-- path relativo: clasificar por subcadenas, sin devolver URLs.
select count(*) as total,
count(*) filter (where attachment_path is not null) as con_path_nuevo,
count(*) filter (where attachment_path is not null
and attachment_url like '%/storage/v1/object/public/contact-attachments/contact/%') as legacy_interno_migrado,
count(*) filter (where attachment_path is null
and attachment_url like '%/storage/v1/object/public/contact-attachments/contact/%') as legacy_interno_sin_resolver,
count(*) filter (where attachment_url is not null
and attachment_url not like '%/storage/v1/object/public/contact-attachments/contact/%'
and attachment_url not like 'contact/%') as refs_externas_otras
from public.contact_messages;
-- Esperado: legacy_interno_sin_resolver = 0; refs_externas_otras >= 1 (legacy
-- externo intacto); con_path_nuevo >= migrados + nuevos uploads firmados.

-- contact-attachments: cero objetos reales bajo contact/ (excluye el
-- placeholder del dashboard). Nombres NO expuestos.
select count(*) as contact_reales_restantes
from storage.objects
where bucket_id = 'contact-attachments'
and name like 'contact/%'
and name <> 'contact/.emptyFolderPlaceholder';
-- Esperado: 0.

-- contact-private: objetos migrados + nuevos (conteo, sin nombres).
select count(*) as contact_privados
from storage.objects
where bucket_id = 'contact-private'
and name like 'contact/%';
-- Esperado: >= 1 (legacy migrado + uploads firmados posteriores).

-- ============ 6. api_rate_limits ============
select to_regclass('public.api_rate_limits') is not null as tabla_existe;

select relrowsecurity as rls from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'api_rate_limits';

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'api_rate_limits'
and indexname = 'api_rate_limits_expires_at_idx';

select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'api_rate_limits'
and grantee in ('anon', 'authenticated');
-- Esperado: cero filas.

select grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'consume_api_rate_limit'
and grantee in ('anon', 'authenticated');
-- Esperado: cero filas.

select grantee from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'consume_api_rate_limit'
and grantee = 'service_role';
-- Esperado: una fila (execute).

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'api_rate_limits'
order by ordinal_position;
-- Esperado: scope, key_hash, window_start, request_count, expires_at (sin PII).
