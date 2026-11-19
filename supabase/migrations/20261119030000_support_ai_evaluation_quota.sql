create table public.support_ai_limits (
  tenant_id text primary key,
  enabled boolean not null default false,
  model text not null,
  daily_requests integer not null check (daily_requests between 1 and 10000),
  daily_budget_micros bigint not null check (daily_budget_micros between 1 and 1000000000),
  input_micros_per_million bigint not null check (input_micros_per_million between 1 and 1000000000),
  output_micros_per_million bigint not null check (output_micros_per_million between 1 and 1000000000)
);
create table public.support_ai_attempts (
  tenant_id text not null references public.support_ai_limits,
  attempt_id uuid not null,
  usage_day date not null,
  reserved_micros bigint not null check (reserved_micros > 0),
  input_cap integer not null,
  output_cap integer not null,
  input_rate bigint not null,
  output_rate bigint not null,
  input_tokens integer,
  output_tokens integer,
  estimated_micros bigint,
  primary key (tenant_id, attempt_id)
);
create index support_ai_attempts_tenant_day on public.support_ai_attempts (tenant_id, usage_day);
alter table public.support_ai_limits enable row level security;
alter table public.support_ai_attempts enable row level security;
revoke all on public.support_ai_limits, public.support_ai_attempts from public, anon, authenticated, service_role;

create function public.reserve_support_ai_attempt(p_tenant text, p_attempt uuid, p_model text, p_input integer, p_output integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  cfg public.support_ai_limits%rowtype;
  utc_day date;
  n bigint;
  spent numeric;
  charge bigint;
begin
  select * into cfg from public.support_ai_limits where tenant_id = p_tenant for update;
  if not found or not cfg.enabled or cfg.model is distinct from p_model then return 'disabled'; end if;
  if p_attempt is null or p_input is null or p_output is null or p_input not between 1 and 10000 or p_output not between 16 and 512 then return 'invalid'; end if;
  if exists (select 1 from public.support_ai_attempts where tenant_id = p_tenant and attempt_id = p_attempt) then return 'duplicate'; end if;
  utc_day := (clock_timestamp() at time zone 'UTC')::date;
  charge := ceil((p_input * cfg.input_micros_per_million + p_output * cfg.output_micros_per_million) / 1000000.0);
  select count(*), coalesce(sum(reserved_micros),0) into n, spent
    from public.support_ai_attempts where tenant_id = p_tenant and usage_day = utc_day;
  if n >= cfg.daily_requests then return 'rate_limit'; end if;
  if spent + charge > cfg.daily_budget_micros then return 'budget_limit'; end if;
  insert into public.support_ai_attempts (tenant_id,attempt_id,usage_day,reserved_micros,input_cap,output_cap,input_rate,output_rate)
    values (p_tenant,p_attempt,utc_day,charge,p_input,p_output,cfg.input_micros_per_million,cfg.output_micros_per_million);
  return 'reserved';
end;
$$;

create function public.record_support_ai_usage(p_tenant text, p_attempt uuid, p_input integer, p_output integer)
returns boolean language sql security definer set search_path = '' as $$
  with updated as (
    update public.support_ai_attempts
      set input_tokens=p_input, output_tokens=p_output,
        estimated_micros=ceil((p_input*input_rate+p_output*output_rate)/1000000.0)
      where tenant_id=p_tenant and attempt_id=p_attempt and input_tokens is null
        and p_input between 1 and input_cap and p_output between 1 and output_cap
      returning 1
  ) select exists(select 1 from updated);
$$;
revoke all on function public.reserve_support_ai_attempt(text,uuid,text,integer,integer),
  public.record_support_ai_usage(text,uuid,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_support_ai_attempt(text,uuid,text,integer,integer),
  public.record_support_ai_usage(text,uuid,integer,integer) to service_role;
