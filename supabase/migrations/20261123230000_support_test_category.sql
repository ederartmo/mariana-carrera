-- Allow administrative classification while keeping visitor intake unchanged.
ALTER TABLE public.support_tickets
  DROP CONSTRAINT support_tickets_category_check,
  ADD CONSTRAINT support_tickets_category_check
    CHECK (category IN ('general','events','registration','other','test'));

CREATE OR REPLACE FUNCTION public.support_admin_list(
  p_limit integer DEFAULT 50, p_status text DEFAULT NULL, p_category text DEFAULT NULL,
  p_assignee text DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_page jsonb; v_more boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_before IS NULL) <> (p_before_id IS NULL)
    OR p_status NOT IN ('pending','in_progress','resolved')
    OR p_category NOT IN ('general','events','registration','other','test')
    OR length(p_assignee)>254 THEN RETURN jsonb_build_object('error','invalid'); END IF;
 WITH page AS (
   SELECT id,status,category,version,assigned_to,updated_at,created_at
   FROM support_tickets
   WHERE (p_status IS NULL OR status=p_status)
     AND (p_category IS NULL OR category=p_category)
     AND (p_assignee IS NULL OR (p_assignee='' AND assigned_to IS NULL) OR assigned_to=p_assignee)
     AND (p_before IS NULL OR (created_at,id)<(p_before,p_before_id))
   ORDER BY created_at DESC,id DESC LIMIT p_limit+1
 ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT coalesce(jsonb_agg(to_jsonb(visible) ORDER BY created_at DESC,id DESC),'[]'::jsonb),
        (SELECT count(*)>p_limit FROM page)
 INTO v_page,v_more FROM visible;
 RETURN jsonb_build_object('ok',true,'tickets',v_page,'nextCursor',
   CASE WHEN v_more THEN jsonb_build_object('createdAt',v_page->-1->>'created_at','id',v_page->-1->>'id') END);
END $$;

CREATE OR REPLACE FUNCTION public.support_admin_action(p_ticket_id uuid,p_request_id uuid,p_expected_version integer,p_action text,p_body text DEFAULT NULL,p_status text DEFAULT NULL,p_category text DEFAULT NULL,p_assign_to text DEFAULT NULL,p_assign_to_set boolean DEFAULT false,p_actor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_ticket support_tickets%ROWTYPE; v_hash text; v_prior support_requests%ROWTYPE; v_item text;
BEGIN
 IF p_ticket_id IS NULL OR p_action IS NULL OR p_action NOT IN ('reply','update') OR p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_actor IS NULL OR length(p_actor)>320 OR p_assign_to_set IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;
 IF p_action='reply' AND (p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000 OR p_status IS NOT NULL OR p_category IS NOT NULL OR p_assign_to IS NOT NULL) THEN RETURN jsonb_build_object('error','invalid'); END IF;
 IF p_action='update' AND ((p_body IS NOT NULL) OR (p_status IS NOT NULL AND p_status NOT IN ('pending','in_progress','resolved')) OR (p_category IS NOT NULL AND p_category NOT IN ('general','events','registration','other','test')) OR (p_assign_to IS NOT NULL AND length(p_assign_to)>320) OR (p_assign_to IS NOT NULL AND NOT p_assign_to_set) OR (p_status IS NULL AND p_category IS NULL AND NOT p_assign_to_set)) THEN RETURN jsonb_build_object('error','invalid'); END IF;
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
