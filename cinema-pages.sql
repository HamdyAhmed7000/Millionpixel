create table if not exists private.cinema_posts(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in('movie','news')),lang text not null check(lang in('ar','en')),
 title text not null check(length(title) between 3 and 180),excerpt text not null default '' check(length(excerpt)<=500),cover text not null default '',cover_credit text not null default '' check(length(cover_credit)<=300),
 category text not null default 'cinema' check(category in('cinema','series','awards','leaks')),platform text not null default 'other' check(platform in('netflix','hollywood','arabic','other')),
 body text not null default '' check(length(body)<=30000),chapters jsonb not null default '[]' check(jsonb_typeof(chapters)='array' and jsonb_array_length(chapters)<=30),
 quote text not null default '' check(length(quote)<=240),quote_credit text not null default '' check(length(quote_credit)<=120),breaking boolean not null default false,
 sources jsonb not null default '[]' check(jsonb_typeof(sources)='array' and jsonb_array_length(sources)<=15),status text not null default 'draft' check(status in('draft','published','archived')),
 author_id uuid not null references auth.users(id),author_name text not null,updated_by text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz
);
create index if not exists cinema_public_feed on private.cinema_posts(kind,lang,published_at desc,id) where status='published';
create table if not exists private.cinema_reactions(post_id uuid not null references private.cinema_posts(id),user_id uuid not null references auth.users(id),reaction text not null check(reaction in('fire','shock','bored','sad')),updated_at timestamptz not null default now(),primary key(post_id,user_id));
alter table private.cinema_posts enable row level security;alter table private.cinema_reactions enable row level security;
revoke all on private.cinema_posts,private.cinema_reactions from public,anon,authenticated;
do $$begin if not exists(select 1 from pg_trigger where tgname='celltalk_member_guard' and tgrelid='private.cinema_reactions'::regclass) then create trigger celltalk_member_guard before insert or update on private.cinema_reactions for each row execute function private.guard_banned_member();end if;end;$$;
create or replace function private.cinema_public(p private.cinema_posts) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'kind',p.kind,'lang',p.lang,'title',p.title,'excerpt',p.excerpt,'cover',p.cover,'cover_credit',p.cover_credit,'category',p.category,'platform',p.platform,'quote',p.quote,'quote_credit',p.quote_credit,'breaking',p.breaking,'author_name',p.author_name,'published_at',p.published_at,'updated_at',p.updated_at,'reading_minutes',greatest(1,ceil(cardinality(regexp_split_to_array(trim(p.body||' '||(select coalesce(string_agg(c->>'body',' '),'') from jsonb_array_elements(p.chapters)c)),'\s+'))::numeric/180))::int,'reactions',(select coalesce(jsonb_object_agg(r.reaction,r.n),'{}') from(select reaction,count(*) n from private.cinema_reactions where post_id=p.id group by reaction)r),'my_reaction',(select reaction from private.cinema_reactions where post_id=p.id and user_id=auth.uid()));$$;
revoke all on function private.cinema_public(private.cinema_posts) from public,anon,authenticated;
create or replace function private.cinema_api(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<cinema>>
declare actor uuid:=auth.uid();owner boolean:=coalesce(private.advice_admin(),false);target uuid;post private.cinema_posts;result jsonb;v_kind text:=coalesce(p_data->>'kind','movie');v_lang text:=coalesce(p_data->>'lang','ar');v_page int:=greatest(0,least(10000,coalesce((p_data->>'page')::int,0)));reason text:=trim(p_data->>'reason');who text;v_status text;ch jsonb:=coalesce(p_data->'chapters','[]');src jsonb:=coalesce(p_data->'sources','[]');r text;previous text;
begin
 if p_action='feed' then
  select coalesce(jsonb_agg(q.item order by q.published_at desc,q.id),'[]') into result from(select a.id,a.published_at,private.cinema_public(a) item from private.cinema_posts a where a.status='published' and a.kind=v_kind and a.lang=v_lang and (coalesce(p_data->>'category','')='' or a.category=p_data->>'category') and (coalesce(p_data->>'platform','')='' or a.platform=p_data->>'platform') and (coalesce(p_data->>'q','')='' or a.title ilike '%'||left(p_data->>'q',80)||'%' or a.excerpt ilike '%'||left(p_data->>'q',80)||'%') order by a.published_at desc,a.id limit 13 offset v_page*12)q;return jsonb_build_object('items',result);
 elsif p_action='ticker' then
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'category',a.category) order by a.published_at desc),'[]') into result from(select id,title,category,published_at from private.cinema_posts where status='published' and kind='news' and lang=v_lang and breaking order by published_at desc,id limit 8)a;return jsonb_build_object('items',result);
 elsif p_action='article' then
  select * into post from private.cinema_posts where id=(p_data->>'id')::uuid and status='published' and kind=v_kind and lang=v_lang;if not found then raise exception 'POST_NOT_FOUND';end if;
  return private.cinema_public(post)||jsonb_build_object('body',post.body,'chapters',post.chapters,'sources',post.sources);
 end if;
 if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'SIGN_IN_REQUIRED';end if;
 if p_action='react' then
  if exists(select 1 from private.member_discipline where user_id=actor and state='banned') then raise exception 'PARTICIPATION_BANNED';end if;
  target:=(p_data->>'id')::uuid;select * into post from private.cinema_posts where id=target and status='published' and kind='news' for share;if not found then raise exception 'POST_NOT_FOUND';end if;
  r:=nullif(p_data->>'reaction','');if r is null then delete from private.cinema_reactions where post_id=target and user_id=actor;else insert into private.cinema_reactions(post_id,user_id,reaction) values(target,actor,r) on conflict(post_id,user_id) do update set reaction=excluded.reaction,updated_at=now();end if;
  return private.cinema_public(post);
 end if;
 if not owner then raise exception 'ADMIN_REQUIRED';end if;
 select coalesce(nullif(trim(a.handle),''),u.email,'Administrator') into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=actor;
 if p_action='admin_list' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id),'[]') into result from(select * from private.cinema_posts a where a.kind=v_kind and (coalesce(p_data->>'q','')='' or a.title ilike '%'||left(p_data->>'q',80)||'%' or a.author_name ilike '%'||left(p_data->>'q',80)||'%' or a.id::text=trim(p_data->>'q')) and (coalesce(p_data->>'status','')='' or a.status=p_data->>'status') order by a.updated_at desc,a.id limit 21 offset v_page*20)q;return jsonb_build_object('items',result);
 end if;
 if length(coalesce(reason,'')) not between 5 and 500 then raise exception 'REASON_REQUIRED';end if;
 target:=nullif(p_data->>'id','')::uuid;
 if target is not null then select * into post from private.cinema_posts where id=target for update;if not found then raise exception 'POST_NOT_FOUND';end if;previous:=post.status;end if;
 if p_action='save' then
  v_status:=coalesce(p_data->>'status','draft');if v_status not in('draft','published') then raise exception 'STATUS_INVALID';end if;
  if target is not null and post.kind<>v_kind then raise exception 'KIND_IMMUTABLE';end if;
  if jsonb_typeof(ch)<>'array' or jsonb_array_length(ch)>30 then raise exception 'CHAPTERS_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(ch)c where jsonb_typeof(c)<>'object' or jsonb_typeof(c->'title') is distinct from 'string' or length(trim(c->>'title')) not between 1 and 100 or jsonb_typeof(c->'body') is distinct from 'string' or length(trim(c->>'body')) not between 20 and 12000 or length(coalesce(c->>'twist',''))>1000) then raise exception 'CHAPTERS_INVALID';end if;
  if length(ch::text)>100000 then raise exception 'CHAPTERS_TOO_LONG';end if;
  if jsonb_typeof(src)<>'array' or jsonb_array_length(src)>15 or exists(select 1 from jsonb_array_elements(src)s where jsonb_typeof(s)<>'object' or length(coalesce(s->>'name','')) not between 1 and 120 or coalesce(s->>'url','') !~ '^https://[^[:space:]]+$' or length(s->>'url')>2000) then raise exception 'SOURCES_INVALID';end if;
  if coalesce(p_data->>'cover','')<>'' and (p_data->>'cover' !~ '^https://[^[:space:]]+$' or length(p_data->>'cover')>2000) then raise exception 'COVER_INVALID';end if;
  if v_status='published' and (coalesce(p_data->>'cover','')='' or length(trim(coalesce(p_data->>'excerpt','')))<10 or (v_kind='movie' and jsonb_array_length(ch)=0) or (v_kind='news' and (length(trim(coalesce(p_data->>'body','')))<50 or jsonb_array_length(src)=0))) then raise exception 'PUBLISH_DETAILS_REQUIRED';end if;
  if target is null then
   insert into private.cinema_posts(kind,lang,title,author_id,author_name,updated_by) values(v_kind,v_lang,trim(p_data->>'title'),actor,'CellTalk',who) returning id into target;
  end if;
  update private.cinema_posts set lang=v_lang,title=trim(p_data->>'title'),excerpt=trim(coalesce(p_data->>'excerpt','')),cover=coalesce(p_data->>'cover',''),cover_credit=trim(coalesce(p_data->>'cover_credit','')),category=coalesce(p_data->>'category','cinema'),platform=coalesce(p_data->>'platform','other'),body=coalesce(p_data->>'body',''),chapters=ch,quote=trim(coalesce(p_data->>'quote','')),quote_credit=trim(coalesce(p_data->>'quote_credit','')),breaking=coalesce((p_data->>'breaking')::boolean,false),sources=src,status=v_status,author_name=left(coalesce(nullif(trim(p_data->>'author_name'),''),'CellTalk'),100),updated_by=who,updated_at=now(),published_at=case when v_status='published' then coalesce(published_at,now()) else published_at end where id=target;
 elsif p_action='archive' then
  if target is null then raise exception 'POST_NOT_FOUND';end if;update private.cinema_posts set status='archived',updated_by=who,updated_at=now() where id=target;
 elsif p_action='restore' then
  if target is null or post.status<>'archived' then raise exception 'POST_NOT_FOUND';end if;update private.cinema_posts set status='draft',updated_by=who,updated_at=now() where id=target;
 else raise exception 'ACTION_INVALID';end if;
 insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(actor,who,p_action,case when v_kind='news' or post.kind='news' then 'cinema_news' else 'movie_story' end,target::text,jsonb_build_object('reason',reason,'previous_status',previous,'title',(select title from private.cinema_posts where id=target)));
 return jsonb_build_object('ok',true,'id',target);
end;$$;
revoke all on function private.cinema_api(text,jsonb) from public;grant execute on function private.cinema_api(text,jsonb) to anon,authenticated;
create or replace function public.cinema_api(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' return private.cinema_api(p_action,p_data);
revoke all on function public.cinema_api(text,jsonb) from public;grant execute on function public.cinema_api(text,jsonb) to anon,authenticated;
-- Include the two public sections in the existing anonymous, daily-hashed traffic tracker.
do $$declare signature text;definition text;begin foreach signature in array array['private.record_page_visit(text,uuid)','private.browser_heartbeat(text,uuid)'] loop if to_regprocedure(signature) is not null then definition:=pg_get_functiondef(signature::regprocedure);definition:=replace(definition,'advice|dreams|auctions|comedy-will|frequencies','advice|dreams|auctions|comedy-will|frequencies|movie-stories|latest-news');execute definition;end if;end loop;end;$$;
notify pgrst,'reload schema';
create or replace function private.record_page_visit(p_path text,p_visitor uuid) returns void language plpgsql security definer set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'Africa/Cairo')::date;section text;begin
 if p_visitor is null or p_path is null or length(p_path)>100 then return;end if;
 if p_path<>'/' and p_path !~ '^/(ar|en)/(advice|comedy-will|dreams|auctions|frequencies|movie-stories|latest-news)/?$' then
  if p_path !~ '^/(ar|en)/(frequencies|movie-stories|latest-news)/[0-9a-f-]{36}$' then return;end if;
  section:=split_part(p_path,'/',3);
  if section='frequencies' then
   if not exists(select 1 from private.frequency_articles where id::text=split_part(p_path,'/',4) and status='published') then return;end if;
  elsif not exists(select 1 from private.cinema_posts where id::text=split_part(p_path,'/',4) and status='published' and kind=case when section='movie-stories' then 'movie' else 'news' end) then return;end if;
 end if;
 insert into private.page_traffic(day,path,visitor_hash) values(today,p_path,md5(p_visitor::text||today::text)) on conflict(day,path,visitor_hash) do update set views=page_traffic.views+1,last_seen=now() where page_traffic.last_seen<now()-interval '10 seconds';
end;$$;
