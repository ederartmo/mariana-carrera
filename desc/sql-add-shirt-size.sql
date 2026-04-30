-- Agrega el campo para la talla de playera en la tabla de inscripciones.
-- Ejecuta este script en Supabase SQL Editor.

alter table public.inscripciones
add column if not exists shirt_size text;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'inscripciones_shirt_size_check'
	) then
		alter table public.inscripciones
		add constraint inscripciones_shirt_size_check
		check (shirt_size in ('S', 'M', 'L'));
	end if;
end
$$;
