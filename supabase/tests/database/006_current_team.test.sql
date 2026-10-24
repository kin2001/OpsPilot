begin;
set local search_path=public,extensions;
select plan(18);

insert into auth.users(id,email,email_confirmed_at)
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'team-'||n||'@example.test',now()
from (select generate_series(1,101) as n union all select generate_series(201,207) union all select generate_series(301,397)) identities;
insert into public.organizations(id,name,timezone,currency,created_by) values
 ('10000000-0000-4000-8000-000000000001','Synthetic retained team','UTC','PHP','00000000-0000-4000-8000-000000000201'),
 ('10000000-0000-4000-8000-000000000002','Synthetic other team','UTC','PHP','00000000-0000-4000-8000-000000000207');
insert into public.organization_members(organization_id,user_id,role,active)
select '10000000-0000-4000-8000-000000000001',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'technician',false
from generate_series(1,101) n;
insert into public.organization_members(organization_id,user_id,role,active) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','owner',true),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','manager',true),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000203','supervisor',true),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000204','technician',true),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000205','supervisor',false),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000207','owner',true);
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true); end $$;
create temporary table observed_team as select public.get_team('10000000-0000-4000-8000-000000000001') as rows;

select ok(has_function_privilege('authenticated','public.get_team(uuid)','EXECUTE'),'Authenticated execution remains granted');
select ok(not has_function_privilege('anon','public.get_team(uuid)','EXECUTE'),'Anonymous execution remains denied');
select is((select jsonb_array_length(rows) from observed_team),100,'Response retains the existing bound');
select is((select count(*)::integer from observed_team,jsonb_array_elements(rows) m where (m->>'active')::boolean),4,'All current active members survive more than 100 earlier inactive records');
select is((select jsonb_agg(m->>'user_id' order by m->>'user_id') from observed_team,jsonb_array_elements(rows) m where (m->>'active')::boolean),
 '["00000000-0000-4000-8000-000000000201","00000000-0000-4000-8000-000000000202","00000000-0000-4000-8000-000000000203","00000000-0000-4000-8000-000000000204"]'::jsonb,'Exact current identities appear once');
select is((select count(*)::integer from observed_team,jsonb_array_elements(rows) m where not (m->>'active')::boolean),96,'Inactive consumers retain bounded historical rows');
select ok(not exists(select 1 from observed_team,jsonb_array_elements(rows) m where m->>'user_id'='00000000-0000-4000-8000-000000000207'),'Other tenant members are excluded');
select ok((select bool_and((select array_agg(key order by key) from jsonb_object_keys(m) key)=array['active','role','user_id','version']) from observed_team,jsonb_array_elements(rows) m),'Strict four-field shape is unchanged');
select is((select jsonb_agg(m order by ordinal) from observed_team,jsonb_array_elements(rows) with ordinality x(m,ordinal)),
 (select jsonb_agg(m order by m->>'user_id') from observed_team,jsonb_array_elements(rows) m),'Outward UUID ordering is unchanged');
select is((select count(*)::integer from public.organization_members where organization_id='10000000-0000-4000-8000-000000000001'),106,'Roster reads do not discard retained membership records');
select throws_ok($$select public.get_team('10000000-0000-4000-8000-000000000002')$$,'P0001','FORBIDDEN','Wrong tenant operations access is denied');
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000202',true); end $$;
select lives_ok($$select public.get_team('10000000-0000-4000-8000-000000000001')$$,'Current manager retains access');
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000203',true); end $$;
select lives_ok($$select public.get_team('10000000-0000-4000-8000-000000000001')$$,'Current supervisor retains access');
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000204',true); end $$;
select throws_ok($$select public.get_team('10000000-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Technician role remains denied');
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000205',true); end $$;
select throws_ok($$select public.get_team('10000000-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Inactive operations member remains denied');
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000206',true); end $$;
select throws_ok($$select public.get_team('10000000-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Nonmember remains denied');
insert into public.organization_members(organization_id,user_id,role)
select '10000000-0000-4000-8000-000000000001',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'technician'
from generate_series(301,397) n;
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000201',true); end $$;
select throws_ok($$select public.get_team('10000000-0000-4000-8000-000000000001')$$,'P0001','DEPENDENCY_UNAVAILABLE','Over-bound current roster fails closed instead of reporting partial success');
select is((select count(*)::integer from public.organization_members where organization_id='10000000-0000-4000-8000-000000000001'),203,'Over-bound read failure preserves every membership');
select * from finish();
rollback;
