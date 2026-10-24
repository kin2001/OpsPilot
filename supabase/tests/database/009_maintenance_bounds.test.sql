begin;
set local search_path=public,extensions;
select no_plan();
-- Dedicated synthetic state for deliberate failure injection and batch contention limits.
insert into auth.users(id,email,email_confirmed_at) values('00000030-0000-4000-8000-000000000009','pm30-bounds@example.test',now());
insert into public.organizations(id,name,timezone,currency,created_by) values('10000030-0000-4000-8000-000000000009','PM bounds','UTC','PHP','00000030-0000-4000-8000-000000000009');
insert into public.organization_members(organization_id,user_id,role) values('10000030-0000-4000-8000-000000000009','00000030-0000-4000-8000-000000000009','owner');
insert into public.assets(id,organization_id,code,name,category,created_by,availability) values('20000030-0000-4000-8000-000000000009','10000030-0000-4000-8000-000000000009','BOUNDS','Synthetic','pump','00000030-0000-4000-8000-000000000009','operational');
create function pg_temp.plan(title text,label text) returns uuid language plpgsql as $$
declare p uuid:=gen_random_uuid();r uuid:=gen_random_uuid();
begin
 insert into public.maintenance_plans(id,organization_id,asset_id,authorized_by,status,created_by)
 values(p,'10000030-0000-4000-8000-000000000009','20000030-0000-4000-8000-000000000009','00000030-0000-4000-8000-000000000009','active','00000030-0000-4000-8000-000000000009');
 insert into public.maintenance_plan_revisions(id,organization_id,plan_id,revision,author_id,title,instructions,category,cadence,frequency,anchor_on,timezone,supervisor_id,assignee_ids,checklist)
 values(r,'10000030-0000-4000-8000-000000000009',p,1,'00000030-0000-4000-8000-000000000009',title,'Synthetic instructions','routine','day',1,'2024-01-01','UTC','00000030-0000-4000-8000-000000000009',array['00000030-0000-4000-8000-000000000009'::uuid],jsonb_build_array(label));
 insert into public.maintenance_segments(organization_id,plan_id,revision_id) values('10000030-0000-4000-8000-000000000009',p,r);
 update public.maintenance_plans set current_revision_id=r where id=p;
 return p;
end $$;
create temporary table failed_plan as select pg_temp.plan('Fault plan','Deliberate failure') id;
create function pg_temp.fail_task() returns trigger language plpgsql as $$ begin if new.label='Deliberate failure' then raise exception 'Synthetic late failure';end if;return new;end $$;
create trigger synthetic_failure before insert on public.work_order_tasks for each row execute function pg_temp.fail_task();
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','0','Late task failure does not report generated success');
select is((select generation_blocked from public.maintenance_plans where id=(select id from failed_plan)),'dependency','Late failure is visible');
select is((select count(*)::integer from public.maintenance_occurrences where organization_id='10000030-0000-4000-8000-000000000009'),0,'Occurrence rolled back');
select is((select count(*)::integer from public.work_orders where organization_id='10000030-0000-4000-8000-000000000009'),0,'Work order rolled back');
select is((select count(*)::integer from public.notifications where organization_id='10000030-0000-4000-8000-000000000009'),0,'No phantom notifications');
select is((select next_ordinal from public.maintenance_segments where plan_id=(select id from failed_plan)),0,'Late failure preserves cursor');
select is((select availability from public.assets where id='20000030-0000-4000-8000-000000000009'),'operational','Late failure cannot demote released asset');
drop trigger synthetic_failure on public.work_order_tasks;
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','1','Retry succeeds after dependency recovers');
select is((select next_ordinal from public.maintenance_segments where plan_id=(select id from failed_plan)),1,'Recovered occurrence advances exactly once');
update public.maintenance_plans set status='paused' where id=(select id from failed_plan);
select pg_temp.plan('Bounded plan '||n,'Check') from generate_series(1,101) n;
create temporary table first_batch as select private.generate_due_maintenance('2026-10-24 12:00Z') result;
select is((select result->>'checked' from first_batch),'100','One execution checks at most 100 plans');
select is((select result->>'generated' from first_batch),'100','One unfinished occurrence per checked plan bounds work below 200');
select is((select count(*)::integer from public.maintenance_segments where organization_id='10000030-0000-4000-8000-000000000009' and next_ordinal=0),1,'Unprocessed plan remains pending');
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','1','Next run picks unprocessed plan without dropping it');
select is(private.generate_due_maintenance('2026-10-24 12:00Z')->>'generated','0','Existing unfinished jobs prevent backlog flood');
select is((select count(*)::integer from public.maintenance_occurrences where organization_id='10000030-0000-4000-8000-000000000009'),102,'Exactly one occurrence per plan after bounded catchup');
select is((select count(*)::integer from public.audit_logs where organization_id='10000030-0000-4000-8000-000000000009' and action='maintenance.generated'),102,'One truthful audit per durable occurrence');
select * from finish();
rollback;
