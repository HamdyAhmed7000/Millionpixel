begin;
-- District gates apply to new reservations. Previously accepted submissions retain their terms.
create or replace function private.canvas_approved_placements() returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(sum(c.spot_size*c.spot_size),0)::bigint from public.slot_claims c
 where c.status in('published','expired') and c.reviewed_at is not null
$$;
revoke all on function private.canvas_approved_placements() from public,anon,authenticated;
create or replace function private.canvas_district(p_slot integer) returns text
language sql immutable set search_path='' as $$
 select case when (p_slot-1)/1000<500 then case when (p_slot-1)%1000<500 then 'A' else 'B' end else case when (p_slot-1)%1000<500 then 'C' else 'D' end end
$$;
revoke all on function private.canvas_district(integer) from public,anon,authenticated;
create or replace function private.check_canvas_district() returns trigger
language plpgsql security definer set search_path='' as $$
declare progress bigint:=private.canvas_approved_placements(); zone text; required bigint; dx integer; dy integer;
begin
 for dy in 0..new.spot_size-1 loop for dx in 0..new.spot_size-1 loop
  zone:=private.canvas_district(new.slot_number+dy*1000+dx);
  required:=case zone when 'A' then 0 when 'B' then 50000 when 'C' then 100000 else 250000 end;
  if progress<required then raise exception 'District % unlocks at % approved tile placements. Choose a spot in an open district.',zone,required; end if;
 end loop; end loop;
 return new;
end $$;
revoke all on function private.check_canvas_district() from public,anon,authenticated;
drop trigger if exists a_check_canvas_district on public.slot_claims;
create trigger a_check_canvas_district before insert on public.slot_claims for each row execute function private.check_canvas_district();
-- Nine cells reserve and publish atomically using the existing review/payment pipeline.
alter table public.slot_claims drop constraint if exists slot_claims_spot_size_check;
alter table public.slot_claims add constraint slot_claims_spot_size_check check(spot_size in(1,2,3,4));
alter table public.published_slots drop constraint if exists published_slots_spot_size_check;
alter table public.published_slots add constraint published_slots_spot_size_check check(spot_size in(1,2,3,4));
create or replace function private.reserve_claim_cells() returns trigger
language plpgsql security definer set search_path='' as $$
declare anchor_col integer:=(new.slot_number-1)%1000; anchor_row integer:=(new.slot_number-1)/1000; dx integer; dy integer;
begin
 if new.spot_size not in(1,2,3,4) then raise exception 'Unsupported spot size'; end if;
 if anchor_col+new.spot_size>1000 or anchor_row+new.spot_size>1000 then raise exception 'This image does not fit at the edge of the canvas'; end if;
 for dy in 0..new.spot_size-1 loop for dx in 0..new.spot_size-1 loop
  insert into public.slot_claim_cells(slot_number,claim_id) values((anchor_row+dy)*1000+anchor_col+dx+1,new.id);
 end loop; end loop; return new;
end $$;
revoke all on function private.reserve_claim_cells() from public,anon,authenticated;

create table if not exists private.canvas_seasons(
 season date primary key, ends_at timestamptz not null, archived boolean not null default false, winner text, final_scores jsonb
);
create table if not exists private.canvas_zone_scores(
 season date not null references private.canvas_seasons(season), zone text not null check(zone in('A','B','C','D')),
 placements bigint not null default 0, opens bigint not null default 0, likes bigint not null default 0, primary key(season,zone)
);
create or replace function private.ensure_canvas_season() returns date
language plpgsql security definer set search_path='' as $$
declare month_start date:=date_trunc('month',now() at time zone 'UTC')::date; past record;
begin
 for past in select season from private.canvas_seasons where not archived and ends_at<=now() for update loop
  update private.canvas_seasons s set archived=true,
   winner=(select z.zone from private.canvas_zone_scores z where z.season=past.season and z.opens+z.likes*3>0 order by z.opens+z.likes*3 desc,z.placements desc,z.zone limit 1),
   final_scores=(select jsonb_agg(jsonb_build_object('zone',z.zone,'score',z.opens+z.likes*3,'placements',z.placements,'opens',z.opens,'likes',z.likes) order by z.zone) from private.canvas_zone_scores z where z.season=past.season)
  where s.season=past.season;
 end loop;
 insert into private.canvas_seasons(season,ends_at) values(month_start,(month_start+interval '1 month') at time zone 'UTC') on conflict do nothing;
 insert into private.canvas_zone_scores(season,zone) select month_start,unnest(array['A','B','C','D']) on conflict do nothing;
 return month_start;
end $$;
revoke all on function private.ensure_canvas_season() from public,anon,authenticated;
create or replace function private.score_canvas_season() returns trigger
language plpgsql security definer set search_path='' as $$
declare current_season date:=private.ensure_canvas_season(); slot integer; target_zone text;
begin
 if tg_table_name='slot_likes' then
  if date_trunc('month',case when tg_op='DELETE' then old.created_at else new.created_at end at time zone 'UTC')::date<>current_season then return null; end if;
  slot:=case when tg_op='DELETE' then old.slot_number else new.slot_number end; target_zone:=private.canvas_district(slot);
  update private.canvas_zone_scores set likes=greatest(0,likes+case when tg_op='DELETE' then -1 else 1 end) where season=current_season and canvas_zone_scores.zone=target_zone;
 elsif tg_table_name='spot_view_events' then
  if new.view_date<current_season then return null; end if;
  target_zone:=private.canvas_district(new.slot_number);
  update private.canvas_zone_scores set opens=opens+1 where season=current_season and canvas_zone_scores.zone=target_zone;
 else
  target_zone:=private.canvas_district(new.slot_number);
  update private.canvas_zone_scores set placements=placements+1 where season=current_season and canvas_zone_scores.zone=target_zone;
 end if;
 return null;
end $$;
revoke all on function private.score_canvas_season() from public,anon,authenticated;
-- Backfill only once from existing genuine activity; archived scores survive image expiry.
do $$ declare season_start date:=private.ensure_canvas_season(); begin
 if not exists(select 1 from private.canvas_zone_scores where season=season_start and (placements>0 or opens>0 or likes>0)) then
  update private.canvas_zone_scores z set
   placements=(select count(*) from public.published_slots p where p.published_at>=season_start::timestamp at time zone 'UTC' and private.canvas_district(p.slot_number)=z.zone),
   opens=(select count(*) from public.spot_view_events v where v.view_date>=season_start and private.canvas_district(v.slot_number)=z.zone),
   likes=(select count(*) from public.slot_likes l where l.created_at>=season_start::timestamp at time zone 'UTC' and private.canvas_district(l.slot_number)=z.zone)
  where season=season_start;
 end if;
end $$;
drop trigger if exists canvas_season_placements on public.published_slots;
create trigger canvas_season_placements after insert on public.published_slots for each row execute function private.score_canvas_season();
drop trigger if exists canvas_season_opens on public.spot_view_events;
create trigger canvas_season_opens after insert on public.spot_view_events for each row execute function private.score_canvas_season();
drop trigger if exists canvas_season_likes on public.slot_likes;
create trigger canvas_season_likes after insert or delete on public.slot_likes for each row execute function private.score_canvas_season();

create table if not exists private.canvas_explorer_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade, points bigint not null default 0,
 streak integer not null default 0, best_streak integer not null default 0, last_checkin date
);
create table if not exists private.canvas_explored(
 user_id uuid not null references auth.users(id) on delete cascade, slot integer not null references public.published_slots(slot_number) on delete cascade,
 primary key(user_id,slot)
);
create or replace function public.canvas_daily_checkin() returns void
language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'UTC')::date; prior private.canvas_explorer_profiles%rowtype; next_streak integer;
begin
 if auth.uid() is null then raise exception 'Sign in to check in'; end if;
 insert into private.canvas_explorer_profiles(user_id) values(auth.uid()) on conflict do nothing;
 select * into prior from private.canvas_explorer_profiles where user_id=auth.uid() for update;
 if prior.last_checkin=today then return; end if;
 next_streak:=case when prior.last_checkin=today-1 then prior.streak+1 else 1 end;
 update private.canvas_explorer_profiles set last_checkin=today,streak=next_streak,best_streak=greatest(best_streak,next_streak),points=points+5 where user_id=auth.uid();
end $$;
create or replace function public.record_canvas_exploration(p_slot integer) returns void
language plpgsql security definer set search_path='' as $$
declare anchor integer;
begin
 if auth.uid() is null then return; end if;
 select p.anchor_slot into anchor from public.published_slots p where p.slot_number=p_slot and p.expires_at>now();
 if anchor is null then return; end if;
 insert into private.canvas_explored(user_id,slot) values(auth.uid(),anchor) on conflict do nothing;
 if found then
  insert into private.canvas_explorer_profiles(user_id,points) values(auth.uid(),1)
  on conflict(user_id) do update set points=canvas_explorer_profiles.points+1;
 end if;
end $$;
create table if not exists private.canvas_riddle_steps(step integer primary key,slot integer not null,question text not null,answer_hash text not null);
insert into private.canvas_riddle_steps values
 (1,1,'At the origin, count the corners of a square. Spell the number.','8cbad96aced40b3838dd9f07f6ef5772'),
 (2,499500,'This canvas is 1,000 columns wide. Enter half its width in digits.','cee631121c2ec9232f3a2f028ad5c89b'),
 (3,777778,'Read this tile''s repeated zero-based coordinate as a three-digit lucky number.','f1c1592588411002af340cbaedd6fc33') on conflict do nothing;
create table if not exists private.canvas_riddle_progress(
 user_id uuid primary key references auth.users(id) on delete cascade, step integer not null default 1 check(step between 1 and 4),visited boolean not null default false,last_attempt timestamptz,completed_at timestamptz
);
create table if not exists private.canvas_riddle_winner(puzzle integer primary key check(puzzle=1),user_id uuid not null references auth.users(id) on delete cascade,won_at timestamptz not null default now());
create or replace function public.visit_canvas_riddle(p_slot integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to follow the puzzle trail'; end if;
 insert into private.canvas_riddle_progress(user_id) values(auth.uid()) on conflict do nothing;
 update private.canvas_riddle_progress p set visited=true where p.user_id=auth.uid() and exists(select 1 from private.canvas_riddle_steps r where r.step=p.step and r.slot=p_slot);
 return found;
end $$;
create or replace function public.answer_canvas_riddle(p_answer text) returns boolean
language plpgsql security definer set search_path='' as $$
declare progress private.canvas_riddle_progress%rowtype; answer text;
begin
 if auth.uid() is null then raise exception 'Sign in to solve the puzzle'; end if;
 select * into progress from private.canvas_riddle_progress where user_id=auth.uid() for update;
 if not found or not progress.visited or progress.step=4 then raise exception 'Visit your current clue on the map first'; end if;
 if progress.last_attempt>now()-interval '2 seconds' then raise exception 'Pause before trying another answer'; end if;
 update private.canvas_riddle_progress set last_attempt=now() where user_id=auth.uid();
 select answer_hash into answer from private.canvas_riddle_steps where step=progress.step;
 if p_answer is null or char_length(p_answer)>100 or md5(lower(trim(p_answer)))<>answer then return false; end if;
 update private.canvas_riddle_progress set step=step+1,visited=false,completed_at=case when step=3 then now() else null end where user_id=auth.uid();
 if progress.step=3 then
  insert into private.canvas_riddle_winner(puzzle,user_id) values(1,auth.uid()) on conflict do nothing;
  insert into private.canvas_explorer_profiles(user_id,points) values(auth.uid(),20) on conflict(user_id) do update set points=canvas_explorer_profiles.points+20;
 end if;
 return true;
end $$;
create table if not exists private.canvas_boss_campaigns(
 id integer primary key check(id=1),title text not null,starts_at timestamptz not null default now(),ends_at timestamptz not null default now()+interval '7 days',col_start integer not null default 200,row_start integer not null default 200,size integer not null default 100
);
insert into private.canvas_boss_campaigns(id,title) values(1,'The first community mosaic') on conflict do nothing;
do $$ declare table_name text; begin
 foreach table_name in array array['canvas_seasons','canvas_zone_scores','canvas_explorer_profiles','canvas_explored','canvas_riddle_steps','canvas_riddle_progress','canvas_riddle_winner','canvas_boss_campaigns'] loop
  execute format('alter table private.%I enable row level security',table_name);
  execute format('revoke all on private.%I from public,anon,authenticated',table_name);
 end loop;
end $$;
create or replace function public.get_canvas_expeditions() returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_season date:=private.ensure_canvas_season(); progress bigint:=private.canvas_approved_placements(); result jsonb;
begin
 select jsonb_build_object(
  'approved_placements',progress,'server_time',now(),
  'districts',(select jsonb_agg(jsonb_build_object('zone',d.zone,'required',d.required,'open',progress>=d.required)) from (values('A',0),('B',50000),('C',100000),('D',250000)) d(zone,required)),
  'season',jsonb_build_object('start',current_season,'ends_at',(select ends_at from private.canvas_seasons where season=current_season),'scores',(select jsonb_agg(jsonb_build_object('zone',z.zone,'score',z.opens+z.likes*3,'placements',z.placements,'opens',z.opens,'likes',z.likes) order by z.opens+z.likes*3 desc,z.zone) from private.canvas_zone_scores z where z.season=current_season)),
  'hall',coalesce((select jsonb_agg(to_jsonb(h)) from (select season,winner,final_scores from private.canvas_seasons where archived order by season desc limit 24) h),'[]'::jsonb),
  'explorer',coalesce((select jsonb_build_object('points',p.points,'streak',case when p.last_checkin>=(now() at time zone 'UTC')::date-1 then p.streak else 0 end,'best_streak',p.best_streak,'checked_in',p.last_checkin=(now() at time zone 'UTC')::date) from private.canvas_explorer_profiles p where p.user_id=auth.uid()),jsonb_build_object('points',0,'streak',0,'best_streak',0,'checked_in',false)),
  'riddle',(select jsonb_build_object('step',coalesce(p.step,1),'visited',coalesce(p.visited,false),'slot',r.slot,'question',case when p.visited then r.question else null end,'completed',coalesce(p.step=4,false)) from (values(1)) dummy(n) left join private.canvas_riddle_progress p on p.user_id=auth.uid() left join private.canvas_riddle_steps r on r.step=coalesce(p.step,1)),
  'riddle_winner',(select jsonb_build_object('won_at',w.won_at,'name',coalesce(p.display_name,'A canvas explorer'),'slot',p.slot_number) from private.canvas_riddle_winner w left join lateral(select ps.display_name,ps.slot_number from public.published_slots ps join public.slot_claim_cells cells on cells.slot_number=ps.slot_number join public.slot_claims c on c.id=cells.claim_id where c.user_id=w.user_id and ps.slot_number=ps.anchor_slot and ps.expires_at>now() order by ps.published_at limit 1) p on true where w.puzzle=1),
  'boss',(select jsonb_build_object('title',b.title,'starts_at',b.starts_at,'ends_at',b.ends_at,'col',b.col_start,'row',b.row_start,'size',b.size,'goal',b.size*b.size,'progress',(select count(distinct ((c.slot_number-1)/1000+dy.n)*1000+((c.slot_number-1)%1000+dx.n)+1) from public.slot_claims c cross join lateral generate_series(0,c.spot_size-1) dx(n) cross join lateral generate_series(0,c.spot_size-1) dy(n) where c.status in('published','expired') and c.reviewed_at>=b.starts_at and c.reviewed_at<=b.ends_at and (c.slot_number-1)%1000+dx.n between b.col_start and b.col_start+b.size-1 and (c.slot_number-1)/1000+dy.n between b.row_start and b.row_start+b.size-1)) from private.canvas_boss_campaigns b where id=1)
 ) into result; return result;
end $$;
revoke all on function public.canvas_daily_checkin(),public.record_canvas_exploration(integer),public.visit_canvas_riddle(integer),public.answer_canvas_riddle(text),public.get_canvas_expeditions() from public,anon,authenticated;
grant execute on function public.get_canvas_expeditions() to anon,authenticated;
grant execute on function public.canvas_daily_checkin(),public.record_canvas_exploration(integer),public.visit_canvas_riddle(integer),public.answer_canvas_riddle(text) to authenticated;
commit;
