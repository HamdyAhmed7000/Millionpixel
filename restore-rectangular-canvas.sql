begin;
drop trigger if exists a0_check_egypt_claim on public.slot_claims;
create or replace function private.is_egypt_slot(p_slot integer) returns boolean language sql immutable parallel safe set search_path='' as $$ select p_slot between 1 and 1000000; $$;
create or replace function private.ensure_canvas_hunt() returns integer[] language plpgsql security definer set search_path='' as $$ declare result integer[]; today date:=(now() at time zone 'UTC')::date; begin insert into private.canvas_hunts(hunt_date,slots) select today,array(select distinct (floor(random()*1000000)+1)::integer from generate_series(1,12) limit 3) on conflict(hunt_date) do nothing; select slots into result from private.canvas_hunts where hunt_date=today; return result; end $$;
do $$declare definition text;begin select pg_get_functiondef('public.get_canvas_games()'::regprocedure) into definition; definition:=replace(definition,'in(100083,219051,499500,499501,500500,500501,777778,899501,899950)','in(1,1000,999001,1000000,499500,499501,500500,500501,777778)');execute definition;end$$;
commit;
