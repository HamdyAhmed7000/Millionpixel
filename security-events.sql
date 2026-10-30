-- Owner-only, bounded Auth audit view; never expose tokens or raw payloads.
create or replace function private.admin_security_events(p_page integer) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not coalesce(private.advice_admin(),false) then raise exception 'OWNER_REQUIRED';end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]') from(select id,created_at,left(coalesce(payload->>'action','unknown'),100) action,left(coalesce(payload->>'actor_username',''),200) account,left(coalesce(ip_address,''),64) ip from auth.audit_log_entries order by created_at desc,id limit 21 offset greatest(0,least(1000,coalesce(p_page,0)))*20)r));
end;$$;
revoke all on function private.admin_security_events(integer) from public,anon;grant execute on function private.admin_security_events(integer) to authenticated;
create or replace function public.admin_security_events(p_page integer default 0) returns jsonb language sql security invoker set search_path='' return private.admin_security_events(p_page);
revoke all on function public.admin_security_events(integer) from public,anon;grant execute on function public.admin_security_events(integer) to authenticated;
notify pgrst,'reload schema';
