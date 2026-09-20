-- desc/sql-batch6-storage-hardening.sql - Batch 6 (rev).
-- Estado REAL confirmado en producción:
--   bucket contact-attachments: public=true, sin límites ni MIME.
--   objetos: avatars=14, covers=8, contact=1.
--   contact_messages: 13 filas (1 attachment interno + 1 referencia externa).
--   7 policies legacy a eliminar (nombres exactos abajo).
--
-- REGLA: NO DML directo contra storage.buckets (lo administra Supabase).
-- Buckets/límites se configuran por Dashboard o Storage API (ROLLOUT).
-- Este SQL solo contiene: ALTER de contact_messages, DROPs/CREATEs de
-- policies sobre storage.objects. NO ejecutar sin revisión humana.
--
-- ROLLOUT SIN DOWNTIME:
--   PHASE 1 — PREDEPLOY (antes del merge): crear contact-private por
--     Dashboard (private, 5MB, jpg/png/webp/pdf) + ALTER contact_messages
--     (sección B0). NO tocar policies de contact-attachments todavía
--     (main actual usa el flujo viejo).
--   PHASE 2 — POSTDEPLOY (main Ready): configurar contact-attachments
--     (public, 4MB, jpg/png/webp), aplicar secciones B1+B2, verificar con C,
--     probar signed upload + contacto + avatar + cover.
--   LEGACY (sección D): migrar el único objeto interno después del deploy.

-- ============================================================
-- SECCIÓN A — INSPECCIÓN (solo lectura). Re-ejecutar antes de B.
-- ============================================================

-- A1. Buckets (esperado: contact-attachments público sin límites;
-- contact-private privado 5MB con 4 MIME tras PREDEPLOY).
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id in ('contact-attachments', 'contact-private');

-- A2. Policies sobre storage.objects (nombres exactos para los DROPs).
select policyname, cmd, roles,
       qual as using_expr,
       with_check as with_check_expr
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by cmd, policyname;

-- A3. Grants sobre storage.objects.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'storage' and table_name = 'objects'
   and grantee in ('anon', 'authenticated', 'service_role')
 order by grantee, privilege_type;

-- A4. Distribución por prefijo (conteos, SIN nombres/URLs).
select split_part(name, '/', 1) as prefix, count(*) as objetos
  from storage.objects
 where bucket_id in ('contact-attachments', 'contact-private')
 group by 1
 order by 2 desc;

-- A5. contact_messages: conteos + columnas (SIN URLs).
select count(*) as total,
       count(*) filter (where attachment_url is not null) as con_attachment_url,
       count(*) filter (where attachment_path is not null) as con_attachment_path
  from public.contact_messages;

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'contact_messages'
 order by ordinal_position;

-- ============================================================
-- SECCIÓN B0 — SCHEMA contact_messages (parte del rollout, PREDEPLOY).
-- Las 13 filas actuales quedan intactas (columna nullable, sin default).
-- ============================================================

alter table public.contact_messages
  add column if not exists attachment_path text;

alter table public.contact_messages
  drop constraint if exists contact_messages_attachment_path_chk;

alter table public.contact_messages
  add constraint contact_messages_attachment_path_chk
  check (
    attachment_path is null
    or attachment_path ~ '^contact/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
  );

-- ============================================================
-- SECCIÓN B1+B2 — POLICIES (transaccional, re-ejecutable, POSTDEPLOY).
-- Dropea las 7 legacy (una amplia anularía el hardening) y crea solo
-- las finales. contact-private queda SIN policies anon/auth: solo
-- service_role (signed uploads/downloads).
-- ============================================================

begin;

-- B1. Drops legacy (nombres exactos confirmados en producción).
drop policy if exists "authenticated delete own avatars covers" on storage.objects;
drop policy if exists "Allow public upload contact attachments" on storage.objects;
drop policy if exists "authenticated upload own avatars covers" on storage.objects;
drop policy if exists contact_attachments_insert_anon on storage.objects;
drop policy if exists contact_attachments_select_anon on storage.objects;
drop policy if exists "public read avatars covers" on storage.objects;
drop policy if exists "authenticated update own avatars covers" on storage.objects;

-- B2. Perfil: INSERT solo archivos exactos propios
-- (avatars/{uid}/avatar.jpg|png|webp, covers/{uid}/cover.jpg|png|webp).
drop policy if exists storage_profile_insert_own on storage.objects;
create policy storage_profile_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-attachments'
    and (name ~ ('^avatars/' || auth.uid()::text || '/avatar\.(jpg|png|webp)$')
      or name ~ ('^covers/' || auth.uid()::text || '/cover\.(jpg|png|webp)$'))
  );

-- B3. Perfil: UPDATE mismo alcance (requerido por upsert=true).
drop policy if exists storage_profile_update_own on storage.objects;
create policy storage_profile_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'contact-attachments'
    and (name ~ ('^avatars/' || auth.uid()::text || '/avatar\.(jpg|png|webp)$')
      or name ~ ('^covers/' || auth.uid()::text || '/cover\.(jpg|png|webp)$'))
  )
  with check (
    bucket_id = 'contact-attachments'
    and (name ~ ('^avatars/' || auth.uid()::text || '/avatar\.(jpg|png|webp)$')
      or name ~ ('^covers/' || auth.uid()::text || '/cover\.(jpg|png|webp)$'))
  );

-- B4. Perfil: SELECT propio (soporte de upsert/lectura; el download público
-- del bucket NO depende de esta policy y NO hay list global).
drop policy if exists storage_profile_select_own on storage.objects;
create policy storage_profile_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'contact-attachments'
    and (name ~ ('^avatars/' || auth.uid()::text || '/(avatar|cover)\.(jpg|png|webp)$')
      or name ~ ('^covers/' || auth.uid()::text || '/(avatar|cover)\.(jpg|png|webp)$'))
  );

-- Sin policy DELETE: el navegador no borra media. Sin policy PUBLIC SELECT:
-- el bucket ya es público y getPublicUrl funciona sin ella.

commit;

-- ============================================================
-- SECCIÓN C — VERIFICACIÓN (solo lectura).
-- ============================================================

-- C1. Policies finales: deben existir SOLO storage_profile_insert_own,
-- storage_profile_update_own, storage_profile_select_own (+ las ajenas a
-- este hardening que ya existieran para otros buckets, a comparar con A2).
-- select policyname, cmd, roles from pg_policies
--  where schemaname='storage' and tablename='objects' order by cmd, policyname;

-- C2. Las 7 legacy ausentes (cero filas esperado).
-- select policyname from pg_policies
--  where schemaname='storage' and tablename='objects'
--    and policyname in (
--      'authenticated delete own avatars covers',
--      'Allow public upload contact attachments',
--      'authenticated upload own avatars covers',
--      'contact_attachments_insert_anon',
--      'contact_attachments_select_anon',
--      'public read avatars covers',
--      'authenticated update own avatars covers');

-- C3. contact-private SIN policies anon/auth (cero filas esperado; solo
-- service_role opera vía API con bypass).
-- select policyname, cmd, roles from pg_policies
--  where schemaname='storage' and tablename='objects'
--    and (qual ilike '%contact-private%' or with_check ilike '%contact-private%');

-- C4. contact_messages con columna + CHECK.
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='contact_messages'
--    and column_name='attachment_path';
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid='public.contact_messages'::regclass
--    and conname='contact_messages_attachment_path_chk';

-- C5. Pruebas funcionales desde la app: signed upload contact OK,
-- contacto completo OK, avatar/cover propios OK, upload ajeno → 403,
-- download directo contact-private → 403, remove/list → 403.

-- ============================================================
-- SECCIÓN D — LEGACY (documentación, NO ejecutar aquí).
-- ============================================================

-- D1. El objeto legacy contact-attachments/contact/... y su fila
-- contact_messages (la del path INTERNO) se migran DESPUÉS del deploy:
--   a) select id FROM contact_messages WHERE attachment_url LIKE
--      'contact-attachments/contact/%' (mostrar SOLO id+prefijo).
--   b) Localizar objeto exacto en storage.objects por name.
--   c) COPIAR bytes vía Storage API/Dashboard a
--      contact-private/contact/<nuevo-uuid>.<ext> (SQL NO mueve binarios).
--   d) update contact_messages set attachment_path='<nuevo path>'
--      where id='<id>' (SOLO esa fila; la referencia externa NO se toca;
--      attachment_url legacy se preserva mientras se verifica).
--   e) Verificado el acceso vía signed URL, borrar el objeto viejo vía
--      Storage API/Dashboard.
