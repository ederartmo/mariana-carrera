-- A delivery queue derived from persisted support events. No hooks on chat writes.
CREATE TABLE public.support_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('new','reopened')),
  source_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','sent','stopped','obsolete')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  config_fingerprint text,
  UNIQUE (kind,source_id)
);
ALTER TABLE public.support_notification_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_notification_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_notification_jobs TO service_role;

CREATE INDEX support_notification_ready_idx ON public.support_notification_jobs(next_attempt_at,id)
  WHERE state IN ('pending','leased');
CREATE INDEX support_notification_reopened_idx ON public.support_activity(ticket_id,created_at DESC,id DESC)
  WHERE action = 'visitor_reopened';

CREATE FUNCTION public.support_claim_notification_jobs(p_since timestamptz, p_config text)
RETURNS TABLE(id uuid,ticket_id uuid,kind text,occurred_at timestamptz,lease_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_since IS NULL OR p_since > now() OR p_config IS NULL OR p_config !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;

  INSERT INTO public.support_notification_jobs(ticket_id,kind,source_id,occurred_at)
  SELECT t.id, CASE WHEN a.id IS NULL THEN 'new' ELSE 'reopened' END,
    coalesce(a.id,t.id), coalesce(a.created_at,t.created_at)
  FROM public.support_tickets t
  LEFT JOIN LATERAL (
    SELECT sa.id,sa.created_at FROM public.support_activity sa
    WHERE sa.ticket_id=t.id AND sa.action='visitor_reopened'
    ORDER BY sa.created_at DESC,sa.id DESC LIMIT 1
  ) a ON true
  WHERE t.status='pending' AND t.updated_at>=p_since AND coalesce(a.created_at,t.created_at)>=p_since
    AND NOT EXISTS (
      SELECT 1 FROM public.support_notification_jobs j
      WHERE j.source_id=coalesce(a.id,t.id) AND j.kind=CASE WHEN a.id IS NULL THEN 'new' ELSE 'reopened' END
    )
  ORDER BY coalesce(a.created_at,t.created_at),coalesce(a.id,t.id)
  LIMIT 25
  ON CONFLICT ON CONSTRAINT support_notification_jobs_kind_source_id_key DO NOTHING;

  -- Do not resend uncertain deliveries beyond the provider's idempotency window,
  -- or retry with a different destination/sender/link.
  UPDATE public.support_notification_jobs j SET state='stopped',lease_token=NULL,lease_until=NULL
  WHERE j.state IN ('pending','leased') AND (j.lease_until IS NULL OR j.lease_until<=now())
    AND (j.attempts>=5 OR j.first_attempt_at<=now()-interval '23 hours'
      OR (j.config_fingerprint IS NOT NULL AND j.config_fingerprint<>p_config));

  UPDATE public.support_notification_jobs j SET state='obsolete',lease_token=NULL,lease_until=NULL
  FROM public.support_tickets t
  WHERE j.ticket_id=t.id AND j.state IN ('pending','leased') AND (j.lease_until IS NULL OR j.lease_until<=now())
    AND (t.status<>'pending' OR EXISTS (
      SELECT 1 FROM public.support_activity a WHERE a.ticket_id=j.ticket_id AND a.action='visitor_reopened'
        AND ((j.kind='new' AND a.created_at>=j.occurred_at) OR
             (j.kind='reopened' AND (a.created_at,a.id)>(j.occurred_at,j.source_id)))
    ));

  RETURN QUERY WITH ready AS (
    SELECT j.id FROM public.support_notification_jobs j
    WHERE j.state IN ('pending','leased') AND (j.lease_until IS NULL OR j.lease_until<=now())
      AND j.next_attempt_at<=now() AND j.occurred_at>=p_since
    ORDER BY j.next_attempt_at,j.id LIMIT 3 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.support_notification_jobs j SET state='leased',attempts=j.attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',
    first_attempt_at=coalesce(j.first_attempt_at,now()), config_fingerprint=p_config
  FROM ready r WHERE j.id=r.id
  RETURNING j.id,j.ticket_id,j.kind,j.occurred_at,j.lease_token;
END;
$$;

CREATE FUNCTION public.support_finish_notification_job(p_id uuid,p_lease_token uuid,p_outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent','retry','permanent') THEN RETURN false; END IF;
  UPDATE public.support_notification_jobs j
  SET state=CASE WHEN p_outcome='sent' THEN 'sent'
      WHEN p_outcome='permanent' OR j.attempts>=5 THEN 'stopped' ELSE 'pending' END,
    next_attempt_at=now()+make_interval(mins => (2 ^ j.attempts)::integer),
    lease_until=NULL,lease_token=NULL
  WHERE j.id=p_id AND j.state='leased' AND j.lease_token=p_lease_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.support_claim_notification_jobs(timestamptz,text),
  public.support_finish_notification_job(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_claim_notification_jobs(timestamptz,text),
  public.support_finish_notification_job(uuid,uuid,text) TO service_role;
