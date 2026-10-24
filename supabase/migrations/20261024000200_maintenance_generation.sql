-- Native executor only; human command receipts retain their original identities and payloads.
create extension if not exists pg_cron;

create table public.maintenance_occurrences (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,plan_id uuid not null,revision_id uuid not null,
 scheduled_local_date date not null check(scheduled_local_date between date '0001-01-01' and date '9999-12-30'),
 timezone text not null,due_policy text not null default 'local_day_end' check(due_policy='local_day_end'),due_at timestamptz not null,
 work_order_id uuid not null,authorized_by uuid not null references auth.users(id),supervisor_id uuid not null references auth.users(id),
 assignee_ids uuid[] not null check(cardinality(assignee_ids) between 1 and 30),generated_at timestamptz not null default now(),
 unique(plan_id,scheduled_local_date),unique(organization_id,id),unique(organization_id,work_order_id),
 foreign key(organization_id,plan_id,revision_id) references public.maintenance_plan_revisions(organization_id,plan_id,id),
 foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id) deferrable initially deferred
);
create index maintenance_occurrence_pages on public.maintenance_occurrences(organization_id,scheduled_local_date,id);
create index maintenance_generation_budget on public.maintenance_occurrences(organization_id,generated_at);
create trigger immutable_history before update or delete on public.maintenance_occurrences for each row execute function private.immutable_history();
alter table public.maintenance_occurrences enable row level security;
revoke all on public.maintenance_occurrences from public,anon,authenticated,service_role;

alter table public.work_orders alter column created_by drop not null;
alter table public.work_orders add column creation_actor_kind text not null default 'human',add column pm_occurrence_id uuid;
alter table public.work_orders add foreign key(organization_id,pm_occurrence_id) references public.maintenance_occurrences(organization_id,id) deferrable initially deferred,
 add constraint work_creation_provenance check((creation_actor_kind='human' and created_by is not null and pm_occurrence_id is null)
 or (creation_actor_kind='system' and created_by is null and pm_occurrence_id is not null and source_request_id is null));
alter table public.audit_logs alter column actor_id drop not null;
alter table public.audit_logs add column actor_kind text not null default 'human',add column system_identity text;
alter table public.audit_logs add constraint audit_actor_provenance check((actor_kind='human' and actor_id is not null and system_identity is null)
 or (actor_kind='system' and actor_id is null and system_identity is not distinct from 'maintenance_scheduler' and action='maintenance.generated' and organization_id is not null));

-- Both writers already serialize on the organization. Count durable system occurrences in
-- the SAME real-time daily window as human receipts, never the executor's evaluation clock.
create function private.maintenance_daily_usage(org uuid) returns bigint language sql stable security definer set search_path='' as $$
 select (select count(*) from private.command_receipts where organization_id=org and created_at>=date_trunc('day',now()))
 +(select count(*) from public.maintenance_occurrences where organization_id=org and generated_at>=date_trunc('day',now()))
$$;
do $migration$
declare definition text;anchor text:='(select count(*) from private.command_receipts where organization_id=org and created_at>=date_trunc(''day'',now()))>=5000';
begin
 definition:=pg_get_functiondef('private.rate_check(uuid,uuid,text)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one daily quota source anchor';end if;
 execute replace(definition,anchor,'private.maintenance_daily_usage(org)>=5000');
end $migration$;

create function private.generate_due_maintenance(at_time timestamptz default now()) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare candidate record;p public.maintenance_plans;r public.maintenance_plan_revisions;s public.maintenance_segments;a public.assets;
 current_r public.maintenance_plan_revisions;day date;occurrence uuid;job uuid;generated integer:=0;checked integer:=0;blocked integer:=0;
begin
 if at_time is null or not isfinite(at_time) or (at_time at time zone 'UTC')::date not between date '0001-01-01' and date '9999-12-30' then raise exception using message='VALIDATION';end if;
 for candidate in select organization_id,id,asset_id from public.maintenance_plans where status='active' order by last_checked_at nulls first,id limit 100 loop
  exit when generated>=200;
  -- Same order as human safety writers: organization, asset, stable work set, plan.
  perform 1 from public.organizations where id=candidate.organization_id for update skip locked;
  if not found then continue;end if;
  select * into a from public.assets where organization_id=candidate.organization_id and id=candidate.asset_id for update skip locked;
  if not found then continue;end if;
  perform 1 from public.work_orders where organization_id=a.organization_id and asset_id=a.id order by id for update;
  select * into p from public.maintenance_plans where id=candidate.id and organization_id=candidate.organization_id for update skip locked;
  if not found or p.status<>'active' then continue;end if;
  checked:=checked+1;
  begin
   if a.archived_at is not null then
    update public.maintenance_plans set generation_blocked='asset_archived',last_checked_at=clock_timestamp() where id=p.id;blocked:=blocked+1;continue;
   end if;
   if not private.maintenance_current_people_eligible(p.organization_id,p.id) then
    update public.maintenance_plans set generation_blocked='person_ineligible',last_checked_at=clock_timestamp() where id=p.id;blocked:=blocked+1;continue;
   end if;
   if exists(select 1 from public.maintenance_occurrences o join public.work_orders w on w.organization_id=o.organization_id and w.id=o.work_order_id where o.organization_id=p.organization_id and o.plan_id=p.id and w.status not in ('completed','canceled')) then
    update public.maintenance_plans set generation_blocked='unfinished_work',last_checked_at=clock_timestamp() where id=p.id;blocked:=blocked+1;continue;
   end if;
   select seg.* into s from public.maintenance_segments seg join public.maintenance_plan_revisions rev on rev.organization_id=seg.organization_id and rev.plan_id=seg.plan_id and rev.id=seg.revision_id
   where seg.plan_id=p.id and seg.organization_id=p.organization_id
    and private.maintenance_date(rev.anchor_on,rev.cadence,rev.frequency,seg.next_ordinal)<=coalesce(seg.protected_through,(at_time at time zone rev.timezone)::date)
    and private.maintenance_date(rev.anchor_on,rev.cadence,rev.frequency,seg.next_ordinal)<=(at_time at time zone rev.timezone)::date
   order by private.maintenance_date(rev.anchor_on,rev.cadence,rev.frequency,seg.next_ordinal),rev.revision limit 1;
   if not found then update public.maintenance_plans set generation_blocked=null,last_checked_at=clock_timestamp() where id=p.id;continue;end if;
   if private.maintenance_daily_usage(p.organization_id)>=5000 or (select count(*) from public.work_orders where organization_id=p.organization_id)>=10000 then
    update public.maintenance_plans set generation_blocked='quota',last_checked_at=clock_timestamp() where id=p.id;blocked:=blocked+1;continue;
   end if;
   select * into r from public.maintenance_plan_revisions where organization_id=p.organization_id and id=s.revision_id;
   select * into current_r from public.maintenance_plan_revisions where organization_id=p.organization_id and id=p.current_revision_id;
   day:=private.maintenance_date(r.anchor_on,r.cadence,r.frequency,s.next_ordinal);occurrence:=gen_random_uuid();job:=gen_random_uuid();
   insert into public.maintenance_occurrences(id,organization_id,plan_id,revision_id,scheduled_local_date,timezone,due_at,work_order_id,authorized_by,supervisor_id,assignee_ids)
   values(occurrence,p.organization_id,p.id,r.id,day,r.timezone,private.maintenance_cutoff(day,r.timezone),job,p.authorized_by,current_r.supervisor_id,current_r.assignee_ids);
   insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,due_at,planned_on,supervisor_id,status,blocks_operation,created_by,creation_actor_kind,pm_occurrence_id)
   values(job,p.organization_id,(select coalesce(max(number),0)+1 from public.work_orders where organization_id=p.organization_id),p.asset_id,r.title,r.instructions,r.category,'normal',private.maintenance_cutoff(day,r.timezone),day,current_r.supervisor_id,'scheduled',false,null,'system',occurrence);
   insert into public.work_order_tasks(organization_id,work_order_id,label,required) select p.organization_id,job,t#>>'{}',true from jsonb_array_elements(r.checklist) t;
   insert into public.work_order_assignments(organization_id,work_order_id,user_id) select p.organization_id,job,u from unnest(current_r.assignee_ids) u;
   insert into public.audit_logs(organization_id,actor_id,actor_kind,system_identity,action,entity_id,request_id,changes)
   values(p.organization_id,null,'system','maintenance_scheduler','maintenance.generated',occurrence,occurrence,
    jsonb_build_object('plan_id',p.id,'revision_id',r.id,'author_id',r.author_id,'authorized_by',p.authorized_by,'personnel_revision_id',current_r.id,'supervisor_id',current_r.supervisor_id,'assignee_ids',current_r.assignee_ids,'work_order_id',job,'scheduled_local_date',day));
   update public.maintenance_segments set next_ordinal=next_ordinal+1 where revision_id=s.revision_id;
   update public.maintenance_plans set generation_blocked=null,last_checked_at=clock_timestamp() where id=p.id;
   generated:=generated+1;
  exception when others then
   -- The subtransaction rolls back occurrence, job, tasks, assignments, audit AND cursor.
   update public.maintenance_plans set generation_blocked='dependency',last_checked_at=clock_timestamp() where id=p.id;blocked:=blocked+1;
  end;
 end loop;
 return jsonb_build_object('checked',checked,'generated',generated,'blocked',blocked,'checked_at',at_time);
end $$;

create function private.pin_pm_work_order() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.maintenance_occurrences;
begin
 if TG_OP='UPDATE' and (new.creation_actor_kind,new.created_by,new.pm_occurrence_id) is distinct from (old.creation_actor_kind,old.created_by,old.pm_occurrence_id) then raise exception using message='VALIDATION';end if;
 if new.pm_occurrence_id is not null then
  select * into o from public.maintenance_occurrences where organization_id=new.organization_id and id=new.pm_occurrence_id;
  if o.id is null or o.work_order_id<>new.id or new.due_at is distinct from o.due_at
   or new.asset_id is distinct from (select asset_id from public.maintenance_plans where id=o.plan_id and organization_id=o.organization_id)
   or (not new.blocks_operation and new.status not in ('scheduled','open','canceled'))
   or (TG_OP='UPDATE' and old.blocks_operation and not new.blocks_operation) then raise exception using message='VALIDATION';end if;
 end if;
 return new;
end $$;
create trigger pm_work_order_identity before insert or update on public.work_orders for each row execute function private.pin_pm_work_order();

-- Extend the accepted shared transaction after replay; reject drift instead of replacing its safety gates.
do $migration$
declare definition text;pair text[];
begin
 definition:=pg_get_functiondef('private.operational_command_base(jsonb,text,jsonb)'::regprocedure);
 foreach pair slice 1 in array array[
  array[$old$  if fields?'due_at' and jsonb_typeof(fields->'due_at') not in ('string','null') then$old$,
        $new$  if wo.pm_occurrence_id is not null and fields?'due_at' then raise exception using message='VALIDATION';end if;
  if fields?'due_at' and jsonb_typeof(fields->'due_at') not in ('string','null') then$new$],
  array[$old$  if wo.blocks_operation and not (wo.status='draft' and next_status='canceled') then$old$,
        $new$  if wo.pm_occurrence_id is not null and next_status='in_progress' then
   update public.work_orders set blocks_operation=true where id=wo.id;
   wo.blocks_operation:=true;
  end if;
  if wo.blocks_operation and not (wo.status='draft' and next_status='canceled') then$new$],
  array[$old$or (wo.status='scheduled' and next_status in ('open','in_progress','canceled'))$old$,
        $new$or (wo.status='scheduled' and (next_status in ('open','in_progress','canceled') or (wo.pm_occurrence_id is not null and next_status='scheduled')))$new$],
  array[$old$if action='review_work_order' or (action='transition_work_order' and not (next_status='canceled' and wo.opened_at is null)) then$old$,
        $new$if action='review_work_order' or (action='transition_work_order' and wo.blocks_operation and not (next_status='canceled' and wo.opened_at is null)) then$new$]
 ] loop
  if (length(definition)-length(replace(definition,pair[1],'')))/length(pair[1])<>1 then raise exception 'Expected one PM operational source anchor';end if;
  definition:=replace(definition,pair[1],pair[2]);
 end loop;
 execute definition;
end $migration$;

-- Preserve old receipt shapes, adding the discriminator only when a legacy command returns a system job.
do $migration$
declare definition text;anchor text:='if fields is not null then select jsonb_object_agg(k,data->k) into data from unnest(fields) k; end if;';
begin
 definition:=pg_get_functiondef('private.finish_command(uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one receipt projection source anchor';end if;
 execute replace(definition,anchor,$new$if fields is not null then
  if action in ('create_work_order','assign_work_order','convert_request') and data->>'creation_actor_kind'='system' then fields:=fields||array['creation_actor_kind','pm_occurrence_id'];end if;
  select jsonb_object_agg(k,data->k) into data from unnest(fields) k;
 end if;$new$);
end $migration$;

create function public.list_maintenance_agenda(organization_id uuid,from_on date,to_on date,cursor jsonb default null,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare org uuid:=organization_id;items jsonb;next_cursor jsonb;after_date date;after_id uuid;
begin
 perform private.confirmed_actor();
 if private.member_role(org) is null or private.member_role(org) not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN';end if;
 if from_on is null or to_on is null or not isfinite(from_on) or not isfinite(to_on) or to_on-from_on not between 0 and 366
  or from_on<date '0001-01-01' or to_on>date '9999-12-30' or page_size is null or page_size not between 1 and 100 then raise exception using message='VALIDATION';end if;
 if cursor is not null then
  perform private.object_fields(cursor,array['date','id']);
  if jsonb_typeof(cursor->'date') is distinct from 'string' or jsonb_typeof(cursor->'id') is distinct from 'string' or (cursor->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using message='VALIDATION';end if;
  after_date:=(cursor->>'date')::date;after_id:=(cursor->>'id')::uuid;
  if after_date not between from_on and to_on then raise exception using message='VALIDATION';end if;
 end if;
 with bounded as (
  select o.*,w.status work_status,w.blocks_operation,w.planned_on,w.title from public.maintenance_occurrences o
  join public.work_orders w on w.organization_id=o.organization_id and w.id=o.work_order_id
  where o.organization_id=org and o.scheduled_local_date between from_on and to_on and private.can_read_maintenance(org,o.plan_id)
   and private.can_read_work(org,w.id) and (cursor is null or (o.scheduled_local_date,o.id)>(after_date,after_id))
  order by o.scheduled_local_date,o.id limit page_size+1
 ),numbered as (select *,row_number() over(order by scheduled_local_date,id) n from bounded)
 select coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by scheduled_local_date,id) filter(where n<=page_size),'[]'::jsonb),
  case when count(*)>page_size then (select jsonb_build_object('date',scheduled_local_date,'id',id) from numbered where n=page_size) end into items,next_cursor from numbered;
 return jsonb_build_object('items',items,'next_cursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception using message='VALIDATION';
end $$;

create function public.list_maintenance_backlog(organization_id uuid,plan_id uuid,cursor integer default null,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare org uuid:=organization_id;target uuid:=plan_id;p public.maintenance_plans;items jsonb;next_cursor integer;
begin
 perform private.confirmed_actor();
 if not private.can_read_maintenance(org,target) then raise exception using message='FORBIDDEN';end if;
 select mp.* into p from public.maintenance_plans mp where mp.organization_id=org and mp.id=target;
 if not found then raise exception using message='NOT_FOUND';end if;
 if page_size is null or page_size not between 1 and 100 or (cursor is not null and cursor<=0) then raise exception using message='VALIDATION';end if;
 with bounded as (
  select r.id revision_id,r.revision,r.author_id,s.next_ordinal,d.next_on,s.protected_through,r.timezone,private.maintenance_cutoff(d.next_on,r.timezone) due_at
  from public.maintenance_segments s join public.maintenance_plan_revisions r on r.organization_id=s.organization_id and r.plan_id=s.plan_id and r.id=s.revision_id
  cross join lateral (select private.maintenance_date(r.anchor_on,r.cadence,r.frequency,s.next_ordinal) next_on) d
  where s.organization_id=org and s.plan_id=target and (cursor is null or r.revision>cursor)
   and d.next_on<=coalesce(s.protected_through,(now() at time zone r.timezone)::date) and d.next_on<=(now() at time zone r.timezone)::date
  order by r.revision limit page_size+1
 ),numbered as(select *,row_number() over(order by revision) n from bounded)
 select coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by revision) filter(where n<=page_size),'[]'::jsonb),
  case when count(*)>page_size then (select revision from numbered where n=page_size) end into items,next_cursor from numbered;
 return jsonb_build_object('items',items,'next_cursor',next_cursor,'evaluated_at',now(),'status',p.status,'generation_blocked',p.generation_blocked,'last_checked_at',p.last_checked_at);
end $$;

revoke all on function private.maintenance_daily_usage(uuid),private.generate_due_maintenance(timestamptz),private.pin_pm_work_order(),public.list_maintenance_agenda(uuid,date,date,jsonb,integer),public.list_maintenance_backlog(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_maintenance_agenda(uuid,date,date,jsonb,integer),public.list_maintenance_backlog(uuid,uuid,integer,integer) to authenticated;
revoke all on schema cron from public,anon,authenticated,service_role;
-- Supabase owns extension function PUBLIC grants. Schema USAGE is the effective
-- application-role boundary; private generator EXECUTE remains explicitly denied.
select cron.schedule('opspilot-maintenance','5 * * * *',$cron$select private.generate_due_maintenance();$cron$);
