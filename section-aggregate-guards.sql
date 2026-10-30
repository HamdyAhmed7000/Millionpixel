-- Cover SQL-language aggregates that intentionally use definer access.
begin;
do $$declare r record;body text;begin
 for r in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and l.lanname='sql' and p.prosecdef and p.proname in('get_slot_like_summary','get_spot_discovery_leaderboard','get_community_challenge_spots') loop
  if strpos(r.prosrc,'/* section aggregate guard */')>0 then continue;end if;
  body:='select guarded.* from ('||regexp_replace(trim(r.prosrc),';\s*$','')||') guarded where private.section_open(''home'') /* section aggregate guard */';
  execute format('create or replace function %I.%I(%s) returns %s language sql %s security definer set search_path='''' as %L',r.nspname,r.proname,pg_get_function_identity_arguments(r.oid),pg_get_function_result(r.oid),case r.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end,body);
 end loop;
end;$$;
do $$declare r record;begin for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and (c.relname like 'canvas_%' or c.relname in('community_challenges','community_challenge_templates','community_challenge_votes','slot_claim_cells','spot_view_events')) loop
 execute format('drop policy if exists celltalk_section_guard on public.%I',r.relname);
 execute format('create policy celltalk_section_guard on public.%I as restrictive for all to anon,authenticated using((select private.section_open(''home''))) with check((select private.section_open(''home'')))',r.relname);
 end loop;end;$$;
notify pgrst,'reload schema';
commit;
