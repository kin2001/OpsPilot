-- Read-only facts: current authority is checked on every page; no browser/service-role bypass.
create function private.report_work_facts(org uuid) returns table(
 id uuid,number integer,asset_id uuid,category text,status text,opened_at timestamptz,approved_at timestamptz,
 completion_seconds numeric,due_at timestamptz,created_at timestamptz
) language sql stable security definer set search_path='' as $$
 select w.id,w.number,w.asset_id,w.category,w.status,w.opened_at,
 case when w.status='completed' then r.created_at end,
 case when w.status='completed' and r.created_at>=w.opened_at then extract(epoch from r.created_at-w.opened_at) end,w.due_at,w.created_at
 from public.work_orders w left join lateral(
  select r.created_at from public.work_order_reviews r where r.organization_id=org and r.work_order_id=w.id
   and r.repair_revision=w.repair_revision and r.decision='approved' order by r.created_at desc,r.id desc limit 1
 ) r on true where w.organization_id=org
$$;
create function private.report_work_summary(org uuid,start_at timestamptz,end_at timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('active_work_orders',count(*) filter(where status in ('open','scheduled','in_progress','blocked','awaiting_review')),
 'blocked',count(*) filter(where status='blocked'),'pending_approvals',count(*) filter(where status='awaiting_review'),
 'overdue',count(*) filter(where status in ('open','scheduled','in_progress','blocked','awaiting_review') and due_at<now()),
 'completed',count(*) filter(where approved_at>=start_at and approved_at<end_at),
 'completion_sample_size',count(completion_seconds) filter(where approved_at>=start_at and approved_at<end_at),
 'completion_seconds',avg(completion_seconds) filter(where approved_at>=start_at and approved_at<end_at)) from private.report_work_facts(org)
$$;
create function private.report_availability(org uuid,start_at timestamptz,end_at timestamptz) returns table(
 id uuid,code text,name text,history_complete boolean,downtime_seconds numeric,known_downtime_seconds numeric
) language sql stable security definer set search_path='' as $$
 with events as (
  select l.entity_id,l.id,(l.changes->>'occurred_at')::timestamptz at_time,l.changes,
   lead((l.changes->>'occurred_at')::timestamptz) over(partition by l.entity_id order by (l.changes->>'occurred_at')::timestamptz,l.id) next_at
  from public.audit_logs l where l.organization_id=org and l.action='asset.availability_changed'
 ), facts as (
  select a.id,a.code,a.name,
   end_at<=now() and exists(select 1 from events e where e.entity_id=a.id and e.at_time<=greatest(start_at,a.created_at))
   and not exists(select 1 from events e where e.entity_id=a.id and e.at_time<end_at and coalesce(e.next_at,end_at)>greatest(start_at,a.created_at)
    and (e.changes->>'provenance' is distinct from 'recorded_transition' or e.changes->>'new_status' is null or e.changes->>'active' is null)) complete,
   coalesce((select sum(greatest(0,extract(epoch from least(coalesce(e.next_at,end_at),end_at,now())-greatest(e.at_time,start_at,a.created_at))))
    from events e where e.entity_id=a.id and e.at_time<end_at and coalesce(e.next_at,end_at)>greatest(start_at,a.created_at)
     and e.changes->>'provenance'='recorded_transition' and e.changes->>'new_status'<>'operational' and (e.changes->>'active')::boolean),0) known
  from public.assets a where a.organization_id=org and a.created_at<end_at
 ) select id,code,name,complete,case when complete then known end,known from facts
$$;
create index report_approvals on public.work_order_reviews(organization_id,work_order_id,repair_revision,created_at desc,id desc) where decision='approved';

create function public.get_report(ctx jsonb,kind text,range jsonb,cursor jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid;role text;zone text;currency text;start_at timestamptz;end_at timestamptz;from_on date;to_on date;
 after_id uuid;page_size integer:=25;rows jsonb;summary jsonb;next_page jsonb;
begin
 if auth.uid() is null then raise exception using message='UNAUTHENTICATED';end if;
 perform private.object_fields(ctx,array['organization_id']);
 org:=(ctx->>'organization_id')::uuid;
 if org is null or jsonb_typeof(ctx->'organization_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
 role:=private.member_role(org);
 if role is null or not (role in ('owner','manager','supervisor') or (role='inventory' and kind='parts_consumption')) then raise exception using message='FORBIDDEN';end if;
 if kind is null or kind not in ('work_orders','asset_availability','pm_compliance','technician_assignments','parts_consumption','maintenance_costs') then raise exception using message='VALIDATION';end if;
 perform private.object_fields(range,array['from','to']);perform private.object_fields(cursor,array['after','page_size']);
 if jsonb_typeof(range->'from') is distinct from 'string' or jsonb_typeof(range->'to') is distinct from 'string'
  or (range->>'from')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (range->>'to')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using message='VALIDATION';end if;
 from_on:=(range->>'from')::date;to_on:=(range->>'to')::date;
 if from_on<date '0001-01-01' or to_on>date '9999-12-30' or to_on-from_on not between 1 and 366 then raise exception using message='VALIDATION';end if;
 if cursor?'after' then
  if jsonb_typeof(cursor->'after') is distinct from 'string' then raise exception using message='VALIDATION';end if;
  after_id:=(cursor->>'after')::uuid;
 end if;
 if cursor?'page_size' then
  if jsonb_typeof(cursor->'page_size') is distinct from 'number' or (cursor->>'page_size')!~'^[1-9][0-9]*$' then raise exception using message='VALIDATION';end if;
  page_size:=(cursor->>'page_size')::integer;
 end if;
 if page_size not between 1 and 100 then raise exception using message='VALIDATION';end if;
 select o.timezone,o.currency into zone,currency from public.organizations o where o.id=org;
 start_at:=from_on::timestamp at time zone zone;end_at:=to_on::timestamp at time zone zone;
 case kind
 when 'work_orders' then
  select coalesce(jsonb_agg(to_jsonb(f)-array['due_at','created_at'] order by id),'[]') into rows from (
   select * from private.report_work_facts(org) where (after_id is null or id>after_id)
    and ((created_at>=start_at and created_at<end_at) or (approved_at>=start_at and approved_at<end_at)
     or (status in ('open','scheduled','in_progress','blocked','awaiting_review') and created_at<end_at)) order by id limit page_size+1
  ) f;
  summary:=private.report_work_summary(org,start_at,end_at);
  with faults as (
   select asset_id,category,count(*) recorded_work_orders from private.report_work_facts(org)
   where opened_at>=start_at and opened_at<end_at and status<>'draft' group by asset_id,category
  ), fault_page as (select * from faults order by asset_id,category limit 100), days as (
   select d.day::date date,count(w.id) completed from generate_series(from_on::timestamp,(to_on-1)::timestamp,interval '1 day')d(day)
   left join private.report_work_facts(org) w on w.approved_at>=d.day at time zone zone and w.approved_at<(d.day+interval '1 day') at time zone zone group by d.day
  ) select summary||jsonb_build_object('daily_completed',(select jsonb_agg(to_jsonb(d) order by date) from days d),
   'recurring_faults',(select coalesce(jsonb_agg(to_jsonb(f) order by asset_id,category),'[]') from fault_page f),
   'recurring_faults_has_more',(select count(*)>100 from faults)) into summary;
 when 'asset_availability' then
  select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]') into rows from (
   select * from private.report_availability(org,start_at,end_at) where after_id is null or id>after_id order by id limit page_size+1
  ) f;
  select jsonb_build_object('history_complete',coalesce(bool_and(history_complete),true),
   'downtime_seconds',case when coalesce(bool_and(history_complete),true) then coalesce(sum(known_downtime_seconds),0) end,
   'known_downtime_seconds',coalesce(sum(known_downtime_seconds),0)) into summary from private.report_availability(org,start_at,end_at);
 when 'pm_compliance' then
  with facts as (
   select o.id,o.work_order_id,o.scheduled_local_date,o.timezone,o.due_at,w.approved_at,w.status,c.reason canceled_reason,
    w.status<>'canceled' or c.reason is null eligible,
    case when w.status='completed' and w.approved_at is null then null else coalesce(w.approved_at<o.due_at,false) and w.status='completed' end on_time
   from public.maintenance_occurrences o join private.report_work_facts(org) w on w.id=o.work_order_id
   left join lateral(select e.note reason from public.work_order_events e where e.organization_id=org and e.work_order_id=w.id
    and e.action='transition_work_order' and e.status='canceled' and length(trim(e.note))>0 order by e.created_at desc,e.id desc limit 1)c on true
   where o.organization_id=org and o.scheduled_local_date>=from_on and o.scheduled_local_date<to_on and o.due_at<=now()
  ), page as (select * from facts where after_id is null or id>after_id order by id limit page_size+1)
  select (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from page p),
   jsonb_build_object('coverage','generated_occurrences','eligible',count(*) filter(where eligible),'completed_on_time',count(*) filter(where eligible and on_time),
    'completion_sample_size',count(*) filter(where eligible and approved_at is not null),'unknown_completions',count(*) filter(where eligible and on_time is null),
    'on_time_rate',case when count(*) filter(where eligible and on_time is null)=0 then count(*) filter(where eligible and on_time)::numeric/nullif(count(*) filter(where eligible),0) end) into rows,summary from facts;
 when 'technician_assignments' then
  with facts as (
   select m.user_id id,m.role,m.active,count(w.id) active_jobs from public.organization_members m
   left join public.work_order_assignments a on a.organization_id=org and a.user_id=m.user_id and a.unassigned_at is null
   left join public.work_orders w on w.organization_id=org and w.id=a.work_order_id and w.status in ('open','scheduled','in_progress','blocked','awaiting_review')
   where m.organization_id=org group by m.user_id,m.role,m.active
  ), page as (select * from facts where after_id is null or id>after_id order by id limit page_size+1)
  select (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from page p),jsonb_build_object('assigned_active_jobs',coalesce(sum(active_jobs),0)) into rows,summary from facts;
 when 'parts_consumption' then
  with facts as (
   select m.id,r.work_order_id,m.part_id,m.location_id,m.unit,m.kind,m.quantity::text,
    (case when m.kind='return' then -m.quantity else m.quantity end)::numeric(14,3)::text net_quantity,m.created_at occurred_at
   from public.inventory_movements m join public.job_stock_movements j on j.organization_id=org and j.movement_id=m.id
   join public.stock_reservations r on r.organization_id=org and r.id=j.reservation_id
   where m.organization_id=org and m.kind in ('issue','return') and m.created_at>=start_at and m.created_at<end_at
  ), page as (select * from facts where after_id is null or id>after_id order by id limit page_size+1)
  select (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from page p),jsonb_build_object('movement_count',count(*),'quantity_policy','net_by_part_and_unit') into rows,summary from facts;
 when 'maintenance_costs' then
  rows:='[]';summary:=jsonb_build_object('label','Entered maintenance-cost estimate','entered_estimate',null,'coverage','unavailable','reason','entered_costs_not_recorded');
 end case;
 if jsonb_array_length(rows)>page_size then
  next_page:=jsonb_build_object('after',rows->(page_size-1)->>'id','page_size',page_size);rows:=rows-page_size;
 end if;
 return jsonb_build_object('schema_version',1,'kind',kind,'range',range,'timezone',zone,'currency',currency,
  'from',start_at,'to',end_at,'generated_at',now(),'items',rows,'next_cursor',next_page,'summary',summary);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using message='VALIDATION';
end $$;

-- Preserve the dashboard transport while sharing report completion/availability definitions.
create or replace function public.get_dashboard(organization_id uuid,range jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare report jsonb;start_at timestamptz;end_at timestamptz;zone text;trend jsonb;counts jsonb;
begin
 report:=public.get_report(jsonb_build_object('organization_id',organization_id),'asset_availability',range);
 start_at:=(report->>'from')::timestamptz;end_at:=(report->>'to')::timestamptz;zone:=report->>'timezone';
 counts:=private.report_work_summary(organization_id,start_at,end_at)||jsonb_build_object(
  'active_assets',(select count(*) from public.assets where assets.organization_id=get_dashboard.organization_id and archived_at is null),
  'available_assets',(select count(*) from public.assets a where a.organization_id=get_dashboard.organization_id and a.archived_at is null and a.availability='operational'
   and not exists(select 1 from public.asset_holds h where h.organization_id=a.organization_id and h.asset_id=a.id and h.released_at is null and h.resolved_at is null)));
 select coalesce(jsonb_agg(jsonb_build_object('date',day::date,'known_assets',known,'available_assets',case when unknown_assets=0 then available end) order by day),'[]') into trend from (
  select d.day,count(a.id) filter(where (d.day+interval '1 day') at time zone zone>now() or not coalesce(e.known,false)) unknown_assets,
   count(e.id) filter(where (d.day+interval '1 day') at time zone zone<=now() and e.known and e.changes->'active'='true'::jsonb) known,
   count(e.id) filter(where (d.day+interval '1 day') at time zone zone<=now() and e.known and e.changes->'active'='true'::jsonb and e.changes->>'new_status'='operational') available
  from generate_series(greatest((range->>'from')::date,(range->>'to')::date-7)::timestamp,((range->>'to')::date-1)::timestamp,interval '1 day')d(day)
  left join public.assets a on a.organization_id=get_dashboard.organization_id and a.created_at<(d.day+interval '1 day') at time zone zone
  left join lateral(select l.id,l.changes,l.changes->>'provenance'='recorded_transition' and jsonb_typeof(l.changes->'active')='boolean'
   and (l.changes->'active'='false'::jsonb or l.changes->>'new_status' in ('operational','under_maintenance','out_of_service','pending_release')) known
   from public.audit_logs l where l.organization_id=get_dashboard.organization_id and l.entity_id=a.id and l.action='asset.availability_changed'
   and (l.changes->>'occurred_at')::timestamptz<(d.day+interval '1 day') at time zone zone order by (l.changes->>'occurred_at')::timestamptz desc,l.id desc limit 1)e on true group by d.day
 ) daily;
 return jsonb_build_object('counts',counts,'daily_availability',trend,'downtime_seconds',report#>'{summary,downtime_seconds}',
  'history_complete',report#>'{summary,history_complete}','timezone',zone,'from',start_at,'to',end_at,'generated_at',now());
end $$;
revoke all on function private.report_work_facts(uuid),private.report_work_summary(uuid,timestamptz,timestamptz),private.report_availability(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.get_report(jsonb,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_report(jsonb,text,jsonb,jsonb) to authenticated;
