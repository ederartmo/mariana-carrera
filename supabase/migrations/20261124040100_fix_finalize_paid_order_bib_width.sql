-- Use a minimum, not fixed, bib width. PostgreSQL lpad truncates '1001' to '100' at width 3.
-- Match only the deployed allocation block, preserving the rest of the function and its grants.
do $patch$
declare
  v_definition text;
  v_old constant text := $before$             select lpad(
               (
                 coalesce(
                   max(nullif(existing.bib_number, '')::integer),
                   0
                 ) + 1
               )::text,
               3,
               '0'
             )
             from public.inscripciones existing
             where (existing.payment_status = 'paid' or p_event_slug = 'perrun-2027')
               and existing.event_slug = p_event_slug
               and existing.bib_number ~ '^[0-9]+$'$before$;
  v_new constant text := $after$             select lpad(candidate.next_bib, greatest(3, length(candidate.next_bib)), '0')
             from (
               select (coalesce(max(nullif(existing.bib_number, '')::integer), 0) + 1)::text as next_bib
               from public.inscripciones existing
               where (existing.payment_status = 'paid' or p_event_slug = 'perrun-2027')
                 and existing.event_slug = p_event_slug
                 and existing.bib_number ~ '^[0-9]+$'
             ) as candidate$after$;
begin
  select replace(pg_get_functiondef(
    'public.finalize_paid_order(text,text,text,numeric,text,text,text,jsonb)'::regprocedure
  ), chr(13) || chr(10), chr(10)) into strict v_definition;

  if strpos(v_definition, v_old) = 0 then
    -- Safe to re-run the exact patch; any other definition calls for review.
    if strpos(v_definition, v_new) > 0 then
      return;
    end if;
    raise exception 'finalize_paid_order allocator drift: review before applying bib width hotfix';
  end if;

  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'finalize_paid_order allocator matched more than once';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$patch$;
