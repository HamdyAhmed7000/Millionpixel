-- Community games use cosmetic rewards. Existing payment and expiry rules remain in force.
begin;
create table if not exists public.canvas_guilds (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 3 and 40), description text not null default '' check(char_length(description)<=200),
 status text not null default 'pending' check(status in ('pending','approved','rejected')), created_at timestamptz not null default now(), unique(owner_id)
);
create unique index if not exists canvas_guild_names on public.canvas_guilds(lower(name));
create table if not exists public.canvas_guild_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 guild_id uuid not null references public.canvas_guilds(id) on delete cascade, joined_at timestamptz not null default now()
);
create index if not exists canvas_guild_members_guild_idx on public.canvas_guild_members(guild_id);
create table if not exists public.canvas_interactions (
 slot_number integer not null references public.published_slots(slot_number) on delete cascade,
 visitor_id uuid not null, kind text not null check(kind in ('click','hover')),
 event_date date not null default ((now() at time zone 'UTC')::date), created_at timestamptz not null default now(),
 primary key(slot_number,visitor_id,kind,event_date)
);
create index if not exists canvas_interactions_date on public.canvas_interactions(event_date,slot_number);
create table if not exists public.canvas_battle_votes (
 round_date date not null default ((now() at time zone 'UTC')::date), user_id uuid not null references auth.users(id) on delete cascade,
 slot_number integer not null references public.published_slots(slot_number) on delete cascade, created_at timestamptz not null default now(), primary key(round_date,user_id)
);
create table if not exists private.canvas_hunts (
 hunt_date date primary key, slots integer[] not null
);
create table if not exists public.canvas_hunt_finds (
 user_id uuid not null references auth.users(id) on delete cascade, hunt_date date not null, slot_number integer not null,
 created_at timestamptz not null default now(), primary key(user_id,hunt_date,slot_number)
);
alter table public.canvas_guilds enable row level security;
alter table public.canvas_guild_members enable row level security;
alter table public.canvas_interactions enable row level security;
alter table public.canvas_battle_votes enable row level security;
alter table public.canvas_hunt_finds enable row level security;
alter table private.canvas_hunts enable row level security;
revoke all on public.canvas_guilds, public.canvas_guild_members, public.canvas_interactions, public.canvas_battle_votes, public.canvas_hunt_finds, private.canvas_hunts from public,anon,authenticated;

create or replace function public.create_canvas_guild(p_name text,p_description text default '') returns void
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to create a guild'; end if;
 insert into public.canvas_guilds(owner_id,name,description) values(auth.uid(),trim(p_name),trim(p_description)) returning id into new_id;
 insert into public.canvas_guild_members(user_id,guild_id) values(auth.uid(),new_id)
 on conflict(user_id) do update set guild_id=excluded.guild_id,joined_at=now();
end $$;
create or replace function public.join_canvas_guild(p_guild_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to join a guild'; end if;
 if p_guild_id is null then delete from public.canvas_guild_members where user_id=auth.uid(); return; end if;
 if not exists(select 1 from public.canvas_guilds where id=p_guild_id and status='approved') then raise exception 'This guild is not available'; end if;
 insert into public.canvas_guild_members(user_id,guild_id) values(auth.uid(),p_guild_id)
 on conflict(user_id) do update set guild_id=excluded.guild_id,joined_at=now();
end $$;
create or replace function public.review_canvas_guild(p_guild_id uuid,p_approve boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Reviewer access required'; end if;
 update public.canvas_guilds set status=case when p_approve then 'approved' else 'rejected' end where id=p_guild_id and status='pending';
end $$;
create or replace function public.record_canvas_interaction(p_slot integer,p_visitor uuid,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare anchor integer;
begin
 if p_visitor is null or p_kind not in ('click','hover') then return; end if;
 select anchor_slot into anchor from public.published_slots where slot_number=p_slot and expires_at>now();
 if anchor is null then return; end if;
 insert into public.canvas_interactions(slot_number,visitor_id,kind) values(anchor,p_visitor,p_kind) on conflict do nothing;
end $$;
create table if not exists private.canvas_battle_rounds(round_date date primary key, slots integer[] not null);
alter table private.canvas_battle_rounds enable row level security;
revoke all on private.canvas_battle_rounds from public,anon,authenticated;
create or replace function private.canvas_battle_candidates(p_day date) returns setof integer
language plpgsql security definer set search_path='' as $$
declare candidates integer[];
begin
 select slots into candidates from private.canvas_battle_rounds where round_date=p_day;
 if candidates is null then
  candidates:=array(select p.slot_number from public.published_slots p where p.slot_number=p.anchor_slot and p.expires_at>now() order by md5(p.slot_number::text||p_day::text) limit 2);
  if cardinality(candidates)=2 then
   insert into private.canvas_battle_rounds(round_date,slots) values(p_day,candidates) on conflict do nothing;
   select slots into candidates from private.canvas_battle_rounds where round_date=p_day;
  end if;
 end if;
 return query select p.slot_number from public.published_slots p where p.slot_number=any(candidates) and p.expires_at>now() order by p.slot_number;
end $$;
revoke all on function private.canvas_battle_candidates(date) from public,anon,authenticated;
create or replace function public.vote_canvas_battle(p_slot integer) returns void
language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'UTC')::date;
begin
 if auth.uid() is null then raise exception 'Sign in to vote'; end if;
 if (select count(*) from private.canvas_battle_candidates(today))<2 or p_slot not in(select private.canvas_battle_candidates(today)) then raise exception 'This image is not in today''s battle'; end if;
 if exists(select 1 from public.slot_claims where user_id=auth.uid() and slot_number=p_slot and status='published' and expires_at>now()) then raise exception 'Choose a photo other than your own'; end if;
 insert into public.canvas_battle_votes(round_date,user_id,slot_number) values(today,auth.uid(),p_slot)
 on conflict(round_date,user_id) do update set slot_number=excluded.slot_number,created_at=now();
end $$;
create or replace function private.ensure_canvas_hunt() returns integer[]
language plpgsql security definer set search_path='' as $$
declare result integer[]; today date := (now() at time zone 'UTC')::date;
begin
 insert into private.canvas_hunts(hunt_date,slots)
 select today,array(select distinct (floor(random()*1000000)+1)::integer from generate_series(1,12) limit 3)
 on conflict(hunt_date) do nothing;
 select slots into result from private.canvas_hunts where hunt_date=today; return result;
end $$;
revoke all on function private.ensure_canvas_hunt() from public,anon,authenticated;
create table if not exists private.canvas_hunt_attempts(user_id uuid not null references auth.users(id) on delete cascade, hunt_date date not null, attempts integer not null default 0, last_attempt timestamptz, primary key(user_id,hunt_date));
alter table private.canvas_hunt_attempts enable row level security;
revoke all on private.canvas_hunt_attempts from public,anon,authenticated;
create or replace function public.find_canvas_golden_pixel(p_slot integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to collect golden pixels'; end if;
 if p_slot is null or p_slot not between 1 and 1000000 then raise exception 'Choose a valid pixel'; end if;
 if exists(select 1 from public.canvas_hunt_finds where user_id=auth.uid() and hunt_date=(now() at time zone 'UTC')::date and slot_number=p_slot) then return true; end if;
 insert into private.canvas_hunt_attempts(user_id,hunt_date,attempts,last_attempt) values(auth.uid(),(now() at time zone 'UTC')::date,1,now())
 on conflict(user_id,hunt_date) do update set attempts=canvas_hunt_attempts.attempts+1,last_attempt=now()
 where canvas_hunt_attempts.attempts<300 and (canvas_hunt_attempts.last_attempt is null or canvas_hunt_attempts.last_attempt<now()-interval '400 milliseconds');
 if not found then raise exception 'Pause between searches. Each account has up to 300 searches per UTC day.'; end if;
 if p_slot=any(private.ensure_canvas_hunt()) then
  insert into public.canvas_hunt_finds(user_id,hunt_date,slot_number) values(auth.uid(),(now() at time zone 'UTC')::date,p_slot) on conflict do nothing;
  return true;
 end if;
 return false;
end $$;

create or replace function public.get_canvas_games() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; today date := (now() at time zone 'UTC')::date; hunt integer[]; winner integer;
begin
 hunt:=private.ensure_canvas_hunt();
 -- Yesterday's unique, non-tied winner receives today's cosmetic champion border.
 select v.slot_number into winner from public.canvas_battle_votes v join public.published_slots p on p.slot_number=v.slot_number and p.expires_at>now()
 where v.round_date=today-1 group by v.slot_number having count(*)>=2 and count(*)>(select count(*) from public.canvas_battle_votes other where other.round_date=today-1 and other.slot_number<>v.slot_number)
 order by count(*) desc limit 1;
 with active as (
  select p.*,c.user_id from public.published_slots p join public.slot_claim_cells cells on cells.slot_number=p.slot_number
  join public.slot_claims c on c.id=cells.claim_id where p.expires_at>now() and c.status='published'
 ), user_stats as (
  select a.user_id,min(a.anchor_slot) as spot,min(a.display_name) as name,count(*) as area,
  bool_or(a.col_index between 450 and 549 and a.row_index between 450 and 549) as center_pioneer,
  bool_or(a.spot_size*a.spot_size>=10) as art_director
  from active a group by a.user_id
 ), views as (
  select a.user_id,count(*) filter(where v.view_date>=today-6) as weekly_clicks,count(*) as total_clicks
  from active a join public.spot_view_events v on v.slot_number=a.slot_number group by a.user_id
 ), engagements as (
  select a.user_id,count(*) as weekly_interactions from active a join public.canvas_interactions i on i.slot_number=a.slot_number where i.event_date>=today-6 and i.kind='hover' group by a.user_id
 ), first_claims as (
  select c.user_id,min(c.reviewed_at) as first_at from public.slot_claims c where c.reviewed_at is not null and c.status in('published','expired') group by c.user_id
 ), pioneer_users as (
  select f.*,row_number() over(order by f.first_at,f.user_id) as pioneer_number from first_claims f
  where f.first_at < (select min(first_at) from first_claims)+interval '7 days'
 ), people as (
  select u.*,exists(select 1 from active a join public.spot_view_events sv on sv.slot_number=a.slot_number where a.user_id=u.user_id group by a.slot_number having count(*)>=1000) as viral_spot,(coalesce(e.weekly_interactions,0)+coalesce(v.weekly_clicks,0)) as weekly_interactions,coalesce(v.weekly_clicks,0) as weekly_clicks,coalesce(v.total_clicks,0) as total_clicks,
  case when pu.pioneer_number<=100 then pu.pioneer_number else null end as pioneer_number,
  exists(select 1 from public.canvas_hunt_finds f where f.user_id=u.user_id) as golden_explorer
  from user_stats u left join engagements e on e.user_id=u.user_id left join views v on v.user_id=u.user_id left join pioneer_users pu on pu.user_id=u.user_id
 ), guild_stats as (
  select g.id,g.name,g.description,g.status,
   (select count(*) from public.canvas_guild_members m where m.guild_id=g.id) as members,
   (select count(*) from active a join public.canvas_guild_members m on m.user_id=a.user_id where m.guild_id=g.id) as area
  from public.canvas_guilds g where g.status='approved' or g.owner_id=auth.uid() or private.is_admin()
 )
 select jsonb_build_object(
  'today',today,'champion',winner,'champion_until',((today+1)::timestamp at time zone 'UTC'),
  'guilds',coalesce((select jsonb_agg(to_jsonb(g) order by g.area desc,g.name) from (select * from guild_stats order by area desc,name limit 100) g),'[]'::jsonb),
  'my_guild',(select guild_id from public.canvas_guild_members where user_id=auth.uid()),
  'people',coalesce((select jsonb_agg(jsonb_build_object('spot',p.spot,'name',p.name,'area',p.area,'weekly_interactions',p.weekly_interactions,'weekly_clicks',p.weekly_clicks,'viral_spot',p.viral_spot,'total_clicks',p.total_clicks,'pioneer_number',p.pioneer_number,'center_pioneer',p.center_pioneer,'art_director',p.art_director,'golden_explorer',p.golden_explorer,'level',1+floor(sqrt(p.area+ p.total_clicks/100.0)))) from (select * from people order by weekly_interactions desc,area desc limit 100) p),'[]'::jsonb),
  'empires',coalesce((select jsonb_agg(jsonb_build_object('spot',p.spot,'name',p.name,'area',p.area,'pioneer_number',p.pioneer_number,'level',1+floor(sqrt(p.area+p.total_clicks/100.0)))) from (select * from people order by area desc,spot limit 100) p),'[]'::jsonb),
  'pioneers',coalesce((select jsonb_agg(jsonb_build_object('spot',p.spot,'name',p.name,'area',p.area,'pioneer_number',p.pioneer_number,'level',1+floor(sqrt(p.area+p.total_clicks/100.0)))) from (select * from people where pioneer_number is not null order by pioneer_number limit 100) p),'[]'::jsonb),
  'decorations',coalesce((select jsonb_agg(jsonb_build_object('slot',a.slot_number,'golden_explorer',p.golden_explorer,'center_pioneer',p.center_pioneer,'art_director',p.art_director,'pioneer_number',p.pioneer_number,'viral_spot',p.viral_spot,'total_clicks',p.total_clicks)) from (select * from active where slot_number=anchor_slot order by slot_number limit 1000) a join people p on p.user_id=a.user_id),'[]'::jsonb),
  'my_achievements',coalesce((select jsonb_build_object('area',p.area,'viral_spot',p.viral_spot,'total_clicks',p.total_clicks,'pioneer_number',p.pioneer_number,'center_pioneer',p.center_pioneer,'art_director',p.art_director,'golden_explorer',p.golden_explorer,'level',1+floor(sqrt(p.area+p.total_clicks/100.0))) from people p where p.user_id=auth.uid()),jsonb_build_object('level',1,'golden_explorer',exists(select 1 from public.canvas_hunt_finds f where f.user_id=auth.uid()))),
  'battle',coalesce((select jsonb_agg(jsonb_build_object('slot',p.slot_number,'name',p.display_name,'image_path',p.image_path,'votes',(select count(*) from public.canvas_battle_votes v where v.round_date=today and v.slot_number=p.slot_number))) from public.published_slots p where p.slot_number in(select private.canvas_battle_candidates(today))),'[]'::jsonb),
  'my_vote',(select slot_number from public.canvas_battle_votes where user_id=auth.uid() and round_date=today),
  'hunt', (select jsonb_agg(jsonb_build_object('column',(((n-1)%1000)/10)*10+1,'row',(((n-1)/1000)/10)*10+1,'found',exists(select 1 from public.canvas_hunt_finds f where f.user_id=auth.uid() and f.hunt_date=today and f.slot_number=n))) from unnest(hunt) n),
  'golden_finds',(select count(*) from public.canvas_hunt_finds where user_id=auth.uid()),
  'heatmap',coalesce((select jsonb_agg(to_jsonb(h)) from (select i.slot_number as slot,count(*) as interactions from public.canvas_interactions i join public.published_slots p on p.slot_number=i.slot_number and p.expires_at>now() where i.event_date>=today-6 group by i.slot_number order by count(*) desc limit 250) h),'[]'::jsonb),
  'territory',coalesce((select jsonb_agg(to_jsonb(t)) from (select a.slot_number as slot,m.guild_id from active a join public.canvas_guild_members m on m.user_id=a.user_id join public.canvas_guilds g on g.id=m.guild_id and g.status='approved' order by a.slot_number limit 10000) t),'[]'::jsonb),
  'landmark_crown',(select jsonb_build_object('slot',p.slot_number,'name',p.display_name,'views',count(v.*)) from public.published_slots p join public.spot_view_events v on v.slot_number=p.slot_number and v.view_date>=date_trunc('month',now())::date where p.slot_number in(1,1000,999001,1000000,499500,499501,500500,500501,777778) and p.expires_at>now() group by p.slot_number,p.display_name order by count(v.*) desc,p.slot_number limit 1)
 ) into result;
 return result;
end $$;
revoke all on function public.create_canvas_guild(text,text),public.join_canvas_guild(uuid),public.review_canvas_guild(uuid,boolean),public.record_canvas_interaction(integer,uuid,text),public.vote_canvas_battle(integer),public.find_canvas_golden_pixel(integer),public.get_canvas_games() from public,anon,authenticated;
grant execute on function public.get_canvas_games(),public.record_canvas_interaction(integer,uuid,text) to anon,authenticated;
grant execute on function public.create_canvas_guild(text,text),public.join_canvas_guild(uuid),public.review_canvas_guild(uuid,boolean),public.vote_canvas_battle(integer),public.find_canvas_golden_pixel(integer) to authenticated;
commit;
