-- desc/sql-batch6-storage-hardening.sql - Batch 6 (rev).
-- Estado REAL confirmado en producción (NO asumir docs viejos):
--   bucket contact-attachments: public=true, file_size_limit=NULL,
--     allowed_mime_types=NULL.
--   objetos: avatars=14, covers=8, contact=1 (+1 referencia externa legacy
--     en contact_messages, NO interna).
--   contact_messages: 13 filas, 2 con attachment_url (1 interna
--     contact-attachments/contact/..., 1 externa/legacy).
--   policies amplias: "Allow public upload contact attachments"
--     (INSERT anon+authenticated sin path), anon INSERT/SELECT contact/%,
--     public SELECT avatars/% covers/%, authenticated INSERT/UPDATE/DELETE
--     propios en avatars|covers/{uid}.
--
-- Arquitectura final:
--   contact-attachments (PUBLIC, solo media de perfil) + contact-private
--   (PRIVADO, adjuntos contact/{uuid}.{ext}, solo signed URLs server-side).
-- NO ejecutar sin revisión humana en SQL Editor.

-- ============================================================
-- SECCIÓN A — INSPECCIÓN (solo lectura). Re-ejecutar antes de B.
-- ============================================================

-- A1. Buckets (esperado pre-B: solo contact-attachments público sin límites).
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id in ('contact-attachments', 'contact-private');

-- A2. Policies sobre storage.objects (anotar nombres EXACTOS, en especial
-- la policy DELETE propia de avatars/covers para el DROP de B3).
select policyname, cmd, roles,
       qual as using_expr,
       with_check as with_check_expr
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by cmd, policyname;

-- A3. Grants sobre storage.objects para anon/authenticated/service_role.
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

-- A5. contact_messages con adjuntos (SOLO conteos + prefijos, sin URLs).
select count(*) as total,
       count(*) filter (where attachment_url is not null) as con_attachment_url
  from public.contact_messages;

-- A6. Columnas de contact_messages (¿existe attachment_path?).
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'contact_messages'
 order by ordinal_position;

-- ============================================================
-- SECCIÓN B — MIGRACIÓN (transaccional, re-ejecutable).
-- ============================================================

begin;

-- B1. contact-attachments: público solo para media, con límites.
update storage.buckets
   set public = true,
       file_size_limit = 4194304,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'contact-attachments';

-- B2. contact-private: privado, 5MB, imágenes + PDF (idempotente).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-private', 'contact-private', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- B3. Eliminar policies legacy amplias (nombres confirmados en producción).
drop policy if exists "Allow public upload contact attachments" on storage.objects;
drop policy if exists contact_attachments_insert_anon on storage.objects;
drop policy if exists contact_attachments_select_anon on storage.objects;
-- DELETE propio de avatars/covers: confirmar nombre exacto en A2; si difiere,
-- sustituir la línea siguiente por el nombre real.
drop policy if exists "authenticated delete own avatars covers" on storage.objects;

-- B4. Perfil en contact-attachments: INSERT solo propio (re-ejecutable).
drop policy if exists storage_profile_insert_own on storage.objects;
create policy storage_profile_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-attachments'
    and (name like 'avatars/' || auth.uid()::text || '/%'
      or name like 'covers/' || auth.uid()::text || '/%')
  );

-- B5. Perfil: UPDATE solo propio (requerido por upsert=true).
drop policy if exists storage_profile_update_own on storage.objects;
create policy storage_profile_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'contact-attachments'
    and (name like 'avatars/' || auth.uid()::text || '/%'
      or name like 'covers/' || auth.uid()::text || '/%')
  )
  with check (
    bucket_id = 'contact-attachments'
    and (name like 'avatars/' || auth.uid()::text || '/%'
      or name like 'covers/' || auth.uid()::text || '/%')
  );

-- B6. Perfil: SELECT propio (soporte de upsert/lectura; el download público
-- del bucket NO depende de esta policy).
drop policy if exists storage_profile_select_own on storage.objects;
create policy storage_profile_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'contact-attachments'
    and (name like 'avatars/' || auth.uid()::text || '/%'
      or name like 'covers/' || auth.uid()::text || '/%')
  );

-- NOTA: si A2 muestra policies propias legacy con OTROS nombres y alcance
-- igual o mayor, dropearlas explícitamente tras comparar (no asumir).
-- Sin policy DELETE: el navegador no borra media.

-- B7. contact-private: SOLO INSERT (anon + authenticated), un nivel.
drop policy if exists storage_contact_insert on storage.objects;
create policy storage_contact_insert
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'contact-private'
    and name like 'contact/%'
    and name not like 'contact/%/%'
  );
-- Sin SELECT/UPDATE/DELETE: solo service_role (backend) lee y firma.

commit;

-- ============================================================
-- SECCIÓN C — VERIFICACIÓN (solo lectura).
-- ============================================================

-- C1. Config de buckets.
-- select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id in ('contact-attachments', 'contact-private');
-- Esperado: (true, 4MB, 3 MIME) y (false, 5MB, 4 MIME).

-- C2. Policies finales (sin "Allow public upload...", sin *_anon en
-- contact-attachments, sin DELETE propio; con storage_profile_* y
-- storage_contact_insert).
-- select policyname, cmd, roles from pg_policies
--  where schemaname='storage' and tablename='objects' order by cmd, policyname;

-- C3. Pruebas funcionales desde la app (anon y usuario no-dueño):
--   upload fuera de prefijo → 403; overwrite ajeno → 403;
--   remove/list → 403; upload propio válido → 200;
--   contact anon válido → 200; contact-private download directo → 403.

-- ============================================================
-- SECCIÓN D — PLAN LEGACY + CONTACT_MESSAGES (documentación, NO ejecutar).
-- ============================================================

-- D1. El objeto legacy contact-attachments/contact/... y su fila
-- contact_messages (la que apunta al path INTERNO) se migran DESPUÉS de B:
--   a) Identificar fila: select id FROM contact_messages
--      WHERE attachment_url LIKE 'contact-attachments/contact/%' (mostrar
--      SOLO id + prefijo, nunca la URL completa en salidas compartidas).
--   b) Identificar objeto exacto en storage.objects por name.
--   c) COPIAR bytes vía Storage API o dashboard (SQL NO mueve binarios):
--      descargar objeto legacy y subirlo a
--      contact-private/contact/<nuevo-uuid>.<ext>.
--   d) update contact_messages set attachment_path = '<nuevo path>'
--      where id = '<id>' (SOLO esa fila; la referencia externa legacy
--      NO se toca).
--   e) Verificar y recién entonces borrar el objeto legacy.
-- Sin Admin API a mano: hacer c) manual vía dashboard Supabase.

-- D2. Columna attachment_path (propuesta, NO aplicada):
-- ALTER TABLE public.contact_messages
--   ADD COLUMN IF NOT EXISTS attachment_path text;
-- El backend ya la usa si existe (reintento sin ella si falta); las filas
-- nuevas llevan attachment_url = NULL y las 13 históricas no se tocan.
