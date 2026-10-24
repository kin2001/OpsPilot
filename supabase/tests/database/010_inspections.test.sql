begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('00000032-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'inspection32-'||n||'@example.test',now() from generate_series(1,4) n;
insert into public.organizations(id,name,timezone,currency,created_by) values
 ('10000032-0000-4000-8000-000000000001','Synthetic inspections','UTC','PHP','00000032-0000-4000-8000-000000000001'),
 ('10000032-0000-4000-8000-000000000002','Other inspections','UTC','PHP','00000032-0000-4000-8000-000000000004');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000032-0000-4000-8000-000000000001','00000032-0000-4000-8000-000000000001','owner'),
 ('10000032-0000-4000-8000-000000000001','00000032-0000-4000-8000-000000000002','technician'),
 ('10000032-0000-4000-8000-000000000001','00000032-0000-4000-8000-000000000003','inventory'),
 ('10000032-0000-4000-8000-000000000002','00000032-0000-4000-8000-000000000004','owner');
insert into public.assets(id,organization_id,code,name,category,created_by) values('20000032-0000-4000-8000-000000000001','10000032-0000-4000-8000-000000000001','INS32','Synthetic guard','safety','00000032-0000-4000-8000-000000000001');
create function pg_temp.ctx(expected integer default null,request uuid default gen_random_uuid()) returns jsonb language sql as $$ select jsonb_strip_nulls(jsonb_build_object('organization_id','10000032-0000-4000-8000-000000000001','request_id',request,'expected_version',expected)) $$;
create function pg_temp.fields() returns jsonb language sql as $$ select '{"title":"Guard inspection","items":[{"id":"40000032-0000-4000-8000-000000000001","label":"Guard fitted","required":true,"safety_relevant":true,"evidence_required":true},{"id":"40000032-0000-4000-8000-000000000002","label":"Paint","required":false,"safety_relevant":false,"evidence_required":false}]}'::jsonb $$;
do $$ begin perform set_config('request.jwt.claim.sub','00000032-0000-4000-8000-000000000001',true); end $$;
create temp table template as select pg_temp.ctx() ctx,pg_temp.fields() fields;
alter table template add column result jsonb;
update template set result=public.publish_inspection_template(ctx,fields);
select is((select public.publish_inspection_template(ctx,fields) from template),(select result from template),'Template publication replay is durable');
select throws_ok($$select public.publish_inspection_template(ctx,fields||'{"title":"Changed retry"}') from template$$,'P0001','CONFLICT','Changed template retry conflicts');
select throws_ok($$select public.publish_inspection_template(pg_temp.ctx(),pg_temp.fields()||jsonb_build_object('items',jsonb_build_array(pg_temp.fields()->'items'->0,pg_temp.fields()->'items'->0)))$$,'P0001','VALIDATION','Duplicate template item identities denied');
create temp table assignment as select public.assign_inspection(pg_temp.ctx(),'20000032-0000-4000-8000-000000000001',(select (result->'data'->>'current_revision_id')::uuid from template),'00000032-0000-4000-8000-000000000002') result;
select lives_ok($$select public.publish_inspection_template(pg_temp.ctx(1),pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from template),'title','Revised template'))$$,'Later publication creates an immutable revision');
select is((select result->'data'->>'template_revision_id' from assignment),(select result->'data'->>'current_revision_id' from template),'Existing assignment retains original revision');
select throws_ok($$update public.inspection_template_revisions set title='Rewrite'$$,'P0001','FORBIDDEN','Published revisions immutable');
select throws_ok($$update public.inspection_assignments set inspector_id='00000032-0000-4000-8000-000000000001'$$,'P0001','FORBIDDEN','Assignments immutable');
create function pg_temp.submit(results jsonb,request uuid default gen_random_uuid()) returns jsonb language sql as $$ select public.submit_inspection(pg_temp.ctx(null,request),(select (result->'data'->>'id')::uuid from assignment),(select (result->'data'->>'template_revision_id')::uuid from assignment),results) $$;
select throws_ok($$select pg_temp.submit('[]')$$,'P0001','FORBIDDEN','Coordinator cannot impersonate assigned inspector');
do $$ begin perform set_config('request.jwt.claim.sub','00000032-0000-4000-8000-000000000002',true); end $$;
select throws_ok($$select pg_temp.submit('[]')$$,'P0001','VALIDATION','Required item cannot be omitted');
select throws_ok($$select pg_temp.submit('[{"item_id":"40000032-0000-4000-8000-000000000001","outcome":"not_applicable","remarks":"No guard","evidence_ids":[]}]')$$,'P0001','VALIDATION','N/A needs reason');
select throws_ok($$select pg_temp.submit('[{"item_id":"40000032-0000-4000-8000-000000000001","outcome":"fail","remarks":"Missing","evidence_ids":[]}]')$$,'P0001','VALIDATION','Configured evidence mandatory');
select is((select count(*)::integer from public.inspection_submissions),0,'Invalid submission has no partial effects');
create temp table evidence as select public.reserve_inspection_attachment(pg_temp.ctx(),(select (result->'data'->>'id')::uuid from assignment),'guard.png','image/png',100) result;
select lives_ok($$select public.finalize_attachment('10000032-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from evidence),'00000032-0000-4000-8000-000000000002',repeat('a',64),1,1)$$,'Evidence ready under real finalization validation');
create temp table submission as select gen_random_uuid() request,jsonb_build_array(jsonb_build_object('item_id','40000032-0000-4000-8000-000000000001','outcome','fail','remarks','Missing guard','evidence_ids',jsonb_build_array((select result->'data'->>'id' from evidence)))) results;
alter table submission add column result jsonb;
update public.assets set archived_at=now(),availability='operational' where id='20000032-0000-4000-8000-000000000001';
update submission set result=pg_temp.submit(results,request);
select is((select availability from public.assets where id='20000032-0000-4000-8000-000000000001'),'out_of_service','Archived asset safety failure still holds immediately');
select is((select pg_temp.submit(results,request) from submission),(select result from submission),'Submission retry returns same result');
select is((select count(*)::integer from public.inspection_failure_episodes),1,'Retry creates one failed episode');
select is((select count(*)::integer from public.maintenance_requests),1,'Retry creates one corrective request');
select is((select count(*)::integer from public.asset_holds where source='inspection'),1,'Retry creates one inspection hold');
select is((select count(*)::integer from public.work_orders),0,'Conversion to repair stays explicit');
select throws_ok($$select pg_temp.submit(results||jsonb_build_array(jsonb_build_object('item_id','40000032-0000-4000-8000-000000000002','outcome','pass','evidence_ids','[]'::jsonb)),request) from submission$$,'P0001','CONFLICT','Changed payload retry conflicts');
select throws_ok($$select pg_temp.submit(results) from submission$$,'P0001','CONFLICT','New identity cannot replace first results');
select throws_ok($$update public.inspection_submissions set results='[]'$$,'P0001','FORBIDDEN','First results immutable');
select is((select inspector_id::text from public.inspection_submissions),'00000032-0000-4000-8000-000000000002','Actual assigned actor recorded');
select ok(private.can_read_inspection('10000032-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from assignment)),'Inspector can read own pinned facts');
update public.organization_members set active=false where user_id='00000032-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.submit(results,request) from submission$$,'P0001','FORBIDDEN','Revoked inspector cannot replay');
select throws_ok($$select public.attachment_access('10000032-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from evidence))$$,'P0001','NOT_FOUND','Evidence access rechecks revocation');
select ok(not private.can_read_inspection('10000032-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from assignment)),'Revoked inspector loses read');
do $$ begin perform set_config('request.jwt.claim.sub','00000032-0000-4000-8000-000000000004',true); end $$;
select throws_ok($$select public.get_inspection('10000032-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from assignment))$$,'P0001','FORBIDDEN','Wrong tenant detail denied');
select throws_ok($$select public.publish_inspection_template(pg_temp.ctx(),pg_temp.fields())$$,'P0001','FORBIDDEN','Wrong tenant publication denied');
select ok(not has_function_privilege('anon','public.submit_inspection(jsonb,uuid,uuid,jsonb)','execute'),'Anonymous submission denied');
select ok(not has_function_privilege('authenticated','private.inspection_command(jsonb,text,jsonb)','execute'),'Generic private writer not exposed');
select ok(not has_function_privilege('authenticated','public.finalize_attachment(uuid,uuid,uuid,text,integer,integer)','execute'),'Caller cannot forge ready evidence');
select * from finish();
rollback;
