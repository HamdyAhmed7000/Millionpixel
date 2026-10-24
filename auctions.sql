-- Auction data stays private; the API returns only the fields each caller may see.
create table private.auction_accounts(user_id uuid primary key references auth.users(id),phone text not null check(phone ~ '^01[0125][0-9]{8}$'),updated_at timestamptz not null default now());
create table private.auction_blocks(user_id uuid primary key references auth.users(id),reason text not null,active boolean not null default true,updated_at timestamptz not null default now());
create table private.auction_lots(id uuid primary key default gen_random_uuid(),seller_id uuid not null references auth.users(id),title text not null check(length(title) between 3 and 100),description text not null check(length(description) between 20 and 2000),category text not null check(category in('electronics','collectibles','vintage','fashion','home','bundle','other')),condition text not null check(condition in('new','excellent','used')),city text not null check(length(city) between 2 and 70),delivery text not null check(length(delivery) between 5 and 300),assets jsonb not null,starting numeric(12,2) not null check(starting between 1 and 1000000),increment numeric(12,2) not null check(increment between 1 and 100000),reserve numeric(12,2) check(reserve between starting and 1000000),duration integer not null check(duration in(1,2,3,24)),status text not null default 'pending' check(status in('pending','live','closed','rejected','cancelled')),created_at timestamptz not null default now(),starts_at timestamptz,ends_at timestamptz,top_bid numeric(12,2),top_user uuid references auth.users(id),bid_count integer not null default 0,extensions integer not null default 0,winner_id uuid references auth.users(id),seller_done boolean not null default false,buyer_done boolean not null default false,review_reason text,reviewed_by uuid references auth.users(id));
create index auction_lots_status_end on private.auction_lots(status,ends_at);
create index auction_lots_seller on private.auction_lots(seller_id,created_at desc);
create table private.auction_bids(id bigint generated always as identity primary key,lot_id uuid not null references private.auction_lots(id),user_id uuid not null references auth.users(id),amount numeric(12,2) not null,created_at timestamptz not null default clock_timestamp());
create index auction_bids_lot on private.auction_bids(lot_id,id desc);
create index auction_bids_user on private.auction_bids(user_id,created_at desc);
create table private.auction_ratings(lot_id uuid references private.auction_lots(id),author_id uuid references auth.users(id),target_id uuid not null references auth.users(id),stars integer not null check(stars between 1 and 5),created_at timestamptz not null default now(),primary key(lot_id,author_id));
create index auction_ratings_target on private.auction_ratings(target_id);
create table private.auction_reports(id uuid primary key default gen_random_uuid(),lot_id uuid references private.auction_lots(id),user_id uuid not null references auth.users(id),reason text not null check(length(reason) between 5 and 500),resolved boolean not null default false,created_at timestamptz not null default now(),unique(lot_id,user_id));
alter table private.auction_accounts enable row level security;alter table private.auction_blocks enable row level security;alter table private.auction_lots enable row level security;alter table private.auction_bids enable row level security;alter table private.auction_ratings enable row level security;alter table private.auction_reports enable row level security;
revoke all on private.auction_accounts,private.auction_blocks,private.auction_lots,private.auction_bids,private.auction_ratings,private.auction_reports from public,anon,authenticated;
-- No public bucket: pending photos are visible only to their owner and reviewers.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('auction-media','auction-media',false,26214400,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
create function private.auction_media_read(p_path text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.auction_lots a where a.status in('live','closed') and exists(select 1 from jsonb_array_elements(a.assets) m where m->>'path'=p_path));$$;
revoke all on function private.auction_media_read(text) from public;grant execute on function private.auction_media_read(text) to anon,authenticated;
create policy auction_media_read on storage.objects for select to anon,authenticated using(bucket_id='auction-media' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select private.advice_admin()) or private.auction_media_read(name)));
create policy auction_media_upload on storage.objects for insert to authenticated with check(bucket_id='auction-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not exists(select 1 from private.auction_blocks b where b.user_id=(select auth.uid()) and b.active));
-- Helper prevents the upload policy from needing direct access to the private suspension table.
create function private.auction_allowed() returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and not exists(select 1 from private.auction_blocks b where b.user_id=auth.uid() and b.active);$$;
revoke all on function private.auction_allowed() from public;grant execute on function private.auction_allowed() to authenticated;
drop policy auction_media_upload on storage.objects;
create policy auction_media_upload on storage.objects for insert to authenticated with check(bucket_id='auction-media' and (storage.foldername(name))[1]=(select auth.uid())::text and (select private.auction_allowed()));
create function private.auction_media_unused(p_path text) returns boolean language sql stable security definer set search_path='' as $$select not exists(select 1 from private.auction_lots a where exists(select 1 from jsonb_array_elements(a.assets) m where m->>'path'=p_path));$$;
revoke all on function private.auction_media_unused(text) from public;grant execute on function private.auction_media_unused(text) to authenticated;
create policy auction_media_cleanup on storage.objects for delete to authenticated using(bucket_id='auction-media' and (storage.foldername(name))[1]=(select auth.uid())::text and private.auction_media_unused(name));
create function private.auction_command(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();admin boolean:=coalesce(private.advice_admin(),false);lot private.auction_lots;target uuid;v_amount numeric;v_reserve numeric;v_id uuid;v_status text;v_reason text;result jsonb;items jsonb;me public.advice_profiles;phone text;v_page integer:=least(10000,greatest(0,coalesce((p_data->>'page')::integer,0)));v_mode text:=coalesce(p_data->>'mode','live');
begin
 if p_action in('feed','detail','account','reports') then
  if p_action in('account','reports') and actor is null then raise exception 'AUCTION_SIGN_IN';end if;
  if p_action='account' then return jsonb_build_object('phone',(select a.phone from private.auction_accounts a where a.user_id=actor),'blocked',exists(select 1 from private.auction_blocks where user_id=actor and active),'block_reason',(select reason from private.auction_blocks where user_id=actor and active));end if;
  if p_action='reports' then if not admin then raise exception 'AUCTION_ADMIN';end if;return coalesce((select jsonb_agg(to_jsonb(r)) from (select * from private.auction_reports where not resolved order by created_at limit 50)r),'[]');end if;
  if p_action='detail' then
   target:=(p_data->>'id')::uuid;select * into lot from private.auction_lots where id=target for update;
   if not found or not(lot.status in('live','closed') or coalesce(lot.seller_id=actor,false) or admin) then raise exception 'AUCTION_NOT_FOUND';end if;
   if lot.status='live' and lot.ends_at<=clock_timestamp() then update private.auction_lots set status='closed',winner_id=case when top_user is not null and (reserve is null or top_bid>=reserve) then top_user end where id=target returning * into lot;end if;
  end if;
  if v_mode in('mine','bids') and actor is null then raise exception 'AUCTION_SIGN_IN';end if;
  if v_mode='admin' and not admin then raise exception 'AUCTION_ADMIN';end if;
  select coalesce(jsonb_agg(r.obj order by r.created_at desc),'[]') into items from (
   select a.created_at,jsonb_build_object('id',a.id,'title',a.title,'description',a.description,'category',a.category,'condition',a.condition,'city',a.city,'delivery',a.delivery,'assets',a.assets,'starting',a.starting,'increment',a.increment,'has_reserve',a.reserve is not null,'reserve',case when actor=a.seller_id or admin then a.reserve end,'duration',a.duration,'status',case when a.status='live' and a.ends_at<=clock_timestamp() then 'closed' else a.status end,'starts_at',a.starts_at,'ends_at',a.ends_at,'created_at',a.created_at,'top_bid',a.top_bid,'bid_count',a.bid_count,'extensions',a.extensions,'seller',s.handle,'leader',u.handle,'seller_rating',(select round(avg(stars),1) from private.auction_ratings where target_id=a.seller_id),'leader_rating',(select round(avg(stars),1) from private.auction_ratings where target_id=a.top_user),'seller_reviews',(select count(*) from private.auction_ratings where target_id=a.seller_id),'is_seller',coalesce(actor=a.seller_id,false),'is_leader',coalesce(actor=a.top_user,false),'is_winner',coalesce(actor=a.winner_id,false),'sold',case when a.ends_at<=clock_timestamp() then a.top_user is not null and (a.reserve is null or a.top_bid>=a.reserve) else false end,'seller_done',a.seller_done,'buyer_done',a.buyer_done,'rated',exists(select 1 from private.auction_ratings where lot_id=a.id and author_id=actor),'review_reason',case when actor=a.seller_id or admin then a.review_reason end) obj
   from private.auction_lots a left join public.advice_profiles s on s.user_id=a.seller_id left join public.advice_profiles u on u.user_id=a.top_user
   where (case when p_action='detail' then a.id=target when v_mode='admin' then a.status='pending' when v_mode='mine' then a.seller_id=actor when v_mode='bids' then exists(select 1 from private.auction_bids b where b.lot_id=a.id and b.user_id=actor) when v_mode='ended' then a.status in('live','closed') and a.ends_at<=clock_timestamp() else a.status='live' and a.ends_at>clock_timestamp() end)
   and (coalesce(p_data->>'q','')='' or a.title ilike '%'||left(p_data->>'q',80)||'%' or a.city ilike '%'||left(p_data->>'q',80)||'%')
   order by a.created_at desc,a.id limit 13 offset v_page*12
  )r;
  result:=jsonb_build_object('items',items,'server_now',clock_timestamp());
  if p_action='detail' then
   result:=result||jsonb_build_object('bids',coalesce((select jsonb_agg(to_jsonb(b)) from (select h.amount,h.created_at,p.handle from private.auction_bids h join public.advice_profiles p on p.user_id=h.user_id where h.lot_id=target order by h.id desc limit 30)b),'[]'));
   if lot.winner_id is not null and actor in(lot.seller_id,lot.winner_id) then select a.phone into phone from private.auction_accounts a where a.user_id=case when actor=lot.seller_id then lot.winner_id else lot.seller_id end;result:=result||jsonb_build_object('counterparty_phone',phone);end if;
  end if;
  return result;
 end if;
 if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'AUCTION_SIGN_IN';end if;
 if p_action in('review','resolve','block','unblock') then
  if not admin then raise exception 'AUCTION_ADMIN';end if;
  v_reason:=trim(p_data->>'reason');if coalesce(length(v_reason),0)<5 then raise exception 'AUCTION_REASON';end if;
  target:=(p_data->>'id')::uuid;
  if p_action='resolve' then update private.auction_reports set resolved=true where id=target;if not found then raise exception 'AUCTION_NOT_FOUND';end if;
  else
   select * into lot from private.auction_lots where id=target for update;if not found then raise exception 'AUCTION_NOT_FOUND';end if;
   if p_action='review' then
    v_status:=p_data->>'status';
    if v_status='live' and lot.status='pending' then
     if exists(select 1 from private.auction_blocks where user_id=lot.seller_id and active) then raise exception 'AUCTION_BLOCKED';end if;
     update private.auction_lots set status='live',starts_at=clock_timestamp(),ends_at=clock_timestamp()+make_interval(hours=>lot.duration),review_reason=v_reason,reviewed_by=actor where id=target;
    elsif v_status='rejected' and lot.status='pending' or v_status='cancelled' and lot.status in('pending','live') then update private.auction_lots set status=v_status,review_reason=v_reason,reviewed_by=actor where id=target;
    else raise exception 'AUCTION_STATE';end if;
   else
    v_id:=case when p_data->>'party'='buyer' then lot.top_user else lot.seller_id end;
    if v_id is null then raise exception 'AUCTION_NOT_FOUND';end if;
    insert into private.auction_blocks(user_id,reason,active) values(v_id,v_reason,p_action='block') on conflict(user_id) do update set reason=excluded.reason,active=excluded.active,updated_at=now();
   end if;
  end if;
  insert into private.advice_audit(actor,action,details) values(actor,'auction_'||p_action,p_data);return jsonb_build_object('ok',true);
 end if;
 if p_action<>'report' and not private.auction_allowed() then raise exception 'AUCTION_BLOCKED';end if;
 select * into me from public.advice_profiles where user_id=actor for update;
 if me.user_id is null then raise exception 'ADVICE_PROFILE';end if;if me.suspended and p_action<>'report' then raise exception 'AUCTION_BLOCKED';end if;
 if me.last_action_at>clock_timestamp()-interval '1 second' then raise exception 'AUCTION_SLOW_DOWN';end if;
 update public.advice_profiles set last_action_at=clock_timestamp() where user_id=actor;
 if p_action='account_save' then
  phone:=trim(p_data->>'phone');if phone is null or phone !~ '^01[0125][0-9]{8}$' then raise exception 'AUCTION_PHONE';end if;
  insert into private.auction_accounts(user_id,phone) values(actor,phone) on conflict(user_id) do update set phone=excluded.phone,updated_at=now();return jsonb_build_object('ok',true);
 end if;
 if p_action='submit' then
  if not exists(select 1 from private.auction_accounts where user_id=actor) then raise exception 'AUCTION_PHONE';end if;
  if (select count(*) from private.auction_lots where seller_id=actor and created_at>now()-interval '1 day')>=5 then raise exception 'AUCTION_LIMIT';end if;
  if jsonb_typeof(p_data->'assets')<>'array' or coalesce(jsonb_array_length(p_data->'assets'),0) not between 1 and 5 then raise exception 'AUCTION_MEDIA';end if;
  if exists(select 1 from jsonb_array_elements(p_data->'assets') m where (m->>'kind' is null or m->>'kind' not in('image','video')) or m->>'path' is null or split_part(m->>'path','/',1)<>actor::text or not exists(select 1 from storage.objects o where o.bucket_id='auction-media' and o.name=m->>'path' and ((m->>'kind'='image' and o.metadata->>'mimetype' in('image/jpeg','image/png','image/webp') and (o.metadata->>'size')::bigint<=5242880) or (m->>'kind'='video' and o.metadata->>'mimetype' in('video/mp4','video/webm'))))) or not exists(select 1 from jsonb_array_elements(p_data->'assets') m where m->>'kind'='image') or (select count(*) from jsonb_array_elements(p_data->'assets')m where m->>'kind'='video')>1 or (select count(*) from jsonb_array_elements(p_data->'assets')m where m->>'kind'='image')>4 then raise exception 'AUCTION_MEDIA';end if;
  insert into private.auction_lots(seller_id,title,description,category,condition,city,delivery,assets,starting,increment,reserve,duration) values(actor,trim(p_data->>'title'),trim(p_data->>'description'),p_data->>'category',p_data->>'condition',trim(p_data->>'city'),trim(p_data->>'delivery'),p_data->'assets',(p_data->>'starting')::numeric,(p_data->>'increment')::numeric,nullif(p_data->>'reserve','')::numeric,(p_data->>'duration')::integer) returning id into v_id;
  return jsonb_build_object('id',v_id);
 end if;
 target:=(p_data->>'id')::uuid;select * into lot from private.auction_lots where id=target for update;if not found then raise exception 'AUCTION_NOT_FOUND';end if;
 if p_action='bid' then
  if p_data->>'accepted' is distinct from 'true' then raise exception 'AUCTION_RULES';end if;
  if lot.status<>'live' or lot.ends_at<=clock_timestamp() then raise exception 'AUCTION_CLOSED';end if;
  if exists(select 1 from private.auction_blocks where user_id=lot.seller_id and active) then raise exception 'AUCTION_BLOCKED';end if;
  if actor=lot.seller_id then raise exception 'AUCTION_OWN';end if;
  if actor=lot.top_user then raise exception 'AUCTION_LEADING';end if;
  if not exists(select 1 from private.auction_accounts where user_id=actor) then raise exception 'AUCTION_PHONE';end if;
  v_amount:=(p_data->>'amount')::numeric;if v_amount is null or v_amount<>round(v_amount,2) or v_amount>1000000 or v_amount<(case when lot.top_bid is null then lot.starting else lot.top_bid+lot.increment end) then raise exception 'AUCTION_AMOUNT';end if;
  if (select count(*) from private.auction_bids where user_id=actor and created_at>clock_timestamp()-interval '1 hour')>=100 then raise exception 'AUCTION_LIMIT';end if;
  insert into private.auction_bids(lot_id,user_id,amount) values(target,actor,v_amount);
  update private.auction_lots set top_bid=v_amount,top_user=actor,bid_count=bid_count+1,ends_at=case when ends_at-clock_timestamp()<=interval '3 minutes' then ends_at+interval '3 minutes' else ends_at end,extensions=extensions+case when ends_at-clock_timestamp()<=interval '3 minutes' then 1 else 0 end where id=target;
 elsif p_action='cancel' then
  if actor<>lot.seller_id or lot.bid_count>0 or lot.status not in('pending','live') then raise exception 'AUCTION_STATE';end if;update private.auction_lots set status='cancelled' where id=target;
 elsif p_action='report' then
  if length(trim(p_data->>'reason')) not between 5 and 500 then raise exception 'AUCTION_REASON';end if;
  if (select count(*) from private.auction_reports where user_id=actor and created_at>now()-interval '1 day')>=10 then raise exception 'AUCTION_LIMIT';end if;
  insert into private.auction_reports(lot_id,user_id,reason) values(target,actor,trim(p_data->>'reason')) on conflict(lot_id,user_id) do update set reason=excluded.reason,resolved=false;
 elsif p_action in('complete','rate') then
  if lot.status='live' and lot.ends_at<=clock_timestamp() then update private.auction_lots set status='closed',winner_id=case when top_user is not null and (reserve is null or top_bid>=reserve) then top_user end where id=target returning * into lot;end if;
  if lot.status<>'closed' or lot.winner_id is null or actor not in(lot.seller_id,lot.winner_id) then raise exception 'AUCTION_STATE';end if;
  if p_action='complete' then update private.auction_lots set seller_done=seller_done or actor=seller_id,buyer_done=buyer_done or actor=winner_id where id=target;
  else
   if not(lot.seller_done and lot.buyer_done) then raise exception 'AUCTION_STATE';end if;
   insert into private.auction_ratings(lot_id,author_id,target_id,stars) values(target,actor,case when actor=lot.seller_id then lot.winner_id else lot.seller_id end,(p_data->>'stars')::integer);
  end if;
 else raise exception 'AUCTION_ACTION';end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function private.auction_command(text,jsonb) from public;grant execute on function private.auction_command(text,jsonb) to anon,authenticated;
create function public.auction_command(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' return private.auction_command(p_action,p_data);
revoke all on function public.auction_command(text,jsonb) from public;grant execute on function public.auction_command(text,jsonb) to anon,authenticated;
