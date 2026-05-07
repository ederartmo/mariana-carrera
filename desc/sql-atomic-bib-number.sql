-- Función para generar el siguiente bib_number de forma atómica.
-- Usa advisory lock para evitar race conditions cuando dos pagos
-- llegan al mismo tiempo.
-- Ejecutar una vez en el SQL editor de Supabase.

CREATE OR REPLACE FUNCTION get_next_bib_number()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  next_num integer;
BEGIN
  -- Advisory lock de sesión: solo un proceso a la vez puede entrar aquí.
  PERFORM pg_advisory_xact_lock(123456789);

  -- bib_number es text; tomamos solo valores numéricos para calcular el siguiente.
  SELECT COALESCE(MAX(bib_number::integer), 0) + 1
    INTO next_num
    FROM inscripciones
   WHERE bib_number ~ '^[0-9]+$';

  RETURN next_num;
END;
$$;
