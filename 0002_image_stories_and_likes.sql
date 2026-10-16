-- Add optional public stories to submissions and persistent likes to published images.
alter table public.slot_claims
  add column if not exists description text not null default '' check (char_length(description) <= 500);

alter table public.published_slots
  add column if not exists description text not null default '' check (char_length(description) <= 500);

grant insert (description) on public.slot_claims to authenticated;

create table if not exists public.slot_likes (
  slot_number integer not null references public.published_slots (slot_number) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slot_number, user_id)
);

alter table public.slot_likes enable row level security;
revoke all on public.slot_likes from anon, authenticated;
grant select, insert, delete on public.slot_likes to authenticated;

create policy "Users read their own image likes"
  on public.slot_likes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users like active published images"
  on public.slot_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.published_slots p
      where p.slot_number = slot_likes.slot_number and p.expires_at > now()
    )
  );

create policy "Users remove their own image likes"
  on public.slot_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.get_slot_like_summary(p_slot_number integer)
returns table (like_count bigint, liked_by_viewer boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint,
         coalesce(bool_or(l.user_id = (select auth.uid())), false)
  from public.slot_likes l
  where l.slot_number = p_slot_number;
$$;

revoke all on function public.get_slot_like_summary(integer) from public;
grant execute on function public.get_slot_like_summary(integer) to anon, authenticated;

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

  insert into public.published_slots (slot_number, display_name, image_path, description, published_at, expires_at)
  values (c.slot_number, c.display_name, p_public_image_path, c.description, now(), published_expiry);

  update public.slot_claims set status = 'published', reviewed_at = now(), reviewed_by = p_admin_user_id, expires_at = published_expiry
  where id = p_claim_id;
end;
$$;

revoke all on function public.publish_slot_claim(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_slot_claim(uuid, text, uuid) to service_role;
