create or replace function private.admin_suite(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<s>>
declare actor uuid:=auth.uid();owner boolean:=coalesce(private.advice_admin(),false);scopes text[];result jsonb;target uuid;kind text:=p_data->>'kind';reason text:=trim(p_data->>'reason');who text;v_page int:=greatest(0,least(10000,coalesce((p_data->>'page')::int,0)));days int:=case when p_data->>'days'='30' then 30 else 7 end;start_day date;entry jsonb;outcomes jsonb:='[]';decision text:=p_data->>'decision';q text:=trim(coalesce(p_data->>'q',''));post record;v_status text;threshold numeric:=greatest(1,least(1000000,coalesce((p_data->>'threshold')::numeric,10000)));
begin
 select coalesce(m.scopes,'{}') into scopes from private.moderator_scopes m where user_id=actor;scopes:=coalesce(scopes,'{}');
 if p_action='access' then return jsonb_build_object('is_admin',actor is not null and (owner or cardinality(scopes)>0),'is_owner',owner,'scopes',to_jsonb(scopes));end if;
 if actor is null then raise exception 'SIGN_IN_REQUIRED';end if;
 if p_action='my_notice' then return coalesce((select jsonb_build_object('state',state,'reason',member_discipline.reason,'updated_at',updated_at) from private.member_discipline where user_id=actor and state<>'clear'),'{}');end if;
 if p_action='support_submit' then
  perform 1 from auth.users where id=actor for update;
  if (select count(*) from private.support_messages where user_id=actor and created_at>now()-interval '1 day')>=3 then raise exception 'SUPPORT_DAILY_LIMIT';end if;
  insert into private.support_messages(user_id,body) values(actor,trim(p_data->>'body'));return '{"ok":true}';
 end if;
 if not owner and cardinality(scopes)=0 then raise exception 'ADMIN_REQUIRED';end if;
 select coalesce(a.handle,u.email,actor::text) into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=actor;
 if p_action='notifications' then
  return jsonb_build_object('pending',(select count(*) from(select 'image' kind from public.slot_claims where status='pending' union all select 'advice' from public.advice_posts where status='pending' union all select 'dream' from public.dream_posts where status='pending' union all select 'dream' from public.dream_comments where status='pending' union all select 'auction' from private.auction_lots where status='pending' union all select 'article' from private.frequency_comments where status='pending' union all select 'article' from private.frequency_submissions where status='pending')r where private.can_moderate(r.kind)),
  'reports',(select count(*) from(select 'advice' kind from public.advice_reports where not resolved union all select 'dream' from public.dream_reports where not resolved union all select 'auction' from private.auction_reports where not resolved)r where private.can_moderate(r.kind)),
  'support',case when owner then(select count(*) from private.support_messages where not resolved) else 0 end,
  'high_bids',case when private.can_moderate('auction') then(select count(*) from private.auction_lots where status='live' and ends_at>now() and top_bid>=threshold) else 0 end,'threshold',threshold);
 elsif p_action='analytics' then
  if not owner then raise exception 'OWNER_REQUIRED';end if;start_day:=(clock_timestamp() at time zone 'Africa/Cairo')::date-days+1;
  return jsonb_build_object('online',(select count(*) from private.online_browsers where last_seen>=now()-interval '5 minutes'),'daily',(select jsonb_agg(to_jsonb(r) order by r.day) from(select d::date as day,(select count(*) from auth.users u where (u.created_at at time zone 'Africa/Cairo')::date=d::date and not coalesce(u.is_anonymous,false)) registrations,(select count(*) from public.slot_claims a where (a.created_at at time zone 'Africa/Cairo')::date=d::date) images,(select count(*) from public.dream_posts a where (a.created_at at time zone 'Africa/Cairo')::date=d::date) dreams,(select count(*) from private.auction_lots a where (a.created_at at time zone 'Africa/Cairo')::date=d::date) auctions,(select count(*) from public.advice_posts a where (a.created_at at time zone 'Africa/Cairo')::date=d::date) advice from generate_series(start_day,(clock_timestamp() at time zone 'Africa/Cairo')::date,interval '1 day')d)r),
  'sections',(select coalesce(jsonb_agg(to_jsonb(r) order by r.views desc),'[]') from(select case when path='/' then 'canvas' else split_part(path,'/',3) end section,sum(views) views from private.page_traffic where day>=start_day group by 1)r));
 elsif p_action='queue' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]') into result from (
   select t.*,a.handle from (
    select 'image' kind,id,display_name title,description body,status,created_at,user_id,artwork_path media_path,proof_path,'submission-files' bucket,slot_number::text serial from public.slot_claims
    union all select 'advice',id,title,body,status,created_at,user_id,null,null,null,null from public.advice_posts
    union all select 'dream',id,title,body,status,created_at,user_id,null,null,null,null from public.dream_posts
    union all select 'dream_comment',id,'تعليق حلم / Dream comment',body,status,created_at,user_id,null,null,null,null from public.dream_comments
    union all select 'auction',id,title,description,status,created_at,seller_id,assets->0->>'path',null,'auction-media',null from private.auction_lots
    union all select 'article',id,title,body,status,created_at,author_id,null,null,null,null from private.frequency_articles
    union all select 'frequency_submission',id,title,body,status,created_at,user_id,null,null,null,null from private.frequency_submissions
    union all select 'article_comment',id,'تعليق مقال / Article comment',body,status,created_at,user_id,null,null,null,null from private.frequency_comments
   )t left join public.advice_profiles a on a.user_id=t.user_id
   where private.can_moderate(case when t.kind='article_comment' then 'article' else t.kind end) and (coalesce(kind,'')='' or t.kind=kind) and (coalesce(p_data->>'status','pending')='' or t.status=coalesce(p_data->>'status','pending'))
    and (q='' or t.title ilike '%'||left(q,100)||'%' or a.handle ilike '%'||left(q,100)||'%' or t.id::text=replace(q,'#','') or t.serial=replace(q,'#','') or (owner and exists(select 1 from auth.users u where u.id=t.user_id and u.email ilike '%'||left(q,100)||'%')))
    and (nullif(p_data->>'from','') is null or (t.created_at at time zone 'Africa/Cairo')::date>=(p_data->>'from')::date) and (nullif(p_data->>'to','') is null or (t.created_at at time zone 'Africa/Cairo')::date<=(p_data->>'to')::date)
   order by t.created_at desc,t.id limit 21 offset v_page*20
  )r;return jsonb_build_object('items',result);
 elsif p_action='reports' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from(
   select t.*,a.handle from(select 'advice' kind,r.id,r.post_id target_id,r.user_id,r.reason,r.resolved,r.created_at,p.title from public.advice_reports r left join public.advice_posts p on p.id=r.post_id union all select 'dream',r.id,r.post_id,r.user_id,r.reason,r.resolved,r.created_at,p.title from public.dream_reports r left join public.dream_posts p on p.id=r.post_id union all select 'auction',r.id,r.lot_id,r.user_id,r.reason,r.resolved,r.created_at,p.title from private.auction_reports r left join private.auction_lots p on p.id=r.lot_id)t left join public.advice_profiles a on a.user_id=t.user_id where private.can_moderate(t.kind) and (coalesce(p_data->>'resolved','false')='all' or t.resolved=coalesce(p_data->>'resolved','false')::boolean) order by t.created_at desc,t.id limit 21 offset v_page*20
  )r;return jsonb_build_object('items',result);
 elsif p_action='audit' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from(select * from(select e.id::text id,e.actor actor_id,e.actor_name actor,e.action,e.kind,e.target_id,e.details,e.created_at from private.editor_events e union all select l.id::text,l.actor,coalesce(a.handle,u.email,l.actor::text,'System'),l.action,coalesce(l.details->>'kind',case when l.action like 'auction_%' then 'auction' when l.action like 'dream_%' then 'dream' else 'advice' end),l.details->>'id',l.details,l.created_at from private.advice_audit l left join public.advice_profiles a on a.user_id=l.actor left join auth.users u on u.id=l.actor)t where (owner or private.can_moderate(t.kind)) and (q='' or t.actor ilike '%'||left(q,100)||'%' or t.target_id ilike '%'||replace(left(q,100),'#','')||'%' or t.details->>'title' ilike '%'||left(q,100)||'%') and (coalesce(p_data->>'action','')='' or t.action=p_data->>'action') and (nullif(p_data->>'from','') is null or t.created_at>=(p_data->>'from')::date::timestamp at time zone 'Africa/Cairo') and (nullif(p_data->>'to','') is null or t.created_at<((p_data->>'to')::date+1)::timestamp at time zone 'Africa/Cairo') order by t.created_at desc,t.id limit 21 offset v_page*20)r;
  return jsonb_build_object('items',result);
 end if;
 if p_action in('members','support') then
  if not owner then raise exception 'OWNER_REQUIRED';end if;
  if p_action='members' then select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from(select u.id,u.email,a.handle,u.created_at,p.is_admin,coalesce(m.scopes,'{}') scopes,coalesce(d.state,case when a.suspended or exists(select 1 from private.auction_blocks b where b.user_id=u.id and b.active) then 'banned' else 'clear' end) state,coalesce(d.reason,(select b.reason from private.auction_blocks b where b.user_id=u.id and b.active)) reason from auth.users u left join public.profiles p on p.user_id=u.id left join public.advice_profiles a on a.user_id=u.id left join private.moderator_scopes m on m.user_id=u.id left join private.member_discipline d on d.user_id=u.id where q='' or u.email ilike '%'||left(q,100)||'%' or a.handle ilike '%'||left(q,100)||'%' or u.id::text=q order by u.created_at desc,u.id limit 21 offset v_page*20)r;
  else select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into result from(select m.id,m.body,m.resolved,m.created_at,a.handle from private.support_messages m left join public.advice_profiles a on a.user_id=m.user_id order by m.created_at desc,m.id limit 21 offset v_page*20)r;end if;return jsonb_build_object('items',result);
 end if;
 if reason is null or length(reason) not between 5 and 500 then raise exception 'REASON_REQUIRED';end if;
 if p_action='bulk' then
  if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 20 or decision not in('approve','reject','remove') then raise exception 'BULK_INVALID';end if;
  for entry in select * from jsonb_array_elements(p_data->'items') loop
   begin
    kind:=entry->>'kind';target:=(entry->>'id')::uuid;
    if not private.can_moderate(case when kind='article_comment' then 'article' else kind end) then raise exception 'SCOPE_DENIED';end if;
    if kind='frequency_submission' and decision in('approve','reject') then
     perform private.radio_api('review_submission',jsonb_build_object('id',target,'decision',decision,'reason',reason,'cover',p_data->>'cover'));
    elsif decision='remove' then
     if kind='article' then perform private.frequency_api('remove',jsonb_build_object('id',target,'reason',reason));
     elsif kind='article_comment' then perform private.frequency_api('review_comment',jsonb_build_object('id',target,'status','removed','reason',reason));
     else perform private.admin_content('remove',jsonb_build_object('kind',kind,'id',target,'reason',reason));end if;
    else
     v_status:=case when decision='approve' then 'published' else 'rejected' end;
     if kind='advice' then
      update public.advice_posts set status=v_status,published_at=case when decision='approve' then now() else published_at end where id=target and status='pending';if not found then raise exception 'NOT_PENDING';end if;
      if decision='approve' then insert into public.advice_price_snapshots(post_id,price) select id,price from public.advice_posts where id=target;end if;
     elsif kind='dream' then update public.dream_posts set status=v_status,published_at=case when decision='approve' then now() else published_at end where id=target and status='pending';if not found then raise exception 'NOT_PENDING';end if;
     elsif kind='dream_comment' then update public.dream_comments set status=v_status where id=target and status='pending';if not found then raise exception 'NOT_PENDING';end if;
     elsif kind='article_comment' then update private.frequency_comments set status=v_status where id=target and status='pending';if not found then raise exception 'NOT_PENDING';end if;
     elsif kind='auction' then update private.auction_lots set status=case when decision='approve' then 'live' else 'rejected' end,starts_at=case when decision='approve' then now() else starts_at end,ends_at=case when decision='approve' then now()+make_interval(hours=>duration) else ends_at end,review_reason=reason,reviewed_by=actor where id=target and status='pending';if not found then raise exception 'NOT_PENDING';end if;
     else raise exception 'USE_IMAGE_REVIEW';end if;
    end if;
    insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(actor,who,'bulk_'||decision,kind,target::text,jsonb_build_object('reason',reason,'status',v_status));
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('id',target,'ok',true));
   exception when others then outcomes:=outcomes||jsonb_build_array(jsonb_build_object('id',entry->>'id','ok',false,'error',SQLERRM));end;
  end loop;return jsonb_build_object('items',outcomes);
 elsif p_action='image_review_note' then
  if not owner then raise exception 'OWNER_REQUIRED';end if;target:=(p_data->>'id')::uuid;kind:='image';if not exists(select 1 from public.slot_claims where id=target and reviewed_by=actor and status in('published','rejected')) then raise exception 'REVIEW_NOT_FOUND';end if;
 elsif p_action='resolve_report' then
  if not private.can_moderate(kind) then raise exception 'SCOPE_DENIED';end if;target:=(p_data->>'id')::uuid;
  if kind='advice' then update public.advice_reports set resolved=true where id=target;elsif kind='dream' then update public.dream_reports set resolved=true where id=target;elsif kind='auction' then update private.auction_reports set resolved=true where id=target;else raise exception 'KIND_INVALID';end if;if not found then raise exception 'NOT_FOUND';end if;
 elsif p_action in('set_scopes','discipline','resolve_support') then
  if not owner then raise exception 'OWNER_REQUIRED';end if;target:=(p_data->>'id')::uuid;
  if p_action='resolve_support' then update private.support_messages set resolved=true where id=target;if not found then raise exception 'NOT_FOUND';end if;
  else
   if target=actor or exists(select 1 from public.profiles where user_id=target and is_admin) then raise exception 'PROTECTED_ADMIN';end if;
   if p_action='set_scopes' then
    if exists(select 1 from private.member_discipline where user_id=target and state='banned') then raise exception 'CLEAR_BAN_FIRST';end if;
    insert into private.moderator_scopes(user_id,scopes,updated_by) values(target,array(select jsonb_array_elements_text(p_data->'scopes')),actor) on conflict(user_id) do update set scopes=excluded.scopes,updated_by=actor,updated_at=now();
   else
    v_status:=p_data->>'state';if v_status not in('warning','banned','clear') then raise exception 'STATE_INVALID';end if;
    if exists(select 1 from private.moderator_scopes m where m.user_id=target and cardinality(m.scopes)>0) then raise exception 'REVOKE_SCOPES_FIRST';end if;
    if v_status='clear' then update public.advice_profiles set suspended=false where user_id=target;update private.auction_blocks set active=false,updated_at=now() where user_id=target;end if;
    insert into private.member_discipline(user_id,state,reason,actor) values(target,v_status,reason,actor) on conflict(user_id) do update set state=v_status,reason=excluded.reason,actor=excluded.actor,updated_at=now();
   end if;
  end if;
 else raise exception 'ACTION_INVALID';end if;
 insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(actor,who,p_action,coalesce(kind,'management'),target::text,jsonb_build_object('reason',reason,'state',v_status,'scopes',p_data->'scopes'));
 return '{"ok":true}';
end;$$;
revoke all on function private.admin_suite(text,jsonb) from public;grant execute on function private.admin_suite(text,jsonb) to authenticated;
create or replace function public.admin_suite(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' return private.admin_suite(p_action,p_data);
revoke all on function public.admin_suite(text,jsonb) from public,anon;grant execute on function public.admin_suite(text,jsonb) to authenticated;
