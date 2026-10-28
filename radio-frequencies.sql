alter table private.frequency_articles add column if not exists mood text not null default 'curious' check(mood in('curious','funny','mystery','inspiring','quick'));
alter table private.frequency_articles add column if not exists quote text not null default '' check(length(quote)<=240);
alter table private.frequency_articles add column if not exists is_micro boolean not null default false;
alter table private.frequency_articles add column if not exists mystery_day date;
alter table private.frequency_articles add column if not exists mystery_target integer not null default 5 check(mystery_target between 1 and 1000);
create unique index if not exists frequency_daily_mystery on private.frequency_articles(lang,mystery_day) where mystery_day is not null and status='published';
create table if not exists private.frequency_signals(article_id uuid not null references private.frequency_articles(id),user_id uuid not null references auth.users(id),strength integer not null check(strength between 1 and 5),updated_at timestamptz not null default now(),primary key(article_id,user_id));
create table if not exists private.frequency_unlocks(article_id uuid not null references private.frequency_articles(id),user_id uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(article_id,user_id));
create table if not exists private.frequency_submissions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),author_name text not null,title text not null check(length(title) between 3 and 160),body text not null check(length(body) between 50 and 10000),category text not null check(category in('world','sports','politics','health','technology','culture','science','other')),lang text not null check(lang in('ar','en')),mood text not null check(mood in('curious','funny','mystery','inspiring','quick')),status text not null default 'pending' check(status in('pending','accepted','rejected')),reason text,article_id uuid references private.frequency_articles(id),created_at timestamptz not null default now());
create index if not exists frequency_submissions_owner on private.frequency_submissions(user_id,created_at desc);
alter table private.frequency_signals enable row level security;alter table private.frequency_unlocks enable row level security;alter table private.frequency_submissions enable row level security;
revoke all on private.frequency_signals,private.frequency_unlocks,private.frequency_submissions from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['private.frequency_signals','private.frequency_unlocks','private.frequency_submissions'] loop if not exists(select 1 from pg_trigger where tgname='celltalk_member_guard' and tgrelid=t::regclass) then execute format('create trigger celltalk_member_guard before insert or update on %s for each row execute function private.guard_banned_member()',t);end if;end loop;end;$$;
create or replace function private.frequency_readable(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.frequency_articles a where a.id=p_id and a.status='published' and (a.mystery_day is null or (a.mystery_day<=(clock_timestamp() at time zone 'Africa/Cairo')::date and (select count(*) from private.frequency_unlocks u where u.article_id=a.id)>=a.mystery_target)));$$;
revoke all on function private.frequency_readable(uuid) from public;grant execute on function private.frequency_readable(uuid) to anon,authenticated;
-- Guard every legacy public article surface, including direct URLs and comments.
do $$declare s text;begin s:=pg_get_functiondef('private.frequency_api(text,jsonb)'::regprocedure);if strpos(s,'private.frequency_readable')=0 then
 s:=replace(s,$old$status='published' and (coalesce(p_data->>'lang'$old$,$new$status='published' and private.frequency_readable(id) and (coalesce(p_data->>'lang'$new$);
 s:=replace(s,$old$where id=target and status='published'$old$,$new$where id=target and status='published' and private.frequency_readable(id)$new$);
 s:=replace(s,$old$a.status='published' and c.status='published'$old$,$new$a.status='published' and private.frequency_readable(a.id) and c.status='published'$new$);execute s;end if;end;$$;
create or replace function private.radio_api(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<radio>>
declare actor uuid:=auth.uid();owner boolean:=coalesce(private.advice_admin(),false);result jsonb;target uuid;v_page integer:=greatest(0,least(10000,coalesce((p_data->>'page')::integer,0)));today date:=(clock_timestamp() at time zone 'Africa/Cairo')::date;who text;reason text:=trim(p_data->>'reason');story private.frequency_submissions;chosen private.frequency_articles;v_count integer;v_strength integer;v_status text;
begin
 if p_action in('feed','random') then
  if jsonb_typeof(coalesce(p_data->'seen','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'seen','[]'))>200 then raise exception 'SEEN_INVALID';end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.published_at desc,q.id),'[]') into result from(
   select a.id,a.title,a.excerpt,a.category,a.cover,a.lang,a.author_name,a.published_at,a.mood,a.quote,a.is_micro,greatest(1,ceil(cardinality(regexp_split_to_array(trim(a.body),'\s+'))::numeric/180))::int reading_minutes,case when a.is_micro then left(a.body,600) end micro_text,
    (select round(avg(strength),1) from private.frequency_signals where article_id=a.id) signal,(select count(*) from private.frequency_signals where article_id=a.id) signal_count
   from private.frequency_articles a where private.frequency_readable(a.id) and a.lang=coalesce(p_data->>'lang','ar') and (coalesce(p_data->>'category','')='' or a.category=p_data->>'category') and (coalesce(p_data->>'mood','')='' or a.mood=p_data->>'mood' or (p_data->>'mood'='quick' and cardinality(regexp_split_to_array(trim(a.body),'\s+'))<=360)) and (coalesce(p_data->>'q','')='' or a.title ilike '%'||left(p_data->>'q',80)||'%' or a.excerpt ilike '%'||left(p_data->>'q',80)||'%') and (p_action<>'random' or (a.id::text<>coalesce(p_data->>'exclude','') and not exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'seen','[]')) v where v=a.id::text)))
   order by case when p_action='random' then random() else 0 end,a.published_at desc,a.id limit case when p_action='random' then 1 else 13 end offset case when p_action='random' then 0 else v_page*12 end
  )q;
  if p_action='random' then return coalesce(result->0,'null');end if;return jsonb_build_object('items',result);
 elsif p_action='article' then
  target:=(p_data->>'id')::uuid;if not private.frequency_readable(target) then raise exception 'ARTICLE_NOT_FOUND';end if;
  result:=private.frequency_api('article',p_data);select * into chosen from private.frequency_articles where id=target;
  return result||jsonb_build_object('mood',chosen.mood,'quote',chosen.quote,'is_micro',chosen.is_micro,'reading_minutes',greatest(1,ceil(cardinality(regexp_split_to_array(trim(chosen.body),'\s+'))::numeric/180))::int,'signal',(select round(avg(strength),1) from private.frequency_signals where article_id=target),'signal_count',(select count(*) from private.frequency_signals where article_id=target),'my_signal',(select strength from private.frequency_signals where article_id=target and user_id=actor));
 elsif p_action='station' then
  return jsonb_build_object('latest',(select max(published_at) from private.frequency_articles where lang=coalesce(p_data->>'lang','ar') and private.frequency_readable(id)),'readers',(select count(*) from private.online_browsers where last_seen>=now()-interval '5 minutes' and path ~ '^/(ar|en)/frequencies'));
 elsif p_action='mystery' then
  select * into chosen from private.frequency_articles where status='published' and mystery_day=today and lang=coalesce(p_data->>'lang','ar');if not found then return 'null';end if;
  select count(*) into v_count from private.frequency_unlocks where article_id=chosen.id;
  return jsonb_build_object('id',chosen.id,'target',chosen.mystery_target,'progress',v_count,'joined',exists(select 1 from private.frequency_unlocks where article_id=chosen.id and user_id=actor),'unlocked',v_count>=chosen.mystery_target,'title',case when v_count>=chosen.mystery_target then chosen.title end);
 end if;
 if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'SIGN_IN_REQUIRED';end if;
 if exists(select 1 from private.member_discipline where user_id=actor and state='banned') and p_action in('rate','unlock','submit') then raise exception 'PARTICIPATION_BANNED';end if;
 select coalesce(a.handle,'CellTalk member') into who from auth.users u left join public.advice_profiles a on a.user_id=u.id where u.id=actor;
 if p_action='rate' then
  target:=(p_data->>'id')::uuid;v_strength:=(p_data->>'strength')::integer;if not private.frequency_readable(target) then raise exception 'ARTICLE_NOT_FOUND';end if;
  insert into private.frequency_signals(article_id,user_id,strength) values(target,actor,v_strength) on conflict(article_id,user_id) do update set strength=excluded.strength,updated_at=now();return '{"ok":true}';
 elsif p_action='unlock' then
  target:=(p_data->>'id')::uuid;select * into chosen from private.frequency_articles where id=target and status='published' and mystery_day=today for update;if not found then raise exception 'MYSTERY_NOT_FOUND';end if;
  insert into private.frequency_unlocks(article_id,user_id) values(target,actor) on conflict do nothing;return '{"ok":true}';
 elsif p_action='submit' then
  perform 1 from auth.users where id=actor for update;
  if (select count(*) from private.frequency_submissions where user_id=actor and created_at>now()-interval '1 day')>=3 then raise exception 'SUBMISSION_LIMIT';end if;
  if not coalesce((p_data->>'original')::boolean,false) then raise exception 'ORIGINAL_REQUIRED';end if;
  if exists(select 1 from private.frequency_submissions where user_id=actor and body=trim(p_data->>'body')) then raise exception 'DUPLICATE_STORY';end if;
  insert into private.frequency_submissions(user_id,author_name,title,body,category,lang,mood) values(actor,who,trim(p_data->>'title'),trim(p_data->>'body'),p_data->>'category',p_data->>'lang',p_data->>'mood') returning id into target;return jsonb_build_object('ok',true,'id',target);
 elsif p_action='mine' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from(select s.id,s.title,s.status,s.reason,s.created_at,case when private.frequency_readable(s.article_id) then s.article_id end published_id from private.frequency_submissions s where user_id=actor order by created_at desc limit 30)q;return jsonb_build_object('items',result);
 end if;
 if not owner then raise exception 'ADMIN_REQUIRED';end if;
 if p_action='submissions' then select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from(select * from private.frequency_submissions order by created_at desc,id limit 21 offset v_page*20)q;return jsonb_build_object('items',result);end if;
 if p_action='pending_stats' then return jsonb_build_object('pending',(select count(*) from private.frequency_submissions where status='pending'));end if;
 if reason is null or length(reason) not between 5 and 500 then raise exception 'REASON_REQUIRED';end if;
 if p_action='editor_save' then
  if coalesce((p_data->>'is_micro')::boolean,false) and (length(p_data->>'body')>600 or position(':::image' in p_data->>'body')>0) then raise exception 'MICRO_MAX_600';end if;
  result:=private.frequency_api('save',p_data);target:=(result->>'id')::uuid;
  update private.frequency_articles set mood=coalesce(p_data->>'mood','curious'),quote=coalesce(p_data->>'quote',''),is_micro=coalesce((p_data->>'is_micro')::boolean,false),mystery_day=nullif(p_data->>'mystery_day','')::date,mystery_target=coalesce((p_data->>'mystery_target')::int,5) where id=target;
 elsif p_action='review_submission' then
  target:=(p_data->>'id')::uuid;select * into story from private.frequency_submissions where id=target and status='pending' for update;if not found then raise exception 'NOT_PENDING';end if;
  if p_data->>'decision'='approve' then
   if coalesce(p_data->>'cover','') not like 'https://%' then raise exception 'COVER_REQUIRED';end if;
   insert into private.frequency_articles(title,excerpt,body,category,cover,lang,status,author_id,author_name,mood) values(story.title,left(story.body,240),story.body,story.category,p_data->>'cover',story.lang,'draft',story.user_id,story.author_name,story.mood) returning id into target;
   update private.frequency_submissions set status='accepted',reason=radio.reason,article_id=target where id=story.id;
  elsif p_data->>'decision'='reject' then update private.frequency_submissions set status='rejected',reason=radio.reason where id=story.id;
  else raise exception 'DECISION_INVALID';end if;
  result:=jsonb_build_object('ok',true,'id',target);
 else raise exception 'ACTION_INVALID';end if;
 insert into private.editor_events(actor,actor_name,action,kind,target_id,details) values(actor,who,'radio_'||p_action,'article',target::text,jsonb_build_object('reason',reason,'title',p_data->>'title'));
 return result;
end;$$;
revoke all on function private.radio_api(text,jsonb) from public;grant execute on function private.radio_api(text,jsonb) to anon,authenticated;
create or replace function public.radio_api(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' return private.radio_api(p_action,p_data);
revoke all on function public.radio_api(text,jsonb) from public;grant execute on function public.radio_api(text,jsonb) to anon,authenticated;
