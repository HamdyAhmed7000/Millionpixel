-- Egypt mask: same normalized Natural Earth 1:50m polygon used by the renderer.
-- Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson
begin;
create or replace function private.is_egypt_slot(p_slot integer) returns boolean
language sql immutable parallel safe set search_path='' as $$
 select p_slot between 1 and 1000000 and polygon '((950.0,900.1732),(925.7307,900.1813),(901.4686,900.1854),(877.1922,900.1894),(852.9301,900.1935),(828.6608,900.1975),(804.3915,900.2015),(780.1223,900.2056),(755.853,900.2097),(731.591,900.2137),(707.3217,900.2178),(683.0524,900.2218),(658.7831,900.2258),(634.5211,900.2339),(610.2446,900.2339),(585.9826,900.2421),(561.7133,900.246),(547.8668,900.246),(550.2287,892.8846),(551.6878,887.6518),(550.0698,884.0297),(545.3387,883.1233),(542.2473,884.2685),(535.0099,899.7119),(531.2034,900.327),(522.5863,900.327),(494.33,900.323),(466.0735,900.3148),(437.8244,900.3068),(409.5608,900.3068),(381.3045,900.2987),(353.0553,900.2946),(324.799,900.2906),(296.5354,900.2866),(268.2862,900.2785),(240.0298,900.2744),(211.7735,900.2703),(183.5171,900.2664),(155.2607,900.2623),(127.0044,900.2542),(98.748,900.2501),(70.4916,900.246),(70.4916,881.6339),(70.4916,863.0218),(70.4916,844.4097),(70.4916,825.7975),(70.4916,807.1854),(70.4916,788.5732),(70.4916,769.957),(70.4916,751.3449),(70.4916,732.7328),(70.4916,714.1206),(70.4916,695.5085),(70.4916,676.8963),(70.4916,658.2841),(70.4916,639.672),(70.4916,621.0598),(70.4916,602.4477),(70.4916,583.8355),(70.4916,565.2234),(70.4916,546.6113),(70.4916,527.9992),(70.4916,509.387),(70.4916,490.7749),(70.4916,472.1586),(70.4916,453.5465),(70.4916,434.9344),(70.4916,416.3223),(70.4916,397.7101),(70.4916,379.0979),(70.4916,360.4858),(70.4916,341.8736),(70.4916,323.2615),(70.4916,304.6493),(69.856,301.173),(65.7461,288.5382),(62.0335,272.4595),(57.9597,252.694),(57.4324,246.2876),(50.6211,225.9393),(50.0,220.1764),(51.7191,216.0727),(62.893,198.9215),(66.259,190.5928),(69.0976,180.6048),(70.0221,172.4785),(66.7356,160.0541),(62.893,148.8845),(61.5929,137.4517),(61.0584,126.2091),(66.7717,118.5279),(73.6264,111.3566),(76.1834,106.9495),(80.2355,102.0),(83.0813,99.673),(88.6285,109.7176),(100.2215,111.4578),(138.0194,102.4978),(179.7394,111.5145),(202.7664,114.9747),(238.2241,122.6396),(259.8208,136.3307),(265.7437,138.0668),(281.2659,137.7956),(291.4431,145.8856),(331.9208,149.7789),(353.5248,158.7105),(365.7895,165.8333),(373.1352,168.0268),(379.6359,167.6706),(388.4335,164.9875),(399.4992,159.9732),(411.5616,153.0043),(436.5748,135.1044),(445.423,131.9599),(451.2014,132.7693),(458.2366,132.5427),(461.1692,127.6984),(464.8673,124.3677),(467.1931,120.5798),(470.9924,116.0309),(484.001,114.7561),(510.076,106.9777),(507.1652,110.6646),(483.4087,119.398),(493.5787,120.4867),(504.0015,117.4999),(515.8617,115.6019),(518.0141,111.8909),(519.5743,104.93),(521.864,103.9547),(530.0765,105.2578),(554.5192,115.9783),(560.5937,116.1847),(577.8061,110.3368),(581.4826,109.0863),(587.0516,112.3441),(599.7568,125.6911),(595.3219,125.4078),(581.721,113.971),(580.5147,119.6691),(572.7645,129.7098),(582.4505,134.0522),(590.3236,135.6831),(594.549,141.2801),(597.2215,146.2661),(604.9718,144.0928),(610.5407,137.31),(607.6515,133.5261),(605.6869,129.6126),(608.2294,129.5155),(613.6249,132.7369),(629.1039,145.6105),(634.3188,148.2612),(640.3284,147.8242),(652.8964,144.202),(656.3779,144.7646),(673.2653,140.0215),(675.2516,143.4979),(678.0324,146.9541),(691.6117,143.1053),(712.9556,143.1498),(730.4136,138.9612),(750.6597,128.7709),(752.2777,127.2209),(753.3394,129.7341),(755.7664,136.6949),(761.9204,154.3721),(767.2798,168.2291),(773.8599,187.42),(775.9185,194.7895),(776.7997,199.8726),(786.3341,220.9736),(791.9897,238.3312),(796.1357,252.4148),(801.9574,272.9856),(804.5071,280.1609),(800.3828,283.9085),(792.0908,297.296),(783.2716,339.7894),(770.6457,372.991),(769.2155,393.7805),(767.1859,401.2795),(761.1836,411.8098),(753.9028,422.1418),(740.9592,416.7917),(719.8897,398.6571),(707.6034,381.425),(694.4358,370.2957),(681.9834,355.5525),(678.5958,344.9453),(678.7258,338.1423),(673.2869,321.5254),(669.2637,313.6701),(654.0882,296.001),(649.7327,286.5714),(646.4029,282.4273),(643.0586,276.4782),(637.562,253.5479),(631.538,238.9989),(624.6834,243.0217),(625.8968,249.1488),(619.9162,257.6192),(616.3047,267.4534),(619.0784,275.4826),(631.4874,287.7046),(634.001,293.0425),(636.8902,304.625),(636.428,320.3679),(638.4288,325.714),(647.7175,337.4098),(651.0473,344.3504),(653.0481,350.34),(656.1323,355.7589),(665.3489,365.9492),(678.6102,385.3424),(691.1928,398.4142),(700.2648,404.7235),(704.1219,411.0489),(704.9887,427.3705),(704.3242,435.1489),(712.2839,449.8031),(715.2309,457.2172),(722.9522,463.2634),(726.4771,470.1635),(729.713,481.3898),(734.5957,514.5793),(741.2842,522.7259),(761.9781,566.3526),(779.4217,593.9693),(787.8654,614.5766),(800.7295,639.668),(825.945,694.7557),(840.9544,711.7612),(846.9278,721.3081),(857.7912,728.6655),(869.5647,739.2929),(858.3329,738.2528),(855.5087,738.8963),(851.5866,740.7134),(849.6942,747.1603),(848.8925,752.4295),(850.2504,780.3416),(853.3273,794.5506),(863.2012,821.4794),(870.5614,829.5572),(874.1441,834.7819),(879.1424,838.5982),(902.5377,847.7848),(916.2108,867.2307),(946.9158,891.8081),(949.9277,898.5949),(950.0,900.1732))' @> point(((p_slot-1)%1000)+0.5,((p_slot-1)/1000)+0.5)
$$;
revoke all on function private.is_egypt_slot(integer) from public,anon,authenticated;
create or replace function private.check_egypt_claim() returns trigger
language plpgsql security definer set search_path='' as $$
declare dx integer;dy integer;
begin
 for dy in 0..new.spot_size-1 loop for dx in 0..new.spot_size-1 loop
  if not private.is_egypt_slot(new.slot_number+dy*1000+dx) then raise exception 'Every tile in a placement must be inside the Egypt canvas. Choose an inland location.'; end if;
 end loop;end loop;return new;
end $$;
revoke all on function private.check_egypt_claim() from public,anon,authenticated;
drop trigger if exists a0_check_egypt_claim on public.slot_claims;
create trigger a0_check_egypt_claim before insert on public.slot_claims for each row execute function private.check_egypt_claim();
create or replace function public.get_egypt_canvas_status() returns jsonb
language sql stable security definer set search_path='' as $$
 with published as(select count(*) as total,count(*) filter(where private.is_egypt_slot(p.slot_number)) as on_map from public.published_slots p where p.expires_at>now()),
 held as(select count(*) as cells from public.slot_claim_cells cells join public.slot_claims c on c.id=cells.claim_id where c.status in('pending','published') and private.is_egypt_slot(cells.slot_number))
 select jsonb_build_object('capacity',556699,'published_tiles',p.on_map,'total_published',p.total,'legacy_published',p.total-p.on_map,'reserved_tiles',greatest(0,h.cells-p.on_map),'available',greatest(0,556699-greatest(h.cells,p.on_map))) from published p cross join held h
$$;
revoke all on function public.get_egypt_canvas_status() from public,anon,authenticated;
grant execute on function public.get_egypt_canvas_status() to anon,authenticated;
-- Keep existing finds and progress. Daily hunt coordinates are now sampled from Egypt.
create or replace function private.ensure_canvas_hunt() returns integer[]
language plpgsql security definer set search_path='' as $$
declare result integer[];today date:=(now() at time zone 'UTC')::date;candidate integer;
begin
 insert into private.canvas_hunts(hunt_date,slots) values(today,array[]::integer[]) on conflict do nothing;
 select array(select distinct n from unnest(h.slots) n where private.is_egypt_slot(n)) into result from private.canvas_hunts h where hunt_date=today for update;
 while cardinality(result)<3 loop
  candidate:=(floor(random()*1000000)+1)::integer;
  if private.is_egypt_slot(candidate) and not(candidate=any(result)) then result:=array_append(result,candidate);end if;
 end loop;
 update private.canvas_hunts set slots=result where hunt_date=today;return result;
end $$;
revoke all on function private.ensure_canvas_hunt() from public,anon,authenticated;
update private.canvas_riddle_steps set slot=100083,question='At the northern shore, count the sides of a square. Spell the number.' where step=1;
update private.canvas_riddle_steps set slot=499500 where step=2;
update private.canvas_riddle_steps set slot=777778 where step=3;
create or replace function public.get_canvas_games() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; today date := (now() at time zone 'UTC')::date; hunt integer[]; winner integer;
begin
 hunt:=private.ensure_canvas_hunt();
 -- Yesterday's unique, non-tied winner receives today's cosmetic champion border.
 select v.slot_number into winner from public.canvas_battle_votes v join public.published_slots p on p.slot_number=v.slot_number and p.expires_at>now()
 where v.round_date=today-1 group by v.slot_number having count(*)>=2 and count(*)>(select count(*) from public.canvas_battle_votes other where other.round_date=today-1 and other.slot_number<>v.slot_number)
 order by count(*) desc limit 1;
 with active as (
  select p.*,c.user_id from public.published_slots p join public.slot_claim_cells cells on cells.slot_number=p.slot_number
  join public.slot_claims c on c.id=cells.claim_id where p.expires_at>now() and c.status='published'
 ), user_stats as (
  select a.user_id,min(a.anchor_slot) as spot,min(a.display_name) as name,count(*) as area,
  bool_or(a.col_index between 450 and 549 and a.row_index between 450 and 549) as center_pioneer,
  bool_or(a.spot_size*a.spot_size>=10) as art_director
  from active a group by a.user_id
 ), views as (
  select a.user_id,count(*) filter(where v.view_date>=today-6) as weekly_clicks,count(*) as total_clicks
  from active a join public.spot_view_events v on v.slot_number=a.slot_number group by a.user_id
 ), engagements as (
  select a.user_id,count(*) as weekly_interactions from active a join public.canvas_interactions i on i.slot_number=a.slot_number where i.event_date>=today-6 and i.kind='hover' group by a.user_id
 ), first_claims as (
  select c.user_id,min(c.reviewed_at) as first_at from public.slot_claims c where c.reviewed_at is not null and c.status in('published','expired') group by c.user_id
 ), pioneer_users as (
  select f.*,row_number() over(order by f.first_at,f.user_id) as pioneer_number from first_claims f
  where f.first_at < (select min(first_at) from first_claims)+interval '7 days'
 ), people as (
  select u.*,exists(select 1 from active a join public.spot_view_events sv on sv.slot_number=a.slot_number where a.user_id=u.user_id group by a.slot_number having count(*)>=1000) as viral_spot,(coalesce(e.weekly_interactions,0)+coalesce(v.weekly_clicks,0)) as weekly_interactions,coalesce(v.weekly_clicks,0) as weekly_clicks,coalesce(v.total_clicks,0) as total_clicks,
  case when pu.pioneer_number<=100 then pu.pioneer_number else null end as pioneer_number,
  exists(select 1 from public.canvas_hunt_finds f where f.user_id=u.user_id) as golden_explorer
  from user_stats u left join engagements e on e.user_id=u.user_id left join views v on v.user_id=u.user_id left join pioneer_users pu on pu.user_id=u.user_id
 ), guild_stats as (
  select g.id,g.name,g.description,g.status,
   (select count(*) from public.canvas_guild_members m where m.guild_id=g.id) as members,
   (select count(*) from active a join public.canvas_guild_members m on m.user_id=a.user_id where m.guild_id=g.id) as area
  from public.canvas_guilds g where g.status='approved' or g.owner_id=auth.uid() or private.is_admin()
 )
 select jsonb_build_object(
  'today',today,'champion',winner,'champion_until',((today+1)::timestamp at time zone 'UTC'),
  'guilds',coalesce((select jsonb_agg(to_jsonb(g) order by g.area desc,g.name) from (select * from guild_stats order by area desc,name limit 100) g),'[]'::jsonb),
  'my_guild',(select guild_id from public.canvas_guild_members where user_id=auth.uid()),
  'people',coalesce((select jsonb_agg(jsonb_build_object('spot',p.spot,'name',p.name,'area',p.area,'weekly_interactions',p.weekly_interactions,'weekly_clicks',p.weekly_clicks,'viral_spot',p.viral_spot,'total_clicks',p.total_clicks,'pioneer_number',p.pioneer_number,'center_pioneer',p.center_pioneer,'art_director',p.art_director,'golden_explorer',p.golden_explorer,'level',1+floor(sqrt(p.area+ p.total_clicks/100.0)))) from (select * from people order by weekly_interactions desc,area desc limit 100) p),'[]'::jsonb),
  'empires',coalesce((select jsonb_agg(jsonb_build_object('spot',p.spot,'name',p.name,'area',p.area,'pioneer_number',p.pioneer_number,'level',1+floor(sqrt(p.area+p.total_clicks/100.0)))) from (select * from people order by area desc,spot limit 100) p),'[]'::jsonb),
  'pioneers',coalesce((select jsonb_agg(jsonb_build_object('spot',p.spot,'name',p.name,'area',p.area,'pioneer_number',p.pioneer_number,'level',1+floor(sqrt(p.area+p.total_clicks/100.0)))) from (select * from people where pioneer_number is not null order by pioneer_number limit 100) p),'[]'::jsonb),
  'decorations',coalesce((select jsonb_agg(jsonb_build_object('slot',a.slot_number,'golden_explorer',p.golden_explorer,'center_pioneer',p.center_pioneer,'art_director',p.art_director,'pioneer_number',p.pioneer_number,'viral_spot',p.viral_spot,'total_clicks',p.total_clicks)) from (select * from active where slot_number=anchor_slot order by slot_number limit 1000) a join people p on p.user_id=a.user_id),'[]'::jsonb),
  'my_achievements',coalesce((select jsonb_build_object('area',p.area,'viral_spot',p.viral_spot,'total_clicks',p.total_clicks,'pioneer_number',p.pioneer_number,'center_pioneer',p.center_pioneer,'art_director',p.art_director,'golden_explorer',p.golden_explorer,'level',1+floor(sqrt(p.area+p.total_clicks/100.0))) from people p where p.user_id=auth.uid()),jsonb_build_object('level',1,'golden_explorer',exists(select 1 from public.canvas_hunt_finds f where f.user_id=auth.uid()))),
  'battle',coalesce((select jsonb_agg(jsonb_build_object('slot',p.slot_number,'name',p.display_name,'image_path',p.image_path,'votes',(select count(*) from public.canvas_battle_votes v where v.round_date=today and v.slot_number=p.slot_number))) from public.published_slots p where p.slot_number in(select private.canvas_battle_candidates(today))),'[]'::jsonb),
  'my_vote',(select slot_number from public.canvas_battle_votes where user_id=auth.uid() and round_date=today),
  'hunt', (select jsonb_agg(jsonb_build_object('column',(((n-1)%1000)/10)*10+1,'row',(((n-1)/1000)/10)*10+1,'found',exists(select 1 from public.canvas_hunt_finds f where f.user_id=auth.uid() and f.hunt_date=today and f.slot_number=n))) from unnest(hunt) n),
  'golden_finds',(select count(*) from public.canvas_hunt_finds where user_id=auth.uid()),
  'heatmap',coalesce((select jsonb_agg(to_jsonb(h)) from (select i.slot_number as slot,count(*) as interactions from public.canvas_interactions i join public.published_slots p on p.slot_number=i.slot_number and p.expires_at>now() where i.event_date>=today-6 group by i.slot_number order by count(*) desc limit 250) h),'[]'::jsonb),
  'territory',coalesce((select jsonb_agg(to_jsonb(t)) from (select a.slot_number as slot,m.guild_id from active a join public.canvas_guild_members m on m.user_id=a.user_id join public.canvas_guilds g on g.id=m.guild_id and g.status='approved' order by a.slot_number limit 10000) t),'[]'::jsonb),
  'landmark_crown',(select jsonb_build_object('slot',p.slot_number,'name',p.display_name,'views',count(v.*)) from public.published_slots p join public.spot_view_events v on v.slot_number=p.slot_number and v.view_date>=date_trunc('month',now())::date where p.slot_number in(100083,219051,499500,499501,500500,500501,777778,899501,899950) and p.expires_at>now() group by p.slot_number,p.display_name order by count(v.*) desc,p.slot_number limit 1)
 ) into result;
 return result;
end $$;
commit;
