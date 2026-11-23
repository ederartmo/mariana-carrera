ALTER TABLE public.support_email_contacts
  ADD COLUMN challenge_attempts smallint NOT NULL DEFAULT 0 CHECK (challenge_attempts BETWEEN 0 AND 5);

-- Old hexadecimal proofs cannot be verified by the new form. Keep verified
-- contacts and let visitors with an unfinished verification resend immediately.
UPDATE public.support_email_contacts SET requested_at=least(requested_at, now()-interval '15 minutes')
  WHERE verified_at IS NULL AND challenge_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.support_email_contact(
  p_action text, p_hash text, p_owner uuid, p_email text DEFAULT NULL, p_proof text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.support_tickets%ROWTYPE;
  contact public.support_email_contacts%ROWTYPE;
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
    IF contact.challenge_hash IS NOT NULL THEN RETURN 'code_pending'; END IF;
    RETURN CASE WHEN eligible THEN 'eligible' ELSE 'unavailable' END;
  END IF;
  IF p_action='verify' AND p_owner IS NULL AND p_proof ~ '^[a-f0-9]{64}$' THEN
    IF contact.challenge_hash IS NULL THEN RETURN 'unavailable'; END IF;
    IF contact.requested_at <= now()-interval '15 minutes' THEN RETURN 'code_expired'; END IF;
    IF contact.challenge_attempts >= 5 THEN RETURN 'code_locked'; END IF;
    IF contact.challenge_hash=p_proof THEN
      UPDATE public.support_email_contacts SET verified_at=now(), challenge_hash=NULL WHERE ticket_id=t.id;
      RETURN 'verified';
    END IF;
    UPDATE public.support_email_contacts SET challenge_attempts=challenge_attempts+1 WHERE ticket_id=t.id;
    RETURN CASE WHEN contact.challenge_attempts=4 THEN 'code_locked' ELSE 'code_invalid' END;
  END IF;
  IF p_action='request' AND eligible AND length(p_email) BETWEEN 3 AND 254 THEN
    IF p_owner IS NOT NULL THEN
      INSERT INTO public.support_email_contacts(ticket_id,email,verified_at) VALUES (t.id,p_email,now())
        ON CONFLICT(ticket_id) DO NOTHING;
      RETURN 'verified';
    END IF;
    IF p_proof ~ '^[a-f0-9]{64}$'
      AND (contact.requested_at IS NULL OR contact.requested_at <= now()-interval '90 seconds') THEN
      IF p_proof=contact.challenge_hash THEN RETURN 'unavailable'; END IF;
      INSERT INTO public.support_email_contacts(ticket_id,email,challenge_hash) VALUES (t.id,p_email,p_proof)
        ON CONFLICT(ticket_id) DO UPDATE SET email=excluded.email, challenge_hash=excluded.challenge_hash,
          requested_at=now(), challenge_attempts=0;
      RETURN 'send';
    END IF;
  END IF;
  RETURN 'unavailable';
END $$;


-- Publish the explicit handoff in the existing visitor write transaction.
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
  v_requested_human boolean;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('start','read','send') OR p_capability_hash IS NULL OR p_capability_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('error','invalid'); END IF;
  IF p_action IN ('start','send') AND (p_request_id IS NULL OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000) THEN RETURN jsonb_build_object('error','invalid'); END IF;
  IF p_action='start' AND p_category NOT IN ('general','events','registration','other') THEN RETURN jsonb_build_object('error','invalid'); END IF;
  v_requested_human := p_action IN ('start','send') AND coalesce(
    translate(lower(btrim(p_body)), 'áéíóú', 'aeiou')
      ~ '^[[:space:]¡¿]*(quiero hablar con (una persona|un humano)|solicito atencion humana)[[:space:]!.?]*$', false);
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
      IF v_requested_human THEN
        IF v_ticket.automation_paused_at IS NULL THEN
          UPDATE support_tickets SET automation_paused_at=clock_timestamp() WHERE id=v_ticket.id;
          INSERT INTO support_activity(ticket_id,action,actor) VALUES(v_ticket.id,'automation_paused','visitor');
        END IF;
        INSERT INTO support_messages(ticket_id,author,body,request_id,created_at,provenance)
          VALUES(v_ticket.id,'agent','¡Claro! Voy a comunicarte con nuestro equipo de atención. Para enviarte su respuesta, necesitamos un correo de contacto.',
            v_message,clock_timestamp(),'automatic_ack');
      END IF;
      IF p_action='send' AND v_ticket.status='resolved' THEN
        UPDATE support_tickets SET status='pending',version=version+1,updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
        INSERT INTO support_activity(ticket_id,action,actor) VALUES(v_ticket.id,'visitor_reopened','visitor');
      ELSE
        UPDATE support_tickets SET version=version+1,updated_at=now() WHERE id=v_ticket.id RETURNING * INTO v_ticket;
      END IF;
      IF NOT v_requested_human THEN PERFORM public.support_shadow_enqueue(v_ticket.id,v_message,v_ticket.version); END IF;
      END IF;
    END IF;
  END IF;
  SELECT count(*) INTO v_count FROM support_messages WHERE ticket_id=v_ticket.id;
  SELECT jsonb_build_object('id',t.id,'status',t.status,'category',t.category,'version',t.version) INTO v_detail FROM support_tickets t WHERE t.id=v_ticket.id;
  RETURN jsonb_build_object('ok',true,'ticket',v_detail,'requestedHuman',v_requested_human,
    'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at) FROM (SELECT id,author,body,created_at,provenance FROM support_messages WHERE ticket_id=v_ticket.id ORDER BY created_at DESC LIMIT 100) m),'[]'::jsonb),
    'hasMore',v_count>100);
END $$;
