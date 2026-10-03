# Perrun — distancia operativa editable

Estado: migración principal aplicada en producción como 20261003041809; código pendiente de publicación y cleanup pendiente.
Migración: supabase/migrations/20261003041809_perrun_admin_operational_distance.sql.

La distancia original de compra sigue en perrun_checkout_orders.distance y nunca
se cambia desde Admin Edit. La distancia actual de participación está en
inscripciones.distance. El select inicializa ese valor actual y permite sólo
1K, 3K y 5K. Envía distance en la raíz del POST, junto con expectedRevision,
participant, dogs y reason; distance no forma parte de participant.

El backend valida los tres valores exactos antes de llamar a PostgreSQL.
La RPC pública y su equivalente privada reciben, en orden:

    admin_update_perrun_registration(
      p_order_session_id text,
      p_expected_revision bigint,
      p_distance text,
      p_participant jsonb,
      p_dogs jsonb,
      p_reason text,
      p_admin_user_id uuid,
      p_admin_email text
    ) returns jsonb

La migración conserva temporalmente ambas firmas de siete argumentos. El wrapper legacy bloquea orden y humano, lee inscripciones.distance y delega sin aceptar cambios de distancia. Conserva todas las validaciones administrativas y el orden de locks:
orden, humano, perros y pagos adicionales. Agrega la validación de distancia y
la asignación en el UPDATE de inscripciones. El cambio sigue siendo atómico:
el historial guarda old_values.participant.distance y
new_values.participant.distance; admin_revision avanza una vez. El actor viene
del JWT verificado del servidor. La función privada sigue siendo SECURITY
DEFINER y el wrapper público SECURITY INVOKER, ambos con search_path vacío;
EXECUTE sólo service_role. No altera tablas, triggers ni funciones de pagos.

Antes de cerrar un lote, el snapshot captura la distancia corregida. Después
de cerrar, se permite corregir el registro actual, pero membership,
production_number, snapshot y CSV del lote cerrado permanecen intactos. El
warning de producción cerrada sigue visible.

Guardar no envía correo. El renderer y el reenvío existente consultan la
distancia actual de inscripciones. Las pruebas de correo usan transporte mock.

## Publicación pendiente

Aplicar primero la migración principal: ambos backends son compatibles. Publicar después backend/UI nuevos. Sólo tras verificar que todas las instancias usan ocho argumentos, aplicar separadamente 20261003043000_perrun_admin_operational_distance_remove_legacy_rpc.sql. Este cleanup elimina únicamente las dos firmas legacy, sin CASCADE ni cambios de datos. NO incluirlo en un db push general previo al deploy. La principal está aplicada y reconciliada; el cleanup sigue sin aplicar.

## Validación local

Suite Node con .env.qa.local. La batería PostgreSQL 17 existente incorpora
--admin-distance después de --production y todas las fases previas; usa un
clúster aislado con datos ficticios. Cubre las validaciones anteriores bajo la
firma nueva, distancia original/current, auditoría, rollback, permisos,
reenvío mock, Payment V1/V2 y producción congelada. Dos conexiones independientes
validan edición contra edición, cierre, rollback y webhook duplicado.
