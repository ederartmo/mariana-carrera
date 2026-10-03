-- LOCAL ONLY. Cancel participation without releasing any historical resource.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.inscripciones add column cancelled_by_user_id uuid;

create function kinetic_perrun_private.admin_annul_perrun_participation(
 p_order_session_id text,p_expected_revision bigint,p_reason text,p_admin_user_id uuid,p_admin_email text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.perrun_checkout_orders; h public.inscripciones; before_values jsonb; after_values jsonb; b record;
begin
 if p_admin_user_id is null or coalesce(length(btrim(p_admin_email)),0)<4
 or coalesce(length(btrim(p_reason)),0) not between 3 and 500 or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'Admin actor, revision and annulment reason required'; end if;
 -- Production save/close takes this lock before batches/orders. Do not invert that hierarchy.
 perform pg_advisory_xact_lock(123456790,hashtext('perrun-2027'));
 select * into strict o from public.perrun_checkout_orders where order_session_id=p_order_session_id for update;
 select * into strict h from public.inscripciones where order_session_id=p_order_session_id and event_slug='perrun-2027' for update;
 if h.registration_status='cancelled' and h.cancellation_type='participation_cancelled' and h.cancelled_by_user_id is not null then
  return jsonb_build_object('alreadyAnnulled',true,'revision',o.admin_revision,'registrationId',h.id); end if;
 if o.admin_revision<>p_expected_revision then raise exception 'PERRUN_REVISION_CONFLICT'; end if;
 if o.event_slug is distinct from 'perrun-2027' or o.finalized_at is null or o.payment_status is distinct from 'paid'
 or h.registration_status is distinct from 'active' or coalesce(h.payment_status,'') not in ('paid','paid_no_email')
 or h.ticket_count is distinct from 1 or h.ticket_index is distinct from 1 or h.bib_number is null then raise exception 'Registration is not eligible for annulment'; end if;
 perform id from public.registration_dogs where order_session_id=p_order_session_id order by dog_index for update;
 select jsonb_build_object('participant',to_jsonb(h),'dogs',(select jsonb_agg(to_jsonb(d) order by dog_index) from public.registration_dogs d where order_session_id=p_order_session_id),
 'originalBuyerEmail',o.buyer_email,'originalOwnerPhone',o.owner_phone) into before_values;
 -- Only mutable draft membership is removed. Closed items and snapshots are never touched.
 for b in select pb.id from public.perrun_production_batches pb join public.perrun_production_items pi on pi.batch_id=pb.id
 where pi.order_session_id=p_order_session_id and pb.status='draft' order by pb.id for update of pb loop
  delete from public.perrun_production_items where batch_id=b.id and order_session_id=p_order_session_id;
  update public.perrun_production_batches set item_count=(select count(*) from public.perrun_production_items where batch_id=b.id),
  revision=revision+1,updated_at=now(),updated_by_user_id=p_admin_user_id,updated_by_email=lower(btrim(p_admin_email)) where id=b.id;
 end loop;
 update public.inscripciones set registration_status='cancelled',cancellation_type='participation_cancelled',
 cancelled_at=now(),cancelled_by=lower(btrim(p_admin_email)),cancelled_by_user_id=p_admin_user_id,cancellation_reason=btrim(p_reason)
 where id=h.id and email=h.email;
 update public.perrun_checkout_orders set admin_revision=admin_revision+1 where order_session_id=p_order_session_id;
 select jsonb_build_object('participant',to_jsonb(i),'dogs',before_values->'dogs','originalBuyerEmail',o.buyer_email,'originalOwnerPhone',o.owner_phone)
 into after_values from public.inscripciones i where id=h.id and email=h.email;
 insert into public.perrun_registration_edits(order_session_id,registration_id,admin_user_id,admin_email,reason,revision,old_values,new_values)
 values(p_order_session_id,h.id,p_admin_user_id,lower(btrim(p_admin_email)),btrim(p_reason),o.admin_revision+1,before_values,after_values);
 return jsonb_build_object('alreadyAnnulled',false,'revision',o.admin_revision+1,'registrationId',h.id);
end; $$;
create function public.admin_annul_perrun_participation(p_order_session_id text,p_expected_revision bigint,p_reason text,p_admin_user_id uuid,p_admin_email text)
returns jsonb language sql security invoker set search_path='' as $$
 select kinetic_perrun_private.admin_annul_perrun_participation(p_order_session_id,p_expected_revision,p_reason,p_admin_user_id,p_admin_email); $$;
revoke all on function public.admin_annul_perrun_participation(text,bigint,text,uuid,text),kinetic_perrun_private.admin_annul_perrun_participation(text,bigint,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_annul_perrun_participation(text,bigint,text,uuid,text),kinetic_perrun_private.admin_annul_perrun_participation(text,bigint,text,uuid,text) to service_role;
create or replace function kinetic_perrun_private.admin_read_perrun_production(p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.perrun_production_batches; items jsonb;
begin
 if p_batch_id is not null then
  select * into b from public.perrun_production_batches where id=p_batch_id;
  if not found then raise exception 'PRODUCTION_BATCH_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'registration_id',i.registration_id,'order_session_id',i.order_session_id,
   'bib_number',coalesce(c.bib_number,i.bib_number),'production_number',i.production_number,'snapshot',i.snapshot,
   'preview',case when b.status='draft' then c.data else null end,'registration_status',(select h.registration_status from public.inscripciones h where h.id=i.registration_id and h.order_session_id=i.order_session_id),'eligible',case when b.status='closed' then true else c.registration_id is not null end)
   order by coalesce(i.production_number,0),i.bib_number::numeric,i.registration_id,i.order_session_id),'[]'::jsonb) into items
   from public.perrun_production_items i left join kinetic_perrun_private.production_candidates() c on c.registration_id=i.registration_id and c.order_session_id=i.order_session_id where i.batch_id=p_batch_id;
 end if;
 return jsonb_build_object('summary',jsonb_build_object('pending',(select count(*) from kinetic_perrun_private.production_candidates()),
 'produced',(select count(*) from public.perrun_production_items where production_number is not null),
 'closed_batches',(select count(*) from public.perrun_production_batches where status='closed')),
 'candidates',(select coalesce(jsonb_agg(data order by bib_number::numeric,registration_id,order_session_id),'[]'::jsonb) from kinetic_perrun_private.production_candidates()),
 'batches',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) from public.perrun_production_batches x),
 'batch',case when p_batch_id is null then null else to_jsonb(b) end,'items',coalesce(items,'[]'::jsonb));
end;$$;
commit;
