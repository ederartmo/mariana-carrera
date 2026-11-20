-- Called only by the authenticated server after a successful visitor write.
-- Keep both public-path RPCs service-role-only and leave the shadow RPCs intact.
CREATE FUNCTION public.support_auto_claim(
  p_tenant text,p_ticket uuid,p_request uuid,p_not_before timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.support_tickets%ROWTYPE;
  m public.support_messages%ROWTYPE;
  j public.support_ai_jobs%ROWTYPE;
BEGIN
  IF p_tenant IS DISTINCT FROM 'kinetichub' OR p_ticket IS NULL OR p_request IS NULL
     OR p_not_before IS NULL OR p_not_before>statement_timestamp() THEN RETURN NULL; END IF;

  SELECT * INTO t FROM public.support_tickets WHERE id=p_ticket FOR UPDATE;
  IF NOT FOUND OR t.created_at<p_not_before OR t.status<>'pending' OR t.automation_paused_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.support_messages x WHERE x.ticket_id=t.id
                AND (x.author='admin' OR x.provenance IS NULL)) THEN RETURN NULL; END IF;

  SELECT * INTO m FROM public.support_messages x WHERE x.ticket_id=t.id AND x.author='visitor'
    ORDER BY x.created_at DESC,x.id DESC LIMIT 1;
  IF NOT FOUND OR m.request_id IS DISTINCT FROM p_request OR m.provenance IS DISTINCT FROM 'visitor'
     OR NOT EXISTS (SELECT 1 FROM public.support_ai_limits WHERE tenant_id=p_tenant AND enabled)
     THEN RETURN NULL; END IF;

  INSERT INTO public.support_ai_ticket_scope(ticket_id,tenant_id,history_verified_at,enabled)
    VALUES(t.id,p_tenant,clock_timestamp(),true) ON CONFLICT(ticket_id) DO NOTHING;
  -- Existing disabled/cross-tenant scope is never re-enabled or remapped.
  PERFORM 1 FROM public.support_ai_ticket_scope WHERE ticket_id=t.id AND tenant_id=p_tenant AND enabled FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.support_shadow_enqueue(t.id,m.id,t.version);

  SELECT * INTO j FROM public.support_ai_jobs x
    WHERE (x.tenant_id,x.ticket_id,x.source_message_id,x.ticket_version)=(p_tenant,t.id,m.id,t.version)
      AND (x.state='queued' OR (x.state='claimed' AND x.lease_until<=clock_timestamp()))
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.support_ai_limits WHERE tenant_id=p_tenant AND enabled FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.support_ai_attempts a WHERE (a.tenant_id,a.attempt_id)=(j.tenant_id,j.attempt_id)) THEN
    UPDATE public.support_ai_jobs SET state='uncertain',claim_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=j.id;
    RETURN jsonb_build_object('state','uncertain');
  END IF;
  UPDATE public.support_ai_jobs SET state='claimed',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
    WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('state','claimed','id',j.id,'token',j.claim_token,'attempt_id',j.attempt_id);
END $$;

CREATE FUNCTION public.support_auto_finish(
  p_tenant text,p_job uuid,p_token uuid,p_status text,
  p_knowledge text DEFAULT NULL,p_model text DEFAULT NULL,p_decision text DEFAULT NULL,
  p_source text DEFAULT NULL,p_reason text DEFAULT NULL,p_body text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  j public.support_ai_jobs%ROWTYPE;
  v_latest uuid;
  v_state text;
BEGIN
  IF p_tenant IS DISTINCT FROM 'kinetichub' OR p_job IS NULL OR p_token IS NULL
     OR p_status IS NULL OR p_status NOT IN ('proposal','failed','skipped') THEN RETURN 'denied'; END IF;
  IF p_status<>'proposal' THEN
    RETURN public.finish_support_shadow_job(p_tenant,p_job,p_token,p_status);
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000
     OR p_decision IS NULL OR p_decision NOT IN ('respond','escalate')
     OR (p_decision='respond') IS DISTINCT FROM (p_source IS NOT NULL) THEN RETURN 'denied'; END IF;

  SELECT * INTO j FROM public.support_ai_jobs WHERE tenant_id=p_tenant AND id=p_job;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  -- Same lock order as the gate: ticket -> scope -> job -> quota. Human replies
  -- and newer visitor writes serialize on the ticket; scope/tenant switches
  -- cannot race a committed publication after this transaction acquired them.
  PERFORM 1 FROM public.support_tickets WHERE id=j.ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  PERFORM 1 FROM public.support_ai_ticket_scope WHERE ticket_id=j.ticket_id AND tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO j FROM public.support_ai_jobs WHERE tenant_id=p_tenant AND id=p_job FOR UPDATE;
  IF NOT FOUND OR j.state<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR j.lease_until<=clock_timestamp()
     THEN RETURN 'denied'; END IF;
  PERFORM 1 FROM public.support_ai_limits WHERE tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT id INTO v_latest FROM public.support_messages WHERE ticket_id=j.ticket_id AND author='visitor'
    ORDER BY created_at DESC,id DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM j.source_message_id THEN
    RETURN public.finish_support_shadow_job(p_tenant,p_job,p_token,'skipped');
  END IF;

  v_state:=public.finish_support_shadow_job(p_tenant,p_job,p_token,p_status,p_knowledge,p_model,p_decision,p_source,p_reason);
  IF v_state IS DISTINCT FROM 'completed' THEN RETURN v_state; END IF;

  -- A single queue identity anchors the message. A conflicting request ID
  -- fails the whole transaction, so a job cannot finish without its message.
  INSERT INTO public.support_messages(ticket_id,author,body,request_id,created_at,provenance)
    VALUES(j.ticket_id,'agent',p_body,j.id,clock_timestamp(),'ai_generated');
  UPDATE public.support_tickets SET updated_at=clock_timestamp(),
    automation_paused_at=CASE WHEN p_decision='escalate' THEN clock_timestamp() ELSE automation_paused_at END
    WHERE id=j.ticket_id;
  RETURN 'published';
END $$;

REVOKE ALL ON FUNCTION public.support_auto_claim(text,uuid,uuid,timestamptz),
  public.support_auto_finish(text,uuid,uuid,text,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.support_auto_claim(text,uuid,uuid,timestamptz),
  public.support_auto_finish(text,uuid,uuid,text,text,text,text,text,text,text) TO service_role;
