CREATE TABLE public.support_email_contacts (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  requested_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  challenge_hash text CHECK (challenge_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE public.support_visitor_email_jobs (
  id uuid PRIMARY KEY REFERENCES public.support_messages(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','sent','permanent')),
  attempts integer NOT NULL DEFAULT 0,
  ready_at timestamptz NOT NULL DEFAULT now(),
  lease uuid,
  resumed_at timestamptz
);
CREATE INDEX support_visitor_email_ready ON public.support_visitor_email_jobs (ready_at)
  WHERE state IN ('pending','leased');

ALTER TABLE public.support_email_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_visitor_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_email_contacts, public.support_visitor_email_jobs
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.support_email_contact(
  p_action text, p_hash text, p_owner uuid, p_email text DEFAULT NULL, p_proof text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.support_tickets%ROWTYPE; contact public.support_email_contacts%ROWTYPE;
  eligible boolean;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN 'unavailable'; END IF;
  SELECT ticket.* INTO t FROM public.support_tickets ticket
    JOIN public.support_conversations conversation ON conversation.id=ticket.conversation_id
    WHERE conversation.capability_hash=p_hash AND conversation.owner_user_id IS NOT DISTINCT FROM p_owner
    FOR UPDATE OF ticket;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  SELECT * INTO contact FROM public.support_email_contacts WHERE ticket_id=t.id;
  IF contact.verified_at IS NOT NULL THEN
    RETURN CASE WHEN p_action='verify' THEN 'unavailable' ELSE 'verified' END;
  END IF;
  eligible := t.automation_paused_at IS NOT NULL OR t.status='in_progress' OR EXISTS (
    SELECT 1 FROM public.support_messages WHERE ticket_id=t.id AND provenance='visitor'
      AND body='Solicito atencion humana.'
  );
  IF p_action='status' THEN
    IF contact.challenge_hash IS NOT NULL AND contact.requested_at > now()-interval '15 minutes' THEN
      RETURN 'code_pending';
    END IF;
    RETURN CASE WHEN eligible THEN 'eligible' ELSE 'unavailable' END;
  END IF;
  IF p_action='verify' AND p_owner IS NULL AND p_proof ~ '^[a-f0-9]{64}$'
    AND contact.challenge_hash=p_proof AND contact.requested_at > now()-interval '15 minutes' THEN
    UPDATE public.support_email_contacts SET verified_at=now(), challenge_hash=NULL WHERE ticket_id=t.id;
    RETURN 'verified';
  END IF;
  IF p_action='request' AND eligible AND length(p_email) BETWEEN 3 AND 254 THEN
    IF p_owner IS NOT NULL THEN
      INSERT INTO public.support_email_contacts(ticket_id,email,verified_at) VALUES (t.id,p_email,now())
        ON CONFLICT(ticket_id) DO NOTHING;
      RETURN 'verified';
    END IF;
    IF p_proof ~ '^[a-f0-9]{64}$'
      AND (contact.requested_at IS NULL OR contact.requested_at <= now()-interval '90 seconds') THEN
      INSERT INTO public.support_email_contacts(ticket_id,email,challenge_hash) VALUES (t.id,p_email,p_proof)
        ON CONFLICT(ticket_id) DO UPDATE SET email=excluded.email, challenge_hash=excluded.challenge_hash, requested_at=now();
      RETURN 'send';
    END IF;
  END IF;
  RETURN 'unavailable';
END $$;

CREATE FUNCTION public.support_queue_visitor_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.support_visitor_email_jobs(id,ticket_id)
    SELECT NEW.id, NEW.ticket_id FROM public.support_email_contacts
    WHERE ticket_id=NEW.ticket_id AND verified_at IS NOT NULL
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER support_queue_visitor_email AFTER INSERT ON public.support_messages FOR EACH ROW
  WHEN (NEW.author='admin' AND NEW.provenance='human_operator')
  EXECUTE FUNCTION public.support_queue_visitor_email();

CREATE FUNCTION public.support_claim_visitor_email(p_ticket uuid DEFAULT NULL, p_request uuid DEFAULT NULL)
RETURNS TABLE(id uuid, ticket_id uuid, email text, owner_user_id uuid, lease uuid)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH expired AS (
    UPDATE public.support_visitor_email_jobs SET state='permanent', lease=NULL
      WHERE state IN ('pending','leased') AND ready_at<=now()
        AND (created_at<=now()-interval '23 hours' OR attempts>=5)
  ), candidate AS (
    SELECT j.id FROM public.support_visitor_email_jobs j
      JOIN public.support_messages m ON m.id=j.id
      WHERE j.state IN ('pending','leased') AND j.ready_at<=now()
        AND j.created_at>now()-interval '23 hours' AND j.attempts<5
        AND (p_ticket IS NULL OR j.ticket_id=p_ticket)
        AND (p_request IS NULL OR m.request_id=p_request)
      ORDER BY j.ready_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE public.support_visitor_email_jobs j SET state='leased', attempts=j.attempts+1,
      lease=gen_random_uuid(), ready_at=now()+interval '1 minute'
      FROM candidate WHERE j.id=candidate.id RETURNING j.*
  )
  SELECT j.id,j.ticket_id,c.email,v.owner_user_id,j.lease
    FROM claimed j JOIN public.support_email_contacts c ON c.ticket_id=j.ticket_id
    JOIN public.support_tickets t ON t.id=j.ticket_id JOIN public.support_conversations v ON v.id=t.conversation_id
    WHERE c.verified_at IS NOT NULL
$$;

CREATE FUNCTION public.support_finish_visitor_email(p_id uuid,p_lease uuid,p_result text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('sent','retry','permanent') THEN RETURN false; END IF;
  UPDATE public.support_visitor_email_jobs SET lease=NULL,
    state=CASE WHEN p_result='retry' AND attempts<5 THEN 'pending'
               WHEN p_result='sent' THEN 'sent' ELSE 'permanent' END,
    ready_at=now()+interval '5 minutes'
    WHERE id=p_id AND lease=p_lease AND state='leased';
  RETURN FOUND;
END $$;

CREATE FUNCTION public.support_resume_visitor_email(p_job uuid,p_next_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient_ticket uuid;
BEGIN
  IF p_next_hash IS NULL OR p_next_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  UPDATE public.support_visitor_email_jobs j SET resumed_at=now()
    WHERE j.id=p_job AND j.state='sent' AND j.resumed_at IS NULL
      AND j.created_at>now()-interval '7 days'
    RETURNING j.ticket_id INTO recipient_ticket;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.support_conversations v SET capability_hash=p_next_hash
    FROM public.support_tickets t, public.support_email_contacts c
    WHERE t.id=recipient_ticket AND c.ticket_id=t.id AND c.verified_at IS NOT NULL
      AND v.id=t.conversation_id AND v.owner_user_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation cannot be resumed'; END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.support_email_contact(text,text,uuid,text,text),
  public.support_queue_visitor_email(), public.support_claim_visitor_email(uuid,uuid),
  public.support_finish_visitor_email(uuid,uuid,text), public.support_resume_visitor_email(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_email_contact(text,text,uuid,text,text),
  public.support_claim_visitor_email(uuid,uuid), public.support_finish_visitor_email(uuid,uuid,text),
  public.support_resume_visitor_email(uuid,text) TO service_role;
