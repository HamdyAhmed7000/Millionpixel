begin;
create table public.dream_posts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.advice_profiles(user_id),
 title text not null check(char_length(trim(title)) between 3 and 100),body text not null check(char_length(trim(body)) between 5 and 500),
 dreamed_at date,buried_at date not null default current_date,language text not null check(language in ('ar','en')),
 status text not null default 'pending' check(status in ('pending','published','rejected','removed','revived')),
 created_at timestamptz not null default now(),published_at timestamptz,
 check(dreamed_at is null or dreamed_at<=buried_at)
);
create index dream_posts_status_date on public.dream_posts(status,created_at desc);
create index dream_posts_user on public.dream_posts(user_id);
create table public.dream_comments(
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.dream_posts(id) on delete cascade,
 user_id uuid not null references public.advice_profiles(user_id),body text not null check(char_length(trim(body)) between 2 and 280),
 status text not null default 'pending' check(status in ('pending','published','rejected','removed')),created_at timestamptz not null default now()
);
create index dream_comments_post_status on public.dream_comments(post_id,status,created_at);
create index dream_comments_user on public.dream_comments(user_id);
create table public.dream_reactions(post_id uuid references public.dream_posts(id) on delete cascade,user_id uuid references public.advice_profiles(user_id) on delete cascade,created_at timestamptz not null default now(),primary key(post_id,user_id));
create index dream_reactions_user on public.dream_reactions(user_id);
create table public.dream_reports(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.dream_posts(id),user_id uuid not null references auth.users(id),reason text not null check(char_length(trim(reason)) between 5 and 500),resolved boolean not null default false,created_at timestamptz not null default now(),unique(post_id,user_id));
create index dream_reports_user on public.dream_reports(user_id);
alter table public.dream_posts enable row level security;
alter table public.dream_comments enable row level security;
alter table public.dream_reactions enable row level security;
alter table public.dream_reports enable row level security;
revoke all on public.dream_posts,public.dream_comments,public.dream_reactions,public.dream_reports from public,anon,authenticated;
grant select on public.dream_posts,public.dream_comments to anon,authenticated;
grant select on public.dream_reactions,public.dream_reports to authenticated;
create policy dream_post_read on public.dream_posts for select to anon,authenticated using(status in('published','revived') or user_id=(select auth.uid()) or (select private.advice_admin()));
create policy dream_comment_read on public.dream_comments for select to anon,authenticated using((status='published' and exists(select 1 from public.dream_posts p where p.id=post_id and p.status in('published','revived'))) or user_id=(select auth.uid()) or (select private.advice_admin()));
create policy dream_reaction_read on public.dream_reactions for select to authenticated using(user_id=(select auth.uid()));
create policy dream_report_read on public.dream_reports for select to authenticated using(user_id=(select auth.uid()) or (select private.advice_admin()));
drop policy advice_public_profiles on public.advice_profiles;
create policy advice_public_profiles on public.advice_profiles for select to anon,authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.advice_posts p where p.user_id=advice_profiles.user_id and p.status='published') or exists(select 1 from public.dream_posts p where p.user_id=advice_profiles.user_id and p.status in('published','revived')) or exists(select 1 from public.dream_comments c where c.user_id=advice_profiles.user_id and c.status='published') or (select private.advice_admin()));
-- Counts are aggregated without exposing individual reaction identities.
create function private.dream_support(p_id uuid) returns bigint language sql stable security definer set search_path='' as $$select count(*) from public.dream_reactions r where r.post_id=p_id and exists(select 1 from public.dream_posts p where p.id=p_id and p.status in('published','revived'));$$;
revoke all on function private.dream_support(uuid) from public;
grant execute on function private.dream_support(uuid) to anon,authenticated;
create view public.dream_market with(security_invoker=true) as select p.*,a.handle,private.dream_support(p.id) as supports from public.dream_posts p join public.advice_profiles a on a.user_id=p.user_id;
revoke all on public.dream_market from public;grant select on public.dream_market to anon,authenticated;
create function private.dream_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();me public.advice_profiles;target uuid;post public.dream_posts;decision text;new_id uuid;
begin
 if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'ADVICE_SIGN_IN';end if;
 select * into me from public.advice_profiles where user_id=actor for update;
 if me.suspended then raise exception 'ADVICE_SUSPENDED';end if;
 if p_action in('review_post','review_comment','resolve_report') then
  if not private.advice_admin() then raise exception 'ADVICE_ADMIN';end if;
  target:=(p_data->>'id')::uuid;
  decision:=p_data->>'status';
  if p_action<>'resolve_report' and (decision is null or decision not in('published','rejected','removed')) then raise exception 'ADVICE_ACTION';end if;
  if p_action='review_post' then
   perform 1 from public.dream_posts where id=target for update;
   update public.dream_posts set status=decision,published_at=case when decision='published' then coalesce(published_at,now()) else published_at end where id=target and (status='pending' or decision='removed');
  elsif p_action='review_comment' then update public.dream_comments set status=decision where id=target and (status='pending' or decision='removed');
  else update public.dream_reports set resolved=true where id=target;end if;
  if not found then raise exception 'ADVICE_NOT_FOUND';end if;
  insert into private.advice_audit(actor,action,details) values(actor,'dream_'||p_action,p_data);return jsonb_build_object('ok',true);
 end if;
 if me.user_id is null then raise exception 'ADVICE_PROFILE';end if;
 if me.last_action_at>clock_timestamp()-interval '1 second' then raise exception 'ADVICE_SLOW_DOWN';end if;
 update public.advice_profiles set last_action_at=clock_timestamp() where user_id=actor;
 if p_action='submit' then
  if (select count(*) from public.dream_posts where user_id=actor and created_at>now()-interval '1 day')>=5 then raise exception 'DREAM_LIMIT';end if;
  if (p_data->>'buried_at')::date>current_date then raise exception 'DREAM_DATE';end if;
  insert into public.dream_posts(user_id,title,body,dreamed_at,buried_at,language) values(actor,trim(p_data->>'title'),trim(p_data->>'body'),nullif(p_data->>'dreamed_at','')::date,(p_data->>'buried_at')::date,p_data->>'language') returning id into new_id;
  return jsonb_build_object('id',new_id);
 end if;
 target:=(p_data->>'id')::uuid;select * into post from public.dream_posts where id=target for update;
 if post.id is null or post.status not in('published','revived') then raise exception 'ADVICE_NOT_FOUND';end if;
 if p_action='support' then
  if exists(select 1 from public.dream_reactions where post_id=target and user_id=actor) then delete from public.dream_reactions where post_id=target and user_id=actor;
  else insert into public.dream_reactions(post_id,user_id) values(target,actor);end if;
 elsif p_action='comment' then
  if (select count(*) from public.dream_comments where user_id=actor and created_at>now()-interval '1 day')>=20 then raise exception 'DREAM_LIMIT';end if;
  insert into public.dream_comments(post_id,user_id,body) values(target,actor,trim(p_data->>'body'));
 elsif p_action='revive' then
  if post.user_id<>actor then raise exception 'ADVICE_ADMIN';end if;
  update public.dream_posts set status='revived' where id=target;
 elsif p_action='report' then insert into public.dream_reports(post_id,user_id,reason) values(target,actor,trim(p_data->>'reason')) on conflict(post_id,user_id) do update set reason=excluded.reason,resolved=false;
 else raise exception 'ADVICE_ACTION';end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function private.dream_command(text,jsonb) from public,anon;grant execute on function private.dream_command(text,jsonb) to authenticated;
create function public.dream_command(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.dream_command(p_action,p_data);$$;
revoke all on function public.dream_command(text,jsonb) from public,anon;grant execute on function public.dream_command(text,jsonb) to authenticated;
commit;
