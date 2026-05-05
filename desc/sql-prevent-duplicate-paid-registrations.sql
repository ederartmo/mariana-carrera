-- Evita pagos duplicados por correo/evento cuando la inscripción ya está pagada.
-- Ejecuta este script en Supabase SQL Editor.

-- 1) Marca duplicados existentes para no bloquear la creación del índice único parcial.
-- Conserva solo el registro pagado más antiguo por (event_slug, email) y marca el resto como duplicate.
with ranked_paid as (
  select
    id,
    row_number() over (
      partition by event_slug, lower(trim(email))
      order by created_at asc nulls last, id asc
    ) as rn
  from public.inscripciones
  where payment_status = 'paid'
    and event_slug is not null
    and email is not null
)
update public.inscripciones i
set payment_status = 'duplicate'
from ranked_paid rp
where i.id = rp.id
  and rp.rn > 1;

-- 2) Crea índice único parcial para impedir más de un pago por correo/evento.
create unique index if not exists inscripciones_unique_paid_email_event_idx
  on public.inscripciones (event_slug, lower(trim(email)))
  where payment_status = 'paid';
