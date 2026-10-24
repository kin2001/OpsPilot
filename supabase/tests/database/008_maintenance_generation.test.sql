begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at)
select ('00000030-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pm30-'||n||'@example.test',now() from generate_series(1,6) n;
insert into public.organizations(id,name,timezone,currency,created_by) values
 ('10000030-0000-4000-8000-000000000001','PM generation','UTC','PHP','00000030-0000-4000-8000-000000000001'),
 ('10000030-0000-4000-8000-000000000002','Human first quota','UTC','PHP','00000030-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role)
select o.id,u.id,case right(u.id::text,1) when '1' then 'owner' when '3' then 'supervisor' when '5' then 'inventory' else 'technician' end
from public.organizations o cross join auth.users u where o.id::text like '10000030-%' and u.id::text like '00000030-%';
insert into public.assets(id,organization_id,code,name,category,created_by)
select ('20000030-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('10000030-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'PM30-'||n,'Synthetic belt','pump','00000030-0000-4000-8000-000000000001' from generate_series(1,2) n;
create function pg_temp.ctx(org integer default 1,expected integer default null) returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('organization_id',('10000030-0000-4000-8000-'||lpad(org::text,12,'0')),'request_id',gen_random_uuid(),'expected_version',expected)) $$;
create function pg_temp.fields(org integer default 1) returns jsonb language sql as $$
 select jsonb_build_object('asset_id',('20000030-0000-4000-8000-'||lpad(org::text,12,'0')),'title','Historical belt','instructions','Original instructions','category','routine','cadence','month','frequency',1,'anchor_on','2024-01-31','supervisor_id','00000030-0000-4000-8000-000000000003','assignee_ids',jsonb_build_array('00000030-0000-4000-8000-000000000002'),'checklist',jsonb_build_array('Original check'),'status','active') $$;
select set_config('request.jwt.claim.sub','00000030-0000-4000-8000-000000000001',true);
create temporary table fixture as select pg_temp.ctx() ctx,pg_temp.fields() fields;
alter table fixture add column saved jsonb;
update fixture set saved=public.save_maintenance_plan(ctx,fields);
create function pg_temp.plan() returns uuid language sql as $$ select (saved#>>'{data,id}')::uuid from fixture $$;
create function pg_temp.job() returns uuid language sql as $$ select work_order_id from public.maintenance_occurrences where plan_id=pg_temp.plan() order by scheduled_local_date desc limit 1 $$;
create function pg_temp.version() returns integer language sql as $$select version from public.work_orders where id=pg_temp.job()$$;

select ok(not has_function_privilege('authenticated','private.generate_due_maintenance(timestamptz)','EXECUTE'),'Browser cannot execute scheduler');
select ok(not has_function_privilege('anon','private.generate_due_maintenance(timestamptz)','EXECUTE'),'Anon cannot execute scheduler');
select ok(not has_function_privilege('service_role','private.generate_due_maintenance(timestamptz)','EXECUTE'),'Service role cannot execute scheduler');
select ok(not has_schema_privilege('authenticated','cron','USAGE'),'Browser cannot reach native Cron');
select ok(not has_function_privilege('service_role','cron.schedule(text,text,text)','EXECUTE'),'Service role cannot schedule native execution');
select is((select count(*)::integer from cron.job where jobname='opspilot-maintenance' and username='postgres' and command='select private.generate_due_maintenance();'),1,'Exactly one intended native owner job installed');
select ok(not has_table_privilege('service_role','public.maintenance_occurrences','SELECT'),'Occurrence source denied even to service clients');
set local role authenticated;
select throws_ok($$select private.generate_due_maintenance()$$,'42501',null,'Browser invocation denied at privilege boundary');
reset role;
select throws_ok($$select private.generate_due_maintenance(null)$$,'P0001','VALIDATION','Invalid executor evaluation rejected');

-- Current personnel revocation blocks without rewriting or advancing the historical segment.
update public.organization_members set active=false where organization_id='10000030-0000-4000-8000-000000000001' and user_id='00000030-0000-4000-8000-000000000002';
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','0','Revoked assignee prevents generation');
select is((select generation_blocked from public.maintenance_plans where id=pg_temp.plan()),'person_ineligible','Revocation has actionable blocker');
select is((select next_ordinal from public.maintenance_segments where plan_id=pg_temp.plan()),0,'Revocation preserves cursor');
create temporary table original as select r.* from public.maintenance_plan_revisions r where plan_id=pg_temp.plan();
select public.save_maintenance_plan(pg_temp.ctx(1,1),pg_temp.fields()||jsonb_build_object('id',pg_temp.plan(),'title','Replacement title','instructions','New instructions','assignee_ids',jsonb_build_array('00000030-0000-4000-8000-000000000004')));
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','1','Valid replacement unblocks retained backlog');
select is((select count(*)::integer from public.maintenance_occurrences where plan_id=pg_temp.plan()),1,'One durable occurrence');
select is((select scheduled_local_date from public.maintenance_occurrences where plan_id=pg_temp.plan()),date '2024-01-31','Original pending date retained');
select is((select due_at from public.maintenance_occurrences where plan_id=pg_temp.plan()),timestamptz '2024-02-01 00:00Z','Original next-midnight UTC cutoff pinned');
select is((select description from public.work_orders where id=pg_temp.job()),'Original instructions','Historical instructions retained');
select is((select label from public.work_order_tasks where work_order_id=pg_temp.job()),'Original check','Historical checklist retained');
select is((select assignee_ids from public.maintenance_occurrences where plan_id=pg_temp.plan()),array['00000030-0000-4000-8000-000000000004'::uuid],'Current replacement personnel govern old segment');
select is((select row_to_json(r)::jsonb from public.maintenance_plan_revisions r where id=(select id from original)),(select row_to_json(o)::jsonb from original o),'Historical revision unchanged');
select is((select creation_actor_kind from public.work_orders where id=pg_temp.job()),'system','Truthful system discriminator');
select ok((select created_by is null and not blocks_operation and status='scheduled' from public.work_orders where id=pg_temp.job()),'Scheduled PM is nonblocking without fake human');
select is((select count(*)::integer from private.command_receipts where organization_id='10000030-0000-4000-8000-000000000001'),2,'Generation creates no human receipt');
select ok((select actor_id is null and actor_kind='system' and system_identity='maintenance_scheduler' from public.audit_logs where action='maintenance.generated' and entity_id=(select id from public.maintenance_occurrences where plan_id=pg_temp.plan())),'System audit has constrained native provenance');
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','0','Retry retains one unfinished job');
select is((select count(*)::integer from public.notifications where source_id=pg_temp.job() and category='assignment'),1,'Retried generation does not duplicate assignment notification');
select is((select next_ordinal from public.maintenance_segments where revision_id=(select id from original)),1,'Only successful occurrence advances protected cursor');
select throws_ok($$update public.maintenance_occurrences set due_at=due_at+interval '1 hour' where plan_id=pg_temp.plan()$$,'P0001',null,'Pinned occurrence is immutable');
select throws_ok($$select public.update_work_order(pg_temp.ctx(1,pg_temp.version()),pg_temp.job(),'{}'::jsonb||jsonb_build_object('due_at','2027-01-01T00:00:00Z'))$$,'P0001','VALIDATION','Independent PM cutoff edits denied');
select throws_ok($$select public.create_work_order(pg_temp.ctx(),'20000030-0000-4000-8000-000000000001',jsonb_build_object('title','Forged','description','Forged','category','routine','priority','normal','creation_actor_kind','system'))$$,'P0001','VALIDATION','Human cannot supply system provenance');

-- Simulate an already released asset: neither overdue generation nor pre-Start operations demote it.
update public.assets set availability='operational' where id='20000030-0000-4000-8000-000000000001';
select public.schedule_work_order(pg_temp.ctx(1,pg_temp.version()),pg_temp.job(),'2026-10-28',null);
select is((select availability from public.assets where id='20000030-0000-4000-8000-000000000001'),'operational','Reschedule remains nonblocking despite overdue cutoff');
select is((select due_at from public.work_orders where id=pg_temp.job()),timestamptz '2024-02-01 00:00Z','Reschedule changes planned date only');
select public.transition_work_order(pg_temp.ctx(1,pg_temp.version()),pg_temp.job(),'canceled','Pre-start cancellation');
select is((select availability from public.assets where id='20000030-0000-4000-8000-000000000001'),'operational','Pre-start cancellation preserves Operational');
select is((select count(*)::integer from public.asset_holds where asset_id='20000030-0000-4000-8000-000000000001'),0,'Pre-start cancellation creates no hold');
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','1','Terminal prior job permits next anchored occurrence');
select is((select scheduled_local_date from public.maintenance_occurrences where work_order_id=pg_temp.job()),date '2024-02-29','Next occurrence retains leap-month anchor');
select public.transition_work_order(pg_temp.ctx(1,pg_temp.version()),pg_temp.job(),'in_progress',null);
select ok((select blocks_operation and status='in_progress' from public.work_orders where id=pg_temp.job()),'Explicit human Start atomically blocks and enters In Progress');
select is((select count(*)::integer from public.asset_holds where work_order_id=pg_temp.job() and released_at is null),1,'Start establishes ordinary hold');
select is((select availability from public.assets where id='20000030-0000-4000-8000-000000000001'),'under_maintenance','Start refreshes availability');
select public.transition_work_order(pg_temp.ctx(1,pg_temp.version()),pg_temp.job(),'canceled','Post-start cancellation');
select is((select count(*)::integer from public.asset_holds where work_order_id=pg_temp.job() and released_at is null),1,'Post-start cancellation retains hold');
select isnt((select availability from public.assets where id='20000030-0000-4000-8000-000000000001'),'operational','Cancellation cannot release asset');

select is(jsonb_array_length(public.list_maintenance_agenda('10000030-0000-4000-8000-000000000001','2024-01-01','2024-12-31',null,1)->'items'),1,'Agenda is bounded');
select ok(public.list_maintenance_agenda('10000030-0000-4000-8000-000000000001','2024-01-01','2024-12-31',null,1)->'next_cursor'<>'null'::jsonb,'Agenda provides stable date/id continuation');
select throws_ok($$select public.list_maintenance_agenda('10000030-0000-4000-8000-000000000001','2024-01-01','2026-12-31')$$,'P0001','VALIDATION','Agenda refuses unbounded date range');
select is(jsonb_array_length(public.list_maintenance_backlog('10000030-0000-4000-8000-000000000001',pg_temp.plan())->'items'),1,'Backlog reports pending historical segment without eager jobs');
select set_config('request.jwt.claim.sub','00000030-0000-4000-8000-000000000005',true);
select throws_ok($$select public.list_maintenance_backlog('10000030-0000-4000-8000-000000000001',pg_temp.plan())$$,'P0001','FORBIDDEN','Inventory cannot read backlog');
select set_config('request.jwt.claim.sub','00000030-0000-4000-8000-000000000001',true);

-- Deliberately shared quota state: scheduler-last and human-last each stop at the same 5,000.
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
select '10000030-0000-4000-8000-000000000001','00000030-0000-4000-8000-000000000006',gen_random_uuid(),'synthetic_quota','synthetic','{}'
from generate_series(1,(4999-private.maintenance_daily_usage('10000030-0000-4000-8000-000000000001'))::integer);
select is(private.generate_due_maintenance('2099-01-01 00:00Z')->>'generated','1','Scheduler consumes final real-time daily slot despite a future evaluation clock');
select is(private.maintenance_daily_usage('10000030-0000-4000-8000-000000000001'),5000::bigint,'Scheduler and human durable counts sum to 5000');
select throws_ok($$select public.save_asset(pg_temp.ctx(),null,'{"code":"Q","name":"Quota denied","category":"pump"}')$$,'P0001','RATE_LIMITED','Human cannot spend beyond scheduler-inclusive budget');
select public.save_maintenance_plan(pg_temp.ctx(2),pg_temp.fields(2));
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
select '10000030-0000-4000-8000-000000000002','00000030-0000-4000-8000-000000000006',gen_random_uuid(),'synthetic_quota','synthetic','{}'
from generate_series(1,(4999-private.maintenance_daily_usage('10000030-0000-4000-8000-000000000002'))::integer);
select public.save_asset(pg_temp.ctx(2),null,'{"code":"Q","name":"Final human slot","category":"pump"}');
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','0','Human-last exhausted budget blocks scheduler');
select is((select generation_blocked from public.maintenance_plans where organization_id='10000030-0000-4000-8000-000000000002'),'quota','Quota blocker retained');
select is((select next_ordinal from public.maintenance_segments where organization_id='10000030-0000-4000-8000-000000000002'),0,'Quota does not advance pending date');
select is(private.maintenance_daily_usage('10000030-0000-4000-8000-000000000002'),5000::bigint,'Both operation orders enforce same unchanged quota');
select * from finish();
rollback;
