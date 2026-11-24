-- Correct the visitor intent matcher without rewriting a previously applied migration.
-- The write, acknowledgment, pause and stale-version invalidation remain in one transaction.
DO $patch$
DECLARE
  v_definition text;
  v_old constant text := $before$      ~ '^[[:space:]¡¿]*(hola[,[:space:]]+)?((quiero|quisiera|necesito|puedo) hablar con (alguien|una persona|un humano|un asesor|un operador|el equipo de atencion)|(solicito|quiero|necesito|quisiera) atencion humana)([,[:space:]]+por favor)?[[:space:]!.?]*$', false);$before$;
  v_new constant text := $after$      ~ $intent$^[[:space:]¡¿]*(?:(?:hola|buenos dias|buenas tardes|buenas noches)[[:space:],.!?¡¿:;]+)?(?:por favor[[:space:],.!?¡¿:;]+)?(?:(?:necesito|quiero|quisiera) (?:que|q) (?:me atienda|me ayude) (?:alguien|una persona|un humano|un asesor|un operador|el equipo de atencion)|(?:quiero|quisiera|necesito|puedo|podria|me gustaria) hablar con (?:alguien|una persona|un humano|un asesor|un operador|el equipo de atencion)|(?:solicito|quiero|necesito|quisiera) atencion humana|(?:me puedes?|me pueden|me podrias?|me podrian) (?:comunicar|pasar|transferir) con (?:alguien|una persona|un humano|un asesor|un operador|el equipo de atencion))(?:[[:space:]]+(?:de soporte|de atencion(?: al cliente)?))?(?:[[:space:],;:]+por favor)?(?:[[:space:],;:]+(?:porque|ya que|pues|sobre|acerca de|respecto a|para|por (?:el|la|mi|mis|un|una))[[:space:]]+[^[:space:]].*|[[:space:]]*[,;:][[:space:]]+(?:no (?:veo|encuentro|me (?:llego|aparece|deja))|(?:ya |acabo de )?pague)\y.*|[[:space:]]*[.!?][[:space:]]+(?!no[[:space:]]+(?:quiero|necesito|hace falta)\y|era[[:space:]]+(?:un ejemplo|una cita)\y)[[:alnum:]¡¿].*)?[[:space:]!.?]*$$intent$, false);$after$;
BEGIN
  SELECT replace(pg_get_functiondef(
    'public.support_visitor_action(text,text,uuid,text,text,uuid)'::regprocedure
  ), chr(13) || chr(10), chr(10)) INTO STRICT v_definition;

  IF strpos(v_definition, v_old) = 0 THEN
    IF strpos(v_definition, v_new) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'support_visitor_action human request matcher drift; review before applying';
  END IF;

  IF length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'support_visitor_action human request matcher matched more than once';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$patch$;
