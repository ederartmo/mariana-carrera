-- Publish approved public guidance using the same ticket lock as human replies.
CREATE FUNCTION public.support_publish_public_guidance(
  p_ticket uuid, p_request uuid, p_not_before timestamptz, p_body text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  ticket public.support_tickets%ROWTYPE;
  latest public.support_messages%ROWTYPE;
BEGIN
  IF p_ticket IS NULL OR p_request IS NULL OR p_not_before IS NULL
    OR p_not_before > statement_timestamp() OR p_body IS NULL
    OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000 THEN RETURN false; END IF;
  SELECT * INTO ticket FROM public.support_tickets WHERE id=p_ticket FOR UPDATE;
  IF NOT FOUND OR ticket.created_at < p_not_before OR ticket.status <> 'pending'
    OR ticket.automation_paused_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.support_messages WHERE ticket_id=p_ticket AND (author='admin' OR provenance IS NULL)
    ) THEN RETURN false; END IF;
  SELECT * INTO latest FROM public.support_messages WHERE ticket_id=p_ticket AND author='visitor'
    ORDER BY created_at DESC,id DESC LIMIT 1;
  IF NOT FOUND OR latest.request_id IS DISTINCT FROM p_request OR latest.provenance <> 'visitor'
    OR EXISTS (
      SELECT 1 FROM public.support_messages WHERE ticket_id=p_ticket AND author='agent' AND created_at > latest.created_at
    ) THEN RETURN false; END IF;
  INSERT INTO public.support_messages(ticket_id,author,body,request_id,created_at,provenance)
    VALUES(p_ticket,'agent',p_body,latest.id,clock_timestamp(),'automatic_ack')
    ON CONFLICT(ticket_id,request_id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.support_tickets SET version=version+1, updated_at=clock_timestamp() WHERE id=p_ticket;
  RETURN true;
END $$;

CREATE INDEX support_visitor_message_recent_idx ON public.support_messages (created_at DESC,id DESC)
  WHERE author='visitor' AND provenance='visitor';

CREATE FUNCTION public.support_admin_monitor()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) ORDER BY created_at DESC,id DESC)
      FROM (
        SELECT id,created_at FROM public.support_messages WHERE author='visitor' AND provenance='visitor'
        ORDER BY created_at DESC,id DESC LIMIT 50
      ) recent
    ), '[]'::jsonb),
    'counts', (
      SELECT jsonb_build_object(
        'pending',count(*) FILTER (WHERE status='pending'),
        'inProgress',count(*) FILTER (WHERE status='in_progress'),
        'resolved',count(*) FILTER (WHERE status='resolved')
      ) FROM public.support_tickets
    )
  )
$$;

-- Keep the email table private. Operators receive only the contact state via the server.
CREATE FUNCTION public.support_admin_email_state(p_ticket uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((
    SELECT CASE WHEN verified_at IS NULL THEN 'pending' ELSE 'verified' END
    FROM public.support_email_contacts WHERE ticket_id=p_ticket
  ), 'none')
$$;

REVOKE ALL ON FUNCTION public.support_admin_email_state(uuid), public.support_admin_monitor(),
  public.support_publish_public_guidance(uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.support_admin_email_state(uuid), public.support_admin_monitor(),
  public.support_publish_public_guidance(uuid,uuid,timestamptz,text) TO service_role;
