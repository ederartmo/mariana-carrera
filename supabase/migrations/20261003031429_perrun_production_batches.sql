-- LOCAL REVIEW ONLY. No historical registration, payment or dog is rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.perrun_production_batches (
 id uuid primary key, event_slug text not null default 'perrun-2027' check(event_slug='perrun-2027'),
 status text not null default 'draft' check(status in ('draft','closed')),
 created_at timestamptz not null default now(), created_by_user_id uuid not null, created_by_email text not null,
 updated_at timestamptz not null default now(), updated_by_user_id uuid not null, updated_by_email text not null,
 closed_at timestamptz, closed_by_user_id uuid, closed_by_email text,
 item_count integer not null default 0 check(item_count>=0), revision bigint not null default 0 check(revision>=0),
 unique(id,event_slug),
 check((status='draft' and closed_at is null and closed_by_user_id is null and closed_by_email is null)
 or(status='closed' and closed_at is not null and closed_by_user_id is not null and closed_by_email is not null and item_count>0))
);
create table public.perrun_production_items (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null, event_slug text not null default 'perrun-2027',
 order_session_id text not null references public.perrun_checkout_orders(order_session_id) on delete restrict,
 -- Stable UUID + order: intentionally not tied to mutable email in the legacy composite PK.
 registration_id uuid not null, bib_number text not null check(bib_number ~ '^[0-9]+$'),
 production_number integer check(production_number>0), snapshot jsonb, created_at timestamptz not null default now(),
 foreign key(batch_id,event_slug) references public.perrun_production_batches(id,event_slug) on delete restrict,
 unique(batch_id,registration_id), unique(batch_id,order_session_id),
 check((production_number is null and snapshot is null) or(production_number is not null and snapshot is not null)),
 check(snapshot is null or(jsonb_typeof(snapshot)='object' and snapshot ?& array['schema_version','registration_id','order_session_id','bib_number','production_number','participant','dogs','dog_count'] and snapshot->>'schema_version'='1'
 and snapshot->>'registration_id'=registration_id::text and snapshot->>'order_session_id'=order_session_id
 and snapshot->>'bib_number'=bib_number and snapshot->>'production_number'=production_number::text))
);
create unique index perrun_production_number_unique on public.perrun_production_items(event_slug,production_number) where production_number is not null;
create unique index perrun_production_registration_once on public.perrun_production_items(event_slug,registration_id) where production_number is not null;
create unique index perrun_production_order_once on public.perrun_production_items(event_slug,order_session_id) where production_number is not null;
create index perrun_production_batch_status on public.perrun_production_batches(event_slug,status,created_at);
create index perrun_production_order_lookup on public.perrun_production_items(order_session_id);
alter table public.perrun_production_batches enable row level security;
alter table public.perrun_production_items enable row level security;
revoke all on public.perrun_production_batches,public.perrun_production_items from public,anon,authenticated,service_role;
grant select on public.perrun_production_batches,public.perrun_production_items to service_role;

create function kinetic_perrun_private.production_candidates()
returns table(registration_id uuid,order_session_id text,bib_number text,data jsonb)
language sql stable set search_path='' as $$
 select h.id,o.order_session_id,h.bib_number,jsonb_build_object(
 'schema_version',1,'registration_id',h.id,'order_session_id',o.order_session_id,'bib_number',h.bib_number,
 'participant',jsonb_build_object('name',h.full_name,'email',h.email,'phone',h.whatsapp,'shirt_size',h.shirt_size,'distance',h.distance),
 'amount_paid',h.amount_paid,'payment_source',o.payment_source,'dog_count',jsonb_array_length(o.dogs),
 'dogs',(select jsonb_agg(jsonb_build_object('id',d.id,'name',d.dog_name,'weight_kg',d.weight_kg,'category',d.category,
 'engraving_sequence',d.engraving_sequence,'engraving_requested',d.engraving_requested,'engraving_free',d.engraving_free,
 'engraving_payment_required',d.engraving_payment_required,'engraving_state',d.engraving_state,'plate_status',d.plate_status,
 'dog_name_for_plate',d.dog_name_for_plate,'owner_phone_for_plate',d.owner_phone_for_plate,'plate_started_at',d.plate_started_at)
 order by d.dog_index) from public.registration_dogs d where d.order_session_id=o.order_session_id and d.registration_id=h.id))
 from public.perrun_checkout_orders o join public.inscripciones h on h.order_session_id=o.order_session_id
 where o.event_slug='perrun-2027' and h.event_slug='perrun-2027' and o.finalized_at is not null and o.payment_status='paid'
 and h.payment_status in ('paid','paid_no_email') and h.registration_status='active' and h.ticket_count=1 and h.ticket_index=1
 and h.bib_number ~ '^[0-9]+$'
 and(select count(*) from public.inscripciones x where x.order_session_id=o.order_session_id)=1
 and(select count(*) from public.registration_dogs d where d.order_session_id=o.order_session_id and d.registration_id=h.id)=jsonb_array_length(o.dogs)
 and not exists(select 1 from public.perrun_production_items i where i.event_slug='perrun-2027' and i.production_number is not null
 and(i.registration_id=h.id or i.order_session_id=o.order_session_id));
$$;

create function kinetic_perrun_private.guard_production_batch() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Production batches cannot be deleted'; end if;
 if tg_op='INSERT' then
  if new.status<>'draft' or new.revision<>0 then raise exception 'Batch must start as draft'; end if;
 else
  if old.status='closed' then raise exception 'Closed production batch is immutable'; end if;
  if(new.id,new.event_slug,new.created_at,new.created_by_user_id,new.created_by_email) is distinct from
    (old.id,old.event_slug,old.created_at,old.created_by_user_id,old.created_by_email) then raise exception 'Batch identity is immutable'; end if;
  if new.revision<>old.revision+1 then raise exception 'Production revision must advance once'; end if;
 end if; return new;
end;$$;
create trigger perrun_production_batch_guard before insert or update or delete on public.perrun_production_batches for each row execute function kinetic_perrun_private.guard_production_batch();
create function kinetic_perrun_private.guard_production_item() returns trigger language plpgsql set search_path='' as $$
declare s text; bid uuid;
begin
 bid:=case when tg_op='DELETE' then old.batch_id else new.batch_id end;
 select status into strict s from public.perrun_production_batches where id=bid;
 if tg_op='INSERT' and not exists(select 1 from public.inscripciones h where h.id=new.registration_id and h.order_session_id=new.order_session_id
  and h.event_slug=new.event_slug and h.bib_number=new.bib_number) then raise exception 'Production registration identity mismatch'; end if;
 if tg_op='UPDATE' and(to_jsonb(new)-array['production_number','snapshot','bib_number']) is distinct from
  (to_jsonb(old)-array['production_number','snapshot','bib_number']) then raise exception 'Item identity is immutable'; end if;
 if s='closed' then
  if tg_op<>'UPDATE' then raise exception 'Closed production membership is immutable'; end if;
  if old.production_number is not null or new.production_number is null or new.snapshot is null then raise exception 'Closed production snapshot is immutable'; end if;
 elsif tg_op<>'DELETE' and(new.production_number is not null or new.snapshot is not null) then raise exception 'Draft has no production number or snapshot'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end;$$;
create trigger perrun_production_item_guard before insert or update or delete on public.perrun_production_items for each row execute function kinetic_perrun_private.guard_production_item();
create function kinetic_perrun_private.check_production_coherence() returns trigger language plpgsql set search_path='' as $$
declare bid uuid; b public.perrun_production_batches; n integer;
begin
 if tg_table_name='perrun_production_batches' then bid:=new.id;
 else bid:=case when tg_op='DELETE' then old.batch_id else new.batch_id end; end if;
 select * into strict b from public.perrun_production_batches where id=bid;
 select count(*) into n from public.perrun_production_items where batch_id=bid;
 if n<>b.item_count then raise exception 'Production item count mismatch'; end if;
 if exists(select 1 from public.perrun_production_items where batch_id=bid and
 ((b.status='closed' and production_number is null) or(b.status='draft' and production_number is not null))) then raise exception 'Production status mismatch'; end if;
 return null;
end;$$;
create constraint trigger perrun_production_batch_coherence after insert or update on public.perrun_production_batches deferrable initially deferred for each row execute function kinetic_perrun_private.check_production_coherence();
create constraint trigger perrun_production_item_coherence after insert or update or delete on public.perrun_production_items deferrable initially deferred for each row execute function kinetic_perrun_private.check_production_coherence();

create function kinetic_perrun_private.admin_read_perrun_production(p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.perrun_production_batches; items jsonb;
begin
 if p_batch_id is not null then
  select * into b from public.perrun_production_batches where id=p_batch_id;
  if not found then raise exception 'PRODUCTION_BATCH_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'registration_id',i.registration_id,'order_session_id',i.order_session_id,
   'bib_number',coalesce(c.bib_number,i.bib_number),'production_number',i.production_number,'snapshot',i.snapshot,
   'preview',case when b.status='draft' then c.data else null end,'eligible',case when b.status='closed' then true else c.registration_id is not null end)
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

create function kinetic_perrun_private.admin_save_perrun_production_batch(p_batch_id uuid,p_expected_revision bigint,p_registration_ids uuid[],p_admin_user_id uuid,p_admin_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.perrun_production_batches; ids uuid[]; initial boolean;
begin
 if p_batch_id is null or p_admin_user_id is null or coalesce(p_admin_email,'')='' or p_registration_ids is null
 or cardinality(p_registration_ids)>1000 or array_position(p_registration_ids,null) is not null then raise exception 'Invalid production draft'; end if;
 select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into ids from unnest(p_registration_ids) x;
 if cardinality(ids)<>cardinality(p_registration_ids) then raise exception 'Duplicate production candidate'; end if;
 perform pg_advisory_xact_lock(123456790,hashtext('perrun-2027'));
 select * into b from public.perrun_production_batches where id=p_batch_id for update; initial:=not found;
 if not initial and p_expected_revision is null then
  if (select coalesce(array_agg(registration_id order by registration_id),'{}'::uuid[]) from public.perrun_production_items where batch_id=p_batch_id)=ids then
   return kinetic_perrun_private.admin_read_perrun_production(p_batch_id);
  end if; raise exception 'PRODUCTION_REVISION_CONFLICT';
 end if;
 if not initial and(b.status<>'draft' or p_expected_revision is distinct from b.revision) then raise exception 'PRODUCTION_REVISION_CONFLICT'; end if;
 if initial and p_expected_revision is not null then raise exception 'PRODUCTION_BATCH_NOT_FOUND'; end if;
 if(select count(*) from kinetic_perrun_private.production_candidates() where registration_id=any(ids))<>cardinality(ids) then raise exception 'PRODUCTION_CANDIDATE_CHANGED'; end if;
 if initial then
  insert into public.perrun_production_batches(id,created_by_user_id,created_by_email,updated_by_user_id,updated_by_email,item_count)
  values(p_batch_id,p_admin_user_id,p_admin_email,p_admin_user_id,p_admin_email,cardinality(ids));
 else
  delete from public.perrun_production_items where batch_id=p_batch_id;
  update public.perrun_production_batches set item_count=cardinality(ids),revision=revision+1,updated_at=now(),updated_by_user_id=p_admin_user_id,updated_by_email=p_admin_email where id=p_batch_id;
 end if;
 insert into public.perrun_production_items(batch_id,registration_id,order_session_id,bib_number)
 select p_batch_id,registration_id,order_session_id,bib_number from kinetic_perrun_private.production_candidates() where registration_id=any(ids);
 return kinetic_perrun_private.admin_read_perrun_production(p_batch_id);
end;$$;

create function kinetic_perrun_private.admin_close_perrun_production_batch(p_batch_id uuid,p_expected_revision bigint,p_admin_user_id uuid,p_admin_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.perrun_production_batches; r record; n integer; total integer;
begin
 if p_batch_id is null or p_admin_user_id is null or coalesce(p_admin_email,'')='' then raise exception 'Invalid production actor'; end if;
 perform pg_advisory_xact_lock(123456790,hashtext('perrun-2027'));
 select * into b from public.perrun_production_batches where id=p_batch_id for update;
 if not found then raise exception 'PRODUCTION_BATCH_NOT_FOUND'; end if;
 if b.status='closed' then return kinetic_perrun_private.admin_read_perrun_production(p_batch_id); end if;
 if b.revision is distinct from p_expected_revision then raise exception 'PRODUCTION_REVISION_CONFLICT'; end if;
 if b.item_count=0 then raise exception 'PRODUCTION_EMPTY_BATCH'; end if;
 -- Same row hierarchy as Admin Edit: orders -> humans -> dogs, deterministic order.
 perform o.order_session_id from public.perrun_checkout_orders o join public.perrun_production_items i on i.order_session_id=o.order_session_id
 where i.batch_id=p_batch_id order by o.order_session_id for update of o;
 perform h.id from public.inscripciones h join public.perrun_production_items i on i.registration_id=h.id and i.order_session_id=h.order_session_id
 where i.batch_id=p_batch_id order by h.order_session_id,h.id for update of h;
 perform d.id from public.registration_dogs d join public.perrun_production_items i on i.registration_id=d.registration_id and i.order_session_id=d.order_session_id
 where i.batch_id=p_batch_id order by d.order_session_id,d.dog_index for share of d;
 select count(*) into total from public.perrun_production_items i join kinetic_perrun_private.production_candidates() c
 on c.registration_id=i.registration_id and c.order_session_id=i.order_session_id where i.batch_id=p_batch_id;
 if total<>b.item_count then raise exception 'PRODUCTION_CANDIDATE_CHANGED'; end if;
 select coalesce(max(production_number),0) into n from public.perrun_production_items where event_slug=b.event_slug;
 update public.perrun_production_batches set status='closed',closed_at=now(),closed_by_user_id=p_admin_user_id,closed_by_email=p_admin_email,
  updated_at=now(),updated_by_user_id=p_admin_user_id,updated_by_email=p_admin_email,revision=revision+1 where id=p_batch_id;
 -- Materialize candidates before assigning, so exclusion of produced rows cannot change ordering mid-loop.
 for r in select i.id,c.bib_number,c.data from public.perrun_production_items i join kinetic_perrun_private.production_candidates() c
  on c.registration_id=i.registration_id and c.order_session_id=i.order_session_id where i.batch_id=p_batch_id
  order by c.bib_number::numeric,i.registration_id,i.order_session_id loop
  n:=n+1;
  update public.perrun_production_items set bib_number=r.bib_number,production_number=n,snapshot=r.data||jsonb_build_object('production_number',n) where id=r.id;
 end loop;
 return kinetic_perrun_private.admin_read_perrun_production(p_batch_id);
end;$$;

do $$ declare f record; args text; names text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kinetic_perrun_private'
 and p.proname in ('admin_read_perrun_production','admin_save_perrun_production_batch','admin_close_perrun_production_batch') loop
  select pg_get_function_arguments(f.oid),array_to_string(proargnames,',') into args,names from pg_proc where oid=f.oid;
  execute format('create function public.%I(%s) returns jsonb language sql security invoker set search_path='''' as $fn$ select kinetic_perrun_private.%I(%s); $fn$',f.proname,args,f.proname,names);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  execute format('grant execute on function %s to service_role',f.oid::regprocedure);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.%I(%s) to service_role',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
end;$$;
revoke all on function kinetic_perrun_private.production_candidates(),kinetic_perrun_private.guard_production_batch(),kinetic_perrun_private.guard_production_item(),kinetic_perrun_private.check_production_coherence() from public,anon,authenticated,service_role;
commit;
