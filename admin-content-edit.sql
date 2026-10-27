create or replace function private.admin_content(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<ctx>>
declare actor uuid:=auth.uid();kind text:=p_data->>'kind';target uuid;reason text;old_status text;snap jsonb;rec private.content_removals;result jsonb;v_page integer:=least(10000,greatest(0,coalesce((p_data->>'page')::integer,0)));
begin
 if actor is null or not coalesce(private.can_moderate(kind),false) then raise exception 'ADMIN_REQUIRED';end if;

 if p_action='edit' then
  target:=(p_data->>'id')::uuid;reason:=trim(p_data->>'reason');
  if reason is null or length(reason) not between 5 and 500 then raise exception 'ADMIN_REASON';end if;
  perform pg_advisory_xact_lock(hashtextextended(kind||target::text,0));
  if exists(select 1 from private.content_removals c where c.kind=ctx.kind and c.target_id=target and c.restored_at is null) then raise exception 'ADMIN_HIDDEN';end if;
  if kind='image' then
   select jsonb_build_object('title',display_name,'body',description) into snap from public.slot_claims where id=target for update;
   if not found then raise exception 'ADMIN_NOT_FOUND';end if;
   update public.slot_claims set display_name=trim(p_data->>'title'),description=trim(p_data->>'body') where id=target;
   update public.published_slots s set display_name=trim(p_data->>'title'),description=trim(p_data->>'body') where exists(select 1 from public.slot_claim_cells c where c.claim_id=target and c.slot_number=s.slot_number);
  elsif kind='advice' then
   select jsonb_build_object('title',title,'body',body) into snap from public.advice_posts where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
   update public.advice_posts set title=trim(p_data->>'title'),body=trim(p_data->>'body') where id=target;
  elsif kind='dream' then
   select jsonb_build_object('title',title,'body',body) into snap from public.dream_posts where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
   update public.dream_posts set title=trim(p_data->>'title'),body=trim(p_data->>'body') where id=target;
  elsif kind='dream_comment' then
   select jsonb_build_object('body',body) into snap from public.dream_comments where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
   update public.dream_comments set body=trim(p_data->>'body') where id=target;
  elsif kind='auction' then
   select jsonb_build_object('title',title,'body',description) into snap from private.auction_lots where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
   if exists(select 1 from private.auction_lots where id=target and bid_count>0) then raise exception 'ADMIN_AUCTION_HAS_BIDS';end if;
   update private.auction_lots set title=trim(p_data->>'title'),description=trim(p_data->>'body') where id=target;
  else raise exception 'ADMIN_ACTION';end if;
  insert into private.advice_audit(actor,action,details) values(actor,'content_edit',jsonb_build_object('kind',kind,'id',target,'reason',reason,'before',snap,'after',jsonb_build_object('title',p_data->>'title','body',p_data->>'body')));return jsonb_build_object('ok',true);
 end if;

 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from (
   select q.*,ap.handle,c.removed_at,c.reason,c.removed_at is not null and c.restored_at is null as hidden from (
    select 'image' kind,a.id,a.display_name title,a.description body,a.status,a.created_at,a.artwork_path media_path,'submission-files' bucket,a.slot_number::text extra,a.user_id owner_id from public.slot_claims a
    union all select 'advice',a.id,a.title,a.body,a.status,a.created_at,null,null,null,a.user_id from public.advice_posts a
    union all select 'dream',a.id,a.title,a.body,a.status,a.created_at,null,null,null,a.user_id from public.dream_posts a
    union all select 'dream_comment',a.id,'تعليق / Comment',a.body,a.status,a.created_at,null,null,a.post_id::text,a.user_id from public.dream_comments a
    union all select 'auction',a.id,a.title,a.description,a.status,a.created_at,a.assets->0->>'path','auction-media',a.bid_count::text,a.seller_id from private.auction_lots a
   )q left join public.advice_profiles ap on ap.user_id=q.owner_id left join private.content_removals c on c.kind=q.kind and c.target_id=q.id
   where (kind is null or q.kind=kind) and (coalesce(p_data->>'status','')='' or (p_data->>'status'='hidden' and c.removed_at is not null and c.restored_at is null) or (q.status=p_data->>'status' and (c.removed_at is null or c.restored_at is not null))) and (coalesce(p_data->>'q','')='' or q.title ilike '%'||left(p_data->>'q',100)||'%' or ap.handle ilike '%'||left(p_data->>'q',100)||'%' or q.id::text=replace(p_data->>'q','#','') or (q.kind='image' and q.extra=replace(p_data->>'q','#','')) or (private.advice_admin() and exists(select 1 from auth.users u where u.id=q.owner_id and u.email ilike '%'||left(p_data->>'q',100)||'%')))
   and (nullif(p_data->>'from','') is null or (q.created_at at time zone 'Africa/Cairo')::date>=(p_data->>'from')::date) and (nullif(p_data->>'to','') is null or (q.created_at at time zone 'Africa/Cairo')::date<=(p_data->>'to')::date)
   order by q.created_at desc,q.id limit 21 offset v_page*20
  )r;return jsonb_build_object('items',result);
 end if;
 if p_action not in('remove','restore') or kind is null or kind not in('image','advice','dream','dream_comment','auction') then raise exception 'ADMIN_ACTION';end if;
 target:=(p_data->>'id')::uuid;reason:=trim(p_data->>'reason');if reason is null or length(reason) not between 5 and 500 then raise exception 'ADMIN_REASON';end if;
 -- Same content lock across all moderation calls from this hub.
 perform pg_advisory_xact_lock(hashtextextended(kind||target::text,0));
 if p_action='remove' then
  if exists(select 1 from private.content_removals where content_removals.kind=ctx.kind and target_id=target and restored_at is null) then raise exception 'ADMIN_ALREADY_HIDDEN';end if;
  if kind='image' then
   select to_jsonb(a),a.status into snap,old_status from public.slot_claims a where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
   snap:=jsonb_build_object('record',snap,'slots',coalesce((select jsonb_agg(to_jsonb(s)) from public.published_slots s where (s.anchor_slot=(snap->>'slot_number')::integer or s.slot_number=(snap->>'slot_number')::integer) and s.published_at=(snap->>'reviewed_at')::timestamptz),'[]'),'cells',coalesce((select jsonb_agg(to_jsonb(c)) from public.slot_claim_cells c where claim_id=target),'[]'));
   -- Match the public records by the claim's occupied cells, including composites.
   snap:=jsonb_set(snap,'{slots}',coalesce((select jsonb_agg(to_jsonb(s)) from public.published_slots s where exists(select 1 from public.slot_claim_cells c where c.claim_id=target and c.slot_number=s.slot_number)),'[]'));
   delete from public.published_slots s where exists(select 1 from public.slot_claim_cells c where c.claim_id=target and c.slot_number=s.slot_number);
   update public.slot_claims set status='expired' where id=target;
  elsif kind='advice' then select to_jsonb(a),a.status into snap,old_status from public.advice_posts a where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;update public.advice_posts set status='removed' where id=target;
  elsif kind='dream' then select to_jsonb(a),a.status into snap,old_status from public.dream_posts a where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;update public.dream_posts set status='removed' where id=target;
  elsif kind='dream_comment' then select to_jsonb(a),a.status into snap,old_status from public.dream_comments a where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;update public.dream_comments set status='removed' where id=target;
  else select to_jsonb(a),a.status into snap,old_status from private.auction_lots a where id=target for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;update private.auction_lots set status='cancelled',review_reason=reason,reviewed_by=actor where id=target;end if;
  insert into private.content_removals(kind,target_id,snapshot,previous_status,reason,actor) values(kind,target,snap,old_status,reason,actor) on conflict on constraint content_removals_pkey do update set snapshot=excluded.snapshot,previous_status=excluded.previous_status,reason=excluded.reason,actor=excluded.actor,removed_at=now(),restored_at=null;
 else
  select * into rec from private.content_removals c where c.kind=ctx.kind and c.target_id=target and c.restored_at is null for update;if not found then raise exception 'ADMIN_NOT_FOUND';end if;
  if kind='image' then
   perform 1 from public.slot_claims where id=target for update;
   if rec.previous_status in('pending','published') and (rec.snapshot->'record'->>'expires_at')::timestamptz<=clock_timestamp() then raise exception 'ADMIN_IMAGE_EXPIRED';end if;
   insert into public.slot_claim_cells select * from jsonb_populate_recordset(null::public.slot_claim_cells,rec.snapshot->'cells');
   insert into public.published_slots select * from jsonb_populate_recordset(null::public.published_slots,rec.snapshot->'slots');
   update public.slot_claims set status=rec.previous_status where id=target;
  elsif kind='advice' then update public.advice_posts set status=rec.previous_status where id=target;
  elsif kind='dream' then update public.dream_posts set status=rec.previous_status where id=target;
  elsif kind='dream_comment' then update public.dream_comments set status=rec.previous_status where id=target;
  else update private.auction_lots set status=rec.previous_status,review_reason=rec.snapshot->>'review_reason',reviewed_by=nullif(rec.snapshot->>'reviewed_by','')::uuid where id=target;end if;
  update private.content_removals c set restored_at=now() where c.kind=ctx.kind and target_id=target;
 end if;
 insert into private.advice_audit(actor,action,details) values(actor,'content_'||p_action,jsonb_build_object('kind',kind,'id',target,'reason',reason));return jsonb_build_object('ok',true);
end;$$;
