-- Additive, read-only RPCs. Existing RPC signatures and grants remain unchanged.
CREATE FUNCTION public.support_admin_message_history(p_ticket_id uuid, p_before uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_before_at timestamptz; v_page jsonb; v_cursor uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_ticket_id) THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF p_before IS NOT NULL THEN
    SELECT created_at INTO v_before_at FROM public.support_messages WHERE ticket_id = p_ticket_id AND id = p_before;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  END IF;

  WITH page AS (
    SELECT id, author, body, created_at FROM public.support_messages
    WHERE ticket_id = p_ticket_id
      AND (p_before IS NULL OR (created_at,id) < (v_before_at,p_before))
    ORDER BY created_at DESC,id DESC LIMIT 51
  ), visible AS (
    SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 50
  )
  SELECT coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at,v.id) FROM visible v),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page) > 50
      THEN (SELECT id FROM visible ORDER BY created_at,id LIMIT 1) END
  INTO v_page,v_cursor;
  RETURN jsonb_build_object('ok',true,'messages',v_page,'nextCursor',v_cursor);
END;
$$;

CREATE FUNCTION public.support_visitor_message_history(p_capability_hash text, p_owner_user_id uuid, p_before uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ticket_id uuid;
BEGIN
  SELECT t.id INTO v_ticket_id FROM public.support_conversations c
    JOIN public.support_tickets t ON t.conversation_id = c.id
  WHERE c.capability_hash = p_capability_hash AND c.owner_user_id IS NOT DISTINCT FROM p_owner_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  RETURN public.support_admin_message_history(v_ticket_id,p_before);
END;
$$;

REVOKE ALL ON FUNCTION public.support_admin_message_history(uuid,uuid),
  public.support_visitor_message_history(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_admin_message_history(uuid,uuid),
  public.support_visitor_message_history(text,uuid,uuid) TO service_role;
