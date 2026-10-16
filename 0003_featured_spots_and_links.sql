-- Featured placements reserve a square of cells while keeping one anchor serial.
alter table public.slot_claims
  add column if not exists spot_size smallint not null default 1,
  add column if not exists website_url text;

alter table public.published_slots
  add column if not exists anchor_slot integer,
  add column if not exists spot_size smallint not null default 1,
  add column if not exists description text not null default '',
  add column if not exists website_url text;

update public.published_slots set anchor_slot = slot_number where anchor_slot is null;
alter table public.published_slots alter column anchor_slot set not null;

alter table public.slot_claims drop constraint if exists slot_claims_spot_size_check;
alter table public.slot_claims add constraint slot_claims_spot_size_check check (spot_size in (1, 2, 4));
alter table public.slot_claims drop constraint if exists slot_claims_website_url_check;
alter table public.slot_claims add constraint slot_claims_website_url_check
  check (website_url is null or (char_length(website_url) <= 300 and website_url ~* '^https?://'));
alter table public.published_slots drop constraint if exists published_slots_spot_size_check;
alter table public.published_slots add constraint published_slots_spot_size_check check (spot_size in (1, 2, 4));
alter table public.published_slots drop constraint if exists published_slots_website_url_check;
alter table public.published_slots add constraint published_slots_website_url_check
  check (website_url is null or (char_length(website_url) <= 300 and website_url ~* '^https?://'));

grant insert (spot_size, website_url) on public.slot_claims to authenticated;

create table if not exists public.slot_claim_cells (
  slot_number integer primary key check (slot_number between 1 and 1000000),
  claim_id uuid not null references public.slot_claims(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists slot_claim_cells_claim_idx on public.slot_claim_cells (claim_id);
alter table public.slot_claim_cells enable row level security;
revoke all on public.slot_claim_cells from public, anon, authenticated;

create or replace function private.reserve_claim_cells()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  anchor_col integer := (new.slot_number - 1) % 1000;
  anchor_row integer := (new.slot_number - 1) / 1000;
  dx integer;
  dy integer;
begin
  if new.spot_size not in (1, 2, 4) then raise exception 'Unsupported spot size'; end if;
  if anchor_col + new.spot_size > 1000 or anchor_row + new.spot_size > 1000 then
    raise exception 'This spot size does not fit at the selected pixel';
  end if;
  for dy in 0..(new.spot_size - 1) loop
    for dx in 0..(new.spot_size - 1) loop
      insert into public.slot_claim_cells (slot_number, claim_id)
      values ((anchor_row + dy) * 1000 + anchor_col + dx + 1, new.id);
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function private.reserve_claim_cells() from public, anon, authenticated;
drop trigger if exists reserve_slot_claim_cells on public.slot_claims;
create trigger reserve_slot_claim_cells
  after insert on public.slot_claims for each row execute function private.reserve_claim_cells();

-- Backfill existing active claims as single-cell reservations.
insert into public.slot_claim_cells (slot_number, claim_id)
select c.slot_number, c.id from public.slot_claims c
where c.status in ('pending', 'published')
on conflict (slot_number) do nothing;

create or replace function private.release_claim_cells()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('rejected', 'expired') and old.status not in ('rejected', 'expired') then
    delete from public.slot_claim_cells where claim_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.release_claim_cells() from public, anon, authenticated;
drop trigger if exists release_slot_claim_cells on public.slot_claims;
create trigger release_slot_claim_cells
  after update of status on public.slot_claims for each row execute function private.release_claim_cells();

create or replace function public.publish_slot_claim(p_claim_id uuid, p_public_image_path text, p_admin_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.slot_claims%rowtype;
  published_expiry timestamptz := now() + interval '30 days';
begin
  select * into c from public.slot_claims where id = p_claim_id and status = 'pending' for update;
  if not found then raise exception 'Claim is no longer pending'; end if;

  insert into public.published_slots
    (slot_number, anchor_slot, spot_size, display_name, image_path, description, website_url, published_at, expires_at)
  select cells.slot_number, c.slot_number, c.spot_size, c.display_name, p_public_image_path,
    c.description, c.website_url, now(), published_expiry
  from public.slot_claim_cells cells where cells.claim_id = c.id;

  update public.slot_claims
    set status = 'published', reviewed_at = now(), reviewed_by = p_admin_user_id, expires_at = published_expiry
    where id = p_claim_id;
end;
$$;

revoke all on function public.publish_slot_claim(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_claim(uuid, text, uuid) to service_role;
