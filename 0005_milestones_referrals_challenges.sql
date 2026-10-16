-- Milestone zones are derived from occupancy. This migration adds private,
-- auditable referral credits and monthly public challenges with one vote per user.

alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists credit_balance numeric(10,2) not null default 0
    check (credit_balance >= 0);
update public.profiles
set referral_code = 'MP-' || upper(replace(left(user_id::text, 13), '-', ''))
where referral_code is null;
create unique index if not exists profiles_referral_code_idx
  on public.profiles (upper(referral_code));

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, referral_code)
  values (new.id, 'MP-' || upper(replace(left(new.id::text, 13), '-', '')))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

alter table public.slot_claims
  add column if not exists referral_code text,
  add column if not exists credits_requested numeric(10,2) not null default 0 check (credits_requested >= 0),
  add column if not exists credits_used numeric(10,2) not null default 0 check (credits_used >= 0),
  add column if not exists amount_due numeric(10,2) not null default 1 check (amount_due >= 0);
grant insert (referral_code, credits_requested) on public.slot_claims to authenticated;
drop policy if exists "Signed-in users submit pending claims" on public.slot_claims;
create policy "Signed-in users submit pending claims"
  on public.slot_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and artwork_path like ((select auth.uid())::text || '/%')
    and (proof_path = '' or proof_path like ((select auth.uid())::text || '/%'))
  );

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_id uuid references public.slot_claims (id) on delete set null,
  entry_type text not null check (entry_type in ('use', 'refund', 'referral_reward')),
  amount numeric(10,2) not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create unique index if not exists credit_ledger_claim_user_type_idx
  on public.credit_ledger (claim_id, user_id, entry_type) where claim_id is not null;
alter table public.credit_ledger enable row level security;
revoke all on public.credit_ledger from public, anon, authenticated;

create table if not exists public.referral_uses (
  id uuid primary key default gen_random_uuid(),
  referred_user_id uuid not null unique references auth.users (id) on delete cascade,
  referrer_user_id uuid not null references auth.users (id) on delete cascade,
  claim_id uuid not null unique references public.slot_claims (id) on delete cascade,
  credited_amount numeric(10,2) not null,
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_user_id)
);
alter table public.referral_uses enable row level security;
revoke all on public.referral_uses from public, anon, authenticated;

create or replace function private.prepare_claim_credits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  gross numeric(10,2);
  referrer uuid;
begin
  gross := (new.spot_size * new.spot_size)::numeric(10,2);
  new.referral_code := nullif(upper(trim(coalesce(new.referral_code, ''))), '');
  if new.referral_code is not null then
    select p.user_id into referrer from public.profiles p
      where upper(p.referral_code) = new.referral_code;
    if referrer is null then raise exception 'Referral code not found'; end if;
    if referrer = new.user_id then raise exception 'You cannot use your own referral code'; end if;
    if exists (select 1 from public.referral_uses r where r.referred_user_id = new.user_id) then
      raise exception 'This account has already used a referral code';
    end if;
  end if;

  if new.credits_requested > gross then raise exception 'Credits requested exceed this spot price'; end if;
  new.credits_used := least(new.credits_requested, gross);
  new.amount_due := gross - new.credits_used;
  if new.credits_used > 0 then
    update public.profiles p set credit_balance = p.credit_balance - new.credits_used
      where p.user_id = new.user_id and p.credit_balance >= new.credits_used;
    if not found then raise exception 'Not enough available credits'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_claim_credits() from public, anon, authenticated;
drop trigger if exists prepare_claim_credits on public.slot_claims;
create trigger prepare_claim_credits before insert on public.slot_claims
  for each row execute function private.prepare_claim_credits();

-- The claim row must exist before its ledger row can satisfy the claim_id foreign key.
create or replace function private.record_claim_credit_use()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.credits_used > 0 then
    insert into public.credit_ledger (user_id, claim_id, entry_type, amount)
      values (new.user_id, new.id, 'use', -new.credits_used);
  end if;
  return new;
end;
$$;
revoke all on function private.record_claim_credit_use() from public, anon, authenticated;
drop trigger if exists record_claim_credit_use on public.slot_claims;
create trigger record_claim_credit_use after insert on public.slot_claims
  for each row execute function private.record_claim_credit_use();

create or replace function private.refund_rejected_claim_credits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status in ('rejected', 'expired') and old.credits_used > 0 then
    insert into public.credit_ledger (user_id, claim_id, entry_type, amount)
      values (old.user_id, old.id, 'refund', old.credits_used)
      on conflict (claim_id, user_id, entry_type) where claim_id is not null do nothing;
    if found then
      update public.profiles set credit_balance = credit_balance + old.credits_used
        where user_id = old.user_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.refund_rejected_claim_credits() from public, anon, authenticated;
drop trigger if exists refund_rejected_claim_credits on public.slot_claims;
create trigger refund_rejected_claim_credits after update of status on public.slot_claims
  for each row execute function private.refund_rejected_claim_credits();

-- Refresh the approval routine so credits are earned only after manual approval.
create or replace function public.publish_slot_claim(p_claim_id uuid, p_public_image_path text, p_admin_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.slot_claims%rowtype;
  referrer uuid;
  reward numeric(10,2);
  inserted_id uuid;
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

  if c.referral_code is not null then
    select p.user_id into referrer from public.profiles p where upper(p.referral_code) = upper(c.referral_code);
    if referrer is null or referrer = c.user_id then raise exception 'Referral code is no longer valid'; end if;
    reward := round((c.spot_size * c.spot_size)::numeric * 0.15, 2);
    insert into public.referral_uses (referred_user_id, referrer_user_id, claim_id, credited_amount)
      values (c.user_id, referrer, c.id, reward);
    insert into public.credit_ledger (user_id, claim_id, entry_type, amount)
      values (referrer, c.id, 'referral_reward', reward) returning id into inserted_id;
    update public.profiles set credit_balance = credit_balance + reward where user_id = referrer;
    insert into public.credit_ledger (user_id, claim_id, entry_type, amount)
      values (c.user_id, c.id, 'referral_reward', reward) returning id into inserted_id;
    update public.profiles set credit_balance = credit_balance + reward where user_id = c.user_id;
  end if;
end;
$$;
revoke all on function public.publish_slot_claim(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_claim(uuid, text, uuid) to service_role;

create table if not exists public.community_challenge_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  tag_key text not null
);
alter table public.community_challenge_templates enable row level security;
revoke all on public.community_challenge_templates from public, anon, authenticated;
insert into public.community_challenge_templates (slug, title, description, tag_key) values
  ('best-pet-photo', 'Best Pet Photo Spot', 'Share a favorite pet portrait and let the community vote.', 'pets'),
  ('indie-creators', 'Indie Creators Corner', 'Give independent artists and makers a place to shine.', 'indie'),
  ('retro-nostalgia', 'Retro Nostalgia Grid', 'Bring a pixel memory, classic game, or throwback moment.', 'retro')
on conflict (slug) do nothing;

create table if not exists public.community_challenges (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.community_challenge_templates (id),
  month_start date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unique (template_id, month_start)
);
alter table public.community_challenges enable row level security;
revoke all on public.community_challenges from public, anon, authenticated;

create table if not exists public.community_challenge_votes (
  challenge_id uuid not null references public.community_challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  slot_number integer not null,
  voted_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table public.community_challenge_votes enable row level security;
revoke all on public.community_challenge_votes from public, anon, authenticated;

create or replace function public.get_community_challenge_spots()
returns table (
  challenge_id uuid,
  title text,
  description text,
  tag_key text,
  ends_at timestamptz,
  slot_number integer,
  display_name text,
  image_path text,
  vote_count bigint,
  place integer
)
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.community_challenges (template_id, month_start, starts_at, ends_at)
  select t.id, date_trunc('month', now())::date, date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month'
  from public.community_challenge_templates t
  on conflict (template_id, month_start) do nothing;

  return query
  with active as (
    select c.id, t.title, t.description, t.tag_key, c.ends_at
    from public.community_challenges c join public.community_challenge_templates t on t.id = c.template_id
    where c.starts_at <= now() and c.ends_at > now()
  ), nominations as (
    select a.id as cid, p.slot_number, p.display_name, p.image_path, count(v.user_id)::bigint as votes
    from active a join public.published_slots p on p.slot_number = coalesce(p.anchor_slot, p.slot_number)
      and p.expires_at > now() and p.tags ilike ('%' || a.tag_key || '%')
    left join public.community_challenge_votes v on v.challenge_id = a.id and v.slot_number = p.slot_number
    group by a.id, p.slot_number, p.display_name, p.image_path
  ), ranked as (
    select n.*, row_number() over (partition by n.cid order by n.votes desc, n.slot_number) as rank
    from nominations n
  )
  select a.id, a.title, a.description, a.tag_key, a.ends_at, r.slot_number, r.display_name,
    r.image_path, coalesce(r.votes, 0)::bigint, r.rank::integer
  from active a left join ranked r on r.cid = a.id and r.rank <= 3
  order by a.title, r.rank nulls last;
end;
$$;
revoke all on function public.get_community_challenge_spots() from public;
grant execute on function public.get_community_challenge_spots() to anon, authenticated;

create or replace function public.vote_for_community_challenge(p_challenge_id uuid, p_slot_number integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  voter uuid := (select auth.uid());
begin
  if voter is null then raise exception 'Sign in to vote'; end if;
  if not exists (
    select 1 from public.community_challenges c
    join public.community_challenge_templates t on t.id = c.template_id
    join public.published_slots p on p.slot_number = p_slot_number and p.expires_at > now()
    where c.id = p_challenge_id and c.starts_at <= now() and c.ends_at > now()
      and p.slot_number = coalesce(p.anchor_slot, p.slot_number)
      and p.tags ilike ('%' || t.tag_key || '%')
  ) then raise exception 'Choose an active published spot tagged for this challenge'; end if;
  insert into public.community_challenge_votes (challenge_id, user_id, slot_number)
    values (p_challenge_id, voter, p_slot_number)
    on conflict (challenge_id, user_id) do update set slot_number = excluded.slot_number, voted_at = now();
end;
$$;
revoke all on function public.vote_for_community_challenge(uuid, integer) from public;
grant execute on function public.vote_for_community_challenge(uuid, integer) to authenticated;
