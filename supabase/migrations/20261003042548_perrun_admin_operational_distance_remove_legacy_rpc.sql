-- POST-DEPLOY ONLY: verify all deployed backend instances use the eight-argument RPC first.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
drop function public.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text);
drop function kinetic_perrun_private.admin_update_perrun_registration(text,bigint,jsonb,jsonb,text,uuid,text);
commit;
