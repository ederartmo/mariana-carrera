-- desc/sql-batch6-storage-hardening.sql - Batch 6 (NO EJECUTAR A CIEGAS).
-- Bucket: contact-attachments (avatares, portadas y adjuntos de contacto).
-- Estado: solo inspección (SECCIÓN A) + modelo propuesto (SECCIÓN B).
-- NO aplicar B sin inspección real: se desconoce si el bucket es
-- público/privado, sus límites y sus policies efectivas.
-- El frontend valida (storage-upload.js) pero NO es el boundary.

-- ============================================================
-- SECCIÓN A — INSPECCIÓN (solo lectura). Guardar salida completa.
-- ============================================================

-- A1. Bucket: público?, límites y MIME permitidos.
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'contact-attachments';

-- A2. Policies efectivas sobre storage.objects.
select policyname, cmd, roles,
       qual as using_expr,
       with_check as with_check_expr
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by cmd, policyname;

-- A3. Grants de tabla sobre storage.objects para anon/authenticated.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'storage' and table_name = 'objects'
   and grantee in ('anon', 'authenticated', 'service_role')
 order by grantee, privilege_type;

-- A4. Distribución por primer folder (conteos, SIN nombres/URLs).
-- bucket_id puede variar si el bucket real tiene otro id: ajustar filtro.
select split_part(name, '/', 1) as prefix, count(*) as objetos
  from storage.objects
 where bucket_id = 'contact-attachments'
 group by 1
 order by 2 desc;

-- A5. Ownership por prefijo (conteos por owner, sin exponer nombres).
select split_part(name, '/', 1) as prefix,
       owner as owner_id,
       count(*) as objetos
  from storage.objects
 where bucket_id = 'contact-attachments'
 group by 1, 2
 order by 1, 3 desc;

-- A6. Policies amplias: ¿alguna cubre el bucket sin ownership de folder?
select policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (qual ilike '%contact-attachments%' or with_check ilike '%contact-attachments%')
   and qual not ilike '%auth.uid()%'
   and with_check not ilike '%auth.uid()%';

-- ============================================================
-- SECCIÓN B — MODELO PROPUESTO (NO APLICAR sin inspección A).
-- Principios: anon mínimo, authenticated acotado a su user_id,
-- sin UPDATE/DELETE/LIST salvo necesidad probada de UX.
-- storage.objects usa columnas: bucket_id, name, owner, owner_id.
-- ¡Adaptar `auth.uid()::text` vs owner_id según lo que muestre A5!
-- ============================================================

-- B1. Límites a nivel bucket (suplemento, no sustituto de policies).
-- update storage.buckets
--    set file_size_limit = 5242880,
--        allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
--  where id = 'contact-attachments';

-- B2. PROFILE MEDIA — INSERT solo en avatars| covers propios.
-- create policy "storage_insert_own_media"
--   on storage.objects for insert to authenticated
--   with check (
--     bucket_id = 'contact-attachments'
--     and (name like 'avatars/' || auth.uid()::text || '/%'
--       or name like 'covers/' || auth.uid()::text || '/%')
--   );

-- B3. PROFILE MEDIA — UPDATE solo propio (requerido por upsert=true).
-- create policy "storage_update_own_media"
--   on storage.objects for update to authenticated
--   using (
--     bucket_id = 'contact-attachments'
--     and (name like 'avatars/' || auth.uid()::text || '/%'
--       or name like 'covers/' || auth.uid()::text || '/%')
--   )
--   with check (
--     bucket_id = 'contact-attachments'
--     and (name like 'avatars/' || auth.uid()::text || '/%'
--       or name like 'covers/' || auth.uid()::text || '/%')
--   );

-- B4. PROFILE MEDIA — SELECT propio (upsert/read; si el bucket es público,
-- el download público NO depende de esta policy: documentarlo, no asumir).
-- create policy "storage_select_own_media"
--   on storage.objects for select to authenticated
--   using (
--     bucket_id = 'contact-attachments'
--     and (name like 'avatars/' || auth.uid()::text || '/%'
--       or name like 'covers/' || auth.uid()::text || '/%')
--   );

-- B5. PROFILE MEDIA — DELETE: DENY (no crear policy DELETE; UX no lo pide).

-- B6. CONTACT (formulario público): solo INSERT bajo contact/, sin
-- UPDATE/DELETE/SELECT. Si A revela abuso o datos sensibles, migrar a
-- bucket privado + signed URLs vía endpoint server-side (fuera de Batch 6).
-- create policy "storage_insert_contact"
--   on storage.objects for insert to anon, authenticated
--   with check (
--     bucket_id = 'contact-attachments'
--     and name like 'contact/%'
--     and name not like 'contact/%/%'
--   );

-- ============================================================
-- SECCIÓN C — VERIFICACIÓN POST-APLICACIÓN (solo lectura).
-- ============================================================

-- C1. Policies finales del bucket.
-- select policyname, cmd, roles from pg_policies
--  where schemaname='storage' and tablename='objects'
--  order by cmd, policyname;
--
-- C2. Probar como anon y como usuario no-dueño (desde la app, no con SQL
-- de servicio): upload fuera de prefijo → 403; overwrite ajeno → 403;
-- remove/list → 403; upload propio válido → 200.
