-- Million Pixel schema. Apply with Supabase CLI or paste into the SQL Editor.
create schema if not exists private;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.is_admin = true
  );
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create table if not exists public.slot_claims (
  id uuid primary key default gen_random_uuid(),
  slot_number integer not null check (slot_number between 1 and 1000000),
  user_id uuid not null references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 60),
  contact text not null check (char_length(contact) between 3 and 120),
  artwork_path text not null,
  proof_path text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  expires_at timestamptz not null default (now() + interval '48 hours')
);

-- The unique partial index is the cross-user reservation lock.
create unique index if not exists slot_claims_one_active_per_slot
  on public.slot_claims (slot_number)
  where status in ('pending', 'published');
create index if not exists slot_claims_user_created_idx on public.slot_claims (user_id, created_at desc);

create table if not exists public.published_slots (
  slot_number integer primary key check (slot_number between 1 and 1000000),
  col_index integer generated always as ((slot_number - 1) % 1000) stored,
  row_index integer generated always as ((slot_number - 1) / 1000) stored,
  display_name text not null,
  image_path text not null,
  published_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists published_slots_expiry_idx on public.published_slots (expires_at);
create index if not exists published_slots_map_idx on public.published_slots (row_index, col_index);

alter table public.profiles enable row level security;
alter table public.slot_claims enable row level security;
alter table public.published_slots enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy "Users read their profile; admins read profiles"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

revoke all on public.slot_claims from anon, authenticated;
grant select on public.slot_claims to authenticated;
grant insert (slot_number, user_id, display_name, contact, artwork_path, proof_path, status)
  on public.slot_claims to authenticated;
create policy "Owners and admins read claims"
  on public.slot_claims for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "Signed-in users submit pending claims"
  on public.slot_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and artwork_path like ((select auth.uid())::text || '/%')
    and proof_path like ((select auth.uid())::text || '/%')
  );

revoke all on public.published_slots from anon, authenticated;
grant select on public.published_slots to anon, authenticated;
create policy "Published slots are public"
  on public.published_slots for select to anon, authenticated using (expires_at > now());

-- Private claim files are readable only by their owner or an admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-files', 'submission-files', false, 3145728,
        array['image/jpeg','image/png','image/gif','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('published-images', 'published-images', true, 3145728,
        array['image/jpeg','image/png','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload their own claim files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submission-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Owners and admins read private claim files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'submission-files'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
  );
create policy "Published images can be read publicly"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'published-images');

-- These RPCs are callable by the Edge Function's service role only.
create or replace function public.publish_slot_claim(p_claim_id uuid, p_public_image_path text, p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.slot_claims%rowtype;
  published_expiry timestamptz := now() + interval '30 days';
begin
  select * into c from public.slot_claims where id = p_claim_id and status = 'pending' for update;
  if not found then raise exception 'Claim is no longer pending'; end if;

  insert into public.published_slots (slot_number, display_name, image_path, published_at, expires_at)
  values (c.slot_number, c.display_name, p_public_image_path, now(), published_expiry);

  update public.slot_claims set status = 'published', reviewed_at = now(), reviewed_by = p_admin_user_id, expires_at = published_expiry
  where id = p_claim_id;
end;
$$;

create or replace function public.expire_published_slots()
returns table (slot_number integer, image_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.slot_claims set status = 'expired'
  where status = 'pending' and expires_at <= now();

  return query
  with due as (
    delete from public.published_slots p where p.expires_at <= now()
    returning p.slot_number, p.image_path
  ), marked as (
    update public.slot_claims c set status = 'expired'
    from due d where c.slot_number = d.slot_number and c.status = 'published'
    returning c.slot_number
  )
  select due.slot_number, due.image_path from due;
end;
$$;

revoke all on function public.publish_slot_claim(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.expire_published_slots() from public, anon, authenticated;
grant execute on function public.publish_slot_claim(uuid, text, uuid) to service_role;
grant execute on function public.expire_published_slots() to service_role;
