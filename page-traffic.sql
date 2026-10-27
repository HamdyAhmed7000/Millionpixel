create table if not exists private.page_traffic(day date not null,path text not null,visitor_hash text not null,views integer not null default 1,last_seen timestamptz not null default now(),primary key(day,path,visitor_hash));
alter table private.page_traffic enable row level security;
revoke all on private.page_traffic from public,anon,authenticated;
create or replace function private.record_page_visit(p_path text,p_visitor uuid) returns void language plpgsql security definer set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'Africa/Cairo')::date;begin
 if p_visitor is null or p_path is null or length(p_path)>100 then return;end if;
 if p_path<>'/' and p_path !~ '^/(ar|en)/(advice|comedy-will|dreams|auctions|frequencies)/?$' then
  if p_path !~ '^/(ar|en)/frequencies/[0-9a-f-]{36}$' then return;end if;
  if not exists(select 1 from private.frequency_articles where id::text=split_part(p_path,'/',4) and status='published') then return;end if;
 end if;
 insert into private.page_traffic(day,path,visitor_hash) values(today,p_path,md5(p_visitor::text||today::text)) on conflict(day,path,visitor_hash) do update set views=page_traffic.views+1,last_seen=now() where page_traffic.last_seen<now()-interval '10 seconds';
end;$$;
revoke all on function private.record_page_visit(text,uuid) from public;grant execute on function private.record_page_visit(text,uuid) to anon,authenticated;
create or replace function public.record_page_visit(p_path text,p_visitor uuid) returns void language sql security invoker set search_path='' return private.record_page_visit(p_path,p_visitor);
revoke all on function public.record_page_visit(text,uuid) from public;grant execute on function public.record_page_visit(text,uuid) to anon,authenticated;
create or replace function private.admin_page_traffic(p_day date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;chosen date:=coalesce(p_day,(clock_timestamp() at time zone 'Africa/Cairo')::date);begin
 if auth.uid() is null or not coalesce(private.advice_admin(),false) then raise exception 'ADMIN_REQUIRED';end if;
 select jsonb_build_object('day',chosen,'views',coalesce(sum(views),0),'visitors',count(distinct visitor_hash),'pages',count(distinct path),'started',(select min(day) from private.page_traffic)) into result from private.page_traffic where day=chosen;
 return result||jsonb_build_object('daily',(select jsonb_agg(to_jsonb(q) order by q.day) from (select d::date as day,coalesce(sum(t.views),0) views,count(distinct t.visitor_hash) visitors from generate_series(chosen-6,chosen,interval '1 day')d left join private.page_traffic t on t.day=d::date group by d)q),'by_page',(select coalesce(jsonb_agg(to_jsonb(q) order by q.views desc),'[]') from(select t.path,sum(t.views) views,count(distinct t.visitor_hash) visitors,max(a.title) title from private.page_traffic t left join private.frequency_articles a on a.id::text=split_part(t.path,'/',4) where t.day=chosen group by t.path order by views desc,t.path limit 100)q));
end;$$;
revoke all on function private.admin_page_traffic(date) from public,anon;grant execute on function private.admin_page_traffic(date) to authenticated;
create or replace function public.admin_page_traffic(p_day date default null) returns jsonb language sql security invoker set search_path='' return private.admin_page_traffic(p_day);
revoke all on function public.admin_page_traffic(date) from public,anon;grant execute on function public.admin_page_traffic(date) to authenticated;

