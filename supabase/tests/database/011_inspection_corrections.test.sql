begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('00000033-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'correction33-'||n||'@example.test',now() from generate_series(1,4) n;
insert into public.organizations(id,name,timezone,currency,created_by) values
 ('10000033-0000-4000-8000-000000000001','Synthetic inspections','UTC','PHP','00000033-0000-4000-8000-000000000001'),
 ('10000033-0000-4000-8000-000000000002','Other inspections','UTC','PHP','00000033-0000-4000-8000-000000000004');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000033-0000-4000-8000-000000000001','00000033-0000-4000-8000-000000000001','owner'),
 ('10000033-0000-4000-8000-000000000001','00000033-0000-4000-8000-000000000002','technician'),
 ('10000033-0000-4000-8000-000000000001','00000033-0000-4000-8000-000000000003','inventory'),
 ('10000033-0000-4000-8000-000000000002','00000033-0000-4000-8000-000000000004','owner');
insert into public.assets(id,organization_id,code,name,category,created_by) values('20000033-0000-4000-8000-000000000001','10000033-0000-4000-8000-000000000001','INS32','Synthetic guard','safety','00000033-0000-4000-8000-000000000001');
create function pg_temp.ctx(expected integer default null,request uuid default gen_random_uuid()) returns jsonb language sql as $$ select jsonb_strip_nulls(jsonb_build_object('organization_id','10000033-0000-4000-8000-000000000001','request_id',request,'expected_version',expected)) $$;
create function pg_temp.fields() returns jsonb language sql as $$ select '{"title":"Guard inspection","items":[{"id":"40000033-0000-4000-8000-000000000001","label":"Guard fitted","required":true,"safety_relevant":true,"evidence_required":false},{"id":"40000033-0000-4000-8000-000000000002","label":"Paint","required":false,"safety_relevant":false,"evidence_required":false}]}'::jsonb $$;
do $$ begin perform set_config('request.jwt.claim.sub','00000033-0000-4000-8000-000000000001',true); end $$;
create temp table template as select pg_temp.ctx() ctx,pg_temp.fields() fields;
alter table template add column result jsonb;
update template set result=public.publish_inspection_template(ctx,fields);

create temp table assigned as select public.assign_inspection(pg_temp.ctx(),'20000033-0000-4000-8000-000000000001',(select (result->'data'->>'current_revision_id')::uuid from template),'00000033-0000-4000-8000-000000000002') result;
do $$ begin perform set_config('request.jwt.claim.sub','00000033-0000-4000-8000-000000000002',true); end $$;
create function pg_temp.results(outcome text default 'fail') returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('item_id','40000033-0000-4000-8000-000000000001','outcome',outcome,'remarks','Synthetic guard observation','evidence_ids','[]'::jsonb)) $$;
create temp table original as select public.submit_inspection(pg_temp.ctx(),(select (result->'data'->>'id')::uuid from assigned),(select (result->'data'->>'template_revision_id')::uuid from assigned),pg_temp.results()) result;
create function pg_temp.correct(predecessor uuid,expected integer,reason text default 'Rechecked',outcome text default 'fail',request uuid default gen_random_uuid()) returns jsonb language sql as $$ select public.correct_inspection(pg_temp.ctx(expected,request),(select (result->'data'->>'id')::uuid from assigned),(select (result->'data'->>'template_revision_id')::uuid from assigned),predecessor,reason,pg_temp.results(outcome)) $$;
select throws_ok($$select pg_temp.correct((select (result->'data'->>'id')::uuid from original),1,' ')$$,'P0001','VALIDATION','Correction reason mandatory');
select throws_ok($$select pg_temp.correct((select (result->'data'->>'id')::uuid from original),2)$$,'P0001','CONFLICT','Stale version denied');
create temp table correction as select gen_random_uuid() request;
alter table correction add column result jsonb;
update correction set result=pg_temp.correct((select (result->'data'->>'id')::uuid from original),1,'Rechecked','fail',request);
select is((select result->'data'->>'version' from correction),'2','Correction appends version two');
select is((select pg_temp.correct((select (result->'data'->>'id')::uuid from original),1,'Rechecked','fail',request) from correction),(select result from correction),'Same identity replays after successor committed');
select throws_ok($$select pg_temp.correct((select (result->'data'->>'id')::uuid from original),1,'Changed','fail',request) from correction$$,'P0001','CONFLICT','Changed replay payload denied');
select throws_ok($$select pg_temp.correct((select (result->'data'->>'id')::uuid from original),1)$$,'P0001','CONFLICT','A distinct stale correction cannot append');
select is((select count(*)::integer from public.inspection_failure_episodes),1,'Active submitted remedy reused');
select is((select inspector_id::text from public.inspection_submissions where version=2),'00000033-0000-4000-8000-000000000002','Actual correction author recorded');
select lives_ok($$select pg_temp.correct((select (result->'data'->>'id')::uuid from correction),2,'Erroneous result','pass')$$,'Pass correction appended');
select is((select count(*)::integer from public.asset_holds where resolved_at is null and released_at is null),1,'Pass never disposes hold');
update public.maintenance_requests set status='rejected';
select lives_ok($$select pg_temp.correct((select id from public.inspection_submissions where version=3),3)$$,'Failure after terminal request creates fresh episode');
select is((select count(*)::integer from public.inspection_failure_episodes),2,'Terminal remedy retains old episode plus one successor');
select is((select count(*)::integer from public.asset_holds where resolved_at is null and released_at is null),2,'Both holds need independent human disposition');
select is((select count(*)::integer from public.inspection_failure_episodes where predecessor_id is not null),1,'New episode links original remedy');
select is((select count(*)::integer from public.maintenance_requests where status='rejected'),1,'Old request stays rejected');
select throws_ok($$update public.inspection_submissions set correction_reason='Rewrite' where version=2$$,'P0001','FORBIDDEN','Correction history immutable');
select throws_ok($$delete from public.inspection_failure_episodes$$,'P0001','FORBIDDEN','Episode history immutable');
select lives_ok($$select public.reserve_inspection_attachment(pg_temp.ctx(),(select (result->'data'->>'id')::uuid from assigned),'new.png','image/png',100)$$,'Correction can reserve fresh evidence');
select is((select jsonb_array_length(public.get_inspection('10000033-0000-4000-8000-000000000001',(result->'data'->>'id')::uuid)->'history') from assigned),4,'Read includes every original and correction');
select is((select jsonb_array_length(public.get_inspection('10000033-0000-4000-8000-000000000001',(result->'data'->>'id')::uuid)->'episode_links') from assigned),3,'Read links each failed submission to its remedy');
-- Reuse an actionable request after disposition without losing the renewed safety block.
update public.asset_holds set resolved_at=now(),resolved_by='00000033-0000-4000-8000-000000000001',resolution='Synthetic prior disposition';
select lives_ok($$select pg_temp.correct((select id from public.inspection_submissions where version=4),4)$$,'Fresh failure renews disposed unreleased hold');
select is((select count(*)::integer from public.asset_holds where resolved_at is null and released_at is null),1,'Exactly one renewed unresolved hold');
select is((select count(*)::integer from public.inspection_failure_episodes),2,'Renewal reuses active episode');
update public.asset_holds set resolved_at=now(),resolved_by='00000033-0000-4000-8000-000000000001',resolution='Synthetic second disposition' where resolved_at is null;
update public.asset_holds set released_at=now();
update public.assets set availability='operational';
select lives_ok($$select pg_temp.correct((select id from public.inspection_submissions where version=5),5)$$,'Fresh failure renews released hold');
select is((select count(*)::integer from public.asset_holds where resolved_at is null and released_at is null),1,'Released history retained alongside one renewed hold');
select is((select count(*)::integer from public.maintenance_requests),2,'Renewal creates no duplicate request');
select is((select availability from public.assets where id='20000033-0000-4000-8000-000000000001'),'out_of_service','Renewed failure invalidates Operational');
select is((select jsonb_array_length(public.get_inspection('10000033-0000-4000-8000-000000000001',(result->'data'->>'id')::uuid)->'holds') from assigned),4,'Read includes original and renewed holds');
-- With every hold explicitly disposed/released, a Pass preserves independent Operational state.
update public.asset_holds set resolved_at=now(),resolved_by='00000033-0000-4000-8000-000000000001',resolution='Synthetic prior disposition',released_at=now();
update public.assets set availability='operational';
select lives_ok($$select pg_temp.correct((select id from public.inspection_submissions where version=6),6,'Verified after release','pass')$$,'Pass after release appends facts');
select is((select availability from public.assets where id='20000033-0000-4000-8000-000000000001'),'operational','Pass correction preserves Operational');
do $$ begin perform set_config('request.jwt.claim.sub','00000033-0000-4000-8000-000000000001',true); end $$;
-- Initial all-Pass submission on a separately assigned checklist changes no availability.
create temp table pass_assignment as select public.assign_inspection(pg_temp.ctx(),'20000033-0000-4000-8000-000000000001',(select (result->'data'->>'current_revision_id')::uuid from template),'00000033-0000-4000-8000-000000000002') result;
do $$ begin perform set_config('request.jwt.claim.sub','00000033-0000-4000-8000-000000000002',true); end $$;
update public.asset_holds set resolved_at=coalesce(resolved_at,now()),resolved_by='00000033-0000-4000-8000-000000000001',resolution='Synthetic disposition',released_at=now();
update public.assets set availability='operational';
select lives_ok($$select public.submit_inspection(pg_temp.ctx(),(select (result->'data'->>'id')::uuid from pass_assignment),(select (result->'data'->>'template_revision_id')::uuid from pass_assignment),pg_temp.results('pass'))$$,'Initial all-Pass submission succeeds');
select is((select availability from public.assets where id='20000033-0000-4000-8000-000000000001'),'operational','Initial all-Pass preserves Operational');
update public.organization_members set role='inventory' where user_id='00000033-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.correct((select (result->'data'->>'id')::uuid from original),1,'Rechecked','fail',request) from correction$$,'P0001','FORBIDDEN','Role revocation checked before receipt replay');
select ok(not has_function_privilege('anon','public.correct_inspection(jsonb,uuid,uuid,uuid,text,jsonb)','execute'),'Anonymous corrections denied');
select ok(not has_function_privilege('service_role','public.correct_inspection(jsonb,uuid,uuid,uuid,text,jsonb)','execute'),'Service role cannot impersonate correction author');
select * from finish();
rollback;
