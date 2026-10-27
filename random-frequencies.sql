create table if not exists private.frequency_articles (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 3 and 160), excerpt text not null check(length(excerpt)<=300), body text not null check(length(body) between 20 and 50000), category text not null check(category in('world','sports','politics','health','technology','culture','science','other')), cover text not null check(cover like 'https://%'), cover_credit text not null default '', sources jsonb not null default '[]', lang text not null check(lang in('ar','en')), status text not null default 'draft' check(status in('draft','published','removed')), author_id uuid not null references auth.users(id), author_name text not null check(length(author_name) between 2 and 80), created_at timestamptz not null default now(), published_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists frequency_articles_feed on private.frequency_articles(status,lang,published_at desc);
create table if not exists private.frequency_comments(id uuid primary key default gen_random_uuid(), article_id uuid not null references private.frequency_articles(id),user_id uuid not null references auth.users(id),author_name text not null,body text not null check(length(body) between 2 and 1000),status text not null default 'pending' check(status in('pending','published','rejected','removed')),created_at timestamptz not null default now());
create index if not exists frequency_comments_feed on private.frequency_comments(article_id,status,created_at desc);
create table if not exists private.editor_events(id uuid primary key default gen_random_uuid(),actor uuid,actor_name text not null,action text not null,kind text not null,target_id text,details jsonb not null default '{}',created_at timestamptz not null default now());
alter table private.frequency_articles enable row level security;
alter table private.frequency_comments enable row level security;
alter table private.editor_events enable row level security;
revoke all on private.frequency_articles,private.frequency_comments,private.editor_events from public,anon,authenticated;
create or replace function private.frequency_api(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<f>>
declare actor uuid:=auth.uid();is_admin boolean:=coalesce(private.advice_admin(),false);result jsonb;target uuid;old_row private.frequency_articles;v_page integer:=greatest(0,least(10000,coalesce((p_data->>'page')::integer,0)));who text;v_status text;v_reason text;
begin
 if p_action='feed' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.published_at desc,q.id),'[]') into result from (select id,title,excerpt,category,cover,cover_credit,lang,author_name,published_at from private.frequency_articles where status='published' and (coalesce(p_data->>'lang','')='' or lang=p_data->>'lang') and (coalesce(p_data->>'category','')='' or category=p_data->>'category') and (coalesce(p_data->>'q','')='' or title ilike '%'||left(p_data->>'q',80)||'%' or excerpt ilike '%'||left(p_data->>'q',80)||'%') order by published_at desc,id limit 13 offset v_page*12)q;
  return jsonb_build_object('items',result);
 elsif p_action='article' then
  target:=(p_data->>'id')::uuid;
  select to_jsonb(q) into result from (select id,title,excerpt,body,category,cover,cover_credit,sources,lang,author_name,published_at,updated_at from private.frequency_articles where id=target and status='published')q;
  if result is null then raise exception 'ARTICLE_NOT_FOUND';end if;return result;
 elsif p_action='comments' then
  target:=(p_data->>'id')::uuid;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from (select c.id,c.author_name,c.body,c.created_at from private.frequency_comments c join private.frequency_articles a on a.id=c.article_id where a.id=target and a.status='published' and c.status='published' order by c.created_at desc,c.id limit 21 offset v_page*20)q;
  return jsonb_build_object('items',result);
 end if;
 if actor is null then raise exception 'SIGN_IN_REQUIRED';end if;
 select coalesce(a.handle,'CellTalk member') into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=actor;
 if p_action='comment' then
  target:=(p_data->>'id')::uuid;perform 1 from auth.users where id=actor for update;
  if not exists(select 1 from private.frequency_articles where id=target and status='published') then raise exception 'ARTICLE_NOT_FOUND';end if;
  if exists(select 1 from private.frequency_comments where user_id=actor and created_at>clock_timestamp()-interval '30 seconds') then raise exception 'SLOW_DOWN';end if;
  insert into private.frequency_comments(article_id,user_id,author_name,body) values(target,actor,who,trim(p_data->>'body'));
  return jsonb_build_object('ok',true);
 end if;
 if not is_admin then raise exception 'ADMIN_REQUIRED';end if;
 if p_action='admin_list' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from (select * from private.frequency_articles where (coalesce(p_data->>'q','')='' or title ilike '%'||left(p_data->>'q',80)||'%') order by created_at desc,id limit 21 offset v_page*20)q;return jsonb_build_object('items',result);
 elsif p_action='admin_comments' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from (select c.*,a.title from private.frequency_comments c join private.frequency_articles a on a.id=c.article_id where (coalesce(p_data->>'status','')='' or c.status=p_data->>'status') order by c.created_at desc,c.id limit 21 offset v_page*20)q;return jsonb_build_object('items',result);
 elsif p_action='audit' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from (
   select * from (select e.id::text as id,e.action,e.details||jsonb_build_object('kind',e.kind,'id',e.target_id) details,e.created_at,e.actor_name actor from private.editor_events e union all select l.id::text,l.action,l.details,l.created_at,coalesce(a.handle,u.email,l.actor::text,'System') from private.advice_audit l left join public.advice_profiles a on a.user_id=l.actor left join auth.users u on u.id=l.actor)z order by created_at desc,id desc limit 21 offset v_page*20
  )q;return jsonb_build_object('items',result);
 end if;
 select coalesce(a.handle,u.email,actor::text) into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=actor;
 target:=nullif(p_data->>'id','')::uuid;v_reason:=trim(p_data->>'reason');
 if v_reason is null or length(v_reason) not between 5 and 500 then raise exception 'REASON_REQUIRED';end if;
 if p_action='save' then
  v_status:=p_data->>'status';if v_status not in('draft','published') then raise exception 'STATUS_INVALID';end if;
  if jsonb_typeof(p_data->'sources')<>'array' or jsonb_array_length(p_data->'sources')>10 or exists(select 1 from jsonb_array_elements(p_data->'sources') s where coalesce(s->>'url','') not like 'https://%' or length(coalesce(s->>'label','')) not between 1 and 150) then raise exception 'SOURCES_INVALID';end if;
  if target is null then
   insert into private.frequency_articles(title,excerpt,body,category,cover,cover_credit,sources,lang,status,author_id,author_name,published_at) values(trim(p_data->>'title'),trim(p_data->>'excerpt'),trim(p_data->>'body'),p_data->>'category',p_data->>'cover',left(coalesce(p_data->>'cover_credit',''),200),p_data->'sources',p_data->>'lang',v_status,actor,trim(p_data->>'author_name'),case when v_status='published' then now() end) returning id into target;
  else
   select * into old_row from private.frequency_articles where id=target for update;if not found then raise exception 'ARTICLE_NOT_FOUND';end if;
   update private.frequency_articles set title=trim(p_data->>'title'),excerpt=trim(p_data->>'excerpt'),body=trim(p_data->>'body'),category=p_data->>'category',cover=p_data->>'cover',cover_credit=left(coalesce(p_data->>'cover_credit',''),200),sources=p_data->'sources',lang=p_data->>'lang',status=v_status,author_name=trim(p_data->>'author_name'),published_at=case when v_status='published' then coalesce(old_row.published_at,now()) else old_row.published_at end,updated_at=now() where id=target;
  end if;
 elsif p_action in('remove','restore') then
  update private.frequency_articles set status=case when p_action='remove' then 'removed' else 'draft' end,updated_at=now() where id=target;if not found then raise exception 'ARTICLE_NOT_FOUND';end if;
 elsif p_action='review_comment' then
  v_status:=p_data->>'status';if v_status not in('published','rejected','removed') then raise exception 'STATUS_INVALID';end if;
  update private.frequency_comments set status=v_status where id=target;if not found then raise exception 'COMMENT_NOT_FOUND';end if;
 else raise exception 'ACTION_INVALID';end if;
 insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(actor,who,'frequency_'||p_action,case when p_action='review_comment' then 'article_comment' else 'article' end,target::text,jsonb_build_object('reason',v_reason,'status',v_status,'title',p_data->>'title'));
 return jsonb_build_object('ok',true,'id',target);
end;$$;
revoke all on function private.frequency_api(text,jsonb) from public;grant execute on function private.frequency_api(text,jsonb) to anon,authenticated;
create or replace function public.frequency_api(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' return private.frequency_api(p_action,p_data);
revoke all on function public.frequency_api(text,jsonb) from public;grant execute on function public.frequency_api(text,jsonb) to anon,authenticated;
-- Capture administrative writes from every moderation surface, including Edge Function image review.
create or replace function private.capture_editor_event() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();who text;old_data jsonb:='{}';new_data jsonb:='{}';
begin
 if TG_OP<>'INSERT' then old_data:=to_jsonb(old);end if;if TG_OP<>'DELETE' then new_data:=to_jsonb(new);end if;
 if actor is null and TG_OP='UPDATE' and old_data->>'reviewed_by' is distinct from new_data->>'reviewed_by' then actor:=nullif(new_data->>'reviewed_by','')::uuid;end if;
 if actor is not null and exists(select 1 from public.profiles where user_id=actor and is_admin) then
  select coalesce(a.handle,u.email,actor::text) into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=actor;
  insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(actor,coalesce(who,actor::text),lower(TG_OP),TG_TABLE_NAME,coalesce(new_data->>'id',old_data->>'id',new_data->>'user_id',old_data->>'user_id'),jsonb_build_object('title',coalesce(new_data->>'title',new_data->>'display_name',old_data->>'title'),'before_status',old_data->>'status','status',new_data->>'status'));
 end if;
 return null;
end;$$;
revoke all on function private.capture_editor_event() from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['public.slot_claims','public.advice_posts','public.dream_posts','public.dream_comments','private.auction_lots','public.profiles'] loop execute format('drop trigger if exists celltalk_editor_event on %s',t);execute format('create trigger celltalk_editor_event after insert or update or delete on %s for each row execute function private.capture_editor_event()',t);end loop;end;$$;
