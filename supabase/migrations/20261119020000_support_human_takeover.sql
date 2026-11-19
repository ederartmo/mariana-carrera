-- NULL provenance denotes historical/unknown, not inferred.
-- Same RPC signatures and security invoker settings retain existing grants.
ALTER TABLE public.support_tickets ADD COLUMN automation_paused_at timestamptz;
ALTER TABLE public.support_messages
  ADD COLUMN provenance text,
  ADD CONSTRAINT support_messages_provenance_check CHECK (
    provenance IS NULL
    OR (author='visitor' AND provenance='visitor')
    OR (author='admin' AND provenance='human_operator')
    OR (author='agent' AND provenance IN ('automatic_ack','ai_generated'))
  );

ALTER TABLE public.support_activity DROP CONSTRAINT support_activity_action_check;
ALTER TABLE public.support_activity ADD CONSTRAINT support_activity_action_check CHECK (
  action IN ('visitor_reopened','admin_reply','status_changed','category_changed',
             'assigned','agent_acknowledged','automation_paused')
);

CREATE OR REPLACE FUNCTION public.support_visitor_action(p_action text, p_capability_hash text, p_request_id uuid DEFAULT NULL, p_body text DEFAULT NULL, p_category text DEFAULT NULL, p_owner_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_conversation support_conversations%ROWTYPE;
  v_ticket support_tickets%ROWTYPE;
  v_hash text;
  v_previous support_requests%ROWTYPE;
  v_detail jsonb;
  v_count integer;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('start','read','send') OR p_capability_hash IS NULL OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('error','invalid'); END IF;
  IF p_action IN ('start','send') AND (p_request_id IS NULL OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000) THEN RETURN jsonb_build_object('error','invalid'); END IF;
  IF p_action='start' AND p_category NOT IN ('general','events','registration','other') THEN RETURN jsonb_build_object('error','invalid'); END IF;
  SELECT * INTO v_conversation FROM support_conversations WHERE capability_hash=p_capability_hash AND owner_user_id IS NOT DISTINCT FROM p_owner_user_id;
  IF NOT FOUND AND p_action='start' THEN
    INSERT INTO support_conversations(capability_hash,owner_user_id) VALUES(p_capability_hash,p_owner_user_id) ON CONFLICT(capability_hash) DO NOTHING;
    SELECT * INTO v_conversation FROM support_conversations WHERE capability_hash=p_capability_hash AND owner_user_id IS NOT DISTINCT FROM p_owner_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
    INSERT INTO support_tickets(conversation_id,category) VALUES(v_conversation.id,p_category) ON CONFLICT (conversation_id) DO NOTHING;
    SELECT * INTO v_ticket FROM support_tickets WHERE conversation_id=v_conversation.id FOR UPDATE;
  ELSIF NOT FOUND THEN RETURN jsonb_build_object('error','not_found');
  ELSE
    SELECT * INTO v_ticket FROM support_tickets WHERE conversation_id=v_conversation.id FOR UPDATE;
  END IF;
  IF p_action IN ('start','send') THEN
    v_hash := md5(concat_ws('|',p_action,p_body,coalesce(p_category,'')));
    SELECT * INTO v_previous FROM support_requests WHERE ticket_id=v_ticket.id AND request_id=p_request_id;
    IF FOUND THEN
      IF v_previous.payload_hash <> v_hash OR v_previous.action <> p_action THEN RETURN jsonb_build_object('error','conflict'); END IF;
    ELSE
      IF p_action='start' AND EXISTS(SELECT 1 FROM support_messages WHERE ticket_id=v_ticket.id) THEN
        IF NOT EXISTS(SELECT 1 FROM support_messages WHERE id=(SELECT id FROM support_messages WHERE ticket_id=v_ticket.id ORDER BY created_at ASC LIMIT 1) AND author='visitor' AND body=p_body)
           OR v_ticket.category<>p_category THEN RETURN jsonb_build_object('error','conflict'); END IF;
      ELSE
      INSERT INTO support_requests(ticket_id,request_id,payload_hash,action) VALUES(v_ticket.id,p_request_id,v_hash,p_action);
      INSERT INTO support_messages(ticket_id,author,body,request_id,provenance) VALUES(v_ticket.id,'visitor',p_body,p_request_id,'visitor');
      IF p_action='send' AND v_ticket.status='resolved' THEN
        UPDATE support_tickets SET status='pending',version=version+1,updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
        INSERT INTO support_activity(ticket_id,action,actor) VALUES(v_ticket.id,'visitor_reopened','visitor');
      ELSE
        UPDATE support_tickets SET version=version+1,updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
      END IF;
      END IF;
    END IF;
  END IF;
  SELECT count(*) INTO v_count FROM support_messages WHERE ticket_id=v_ticket.id;
  SELECT jsonb_build_object('id',t.id,'status',t.status,'category',t.category,'version',t.version) INTO v_detail FROM support_tickets t WHERE t.id=v_ticket.id;
  RETURN jsonb_build_object('ok',true,'ticket',v_detail,
    'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at) FROM (SELECT id,author,body,created_at,provenance FROM support_messages WHERE ticket_id=v_ticket.id ORDER BY created_at DESC LIMIT 100) m),'[]'::jsonb),
    'hasMore',v_count>100);
END $$;

CREATE OR REPLACE FUNCTION public.support_admin_detail(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_ticket support_tickets%ROWTYPE; v_messages jsonb; v_activity jsonb; v_count integer; v_activity_count integer;
BEGIN
 SELECT * INTO v_ticket FROM support_tickets WHERE id=p_ticket_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
 SELECT count(*) INTO v_count FROM support_messages WHERE ticket_id=p_ticket_id;
 SELECT count(*) INTO v_activity_count FROM support_activity WHERE ticket_id=p_ticket_id;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at),'[]'::jsonb) INTO v_messages FROM (SELECT id,author,body,created_at,provenance FROM support_messages WHERE ticket_id=p_ticket_id ORDER BY created_at DESC LIMIT 100) m;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at),'[]'::jsonb) INTO v_activity FROM (SELECT id,action,actor,created_at FROM support_activity WHERE ticket_id=p_ticket_id ORDER BY created_at DESC LIMIT 100) a;
 RETURN jsonb_build_object('ok',true,'ticket',jsonb_build_object('id',v_ticket.id,'status',v_ticket.status,'category',v_ticket.category,'version',v_ticket.version,'assigned_to',v_ticket.assigned_to,'updated_at',v_ticket.updated_at,'automation_paused_at',v_ticket.automation_paused_at),'messages',v_messages,'activity',v_activity,'hasMore',(v_count>100 OR v_activity_count>100));
END $$;

CREATE OR REPLACE FUNCTION public.support_admin_action(p_ticket_id uuid,p_request_id uuid,p_expected_version integer,p_action text,p_body text DEFAULT NULL,p_status text DEFAULT NULL,p_category text DEFAULT NULL,p_assign_to text DEFAULT NULL,p_assign_to_set boolean DEFAULT false,p_actor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_ticket support_tickets%ROWTYPE; v_hash text; v_prior support_requests%ROWTYPE; v_item text;
BEGIN
 IF p_ticket_id IS NULL OR p_action IS NULL OR p_action NOT IN ('reply','update') OR p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_actor IS NULL OR length(p_actor)>320 OR p_assign_to_set IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;
 IF p_action='reply' AND (p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000 OR p_status IS NOT NULL OR p_category IS NOT NULL OR p_assign_to IS NOT NULL) THEN RETURN jsonb_build_object('error','invalid'); END IF;
 IF p_action='update' AND ((p_body IS NOT NULL) OR (p_status IS NOT NULL AND p_status NOT IN ('pending','in_progress','resolved')) OR (p_category IS NOT NULL AND p_category NOT IN ('general','events','registration','other')) OR (p_assign_to IS NOT NULL AND length(p_assign_to)>320) OR (p_assign_to IS NOT NULL AND NOT p_assign_to_set) OR (p_status IS NULL AND p_category IS NULL AND NOT p_assign_to_set)) THEN RETURN jsonb_build_object('error','invalid'); END IF;
 IF p_action='reply' AND p_assign_to_set THEN RETURN jsonb_build_object('error','invalid'); END IF;
 SELECT * INTO v_ticket FROM support_tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
 v_hash := md5(concat_ws('|',p_action,coalesce(p_body,''),coalesce(p_status,''),coalesce(p_category,''),coalesce(p_assign_to,''),p_assign_to_set::text));
 SELECT * INTO v_prior FROM support_requests WHERE ticket_id=p_ticket_id AND request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.action<>p_action OR v_prior.payload_hash<>v_hash THEN RETURN jsonb_build_object('error','conflict'); END IF;
   RETURN public.support_admin_detail(p_ticket_id);
 END IF;
 IF v_ticket.version<>p_expected_version THEN RETURN jsonb_build_object('error','conflict'); END IF;
 INSERT INTO support_requests(ticket_id,request_id,payload_hash,action) VALUES(p_ticket_id,p_request_id,v_hash,p_action);
 IF p_action='reply' THEN
   INSERT INTO support_messages(ticket_id,author,body,request_id,provenance) VALUES(p_ticket_id,'admin',p_body,p_request_id,'human_operator');
   INSERT INTO support_activity(ticket_id,action,actor) VALUES(p_ticket_id,'admin_reply',p_actor);
   IF v_ticket.status='pending' THEN
     INSERT INTO support_activity(ticket_id,action,actor) VALUES(p_ticket_id,'status_changed',p_actor);
   END IF;
   IF v_ticket.automation_paused_at IS NULL THEN
     INSERT INTO support_activity(ticket_id,action,actor) VALUES(p_ticket_id,'automation_paused',p_actor);
   END IF;
 ELSE
   IF p_status IS NOT NULL AND p_status<>v_ticket.status THEN INSERT INTO support_activity(ticket_id,action,actor) VALUES(p_ticket_id,'status_changed',p_actor); END IF;
   IF p_category IS NOT NULL AND p_category<>v_ticket.category THEN INSERT INTO support_activity(ticket_id,action,actor) VALUES(p_ticket_id,'category_changed',p_actor); END IF;
   IF p_assign_to IS NOT NULL AND p_assign_to IS DISTINCT FROM v_ticket.assigned_to THEN INSERT INTO support_activity(ticket_id,action,actor) VALUES(p_ticket_id,'assigned',p_actor); END IF;
 END IF;
 UPDATE support_tickets SET status=CASE WHEN p_action='reply' AND v_ticket.status='pending' THEN 'in_progress'
                 ELSE coalesce(p_status,status) END,
   automation_paused_at=CASE WHEN p_action='reply' THEN coalesce(automation_paused_at,clock_timestamp())
                             ELSE automation_paused_at END,
   category=coalesce(p_category,category),assigned_to=CASE WHEN p_action='update' AND p_assign_to_set THEN p_assign_to ELSE assigned_to END,version=version+1,updated_at=now() WHERE id=p_ticket_id;
 RETURN public.support_admin_detail(p_ticket_id);
END $$;

CREATE OR REPLACE FUNCTION public.support_agent_acknowledge_first(
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
  ) OR v_ticket.automation_paused_at IS NOT NULL OR v_ticket.status <> 'pending' OR v_ticket.created_at < p_not_before
    OR EXISTS (SELECT 1 FROM public.support_messages
               WHERE ticket_id=p_ticket_id AND author IN ('admin','agent'))
  THEN RETURN jsonb_build_object('error','source_not_eligible'); END IF;

  INSERT INTO public.support_messages(ticket_id,author,body,request_id,provenance)
    VALUES (p_ticket_id,'agent',p_body,p_source_message_id,'automatic_ack')
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
