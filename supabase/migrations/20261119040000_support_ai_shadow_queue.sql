-- Silent proposals only. No scope rows are seeded or backfilled.
ALTER TABLE public.support_messages ADD UNIQUE (ticket_id,id);

CREATE TABLE public.support_ai_ticket_scope (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES public.support_ai_limits(tenant_id),
  history_verified_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE(tenant_id,ticket_id)
);
CREATE TABLE public.support_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  ticket_id uuid NOT NULL,
  source_message_id uuid NOT NULL UNIQUE,
  ticket_version integer NOT NULL CHECK (ticket_version > 0),
  attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','claimed','completed','skipped','obsolete','failed','uncertain')),
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE(tenant_id,attempt_id),
  UNIQUE(tenant_id,id),
  CHECK ((state='claimed') = (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES public.support_ai_ticket_scope(tenant_id,ticket_id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id,source_message_id) REFERENCES public.support_messages(ticket_id,id) ON DELETE CASCADE
);
CREATE INDEX support_ai_jobs_queue_idx ON public.support_ai_jobs(tenant_id,created_at,id)
  WHERE state IN ('queued','claimed');
CREATE INDEX support_ai_jobs_ticket_idx ON public.support_ai_jobs(ticket_id);

CREATE TABLE public.support_ai_proposals (
  job_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  knowledge_version text NOT NULL CHECK (length(knowledge_version) BETWEEN 1 AND 100),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  decision text NOT NULL CHECK(decision IN ('respond','escalate')),
  source_id text CHECK (source_id ~ '^[a-z0-9-]{1,100}$'),
  reason text CHECK (reason ~ '^[a-z0-9_]{1,100}$'),
  state text NOT NULL CHECK(state IN ('current','obsolete')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((decision='respond') = (source_id IS NOT NULL)),
  FOREIGN KEY (tenant_id,job_id) REFERENCES public.support_ai_jobs(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE public.support_ai_ticket_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ai_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_ai_ticket_scope,public.support_ai_jobs,public.support_ai_proposals
  FROM PUBLIC,anon,authenticated,service_role;

-- Internal only. Historical admin messages remain a block even if provenance is NULL.
CREATE FUNCTION public.support_shadow_eligible(p_tenant text,p_ticket uuid,p_version integer)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_tickets t
    JOIN public.support_ai_ticket_scope s ON s.ticket_id=t.id
    JOIN public.support_ai_limits l ON l.tenant_id=s.tenant_id
    WHERE t.id=p_ticket AND s.tenant_id=p_tenant AND s.enabled AND l.enabled
      AND t.version=p_version AND t.status='pending' AND t.automation_paused_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.support_messages m
        WHERE m.ticket_id=t.id AND (m.author='admin' OR m.provenance IS NULL))
  );
$$;

CREATE FUNCTION public.support_shadow_enqueue(p_ticket uuid,p_message uuid,p_version integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.support_ai_jobs(tenant_id,ticket_id,source_message_id,ticket_version)
  SELECT s.tenant_id,s.ticket_id,m.id,p_version FROM public.support_ai_ticket_scope s
  JOIN public.support_messages m ON m.ticket_id=s.ticket_id AND m.id=p_message
  WHERE s.ticket_id=p_ticket AND m.author='visitor' AND m.provenance='visitor'
    AND public.support_shadow_eligible(s.tenant_id,p_ticket,p_version)
  ON CONFLICT(source_message_id) DO NOTHING;
$$;

-- Ticket writes already serialize on the ticket row. Invalidate only current proposals.
CREATE FUNCTION public.support_shadow_invalidate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ticket uuid;
BEGIN
  IF TG_TABLE_NAME='support_tickets' THEN v_ticket:=NEW.id;
  ELSE v_ticket:=NEW.ticket_id; END IF;
  UPDATE public.support_ai_proposals p SET state='obsolete'
    FROM public.support_ai_jobs j WHERE j.id=p.job_id AND j.tenant_id=p.tenant_id
      AND j.ticket_id=v_ticket AND p.state='current';
  RETURN NEW;
END $$;
CREATE TRIGGER support_shadow_ticket_invalidate AFTER UPDATE OF version,status,automation_paused_at ON public.support_tickets
FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version OR OLD.status IS DISTINCT FROM NEW.status OR
  OLD.automation_paused_at IS DISTINCT FROM NEW.automation_paused_at)
EXECUTE FUNCTION public.support_shadow_invalidate();
CREATE TRIGGER support_shadow_scope_invalidate AFTER UPDATE OF enabled,history_verified_at ON public.support_ai_ticket_scope
FOR EACH ROW WHEN (OLD.enabled IS DISTINCT FROM NEW.enabled OR OLD.history_verified_at IS DISTINCT FROM NEW.history_verified_at)
EXECUTE FUNCTION public.support_shadow_invalidate();

CREATE FUNCTION public.claim_support_shadow_job(p_tenant text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.support_ai_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.support_ai_jobs x
  WHERE x.tenant_id=p_tenant AND (x.state='queued' OR (x.state='claimed' AND x.lease_until<=clock_timestamp()))
  ORDER BY x.created_at,x.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.support_ai_attempts a WHERE (a.tenant_id,a.attempt_id)=(j.tenant_id,j.attempt_id)) THEN
    UPDATE public.support_ai_jobs SET state='uncertain',claim_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=j.id;
    RETURN jsonb_build_object('state','uncertain');
  END IF;
  UPDATE public.support_ai_jobs SET state='claimed',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
    WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('state','claimed','id',j.id,'token',j.claim_token,'attempt_id',j.attempt_id);
END $$;

-- Operations follow ticket -> scope -> job -> quota order. No external call in a transaction.
CREATE FUNCTION public.gate_support_shadow_job(p_tenant text,p_job uuid,p_token uuid,
  p_model text DEFAULT NULL,p_input integer DEFAULT NULL,p_output integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.support_ai_jobs%ROWTYPE; v_body text; v_result text;
BEGIN
  SELECT * INTO j FROM public.support_ai_jobs WHERE id=p_job AND tenant_id=p_tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','denied'); END IF;
  PERFORM 1 FROM public.support_tickets WHERE id=j.ticket_id FOR UPDATE;
  PERFORM 1 FROM public.support_ai_ticket_scope WHERE ticket_id=j.ticket_id AND tenant_id=p_tenant FOR SHARE;
  SELECT * INTO j FROM public.support_ai_jobs WHERE id=p_job AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND OR j.state<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR j.lease_until<=clock_timestamp()
    THEN RETURN jsonb_build_object('state','denied'); END IF;
  SELECT body INTO v_body FROM public.support_messages
    WHERE ticket_id=j.ticket_id AND id=j.source_message_id AND author='visitor' AND provenance='visitor';
  IF NOT FOUND OR NOT public.support_shadow_eligible(p_tenant,j.ticket_id,j.ticket_version)
    THEN RETURN jsonb_build_object('state','obsolete'); END IF;
  IF p_model IS NULL AND p_input IS NULL AND p_output IS NULL THEN RETURN jsonb_build_object('state','eligible','body',v_body); END IF;
  IF p_model IS NULL OR p_input IS NULL OR p_output IS NULL THEN RETURN jsonb_build_object('state','denied'); END IF;
  PERFORM 1 FROM public.support_ai_limits WHERE tenant_id=p_tenant AND enabled AND model=p_model FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','disabled'); END IF;
  IF j.lease_until<=clock_timestamp()+interval '15 seconds' THEN RETURN jsonb_build_object('state','denied'); END IF;
  v_result:=public.reserve_support_ai_attempt(p_tenant,j.attempt_id,p_model,p_input,p_output);
  RETURN jsonb_build_object('state',v_result);
END $$;

CREATE FUNCTION public.finish_support_shadow_job(p_tenant text,p_job uuid,p_token uuid,p_status text,
  p_knowledge text DEFAULT NULL,p_model text DEFAULT NULL,p_decision text DEFAULT NULL,
  p_source text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.support_ai_jobs%ROWTYPE; v_live boolean; v_state text; v_reserved boolean; v_metered boolean;
BEGIN
  SELECT * INTO j FROM public.support_ai_jobs WHERE id=p_job AND tenant_id=p_tenant;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  PERFORM 1 FROM public.support_tickets WHERE id=j.ticket_id FOR UPDATE;
  PERFORM 1 FROM public.support_ai_ticket_scope WHERE ticket_id=j.ticket_id AND tenant_id=p_tenant FOR SHARE;
  SELECT * INTO j FROM public.support_ai_jobs WHERE id=p_job AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND OR j.state<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR j.lease_until<=clock_timestamp()
    THEN RETURN 'denied'; END IF;
  SELECT true,(a.input_tokens IS NOT NULL AND a.output_tokens IS NOT NULL) INTO v_reserved,v_metered
    FROM public.support_ai_attempts a WHERE (a.tenant_id,a.attempt_id)=(p_tenant,j.attempt_id);
  v_live:=public.support_shadow_eligible(p_tenant,j.ticket_id,j.ticket_version) AND EXISTS (
    SELECT 1 FROM public.support_messages m WHERE (m.ticket_id,m.id)=(j.ticket_id,j.source_message_id)
      AND m.author='visitor' AND m.provenance='visitor');
  IF p_status='proposal' AND (v_metered IS TRUE OR (v_reserved IS NOT TRUE AND p_decision='escalate')) THEN
    v_state:=CASE WHEN v_live THEN 'completed' ELSE 'obsolete' END;
    INSERT INTO public.support_ai_proposals(job_id,tenant_id,knowledge_version,model,decision,source_id,reason,state)
      VALUES(j.id,p_tenant,p_knowledge,p_model,p_decision,p_source,p_reason,
        CASE WHEN v_live THEN 'current' ELSE 'obsolete' END);
  ELSIF v_reserved IS TRUE AND v_metered IS NOT TRUE THEN v_state:='uncertain';
  ELSIF p_status='failed' THEN v_state:='failed';
  ELSIF NOT v_live THEN v_state:='obsolete';
  ELSE v_state:='skipped';
  END IF;
  UPDATE public.support_ai_jobs SET state=v_state,claim_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=j.id;
  RETURN v_state;
END $$;

REVOKE ALL ON FUNCTION public.support_shadow_eligible(text,uuid,integer),
  public.support_shadow_enqueue(uuid,uuid,integer), public.support_shadow_invalidate(),
  public.claim_support_shadow_job(text), public.gate_support_shadow_job(text,uuid,uuid,text,integer,integer),
  public.finish_support_shadow_job(text,uuid,uuid,text,text,text,text,text,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.support_shadow_enqueue(uuid,uuid,integer),public.claim_support_shadow_job(text),
  public.gate_support_shadow_job(text,uuid,uuid,text,integer,integer),
  public.finish_support_shadow_job(text,uuid,uuid,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.support_visitor_action(p_action text, p_capability_hash text, p_request_id uuid DEFAULT NULL, p_body text DEFAULT NULL, p_category text DEFAULT NULL, p_owner_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_conversation support_conversations%ROWTYPE;
  v_ticket support_tickets%ROWTYPE;
  v_hash text;
  v_previous support_requests%ROWTYPE;
  v_detail jsonb;
  v_count integer;
  v_message uuid;
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
      INSERT INTO support_messages(ticket_id,author,body,request_id,provenance) VALUES(v_ticket.id,'visitor',p_body,p_request_id,'visitor') RETURNING id INTO v_message;
      IF p_action='send' AND v_ticket.status='resolved' THEN
        UPDATE support_tickets SET status='pending',version=version+1,updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
        INSERT INTO support_activity(ticket_id,action,actor) VALUES(v_ticket.id,'visitor_reopened','visitor');
      ELSE
        UPDATE support_tickets SET version=version+1,updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
      END IF;
      PERFORM public.support_shadow_enqueue(v_ticket.id,v_message,v_ticket.version);
      END IF;
    END IF;
  END IF;
  SELECT count(*) INTO v_count FROM support_messages WHERE ticket_id=v_ticket.id;
  SELECT jsonb_build_object('id',t.id,'status',t.status,'category',t.category,'version',t.version) INTO v_detail FROM support_tickets t WHERE t.id=v_ticket.id;
  RETURN jsonb_build_object('ok',true,'ticket',v_detail,
    'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at) FROM (SELECT id,author,body,created_at,provenance FROM support_messages WHERE ticket_id=v_ticket.id ORDER BY created_at DESC LIMIT 100) m),'[]'::jsonb),
    'hasMore',v_count>100);
END $$;
