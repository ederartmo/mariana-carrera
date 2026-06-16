-- Modelo multi-ticket para Axolote Night Run.
-- Ejecutar en Supabase SQL Editor antes de activar en producción.

begin;

-- 1) Columnas para agrupar tickets por compra principal
alter table public.inscripciones
  add column if not exists buyer_email text,
  add column if not exists order_session_id text,
  add column if not exists ticket_index integer,
  add column if not exists ticket_count integer;

-- 2) Backfill de datos históricos para mantener consistencia
update public.inscripciones
   set buyer_email = coalesce(buyer_email, lower(trim(email))),
       order_session_id = coalesce(order_session_id, stripe_session_id),
       ticket_index = coalesce(ticket_index, 1),
       ticket_count = coalesce(ticket_count, 1)
 where order_session_id is null
    or buyer_email is null
    or ticket_index is null
    or ticket_count is null;

-- 3) Constraints suaves para datos nuevos
alter table public.inscripciones
  drop constraint if exists inscripciones_ticket_index_positive_chk;
alter table public.inscripciones
  add constraint inscripciones_ticket_index_positive_chk
  check (ticket_index is null or ticket_index >= 1);

alter table public.inscripciones
  drop constraint if exists inscripciones_ticket_count_positive_chk;
alter table public.inscripciones
  add constraint inscripciones_ticket_count_positive_chk
  check (ticket_count is null or ticket_count >= 1);

-- 4) Índices para consultas por compra principal
create index if not exists inscripciones_order_session_idx
  on public.inscripciones (order_session_id);

create index if not exists inscripciones_buyer_email_idx
  on public.inscripciones (lower(trim(buyer_email)));

create unique index if not exists inscripciones_order_ticket_unique_idx
  on public.inscripciones (order_session_id, ticket_index)
  where order_session_id is not null and ticket_index is not null;

-- 5) El índice de pago único por email/evento bloquea multi-ticket; se elimina.
drop index if exists public.inscripciones_unique_paid_email_event_idx;

commit;
