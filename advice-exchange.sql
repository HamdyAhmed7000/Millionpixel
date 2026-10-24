-- Additive staging feature. Does not change canvas tables, payments, auth or storage.
begin;
create schema if not exists private;
create table public.advice_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 handle text not null check(char_length(handle) between 3 and 30 and handle ~ '^[a-zA-Z0-9_]+$'),
 joined_at timestamptz not null default now(), suspended boolean not null default false,
 last_action_at timestamptz, last_visit date, streak integer not null default 0
);
create unique index advice_handles_unique on public.advice_profiles(lower(handle));
create table public.advice_posts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.advice_profiles(user_id),
 title text not null check(char_length(trim(title)) between 3 and 100),
 body text not null check(char_length(trim(body)) between 5 and 280),
 category text not null check(category in ('useful','funny','both')),
 language text not null check(language in ('ar','en')), tags text[] not null default '{}',
 search_text text generated always as (lower(translate(regexp_replace(title||' '||body,'[ً-ٰٟـ]','','g'),'أإآى','اااي'))) stored,
 status text not null default 'pending' check(status in ('pending','published','rejected','removed')),
 created_at timestamptz not null default now(), published_at timestamptz,
 upvotes integer not null default 0 check(upvotes>=0), downvotes integer not null default 0 check(downvotes>=0),
 price integer generated always as (greatest(1,100+10*upvotes-10*downvotes)) stored,
 check(cardinality(tags)<=3)
);
create index advice_posts_market on public.advice_posts(status,price desc,id);
create index advice_posts_author on public.advice_posts(user_id,created_at desc);
create index advice_posts_new on public.advice_posts(status,published_at desc,id);
create table public.advice_votes (
 post_id uuid references public.advice_posts(id) on delete cascade,
 user_id uuid references public.advice_profiles(user_id) on delete cascade,
 value smallint not null check(value in (-1,1)), updated_at timestamptz not null default now(),
 primary key(post_id,user_id)
);
create index advice_votes_user on public.advice_votes(user_id);
create table public.advice_price_snapshots (
 id bigint generated always as identity primary key, post_id uuid not null references public.advice_posts(id) on delete cascade,
 price integer not null, recorded_at timestamptz not null default clock_timestamp()
);
create index advice_snapshots_post on public.advice_price_snapshots(post_id,recorded_at desc);
create table public.advice_bookmarks (
 post_id uuid references public.advice_posts(id) on delete cascade,
 user_id uuid references public.advice_profiles(user_id) on delete cascade,
 created_at timestamptz not null default now(), primary key(post_id,user_id)
);
create index advice_bookmarks_user on public.advice_bookmarks(user_id);
create table public.advice_reports (
 id uuid primary key default gen_random_uuid(), post_id uuid not null references public.advice_posts(id),
 user_id uuid not null references public.advice_profiles(user_id), reason text not null check(char_length(reason) between 5 and 500),
 resolved boolean not null default false, created_at timestamptz not null default now(), unique(post_id,user_id)
);
create table public.advice_contests (
 id uuid primary key default gen_random_uuid(), title_en text not null, title_ar text not null,
 sponsor text not null, prize_en text not null, prize_ar text not null,
 rules_en text not null, rules_ar text not null,
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 status text not null default 'draft' check(status in ('draft','active','closed')),
 winner_post_id uuid references public.advice_posts(id),
 check(status='draft' or (char_length(sponsor)>1 and char_length(rules_en)>20 and char_length(rules_ar)>20))
);
create table private.advice_audit (
 id bigint generated always as identity primary key, actor uuid, action text not null,
 details jsonb not null, created_at timestamptz not null default now()
);
alter table public.advice_profiles enable row level security;
alter table public.advice_posts enable row level security;
alter table public.advice_votes enable row level security;
alter table public.advice_price_snapshots enable row level security;
alter table public.advice_bookmarks enable row level security;
alter table public.advice_reports enable row level security;
alter table public.advice_contests enable row level security;
alter table private.advice_audit enable row level security;
revoke all on public.advice_profiles,public.advice_posts,public.advice_votes,public.advice_price_snapshots,public.advice_bookmarks,public.advice_reports,public.advice_contests,private.advice_audit from public,anon,authenticated;
grant select on public.advice_profiles,public.advice_posts,public.advice_price_snapshots,public.advice_contests to anon,authenticated;
grant select on public.advice_votes,public.advice_bookmarks,public.advice_reports to authenticated;
-- Used only by policies; no anonymous access to the private schema is granted.
create function private.advice_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where user_id=auth.uid() and is_admin);
$$;
revoke all on function private.advice_admin() from public;
grant execute on function private.advice_admin() to anon,authenticated;
create policy advice_public_profiles on public.advice_profiles for select to anon,authenticated using (
 user_id=(select auth.uid()) or exists(select 1 from public.advice_posts p where p.user_id=advice_profiles.user_id and p.status='published') or (select private.advice_admin())
);
create policy advice_read_posts on public.advice_posts for select to anon,authenticated using(status='published' or user_id=(select auth.uid()) or (select private.advice_admin()));
create policy advice_read_snapshots on public.advice_price_snapshots for select to anon,authenticated using(exists(select 1 from public.advice_posts p where p.id=post_id and p.status='published'));
create policy advice_own_votes on public.advice_votes for select to authenticated using(user_id=(select auth.uid()));
create policy advice_own_bookmarks on public.advice_bookmarks for select to authenticated using(user_id=(select auth.uid()));
create policy advice_read_reports on public.advice_reports for select to authenticated using(user_id=(select auth.uid()) or (select private.advice_admin()));
create policy advice_public_contests on public.advice_contests for select to anon,authenticated using(status<>'draft' or (select private.advice_admin()));

-- Trigger is privileged solely to maintain derived totals; clients cannot write votes directly.
create function private.advice_reprice() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; next_price integer;
begin
 target:=coalesce(new.post_id,old.post_id);
 perform 1 from public.advice_posts where id=target for update;
 update public.advice_posts set upvotes=(select count(*) from public.advice_votes where post_id=target and value=1),
 downvotes=(select count(*) from public.advice_votes where post_id=target and value=-1) where id=target returning price into next_price;
 if next_price is not null then insert into public.advice_price_snapshots(post_id,price) values(target,next_price); end if;
 return null;
end $$;
revoke all on function private.advice_reprice() from public,anon,authenticated;
create trigger advice_vote_totals after insert or update or delete on public.advice_votes for each row execute function private.advice_reprice();

create function private.advice_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; me public.advice_profiles; post public.advice_posts;
 handle_value text; new_id uuid; direction integer; result jsonb; decision text;
begin
 if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'ADVICE_SIGN_IN'; end if;
 select * into me from public.advice_profiles where user_id=actor for update;
 if me.suspended then raise exception 'ADVICE_SUSPENDED'; end if;
 if p_action='profile' then
   handle_value:=trim(p_data->>'handle');
   if handle_value is null or handle_value !~ '^[a-zA-Z0-9_]{3,30}$' then raise exception 'ADVICE_HANDLE'; end if;
   insert into public.advice_profiles(user_id,handle) values(actor,handle_value) on conflict(user_id) do update set handle=excluded.handle;
   return jsonb_build_object('ok',true);
 end if;
 if me.user_id is null then raise exception 'ADVICE_PROFILE'; end if;
 if p_action='visit' then
   update public.advice_profiles set streak=case when last_visit=current_date then streak when last_visit=current_date-1 then streak+1 else 1 end,last_visit=current_date where user_id=actor;
   return jsonb_build_object('ok',true);
 end if;
 if me.last_action_at>clock_timestamp()-interval '1 second' then raise exception 'ADVICE_SLOW_DOWN'; end if;
 update public.advice_profiles set last_action_at=clock_timestamp() where user_id=actor;
 if p_action='submit' then
   if exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'tags','[]')) tag where char_length(trim(tag)) not between 1 and 24) then raise exception 'ADVICE_TAGS'; end if;
   if (select count(*) from public.advice_posts where user_id=actor and created_at>now()-interval '1 day')>=10 then raise exception 'ADVICE_DAILY_LIMIT'; end if;
   if exists(select 1 from public.advice_posts where user_id=actor and lower(trim(body))=lower(trim(p_data->>'body'))) then raise exception 'ADVICE_DUPLICATE'; end if;
   insert into public.advice_posts(user_id,title,body,category,language,tags)
   values(actor,trim(p_data->>'title'),trim(p_data->>'body'),p_data->>'category',p_data->>'language',array(select trim(x) from jsonb_array_elements_text(coalesce(p_data->'tags','[]')) x)) returning id into new_id;
   return jsonb_build_object('id',new_id);
 end if;
 if p_action='resolve' then
   if not private.advice_admin() then raise exception 'ADVICE_ADMIN'; end if;
   update public.advice_reports set resolved=true where id=(p_data->>'id')::uuid;
 elsif p_action='suspend' then
   if not private.advice_admin() then raise exception 'ADVICE_ADMIN'; end if;
   target:=(p_data->>'id')::uuid;
   if target=actor then raise exception 'ADVICE_SELF'; end if;
   perform 1 from public.advice_profiles where user_id=target for update;
   update public.advice_profiles set suspended=true where user_id=target;
   update public.advice_posts set status='removed' where user_id=target;
   -- Stable lock order prevents concurrent suspension deadlocks.
   perform 1 from public.advice_posts where id in(select post_id from public.advice_votes where user_id=target) order by id for update;
   delete from public.advice_votes where user_id=target;
 else
   target:=(p_data->>'id')::uuid;
   select * into post from public.advice_posts where id=target for update;
   if post.id is null then raise exception 'ADVICE_NOT_FOUND'; end if;
   if p_action='review' then
     if not private.advice_admin() then raise exception 'ADVICE_ADMIN'; end if;
     decision:=p_data->>'status';
     if decision not in ('published','rejected','removed') or char_length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'ADVICE_REASON'; end if;
     if decision='published' and post.status<>'pending' then raise exception 'ADVICE_NOT_PENDING'; end if;
     update public.advice_posts set status=decision,published_at=case when decision='published' then now() else published_at end where id=target;
     if decision='published' then insert into public.advice_price_snapshots(post_id,price) values(target,post.price); end if;
   else
     if post.status<>'published' then raise exception 'ADVICE_NOT_FOUND'; end if;
     if p_action='vote' then
       if post.user_id=actor then raise exception 'ADVICE_SELF'; end if;
       direction:=(p_data->>'value')::integer;
       if direction not in (-1,0,1) or direction is null then raise exception 'ADVICE_VOTE'; end if;
       if direction=0 then delete from public.advice_votes where post_id=target and user_id=actor;
       else insert into public.advice_votes(post_id,user_id,value) values(target,actor,direction)
        on conflict(post_id,user_id) do update set value=excluded.value,updated_at=now() where advice_votes.value<>excluded.value; end if;
     elsif p_action='bookmark' then
       if exists(select 1 from public.advice_bookmarks where post_id=target and user_id=actor) then delete from public.advice_bookmarks where post_id=target and user_id=actor;
       else insert into public.advice_bookmarks(post_id,user_id) values(target,actor); end if;
     elsif p_action='report' then
       insert into public.advice_reports(post_id,user_id,reason) values(target,actor,trim(p_data->>'reason')) on conflict(post_id,user_id) do update set reason=excluded.reason,resolved=false;
     else raise exception 'ADVICE_ACTION'; end if;
   end if;
 end if;
 if p_action in ('review','suspend','resolve') then insert into private.advice_audit(actor,action,details) values(actor,p_action,p_data); end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.advice_command(text,jsonb) from public,anon;
grant execute on function private.advice_command(text,jsonb) to authenticated;
create function public.advice_command(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.advice_command(p_action,p_data);$$;
revoke all on function public.advice_command(text,jsonb) from public,anon;
grant execute on function public.advice_command(text,jsonb) to authenticated;
-- Bounded aggregate endpoint: no email addresses or vote identities are exposed.
create function public.advice_leaderboard() returns table(user_id uuid,handle text,valuation bigint,posts bigint,upvotes bigint)
language sql stable security invoker set search_path='' as $$
 select p.user_id,a.handle,sum(p.price)::bigint,count(*)::bigint,sum(p.upvotes)::bigint
 from public.advice_posts p join public.advice_profiles a on a.user_id=p.user_id
 where p.status='published' group by p.user_id,a.handle order by sum(p.price) desc,p.user_id limit 50;
$$;
revoke all on function public.advice_leaderboard() from public;
grant execute on function public.advice_leaderboard() to anon,authenticated;
create view public.advice_market with(security_invoker=true) as
 select p.*,a.handle,
 p.price-coalesce((select s.price from public.advice_price_snapshots s where s.post_id=p.id and s.recorded_at<=now()-interval '24 hours' order by s.recorded_at desc,s.id desc limit 1),100) as day_change,
 p.price-coalesce((select s.price from public.advice_price_snapshots s where s.post_id=p.id and s.recorded_at<=now()-interval '7 days' order by s.recorded_at desc,s.id desc limit 1),100) as week_change
 from public.advice_posts p join public.advice_profiles a on a.user_id=p.user_id where p.status='published';
revoke all on public.advice_market from public,anon,authenticated;
grant select on public.advice_market to anon,authenticated;
commit;
