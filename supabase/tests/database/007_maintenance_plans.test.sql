begin;
set local search_path=public,extensions;
select no_plan();

-- Literal expectations exercise PostgreSQL's own calendar/timezone conversion, including midnight transitions.
select is(private.maintenance_date('2024-01-31','month',1,1),date '2024-02-29','Leap February clamps to month end');
select is(private.maintenance_date('2024-01-31','month',1,2),date '2024-03-31','March returns to the original anchor day');
select is(private.maintenance_date('2025-01-31','month',1,1),date '2025-02-28','Non-leap February clamps');
select is(private.maintenance_date('2024-02-29','month',12,1),date '2025-02-28','Yearly leap anchor clamps without completion drift');
select is(private.maintenance_date('2026-10-20','week',2,1),date '2026-11-03','Weeks remain anchored calendar dates');
select is(private.maintenance_cutoff('2026-03-08','America/New_York'),timestamptz '2026-03-09 04:00Z','Spring DST uses next LOCAL midnight');
select is(private.maintenance_cutoff('2026-11-01','America/New_York'),timestamptz '2026-11-02 05:00Z','Autumn DST uses next LOCAL midnight');
select is(private.maintenance_cutoff('2018-11-03','America/Sao_Paulo'),timestamptz '2018-11-04 03:00Z','PostgreSQL resolves nonexistent midnight');
select is(private.maintenance_cutoff('2020-10-31','America/Havana'),timestamptz '2020-11-01 05:00Z','PostgreSQL resolves repeated midnight to standard time');
select is(private.maintenance_cutoff('2011-12-29','Pacific/Apia'),timestamptz '2011-12-30 10:00Z','Skipped date-line day has a deterministic cutoff');
select is(private.maintenance_ordinal('2024-01-31','month',1,'2024-02-29'),2,'New cadence starts strictly after cutoff');
select throws_ok($$select private.maintenance_date('2024-01-31','day',0,1)$$,'P0001','VALIDATION','Zero cadence frequency is rejected');
select throws_ok($$select private.maintenance_date('9999-12-30','day',1,1)$$,'P0001','VALIDATION','Unsupported date/cutoff range fails closed');

insert into auth.users(id,email,email_confirmed_at)
select ('00000029-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pm29-'||n||'@example.test',now() from generate_series(1,5) n;
insert into public.organizations(id,name,timezone,currency,created_by) values
 ('10000029-0000-4000-8000-000000000001','Synthetic PM plans','Pacific/Kiritimati','PHP','00000029-0000-4000-8000-000000000001'),
 ('10000029-0000-4000-8000-000000000002','Synthetic other PM tenant','UTC','PHP','00000029-0000-4000-8000-000000000005');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000029-0000-4000-8000-000000000001','00000029-0000-4000-8000-000000000001','owner'),
 ('10000029-0000-4000-8000-000000000001','00000029-0000-4000-8000-000000000002','technician'),
 ('10000029-0000-4000-8000-000000000001','00000029-0000-4000-8000-000000000003','supervisor'),
 ('10000029-0000-4000-8000-000000000001','00000029-0000-4000-8000-000000000004','technician'),
 ('10000029-0000-4000-8000-000000000002','00000029-0000-4000-8000-000000000005','owner');
insert into public.assets(id,organization_id,code,name,category,created_by) values
 ('20000029-0000-4000-8000-000000000001','10000029-0000-4000-8000-000000000001','PM-29','Synthetic belt','pump','00000029-0000-4000-8000-000000000001');
create function pg_temp.fields() returns jsonb language sql as $$select '{"asset_id":"20000029-0000-4000-8000-000000000001","title":"Original belt plan","instructions":"Preserved historical instructions","category":"routine","cadence":"day","frequency":1,"anchor_on":"2026-10-20","supervisor_id":"00000029-0000-4000-8000-000000000001","assignee_ids":["00000029-0000-4000-8000-000000000002"],"checklist":["Inspect original belt"],"status":"active"}'::jsonb$$;
create function pg_temp.ctx(expected integer default null,request uuid default gen_random_uuid()) returns jsonb language sql as $$
select jsonb_strip_nulls(jsonb_build_object('organization_id','10000029-0000-4000-8000-000000000001','request_id',request,'expected_version',expected))$$;
do $$ begin perform set_config('request.jwt.claim.sub','00000029-0000-4000-8000-000000000001',true); end $$;
create temporary table saved as select pg_temp.ctx() ctx,pg_temp.fields() fields;
alter table saved add column result jsonb;
update saved set result=public.save_maintenance_plan(ctx,fields);
select is((select result->'data'->>'version' from saved),'1','Initial plan saves one version');
select is((select count(*)::integer from public.maintenance_segments),1,'Initial plan has one retained cursor');
select is((select public.save_maintenance_plan(ctx,fields) from saved),(select result from saved),'Durable replay returns the committed envelope');
select is((select count(*)::integer from public.maintenance_plan_revisions),1,'Replay adds no revision');
select throws_ok($$select public.save_maintenance_plan(ctx,fields||'{"title":"Changed replay"}'::jsonb) from saved$$,'P0001','CONFLICT','Changed payload under the same identity is rejected');
select throws_ok($$select public.save_maintenance_plan(pg_temp.ctx(2),pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from saved)))$$,'P0001','CONFLICT','Stale version cannot edit');
select throws_ok($$select public.save_maintenance_plan(pg_temp.ctx(),pg_temp.fields()||'{"actor_id":"00000029-0000-4000-8000-000000000005"}'::jsonb)$$,'P0001','VALIDATION','Client cannot forge author');
select throws_ok($$select public.save_maintenance_plan(pg_temp.ctx(),pg_temp.fields()||'{"frequency":1.5}'::jsonb)$$,'P0001','VALIDATION','Fractional cadence is rejected at SQL boundary');
select throws_ok($$select public.save_maintenance_plan(pg_temp.ctx(),pg_temp.fields()||'{"assignee_ids":["00000029-0000-4000-8000-000000000002","00000029-0000-4000-8000-000000000002"]}'::jsonb)$$,'P0001','VALIDATION','Duplicate personnel are rejected at SQL boundary');

update public.organizations set timezone='America/Adak' where id='10000029-0000-4000-8000-000000000001';
create temporary table edit_preview as select private.maintenance_preview('10000029-0000-4000-8000-000000000001',pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from saved),'cadence','week'),'2026-10-24 10:30Z') result;
select is((select result->>'old_local_date' from edit_preview),'2026-10-25','Date-line edit observes old local day');
select is((select result->>'new_local_date' from edit_preview),'2026-10-24','Date-line edit observes proposed local day');
select is((select result->>'protected_through' from edit_preview),'2026-10-25','Both local days protected by MAX date');
select is((select result->'first_new'->>'scheduled_local_date' from edit_preview),'2026-10-27','New weekly cadence excludes protected days');
select is((select result->'retained_backlog'->0->>'next_on' from edit_preview),'2026-10-20','Missed old dates retain the original cursor');
select is((select count(*)::integer from private.command_receipts where action='save_maintenance_plan'),1,'Read-only preview creates no command receipt');

create temporary table historic as select to_jsonb(r) revision from public.maintenance_plan_revisions r;
select lives_ok($$select public.save_maintenance_plan(pg_temp.ctx(1),pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from saved),'cadence','week'))$$,'First edit creates protected segment');
create temporary table protected as select to_jsonb(s) segment from public.maintenance_segments s where protected_through is not null;
update public.organizations set timezone='Pacific/Kiritimati' where id='10000029-0000-4000-8000-000000000001';
create temporary table reverse_date_line_preview as select private.maintenance_preview('10000029-0000-4000-8000-000000000001',pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from saved)),'2026-10-24 10:30Z') result;
select is((select result->>'new_local_date' from reverse_date_line_preview),'2026-10-25','Reverse date-line edit evaluates the NEW local day at the fixed preview time');
select is((select result->>'protected_through' from reverse_date_line_preview),
 (select greatest(date '2026-10-25',max(protected_through))::text from public.maintenance_segments where organization_id='10000029-0000-4000-8000-000000000001' and plan_id=(select (result->'data'->>'id')::uuid from saved)),
 'Reverse date-line edit preserves existing protection and the later NEW local day');
update public.organizations set timezone='America/Adak' where id='10000029-0000-4000-8000-000000000001';
select lives_ok($$select public.save_maintenance_plan(pg_temp.ctx(2),pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from saved),'cadence','month','status','paused'))$$,'Repeated edit and pause create a new future segment');
select is((select to_jsonb(s) from public.maintenance_segments s where s.revision_id=(select (segment->>'revision_id')::uuid from protected)),(select segment from protected),'Repeated edit preserves already protected cursor and boundary');
select is((select to_jsonb(r) from public.maintenance_plan_revisions r where r.id=(select (revision->>'id')::uuid from historic)),(select revision from historic),'Repeated edits preserve original author and content');
select throws_ok($$update public.maintenance_plan_revisions set title='Rewrite history'$$,'P0001','FORBIDDEN','Historical revision mutation is denied');

update public.organization_members set active=false where user_id='00000029-0000-4000-8000-000000000002';
select ok(not private.maintenance_current_people_eligible('10000029-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from saved)),'Revoked personnel block current authorization');
do $$ begin perform set_config('request.jwt.claim.sub','00000029-0000-4000-8000-000000000003',true); end $$;
select lives_ok($$select public.save_maintenance_plan(pg_temp.ctx(3),pg_temp.fields()||jsonb_build_object('id',(select result->'data'->>'id' from saved),'supervisor_id','00000029-0000-4000-8000-000000000003','assignee_ids',jsonb_build_array('00000029-0000-4000-8000-000000000004')))$$,'Explicit current coordinator/personnel replacement reauthorizes retained dates');
select ok(private.maintenance_current_people_eligible('10000029-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from saved)),'Old revoked personnel no longer permanently block retained backlog');
update public.organization_members set active=false where user_id='00000029-0000-4000-8000-000000000001';
select ok(private.maintenance_current_people_eligible('10000029-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from saved)),'Revoked historical author does not replace valid current authorization');
select is((select to_jsonb(r) from public.maintenance_plan_revisions r where r.id=(select (revision->>'id')::uuid from historic)),(select revision from historic),'Replacement never rewrites old personnel/author/instructions/cadence/zone');
select is((select to_jsonb(s) from public.maintenance_segments s where s.revision_id=(select (segment->>'revision_id')::uuid from protected)),(select segment from protected),'Replacement does not consume any old date');
select is(jsonb_array_length(public.list_maintenance_revisions('10000029-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from saved),null,1)->'items'),1,'Revision reads honor caller page bound');
select is(public.list_maintenance_revisions('10000029-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from saved),null,1)->>'next_cursor','1','Revision reads return a stable continuation');
select throws_ok($$select public.list_maintenance_plans('10000029-0000-4000-8000-000000000001',null,101)$$,'P0001','VALIDATION','Over-bound plan reads fail closed');

do $$ begin perform set_config('request.jwt.claim.sub','00000029-0000-4000-8000-000000000001',true); end $$;
update public.organization_members set role='technician' where user_id='00000029-0000-4000-8000-000000000001';
select throws_ok($$select public.save_maintenance_plan(ctx,fields) from saved$$,'P0001','FORBIDDEN','Downgraded author cannot replay privileged result');
select throws_ok($$select public.preview_maintenance_plan('10000029-0000-4000-8000-000000000001',pg_temp.fields())$$,'P0001','FORBIDDEN','Technician cannot preview coordinator fields');
do $$ begin perform set_config('request.jwt.claim.sub','00000029-0000-4000-8000-000000000005',true); end $$;
select throws_ok($$select public.list_maintenance_revisions('10000029-0000-4000-8000-000000000001',(select (result->'data'->>'id')::uuid from saved))$$,'P0001','FORBIDDEN','Wrong tenant cannot read history');
do $$ begin perform set_config('request.jwt.claim.sub','00000029-0000-4000-8000-000000000004',true); end $$;
select is(jsonb_array_length(public.list_maintenance_plans('10000029-0000-4000-8000-000000000001')->'items'),1,'Current assigned technician can read plan context');
do $$ begin perform set_config('request.jwt.claim.sub','00000029-0000-4000-8000-000000000002',true); end $$;
select throws_ok($$select public.list_maintenance_plans('10000029-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Revoked technician cannot read plan context');

select ok(not has_table_privilege('authenticated','public.maintenance_plans','SELECT'),'Unbounded direct plan reads denied');
select ok(not has_table_privilege('authenticated','public.maintenance_plan_revisions','UPDATE'),'Direct history writes denied');
select ok(not has_function_privilege('anon','public.save_maintenance_plan(jsonb,jsonb)','EXECUTE'),'Anonymous plan writes denied');
select ok(not has_function_privilege('service_role','public.save_maintenance_plan(jsonb,jsonb)','EXECUTE'),'Service-role cannot impersonate plan author');
select ok(not has_function_privilege('authenticated','private.maintenance_preview(uuid,jsonb,timestamptz)','EXECUTE'),'Browser cannot choose server clock');
select ok(not has_function_privilege('authenticated','private.maintenance_current_people_eligible(uuid,uuid)','EXECUTE'),'Internal authorization helper is not public');
select is(to_regprocedure('public.generate_due_maintenance(timestamp with time zone)')::text,null::text,'Generator has no public RPC surface');
select * from finish();
rollback;
