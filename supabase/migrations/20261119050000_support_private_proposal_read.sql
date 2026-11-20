-- The service role cannot SELECT the shadow tables; expose only this projection.
CREATE FUNCTION public.support_admin_proposal(p_tenant text, p_ticket uuid, p_version integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'eligible', public.support_shadow_eligible(s.tenant_id,t.id,t.version),
    'proposal', (
      SELECT jsonb_build_object(
        'source',p.source_id,'knowledge',p.knowledge_version,'decision',p.decision,
        'state',CASE WHEN p.state='current' AND j.ticket_version=t.version
                     AND public.support_shadow_eligible(s.tenant_id,t.id,t.version)
                     AND m.author='visitor' AND m.provenance='visitor'
                THEN 'current' ELSE 'obsolete' END)
      FROM public.support_ai_jobs j
      JOIN public.support_ai_proposals p ON (p.tenant_id,p.job_id)=(j.tenant_id,j.id)
      JOIN public.support_messages m ON (m.ticket_id,m.id)=(j.ticket_id,j.source_message_id)
      WHERE (j.tenant_id,j.ticket_id)=(s.tenant_id,t.id)
      ORDER BY p.created_at DESC,p.job_id DESC LIMIT 1
    ))
  FROM public.support_tickets t JOIN public.support_ai_ticket_scope s ON s.ticket_id=t.id
  WHERE p_tenant='kinetichub' AND s.tenant_id=p_tenant AND t.id=p_ticket AND t.version=p_version;
$$;
REVOKE ALL ON FUNCTION public.support_admin_proposal(text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.support_admin_proposal(text,uuid,integer) TO service_role;
