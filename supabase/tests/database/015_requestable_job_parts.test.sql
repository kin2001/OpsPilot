begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('00000038-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'job38-'||n||'@example.test',now() from generate_series(1,4) n;
insert into public.organizations(id,name,timezone,currency,created_by) values('10000038-0000-4000-8000-000000000001','Synthetic job38','UTC','PHP','00000038-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000038-0000-4000-8000-000000000001','00000038-0000-4000-8000-000000000001','owner'),
 ('10000038-0000-4000-8000-000000000001','00000038-0000-4000-8000-000000000002','technician'),
 ('10000038-0000-4000-8000-000000000001','00000038-0000-4000-8000-000000000003','inventory');
insert into public.assets(id,organization_id,code,name,category,created_by) values('20000038-0000-4000-8000-000000000001','10000038-0000-4000-8000-000000000001','J38','Synthetic pump','pump','00000038-0000-4000-8000-000000000001');
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('30000038-0000-4000-8000-000000000001','10000038-0000-4000-8000-000000000001',1,'20000038-0000-4000-8000-000000000001','Synthetic repair','Synthetic allocation','pump','normal','00000038-0000-4000-8000-000000000001','open','00000038-0000-4000-8000-000000000001');
insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('10000038-0000-4000-8000-000000000001','30000038-0000-4000-8000-000000000001','00000038-0000-4000-8000-000000000002');
insert into public.parts(id,organization_id,code,name,unit,created_by) values('40000038-0000-4000-8000-000000000001','10000038-0000-4000-8000-000000000001','KG','Synthetic stock','kg','00000038-0000-4000-8000-000000000001');
insert into public.parts(id,organization_id,code,name,unit,archived_at,created_by) values
 ('40000038-0000-4000-8000-000000000002','10000038-0000-4000-8000-000000000001','B','Second stock','each',null,'00000038-0000-4000-8000-000000000001'),
 ('40000038-0000-4000-8000-000000000003','10000038-0000-4000-8000-000000000001','C','Archived stock','each',now(),'00000038-0000-4000-8000-000000000001');
create function pg_temp.lookup(cursor uuid default null,page_size integer default 25) returns jsonb language sql as $$select public.list_requestable_job_parts('10000038-0000-4000-8000-000000000001','30000038-0000-4000-8000-000000000001',cursor,page_size)$$;
do $$begin perform set_config('request.jwt.claim.sub','00000038-0000-4000-8000-000000000002',true);end$$;
select is(pg_temp.lookup(null,1),' {"items":[{"id":"40000038-0000-4000-8000-000000000001","code":"KG","name":"Synthetic stock","unit":"kg"}],"next_cursor":"40000038-0000-4000-8000-000000000001"}'::jsonb,'First page exposes only four fields and stable continuation');
select is(pg_temp.lookup('40000038-0000-4000-8000-000000000001',1),'{"items":[{"id":"40000038-0000-4000-8000-000000000002","code":"B","name":"Second stock","unit":"each"}],"next_cursor":null}'::jsonb,'Continuation excludes archived parts without duplicates');
select is(pg_temp.lookup('40000038-0000-4000-8000-000000000003'),'{"items":[],"next_cursor":null}'::jsonb,'Exhausted cursor yields empty page');
select throws_ok(format('select pg_temp.lookup(null,%s)',coalesce(size::text,'null')),'P0001','VALIDATION','Page bound rejected') from (values(0),(101),(null::integer)) limits(size);
select lives_ok($$select pg_temp.lookup(null,100)$$,'Maximum page accepted');
select throws_ok($$select public.list_inventory_parts('10000038-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Technician still has no general inventory access');
select throws_ok($$select public.list_requestable_job_parts('10000038-0000-4000-8000-000000000002','30000038-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Wrong tenant denied before disclosure');
select throws_ok($$select public.list_requestable_job_parts('10000038-0000-4000-8000-000000000001',gen_random_uuid())$$,'P0001','FORBIDDEN','Unassigned or missing job denied uniformly');
update public.organization_members set active=false where user_id='00000038-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.lookup()$$,'P0001','FORBIDDEN','Revoked membership takes effect on next page');
update public.organization_members set active=true where user_id='00000038-0000-4000-8000-000000000002';
update public.work_order_assignments set unassigned_at=now() where user_id='00000038-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.lookup()$$,'P0001','FORBIDDEN','Removed assignment takes effect on next page');
do $$begin perform set_config('request.jwt.claim.sub','00000038-0000-4000-8000-000000000001',true);end$$;
select throws_ok($$select pg_temp.lookup()$$,'P0001','FORBIDDEN','Owner cannot impersonate technician lookup');
set local role anon;
select throws_ok($$select public.list_requestable_job_parts(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'Anonymous execute denied');
reset role;
set local role service_role;
select throws_ok($$select public.list_requestable_job_parts(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'Service execute denied');
reset role;
set local role authenticated;
select throws_ok($$select * from public.parts$$,'42501',null,'Lookup does not grant direct catalog access');
reset role;
select * from finish();
rollback;
