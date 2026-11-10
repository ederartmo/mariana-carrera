-- Transactional legacy participant editor. Perrun remains on its own ledger.
CREATE TABLE IF NOT EXISTS public.admin_participant_change_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inscription_id uuid NOT NULL,
  inscription_email text NOT NULL,
  event_slug text NOT NULL,
  admin_email text NOT NULL,
  changed_fields text[] NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.admin_participant_change_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_participant_change_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_participant_change_audit_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_participant_change(
  p_id uuid,
  p_email text,
  p_event_slug text,
  p_expected jsonb,
  p_changes jsonb,
  p_admin_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.inscripciones%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_audit_before jsonb;
  v_audit_after jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_audit public.admin_participant_change_audit%ROWTYPE;
  v_distance text;
BEGIN
  IF p_id IS NULL OR p_email IS NULL OR p_event_slug IS NULL OR p_admin_email IS NULL
     OR jsonb_typeof(p_expected) <> 'object' OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid participant change request' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_changes) AS k
    WHERE k NOT IN ('full_name','shirt_size','birth_date','whatsapp','state','borough','distance')
  ) THEN
    RAISE EXCEPTION 'unsupported participant field' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.inscripciones
  WHERE id = p_id AND email = p_email AND event_slug = p_event_slug
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.event_slug = 'perrun-2027' THEN
    RAISE EXCEPTION 'Perrun registrations use a separate ledger' USING ERRCODE = '22023';
  END IF;
  IF v_row.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'only paid registrations may be edited' USING ERRCODE = '22023';
  END IF;

  v_before := jsonb_build_object(
    'fullName', v_row.full_name, 'shirtSize', v_row.shirt_size,
    'birthDate', v_row.birth_date, 'whatsapp', v_row.whatsapp,
    'state', v_row.state, 'borough', v_row.borough, 'distance', v_row.distance
  );
  IF p_expected IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'registration changed; reload before editing' USING ERRCODE = '40001';
  END IF;

  v_distance := CASE WHEN p_changes ? 'distance' THEN p_changes->>'distance' ELSE v_row.distance END;
  -- Legacy NULL distances may remain NULL, but cannot be explicitly cleared.
  IF (v_distance IS NULL AND (p_changes ? 'distance')) OR
     v_row.event_slug NOT IN ('axolote-night-run', 'cascanueces-run') OR
     (v_distance IS NOT NULL AND NOT (
    (v_row.event_slug = 'axolote-night-run' AND v_distance = '5K') OR
    (v_row.event_slug = 'cascanueces-run' AND v_distance IN ('5K','10K'))
  )) THEN
    RAISE EXCEPTION 'distance is not allowed for this event' USING ERRCODE = '22023';
  END IF;

  v_after := jsonb_build_object(
    'fullName', COALESCE(p_changes->>'full_name', v_row.full_name),
    'shirtSize', COALESCE(p_changes->>'shirt_size', v_row.shirt_size),
    'birthDate', COALESCE(p_changes->>'birth_date', v_row.birth_date::text),
    'whatsapp', COALESCE(p_changes->>'whatsapp', v_row.whatsapp),
    'state', COALESCE(p_changes->>'state', v_row.state),
    'borough', CASE WHEN p_changes ? 'borough' THEN p_changes->'borough' ELSE to_jsonb(v_row.borough) END,
    'distance', v_distance
  );
  IF v_before = v_after THEN
    RETURN jsonb_build_object('inscription', to_jsonb(v_row), 'audit', NULL);
  END IF;

  IF v_before->>'fullName' IS DISTINCT FROM v_after->>'fullName' THEN v_changed := array_append(v_changed, 'full_name'); END IF;
  IF v_before->>'shirtSize' IS DISTINCT FROM v_after->>'shirtSize' THEN v_changed := array_append(v_changed, 'shirt_size'); END IF;
  IF v_before->>'birthDate' IS DISTINCT FROM v_after->>'birthDate' THEN v_changed := array_append(v_changed, 'birth_date'); END IF;
  IF v_before->>'whatsapp' IS DISTINCT FROM v_after->>'whatsapp' THEN v_changed := array_append(v_changed, 'whatsapp'); END IF;
  IF v_before->>'state' IS DISTINCT FROM v_after->>'state' THEN v_changed := array_append(v_changed, 'state'); END IF;
  IF v_before->>'borough' IS DISTINCT FROM v_after->>'borough' THEN v_changed := array_append(v_changed, 'borough'); END IF;
  IF v_before->>'distance' IS DISTINCT FROM v_after->>'distance' THEN v_changed := array_append(v_changed, 'distance'); END IF;

  SELECT jsonb_object_agg(key_name, v_before->key_name), jsonb_object_agg(key_name, v_after->key_name)
    INTO v_audit_before, v_audit_after
  FROM unnest(v_changed) AS changed(field_name)
  CROSS JOIN LATERAL (SELECT CASE field_name
    WHEN 'full_name' THEN 'fullName' WHEN 'shirt_size' THEN 'shirtSize'
    WHEN 'birth_date' THEN 'birthDate' WHEN 'whatsapp' THEN 'whatsapp'
    WHEN 'state' THEN 'state' WHEN 'borough' THEN 'borough' WHEN 'distance' THEN 'distance'
  END AS key_name) AS mapped;

  UPDATE public.inscripciones SET
    full_name = v_after->>'fullName', shirt_size = v_after->>'shirtSize',
    birth_date = (v_after->>'birthDate')::date, whatsapp = v_after->>'whatsapp',
    state = v_after->>'state', borough = v_after->>'borough', distance = v_distance
  WHERE id = p_id AND email = p_email AND event_slug = p_event_slug
  RETURNING * INTO v_row;

  INSERT INTO public.admin_participant_change_audit
    (inscription_id, inscription_email, event_slug, admin_email, changed_fields, before, after)
  VALUES (p_id, p_email, p_event_slug, p_admin_email, v_changed, v_audit_before, v_audit_after)
  RETURNING * INTO v_audit;

  RETURN jsonb_build_object('inscription', to_jsonb(v_row), 'audit', to_jsonb(v_audit));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_participant_change(uuid,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_participant_change(uuid,text,text,jsonb,jsonb,text) TO service_role;
