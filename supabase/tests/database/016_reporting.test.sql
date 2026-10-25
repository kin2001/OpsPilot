begin;
select no_plan();
-- This transaction owns all identities and rows. No ordinary fixture borrows accumulated quota/state.
create function pg_temp.u(n integer) returns uuid language sql immutable as $$select ('00000039-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.u(n),'report39-'||n||'@example.test',now() from generate_series(1,4)n;
insert into public.organizations(id,name,timezone,currency,created_by) values
 (pg_temp.u(100),'Reporting39','Asia/Manila','PHP',pg_temp.u(1)),(pg_temp.u(101),'Foreign39','UTC','USD',pg_temp.u(4)),
 (pg_temp.u(102),'Empty reporting39','UTC','PHP',pg_temp.u(1));
insert into public.organization_members(organization_id,user_id,role) values
 (pg_temp.u(100),pg_temp.u(1),'owner'),(pg_temp.u(100),pg_temp.u(2),'technician'),(pg_temp.u(100),pg_temp.u(3),'inventory'),(pg_temp.u(101),pg_temp.u(4),'owner'),(pg_temp.u(102),pg_temp.u(1),'owner');
insert into public.assets(id,organization_id,code,name,category,created_by,created_at) values
 (pg_temp.u(200),pg_temp.u(100),'KNOWN','Known pump','pump',pg_temp.u(1),'2026-01-01T00:00:00Z'),
 (pg_temp.u(201),pg_temp.u(100),'UNKNOWN','Missing historical baseline','pump',pg_temp.u(1),'2026-01-01T00:00:00Z'),
 (pg_temp.u(202),pg_temp.u(101),'FOREIGN','Foreign pump','pump',pg_temp.u(4),'2026-01-01T00:00:00Z');
-- Immutable state intervals, including a second hold while already unavailable; 01:00..04:00 = 10,800 seconds once.
-- Deliberately different created_at proves occurred_at is the ordering clock.
insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes,created_at)
 select pg_temp.u(100),pg_temp.u(1),'asset.availability_changed',pg_temp.u(200),gen_random_uuid(),
 jsonb_build_object('occurred_at',at_time,'new_status',status,'active',true,'provenance','recorded_transition'),clock_timestamp()
 from (values('2026-09-30T00:00:00Z','operational'),('2026-10-01T01:00:00Z','under_maintenance'),
 ('2026-10-01T02:00:00Z','under_maintenance'),('2026-10-01T04:00:00Z','operational'))e(at_time,status);
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by,created_at,opened_at,repair_revision)
 select pg_temp.u(300+n),pg_temp.u(100),n,pg_temp.u(200),'Synthetic job '||n,'Report fixture','pump','normal',pg_temp.u(1),
 case n when 2 then 'in_progress' when 7 then 'canceled' when 8 then 'scheduled' else 'completed' end,pg_temp.u(1),'2026-10-01T00:00:00Z',
 case when n=4 then null else '2026-10-01T00:00:00Z'::timestamptz end,case when n=1 then 2 else 1 end from generate_series(1,8)n;
insert into public.work_order_reviews(organization_id,work_order_id,reviewer_id,repair_revision,decision,reason,created_at)
 select pg_temp.u(100),pg_temp.u(300+n),pg_temp.u(1),case when n=1 then 2 else 1 end,'approved','Fixture approval',at_time::timestamptz
 from (values(1,'2026-10-01T04:00:00Z'),(2,'2026-10-01T03:00:00Z'),(3,'2026-10-01T16:00:00Z'),
 (4,'2026-10-01T05:00:00Z'),(5,'2026-10-01T15:59:00Z'),(6,'2026-10-01T16:00:00Z'))e(n,at_time);
insert into public.work_order_reviews(organization_id,work_order_id,reviewer_id,repair_revision,decision,reason,created_at)
 values(pg_temp.u(100),pg_temp.u(301),pg_temp.u(1),1,'approved','Superseded approval','2026-10-01T01:00:00Z');
insert into public.work_order_assignments(organization_id,work_order_id,user_id,unassigned_at) values
 (pg_temp.u(100),pg_temp.u(302),pg_temp.u(2),null),(pg_temp.u(100),pg_temp.u(308),pg_temp.u(2),null),
 (pg_temp.u(100),pg_temp.u(301),pg_temp.u(2),null),(pg_temp.u(100),pg_temp.u(308),pg_temp.u(1),now());
insert into public.maintenance_plans(id,organization_id,asset_id,authorized_by,status,created_by)
 select pg_temp.u(400+n),pg_temp.u(100),pg_temp.u(200),pg_temp.u(1),'paused',pg_temp.u(1) from generate_series(5,8)n;
insert into public.maintenance_plan_revisions(id,organization_id,plan_id,revision,author_id,title,instructions,category,cadence,frequency,anchor_on,timezone,supervisor_id,assignee_ids,checklist)
 select pg_temp.u(500+n),pg_temp.u(100),pg_temp.u(400+n),1,pg_temp.u(1),'Pinned PM','Check pump','pump','day',1,'2026-10-01','Asia/Manila',pg_temp.u(1),array[pg_temp.u(2)],'["Check"]'::jsonb from generate_series(5,8)n;
insert into public.maintenance_occurrences(id,organization_id,plan_id,revision_id,scheduled_local_date,timezone,due_at,work_order_id,authorized_by,supervisor_id,assignee_ids)
 select pg_temp.u(600+n),pg_temp.u(100),pg_temp.u(400+n),pg_temp.u(500+n),'2026-10-01','Asia/Manila','2026-10-01T16:00:00Z',pg_temp.u(300+n),pg_temp.u(1),pg_temp.u(1),array[pg_temp.u(2)] from generate_series(5,8)n;
insert into public.work_order_events(organization_id,work_order_id,actor_id,request_id,action,status,repair_revision,note)
 values(pg_temp.u(100),pg_temp.u(307),pg_temp.u(1),gen_random_uuid(),'transition_work_order','canceled',1,'Explicit canceled occurrence');
insert into public.parts(id,organization_id,code,name,unit,created_by) values(pg_temp.u(700),pg_temp.u(100),'OIL','Oil','kg',pg_temp.u(1));
insert into public.stock_locations(id,organization_id,code,name,created_by) values(pg_temp.u(800),pg_temp.u(100),'A','Shelf',pg_temp.u(1));
insert into public.inventory_balances(organization_id,part_id,location_id) values(pg_temp.u(100),pg_temp.u(700),pg_temp.u(800));
insert into public.work_order_parts(organization_id,work_order_id,part_id,requested) values(pg_temp.u(100),pg_temp.u(302),pg_temp.u(700),1);
insert into public.stock_reservations(id,organization_id,work_order_id,part_id,location_id,quantity,issued,returned)
 values(pg_temp.u(1000),pg_temp.u(100),pg_temp.u(302),pg_temp.u(700),pg_temp.u(800),1,0.3,0.1);
insert into public.inventory_movements(id,organization_id,part_id,location_id,kind,direction,quantity,unit,actor_id,request_id,created_at) values
 (pg_temp.u(900),pg_temp.u(100),pg_temp.u(700),pg_temp.u(800),'issue','out',0.3,'kg',pg_temp.u(3),pg_temp.u(1100),'2026-10-01T00:00:00Z'),
 (pg_temp.u(901),pg_temp.u(100),pg_temp.u(700),pg_temp.u(800),'return','in',0.1,'kg',pg_temp.u(3),pg_temp.u(1101),'2026-10-01T01:00:00Z');
insert into public.job_stock_movements(organization_id,movement_id,reservation_id,request_id) values
 (pg_temp.u(100),pg_temp.u(900),pg_temp.u(1000),pg_temp.u(1100)),(pg_temp.u(100),pg_temp.u(901),pg_temp.u(1000),pg_temp.u(1101));
create function pg_temp.report(kind text,page jsonb default '{}',range jsonb default '{"from":"2026-10-01","to":"2026-10-02"}') returns jsonb language sql as
 $$select public.get_report(jsonb_build_object('organization_id',pg_temp.u(100)),kind,range,page)$$;
do $$begin perform set_config('request.jwt.claim.sub',pg_temp.u(1)::text,true);end$$;
select is(pg_temp.report('work_orders')->>'from','2026-09-30T16:00:00+00:00','Tenant midnight converted once to UTC');
select is(pg_temp.report('work_orders')#>>'{summary,completed}','3','Current completed range excludes reopened and exact end; includes PM before cutoff');
select is(pg_temp.report('work_orders')#>>'{summary,completion_sample_size}','2','Missing initial open has no duration sample');
select is((pg_temp.report('work_orders')#>>'{summary,completion_seconds}')::numeric,35970::numeric,'Latest approval 4h and PM 15h59m average = 35,970 seconds');
select is(pg_temp.report('work_orders')#>>'{summary,active_work_orders}','2','Active statuses exclude completed and canceled');
select is(pg_temp.report('work_orders')#>>'{summary,daily_completed,0,completed}','3','Tenant-local completion trend uses same current completions');
select is(pg_temp.report('work_orders')#>>'{summary,recurring_faults,0,recorded_work_orders}','7','Recorded asset/category counts are coordination facts, not diagnosis');
select is((pg_temp.report('asset_availability')#>>'{items,0,downtime_seconds}')::numeric,10800::numeric,'Overlapping unavailability is one interval union');
select is(pg_temp.report('asset_availability')#>'{items,1,downtime_seconds}','null'::jsonb,'Missing history remains unknown');
select is(pg_temp.report('asset_availability')#>'{summary,downtime_seconds}','null'::jsonb,'Unknown asset prevents fabricated aggregate zero');
select is((pg_temp.report('asset_availability')#>>'{summary,known_downtime_seconds}')::numeric,10800::numeric,'Known partial subtotal remains labeled');
select is(pg_temp.report('pm_compliance')#>>'{summary,eligible}','3','Canceled with explicit reason excluded; scheduled due remains eligible');
select is(pg_temp.report('pm_compliance')#>>'{summary,completed_on_time}','1','Exclusive pinned cutoff rejects approval exactly at midnight');
select is(round((pg_temp.report('pm_compliance')#>>'{summary,on_time_rate}')::numeric,4),0.3333::numeric,'Known PM rate uses independent one of three denominator');
select is(pg_temp.report('pm_compliance')#>>'{summary,completion_sample_size}','2','PM latest-approval sample explicit');
select is(pg_temp.report('pm_compliance')#>>'{summary,coverage}','generated_occurrences','Ungenerated backlog not misrepresented as overall compliance');
select is(pg_temp.report('technician_assignments')#>>'{items,1,active_jobs}','2','Only currently assigned active jobs count, not completed/unassigned work');
select is(pg_temp.report('parts_consumption')#>>'{items,0,net_quantity}','0.300','Exact issue quantity');
select is(pg_temp.report('parts_consumption')#>>'{items,1,net_quantity}','-0.100','Return compensates consumption exactly');
select is(pg_temp.report('maintenance_costs')#>'{summary,entered_estimate}','null'::jsonb,'No recorded cost input is unknown, never zero');
select is(pg_temp.report('maintenance_costs')->>'currency','PHP','Known tenant currency retained');
select is(public.get_dashboard(pg_temp.u(100),'{"from":"2026-10-01","to":"2026-10-02"}')#>'{counts,completed}',pg_temp.report('work_orders')#>'{summary,completed}','Dashboard shares latest-approval definition');
select is(public.get_dashboard(pg_temp.u(100),'{"from":"2026-10-01","to":"2026-10-02"}')->'downtime_seconds','null'::jsonb,'Dashboard shares unknown downtime');
select is(jsonb_array_length(pg_temp.report('work_orders','{"page_size":1}')->'items'),1,'Requested bounded first page');
select is(pg_temp.report('work_orders',pg_temp.report('work_orders','{"page_size":1}')->'next_cursor')#>>'{items,0,id}',pg_temp.u(302)::text,'Stable UUID continuation has no duplicate');
select throws_ok($$select pg_temp.report('work_orders','{"page_size":101}')$$,'P0001','VALIDATION','Oversized read denied');
select throws_ok($$select pg_temp.report('work_orders','{"page_size":null}')$$,'P0001','VALIDATION','Null size denied');
select throws_ok($$select pg_temp.report('sql_expression')$$,'P0001','VALIDATION','Kind allowlist enforced');
select throws_ok($$select pg_temp.report('work_orders','{}','{"from":"2024-01-01","to":"2025-01-02"}')$$,'P0001','VALIDATION','367 days denied');
select lives_ok($$select pg_temp.report('work_orders','{}','{"from":"2024-01-01","to":"2025-01-01"}')$$,'366 days accepted');
select throws_ok($$select pg_temp.report('work_orders','{}','{"from":"2026-02-30","to":"2026-03-01"}')$$,'P0001','VALIDATION','Impossible date rejected');
update public.organizations set timezone='America/New_York' where id=pg_temp.u(100);
select is(extract(epoch from (pg_temp.report('work_orders','{}','{"from":"2026-03-08","to":"2026-03-09"}')->>'to')::timestamptz-(pg_temp.report('work_orders','{}','{"from":"2026-03-08","to":"2026-03-09"}')->>'from')::timestamptz),82800::numeric,'Spring DST tenant day is 23 hours');
select is(extract(epoch from (pg_temp.report('work_orders','{}','{"from":"2026-11-01","to":"2026-11-02"}')->>'to')::timestamptz-(pg_temp.report('work_orders','{}','{"from":"2026-11-01","to":"2026-11-02"}')->>'from')::timestamptz),90000::numeric,'Fall DST tenant day is 25 hours');
update public.organizations set timezone='Pacific/Kiritimati' where id=pg_temp.u(100);
select is((pg_temp.report('work_orders')->>'from')::timestamptz,'2026-09-30T10:00:00Z'::timestamptz,'Date-line tenant boundary honored');
update public.organizations set timezone='Asia/Manila' where id=pg_temp.u(100);
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by,created_at)
 select pg_temp.u(2000+n),pg_temp.u(100),n,pg_temp.u(200),'Page fixture '||n,'Bounded drafts','pump','normal',pg_temp.u(1),'draft',pg_temp.u(1),'2026-10-01T00:00:00Z' from generate_series(20,145)n;
select is(jsonb_array_length(pg_temp.report('work_orders')->'items'),25,'Interactive default is 25 even for larger source');
select ok(pg_temp.report('work_orders')->'next_cursor'<>'null'::jsonb,'Default page offers bounded continuation');
select is(jsonb_array_length(pg_temp.report('work_orders','{"page_size":100}')->'items'),100,'Max100 cannot return larger source in one response');
select is(jsonb_array_length(pg_temp.report('work_orders',pg_temp.report('work_orders','{"page_size":100}')->'next_cursor')->'items'),34,'Remaining 34 rows remain reachable');
select is(public.get_report(jsonb_build_object('organization_id',pg_temp.u(102)),'work_orders','{"from":"2026-10-01","to":"2026-10-02"}')#>'{summary,completion_seconds}','null'::jsonb,'Empty completion sample is no data, not zero duration');
select is(public.get_report(jsonb_build_object('organization_id',pg_temp.u(102)),'asset_availability','{"from":"2026-10-01","to":"2026-10-02"}')#>>'{summary,downtime_seconds}','0','Known empty asset set is distinct from unknown history');
select is(pg_temp.report('asset_availability','{}',jsonb_build_object('from',((now() at time zone 'Asia/Manila')::date+1)::text,'to',((now() at time zone 'Asia/Manila')::date+2)::text))#>'{items,0,downtime_seconds}','null'::jsonb,'Future availability is unknown even with historical baseline');
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by,created_at,opened_at)
 values(pg_temp.u(309),pg_temp.u(100),9,pg_temp.u(200),'Missing approval','Unknown completion history','pump','normal',pg_temp.u(1),'completed',pg_temp.u(1),'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
insert into public.maintenance_plans(id,organization_id,asset_id,authorized_by,status,created_by) values(pg_temp.u(409),pg_temp.u(100),pg_temp.u(200),pg_temp.u(1),'paused',pg_temp.u(1));
insert into public.maintenance_plan_revisions(id,organization_id,plan_id,revision,author_id,title,instructions,category,cadence,frequency,anchor_on,timezone,supervisor_id,assignee_ids,checklist)
 values(pg_temp.u(509),pg_temp.u(100),pg_temp.u(409),1,pg_temp.u(1),'Pinned unknown PM','Check pump','pump','day',1,'2026-10-01','Asia/Manila',pg_temp.u(1),array[pg_temp.u(2)],'["Check"]');
insert into public.maintenance_occurrences(id,organization_id,plan_id,revision_id,scheduled_local_date,timezone,due_at,work_order_id,authorized_by,supervisor_id,assignee_ids)
 values(pg_temp.u(609),pg_temp.u(100),pg_temp.u(409),pg_temp.u(509),'2026-10-01','Asia/Manila','2026-10-01T16:00:00Z',pg_temp.u(309),pg_temp.u(1),pg_temp.u(1),array[pg_temp.u(2)]);
select is(pg_temp.report('pm_compliance')#>>'{summary,unknown_completions}','1','Missing immutable approval is explicitly unknown');
select is(pg_temp.report('pm_compliance')#>'{summary,on_time_rate}','null'::jsonb,'Unknown completion prevents fabricated PM rate');
select is(pg_temp.report('pm_compliance')#>>'{summary,eligible}','4','Unknown completion stays in denominator');
select throws_ok($$select public.get_report(jsonb_build_object('organization_id',pg_temp.u(100),'user_id',pg_temp.u(1)),'work_orders','{"from":"2026-10-01","to":"2026-10-02"}')$$,'P0001','VALIDATION','Cannot supply caller identity');
select throws_ok($$select public.get_report(jsonb_build_object('organization_id',pg_temp.u(101)),'work_orders','{"from":"2026-10-01","to":"2026-10-02"}')$$,'P0001','FORBIDDEN','Wrong tenant uniformly denied');
do $$begin perform set_config('request.jwt.claim.sub',pg_temp.u(2)::text,true);end$$;
select throws_ok($$select pg_temp.report('work_orders')$$,'P0001','FORBIDDEN','Assigned technician still has no team reports');
do $$begin perform set_config('request.jwt.claim.sub',pg_temp.u(3)::text,true);end$$;
select lives_ok($$select pg_temp.report('parts_consumption')$$,'Inventory may read minimal stock facts');
select throws_ok($$select pg_temp.report('maintenance_costs')$$,'P0001','FORBIDDEN','Inventory cannot read operational cost report');
update public.organization_members set active=false where organization_id=pg_temp.u(100) and user_id=pg_temp.u(3);
select throws_ok($$select pg_temp.report('parts_consumption')$$,'P0001','FORBIDDEN','Revocation checked on next page');
update public.organization_members set active=true,role='manager' where organization_id=pg_temp.u(100) and user_id=pg_temp.u(3);
select lives_ok($$select pg_temp.report('work_orders')$$,'Current manager may read operational reports');
update public.organization_members set role='supervisor' where organization_id=pg_temp.u(100) and user_id=pg_temp.u(3);
select lives_ok($$select pg_temp.report('asset_availability')$$,'Current supervisor may read operational reports');
update auth.users set banned_until='infinity' where id=pg_temp.u(3);
select throws_ok($$select pg_temp.report('asset_availability')$$,'P0001','FORBIDDEN','Banned user with retained claims denied');
set local role anon;
select throws_ok($$select public.get_report('{}','work_orders','{}')$$,'42501',null,'Anonymous execute denied');
reset role;
set local role service_role;
select throws_ok($$select public.get_report('{}','work_orders','{}')$$,'42501',null,'Service role cannot bypass report authorization');
reset role;
select * from finish();
rollback;
