create function private.admin_dashboard(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;v_page integer:=greatest(0,least(10000,coalesce((p_data->>'page')::integer,0)));day_start timestamptz:=date_trunc('day',clock_timestamp() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
begin
 if auth.uid() is null or not coalesce(private.advice_admin(),false) then raise exception 'ADMIN_REQUIRED';end if;
 if p_action='stats' then
  select jsonb_build_object('total',count(*),'today',count(*)filter(where created_at>=day_start),'week',count(*)filter(where created_at>=clock_timestamp()-interval '7 days'),'month',count(*)filter(where created_at>=clock_timestamp()-interval '30 days'),'confirmed',count(*)filter(where email_confirmed_at is not null)) into result from auth.users where not coalesce(is_anonymous,false);
  return result||jsonb_build_object('pending_images',(select count(*) from public.slot_claims where status='pending'),'pending_auctions',(select count(*) from private.auction_lots where status='pending'),'pending_advice',(select count(*) from public.advice_posts where status='pending'),'pending_dreams',(select count(*) from public.dream_posts where status='pending'),'pending_comments',(select count(*) from public.dream_comments where status='pending'),'hidden',(select count(*) from private.content_removals where restored_at is null),'updated_at',clock_timestamp());
 elsif p_action='users' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from (select u.id,u.email,a.handle,u.created_at,u.email_confirmed_at,u.last_sign_in_at,coalesce(p.is_admin,false) is_admin from auth.users u left join public.advice_profiles a on a.user_id=u.id left join public.profiles p on p.user_id=u.id where not coalesce(u.is_anonymous,false) and (coalesce(p_data->>'q','')='' or u.email ilike '%'||left(p_data->>'q',80)||'%' or a.handle ilike '%'||left(p_data->>'q',80)||'%') and (coalesce(p_data->>'new','')<>'week' or u.created_at>=clock_timestamp()-interval '7 days') order by u.created_at desc,u.id limit 21 offset v_page*20)r;
  return jsonb_build_object('items',result);
 elsif p_action='audit' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from (select l.id,l.action,l.details,l.created_at,coalesce(a.handle,'Admin') actor from private.advice_audit l left join public.advice_profiles a on a.user_id=l.actor where l.action in('content_remove','content_restore','content_edit') order by l.created_at desc,l.id desc limit 21 offset v_page*20)r;
  return jsonb_build_object('items',result);
 end if;
 raise exception 'ADMIN_ACTION';
end;$$;
revoke all on function private.admin_dashboard(text,jsonb) from public;grant execute on function private.admin_dashboard(text,jsonb) to authenticated;
create function public.admin_dashboard(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' return private.admin_dashboard(p_action,p_data);
revoke all on function public.admin_dashboard(text,jsonb) from public,anon;grant execute on function public.admin_dashboard(text,jsonb) to authenticated;
