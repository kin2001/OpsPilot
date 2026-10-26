begin;
select no_plan();
-- Dedicated identities keep tenant/day and invitation limits independent of other suites.
insert into auth.users(id,email,email_confirmed_at)
 select ('00000044-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'limits44-'||n||'@example.test',now() from generate_series(1,2)n;
insert into public.organizations(id,name,timezone,currency,created_by)
 select ('10000044-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic limits','UTC','PHP','00000044-0000-4000-8000-000000000001' from generate_series(1,2)n;
insert into public.organization_members(organization_id,user_id,role)
 select ('10000044-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000044-0000-4000-8000-000000000001','owner' from generate_series(1,2)n;
do $$ begin perform set_config('request.jwt.claim.sub','00000044-0000-4000-8000-000000000001',true); perform set_config('request.jwt.claims','{"aal":"aal2"}',true); end $$;
create function pg_temp.ctx(n integer) returns jsonb language sql as $$
 select jsonb_build_object('organization_id',('10000044-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'request_id',gen_random_uuid()) $$;
create temp table committed as select pg_temp.ctx(1) ctx,'{"code":"LIMITS","name":"Synthetic asset","category":"pump"}'::jsonb fields;
alter table committed add column result jsonb;
update committed set result=public.save_asset(ctx,null,fields);
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
 select '10000044-0000-4000-8000-000000000001','00000044-0000-4000-8000-000000000002',gen_random_uuid(),'synthetic_daily_limit','fixture','{}' from generate_series(1,4998);
select lives_ok($$select private.rate_check('10000044-0000-4000-8000-000000000001','00000044-0000-4000-8000-000000000001','save_asset')$$,'4999 tenant commands leave the final admission available');
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
 values('10000044-0000-4000-8000-000000000001','00000044-0000-4000-8000-000000000002',gen_random_uuid(),'synthetic_daily_limit','fixture','{}');
select throws_ok($$select public.save_asset(pg_temp.ctx(1),null,'{"code":"DENIED","name":"Synthetic denied","category":"pump"}')$$,'P0001','RATE_LIMITED','5000 tenant/day denies new intake');
select is((select count(*) from public.assets where organization_id='10000044-0000-4000-8000-000000000001'),1::bigint,'Quota denial leaves no partial asset');
select is((select public.save_asset(ctx,null,fields) from committed),(select result from committed),'Lost acknowledgement remains discoverable at quota');
select throws_ok($$select public.save_asset(ctx,null,fields||'{"name":"Changed retry"}') from committed$$,'P0001','CONFLICT','Quota cannot hide changed-payload replay conflict');
select lives_ok($$select public.save_asset(pg_temp.ctx(2),null,'{"code":"OTHER","name":"Synthetic other tenant","category":"pump"}')$$,'One exhausted tenant does not block another');
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
 select '10000044-0000-4000-8000-000000000002','00000044-0000-4000-8000-000000000002',gen_random_uuid(),'create_organization_invitation','fixture','{}' from generate_series(1,99);
select lives_ok($$select private.rate_check('10000044-0000-4000-8000-000000000002','00000044-0000-4000-8000-000000000001','create_organization_invitation')$$,'99 tenant invitations leave final admission available');
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
 values('10000044-0000-4000-8000-000000000002','00000044-0000-4000-8000-000000000002',gen_random_uuid(),'create_organization_invitation','fixture','{}');
select throws_ok($$select public.create_organization_invitation(pg_temp.ctx(2),'limits-recipient@example.test','technician')$$,'P0001','RATE_LIMITED','100 tenant invitations/day deny fresh invitation without delivery');
select is((select count(*) from public.organization_invitations where organization_id='10000044-0000-4000-8000-000000000002'),0::bigint,'Denied invitation has no token or membership effect');
select * from finish();
rollback;
