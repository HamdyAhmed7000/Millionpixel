-- CellTalk operations: private settings, maintenance guards and attributed traffic.
begin;
create table if not exists private.operations_config(id boolean primary key default true check(id),alert_email text not null default '',monitor_provider text not null default '',monitor_status text not null default 'not_connected');
insert into private.operations_config(id) values(true) on conflict do nothing;
alter table private.operations_config enable row level security;
revoke all on private.operations_config from public,anon,authenticated;
create table if not exists private.site_sections(key text primary key check(key in('home','advice','will','dreams','auctions','frequencies','movies','news')),visible boolean not null default true,updated_at timestamptz not null default now(),updated_by uuid,reason text not null default 'Initial setup');
insert into private.site_sections(key) select unnest(array['home','advice','will','dreams','auctions','frequencies','movies','news']) on conflict do nothing;
alter table private.site_sections enable row level security;
revoke all on private.site_sections from public,anon,authenticated;
create or replace function private.section_open(p_key text) returns boolean language sql stable security definer set search_path='' as $$select coalesce(private.advice_admin(),false) or coalesce((select visible from private.site_sections where key=p_key),false);$$;
revoke all on function private.section_open(text) from public;grant execute on function private.section_open(text) to anon,authenticated;
create or replace function private.require_section(p_key text) returns void language plpgsql stable security definer set search_path='' as $$begin if auth.role()='service_role' then return;end if;if not private.section_open(p_key) then raise exception 'SECTION_MAINTENANCE';end if;end;$$;
revoke all on function private.require_section(text) from public;grant execute on function private.require_section(text) to anon,authenticated;
create or replace function private.site_operations(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<ops>>
declare who text;key text:=p_data->>'key';reason text:=trim(p_data->>'reason');result jsonb;begin
 if p_action='sections' then return (select jsonb_object_agg(s.key,s.visible) from private.site_sections s);end if;
 if auth.uid() is null or not coalesce(private.advice_admin(),false) then raise exception 'OWNER_REQUIRED';end if;
 if p_action='health' then return jsonb_build_object('database','reachable','checked_at',clock_timestamp(),'monitor_status',(select monitor_status from private.operations_config where id));end if;
 if p_action='set_section' then
  if reason is null or length(reason) not between 5 and 500 or jsonb_typeof(p_data->'visible')<>'boolean' then raise exception 'VALIDATION_REQUIRED';end if;
  select coalesce(a.handle,u.email,auth.uid()::text) into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=auth.uid();
  update private.site_sections s set visible=(p_data->>'visible')::boolean,updated_at=now(),updated_by=auth.uid(),reason=ops.reason where s.key=ops.key;
  if not found then raise exception 'SECTION_INVALID';end if;
  insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(auth.uid(),who,case when (p_data->>'visible')::boolean then 'section_restored' else 'section_hidden' end,'site_section',key,jsonb_build_object('reason',reason,'visible',p_data->'visible'));
  return jsonb_build_object('ok',true);
 end if;
 if p_action='settings' then return jsonb_build_object('sections',(select jsonb_agg(to_jsonb(s) order by s.key) from private.site_sections s),'alert_email',(select alert_email from private.operations_config where id),'monitor_status',(select monitor_status from private.operations_config where id),'monitor_provider',(select monitor_provider from private.operations_config where id));end if;
 raise exception 'ACTION_INVALID';end;$$;
revoke all on function private.site_operations(text,jsonb) from public;grant execute on function private.site_operations(text,jsonb) to anon,authenticated;
create or replace function public.site_operations(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' return private.site_operations(p_action,p_data);
revoke all on function public.site_operations(text,jsonb) from public;grant execute on function public.site_operations(text,jsonb) to anon,authenticated;
-- Restrictive policies compose with all existing ownership/status policies.
do $$declare t text;k text;begin for t,k in select * from (values ('published_slots','home'),('slot_claims','home'),('slot_likes','home'),('advice_posts','advice'),('advice_price_snapshots','advice'),('advice_votes','advice'),('advice_bookmarks','advice'),('advice_contests','advice'),('dream_posts','dreams'),('dream_comments','dreams'),('dream_reactions','dreams'))r(t,k) loop
 execute format('drop policy if exists celltalk_section_guard on public.%I',t);
 execute format('create policy celltalk_section_guard on public.%I as restrictive for all to anon,authenticated using((select private.section_open(%L))) with check((select private.section_open(%L)))',t,k,k);
 end loop;end;$$;
-- Guard definer APIs as well as direct table access. Idempotent, retains existing ACLs.
do $$declare r record;definition text;guard text;begin for r in select p.oid,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where l.lanname='plpgsql' and ((n.nspname='private' and p.proname in('cinema_api','frequency_api','radio_api','auction_command','advice_command','dream_command')) or (n.nspname='public' and (p.proname like '%canvas%' or p.proname in('get_community_challenge_spots','get_spot_discovery_leaderboard','record_public_spot_view','get_slot_like_summary','vote_for_community_challenge')) and p.prosecdef)) loop
 definition:=pg_get_functiondef(r.oid);if strpos(definition,'/* section maintenance */')>0 then continue;end if;
 guard:=case r.proname when 'cinema_api' then $g$perform private.require_section(case when p_action in('ticker','react') or p_data->>'kind'='news' then 'news' else 'movies' end);$g$ when 'frequency_api' then $g$perform private.require_section('frequencies');$g$ when 'radio_api' then $g$perform private.require_section('frequencies');$g$ when 'auction_command' then $g$perform private.require_section('auctions');$g$ when 'advice_command' then $g$perform private.require_section('advice');$g$ when 'dream_command' then $g$perform private.require_section('dreams');$g$ else $g$perform private.require_section('home');$g$ end;
 definition:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n /* section maintenance */ '||guard,'i');execute definition;
 end loop;end;$$;
-- SQL aggregate endpoint bypasses table RLS through its definer, so guard explicitly.
do $$declare d text;begin d:=pg_get_functiondef('public.advice_leaderboard()'::regprocedure);if strpos(d,'section_open')=0 then d:=regexp_replace(d,'(where\s+)','\1private.section_open(''advice'') and ','i');execute d;end if;end;$$;
alter table private.page_traffic add column if not exists source text not null default 'unknown';
alter table private.page_traffic add column if not exists source_host text not null default '';
create or replace function private.record_visit_attributed(p_path text,p_visitor uuid,p_source text,p_host text) returns void language plpgsql security definer set search_path='' as $$
declare d date:=(clock_timestamp() at time zone 'Africa/Cairo')::date;h text:=md5(p_visitor::text||d::text);begin
 perform private.record_page_visit(p_path,p_visitor);
 update private.page_traffic set source=case when p_source in('search','social','referral','direct') then p_source else 'unknown' end,source_host=case when coalesce(p_host,'') ~ '^[a-z0-9.-]{1,120}$' then p_host else '' end where day=d and path=p_path and visitor_hash=h and source='unknown';
end;$$;
revoke all on function private.record_visit_attributed(text,uuid,text,text) from public;grant execute on function private.record_visit_attributed(text,uuid,text,text) to anon,authenticated;
create or replace function public.record_visit_attributed(p_path text,p_visitor uuid,p_source text,p_host text) returns void language sql security invoker set search_path='' return private.record_visit_attributed(p_path,p_visitor,p_source,p_host);
revoke all on function public.record_visit_attributed(text,uuid,text,text) from public;grant execute on function public.record_visit_attributed(text,uuid,text,text) to anon,authenticated;
create or replace function private.admin_traffic_extended(p_day date,p_days integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare d date:=coalesce(p_day,(clock_timestamp() at time zone 'Africa/Cairo')::date);start_day date;begin
 if auth.uid() is null or not coalesce(private.advice_admin(),false) then raise exception 'OWNER_REQUIRED';end if;
 start_day:=d-case when p_days=7 then 6 else 0 end;
 return jsonb_build_object('from',start_day,'to',d,'sources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.views desc),'[]') from(select source,sum(views) views,count(distinct visitor_hash) browser_days from private.page_traffic where day between start_day and d group by source)r),'pages',(select coalesce(jsonb_agg(to_jsonb(r) order by r.views desc),'[]') from(select path,sum(views) views,count(distinct visitor_hash) browser_days from private.page_traffic where day between start_day and d group by path order by sum(views) desc,path limit 100)r),'daily',(select coalesce(jsonb_agg(to_jsonb(r) order by r.day),'[]') from(select day,sum(views) views,count(distinct visitor_hash) visitors from private.page_traffic where day between start_day and d group by day)r),'registrations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.day),'[]') from(select (created_at at time zone 'Africa/Cairo')::date as day,count(*) registrations from auth.users where not coalesce(is_anonymous,false) and (created_at at time zone 'Africa/Cairo')::date between start_day and d group by 1)r));
end;$$;
revoke all on function private.admin_traffic_extended(date,integer) from public,anon;grant execute on function private.admin_traffic_extended(date,integer) to authenticated;
create or replace function public.admin_traffic_extended(p_day date default null,p_days integer default 1) returns jsonb language sql security invoker set search_path='' return private.admin_traffic_extended(p_day,p_days);
revoke all on function public.admin_traffic_extended(date,integer) from public,anon;grant execute on function public.admin_traffic_extended(date,integer) to authenticated;
notify pgrst,'reload schema';
commit;

