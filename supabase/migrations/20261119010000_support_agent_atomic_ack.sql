-- Support intake: inert atomic persistence primitive. No automatic caller is enabled.
-- Apply only after reviewing tests, UI agent attribution and a separate rollout gate.
ALTER TABLE public.support_messages
  DROP CONSTRAINT IF EXISTS support_messages_author_check;
ALTER TABLE public.support_messages
  ADD CONSTRAINT support_messages_author_check CHECK (author IN ('visitor','admin','agent'));

ALTER TABLE public.support_activity
  DROP CONSTRAINT IF EXISTS support_activity_action_check;
ALTER TABLE public.support_activity
  ADD CONSTRAINT support_activity_action_check CHECK (
    action IN ('visitor_reopened','admin_reply','status_changed',
               'category_changed','assigned','agent_acknowledged'));

CREATE TABLE public.support_agent_acknowledgments (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL UNIQUE REFERENCES public.support_messages(id) ON DELETE CASCADE,
  message_id uuid NOT NULL UNIQUE REFERENCES public.support_messages(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL UNIQUE REFERENCES public.support_activity(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_agent_acknowledgments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_agent_acknowledgments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.support_agent_acknowledgments TO service_role;

-- The server must invoke this function only after an explicit rollout flag.
-- Locks the ticket, validates the FIRST visitor message, and commits the
-- agent reply, audit activity and exact correlation together or not at all.
CREATE FUNCTION public.support_agent_acknowledge_first(
  p_ticket_id uuid, p_source_message_id uuid, p_body text, p_not_before timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_source public.support_messages%ROWTYPE;
  v_previous public.support_agent_acknowledgments%ROWTYPE;
  v_message uuid;
  v_activity uuid;
BEGIN
  IF p_ticket_id IS NULL OR p_source_message_id IS NULL
     OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000
     OR p_not_before IS NULL OR p_not_before > now()
  THEN RETURN jsonb_build_object('error','invalid'); END IF;

  SELECT * INTO v_ticket FROM public.support_tickets
    WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;

  -- Idempotent retry, including after an ambiguous network timeout.
  SELECT * INTO v_previous FROM public.support_agent_acknowledgments
    WHERE ticket_id = p_ticket_id;
  IF FOUND THEN
    IF v_previous.source_message_id <> p_source_message_id
       OR NOT EXISTS (
         SELECT 1 FROM public.support_messages
         WHERE id=v_previous.message_id AND body=p_body AND author='agent'
       )
    THEN RETURN jsonb_build_object('error','conflict'); END IF;
    RETURN jsonb_build_object('ok',true,'status','already_created',
      'message_id',v_previous.message_id,'activity_id',v_previous.activity_id);
  END IF;

  SELECT * INTO v_source FROM public.support_messages
    WHERE id=p_source_message_id AND ticket_id=p_ticket_id
      AND author='visitor' AND created_at>=p_not_before;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','source_not_eligible'); END IF;

  -- Scope V1 to first-contact acknowledgments, NOT reopen or every message.
  IF v_source.id IS DISTINCT FROM (
     SELECT id FROM public.support_messages WHERE ticket_id=p_ticket_id
     ORDER BY created_at,id LIMIT 1
  ) OR v_ticket.status <> 'pending' OR v_ticket.created_at < p_not_before
    OR EXISTS (SELECT 1 FROM public.support_messages
               WHERE ticket_id=p_ticket_id AND author IN ('admin','agent'))
  THEN RETURN jsonb_build_object('error','source_not_eligible'); END IF;

  INSERT INTO public.support_messages(ticket_id,author,body,request_id)
    VALUES (p_ticket_id,'agent',p_body,p_source_message_id)
    RETURNING id INTO v_message;
  INSERT INTO public.support_activity(ticket_id,action,actor)
    VALUES (p_ticket_id,'agent_acknowledged','agent:intake-v1')
    RETURNING id INTO v_activity;
  INSERT INTO public.support_agent_acknowledgments(
    ticket_id,source_message_id,message_id,activity_id
  ) VALUES (p_ticket_id,p_source_message_id,v_message,v_activity);

  -- Preserve ticket status/assignee. Update only the visible transcript version.
  UPDATE public.support_tickets SET version=version+1,updated_at=now()
    WHERE id=p_ticket_id;
  RETURN jsonb_build_object('ok',true,'status','created',
    'message_id',v_message,'activity_id',v_activity);
END;
$$;

REVOKE ALL ON FUNCTION public.support_agent_acknowledge_first(uuid,uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_agent_acknowledge_first(uuid,uuid,text,timestamptz)
  TO service_role;
