-- Public discovery tools: searchable tags, daily unique spot views, and a
-- privacy-safe aggregate for activity and leaderboard cards.
alter table public.slot_claims
  add column if not exists tags text not null default ''
    check (char_length(tags) <= 160);
alter table public.published_slots
  add column if not exists tags text not null default ''
    check (char_length(tags) <= 160);

grant insert (tags) on public.slot_claims to authenticated;

create table if not exists public.spot_view_events (
  slot_number integer not null references public.published_slots (slot_number) on delete cascade,
  visitor_id uuid not null,
  view_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (slot_number, visitor_id, view_date)
);
create index if not exists spot_view_events_slot_date_idx
  on public.spot_view_events (slot_number, view_date desc);
alter table public.spot_view_events enable row level security;
revoke all on public.spot_view_events from public, anon, authenticated;

create or replace function public.record_public_spot_view(p_slot_number integer, p_visitor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  anchor integer;
begin
  select coalesce(p.anchor_slot, p.slot_number) into anchor
  from public.published_slots p
  where p.slot_number = p_slot_number and p.expires_at > now()
  limit 1;
  if anchor is null or p_visitor_id is null then return; end if;
  insert into public.spot_view_events (slot_number, visitor_id)
  values (anchor, p_visitor_id)
  on conflict do nothing;
end;
$$;
revoke all on function public.record_public_spot_view(integer, uuid) from public;
grant execute on function public.record_public_spot_view(integer, uuid) to anon, authenticated;

create or replace function public.get_spot_discovery_leaderboard()
returns table (
  leader_type text,
  anchor_slot integer,
  display_name text,
  published_at timestamptz,
  tags text,
  like_count bigint,
  view_count bigint,
  spot_count bigint
)
language sql stable security definer set search_path = '' as $$
  with active as (
    select p.slot_number, p.display_name, p.published_at, p.tags,
      coalesce(l.like_count, 0)::bigint as like_count,
      coalesce(v.view_count, 0)::bigint as view_count
    from public.published_slots p
    left join (select slot_number, count(*)::bigint as like_count from public.slot_likes group by slot_number) l
      on l.slot_number = p.slot_number
    left join (select slot_number, count(*)::bigint as view_count from public.spot_view_events group by slot_number) v
      on v.slot_number = p.slot_number
    where p.slot_number = coalesce(p.anchor_slot, p.slot_number) and p.expires_at > now()
  ), hotspots as (
    select * from active order by view_count desc, like_count desc, published_at desc limit 8
  ), creators as (
    select display_name, count(*)::bigint as spot_count, sum(like_count)::bigint as like_count,
      sum(view_count)::bigint as view_count
    from active group by display_name order by sum(like_count) desc, count(*) desc, max(published_at) desc limit 8
  )
  select 'hotspot'::text, h.slot_number, h.display_name, h.published_at, h.tags, h.like_count, h.view_count, 1::bigint
    from hotspots h
  union all
  select 'creator'::text, null::integer, c.display_name, null::timestamptz, ''::text,
    c.like_count, c.view_count, c.spot_count from creators c;
$$;
revoke all on function public.get_spot_discovery_leaderboard() from public;
grant execute on function public.get_spot_discovery_leaderboard() to anon, authenticated;

create or replace function public.publish_slot_claim(p_claim_id uuid, p_public_image_path text, p_admin_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.slot_claims%rowtype;
  published_expiry timestamptz := now() + interval '30 days';
begin
  select * into c from public.slot_claims where id = p_claim_id and status = 'pending' for update;
  if not found then raise exception 'Claim is no longer pending'; end if;

  insert into public.published_slots
    (slot_number, anchor_slot, spot_size, display_name, image_path, description, website_url, tags, published_at, expires_at)
  select cells.slot_number, c.slot_number, c.spot_size, c.display_name, p_public_image_path,
    c.description, c.website_url, c.tags, now(), published_expiry
  from public.slot_claim_cells cells where cells.claim_id = c.id;

  update public.slot_claims
    set status = 'published', reviewed_at = now(), reviewed_by = p_admin_user_id, expires_at = published_expiry
    where id = p_claim_id;
end;
$$;
revoke all on function public.publish_slot_claim(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_claim(uuid, text, uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'published_slots'
     ) then
    execute 'alter publication supabase_realtime add table public.published_slots';
  end if;
end;
$$;
