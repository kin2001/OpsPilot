-- Plan commands only. Generation, occurrence provenance and native Cron belong to POR-30.
create function private.maintenance_date(anchor date,cadence text,frequency integer,ordinal integer) returns date
language plpgsql immutable set search_path='' as $$
declare result date;
begin
 if anchor is null or not isfinite(anchor) or frequency is null or frequency not between 1 and 365 or ordinal is null or ordinal not between 0 and 100000 then raise exception using message='VALIDATION';end if;
 if cadence='day' then result:=anchor+frequency*ordinal;
 elsif cadence='week' then result:=anchor+7*frequency*ordinal;
 elsif cadence='month' then result:=(anchor+make_interval(months=>frequency*ordinal))::date;
 else raise exception using message='VALIDATION';end if;
 if result not between date '0001-01-01' and date '9999-12-30' then raise exception using message='VALIDATION';end if;
 return result;
end $$;
create function private.maintenance_cutoff(scheduled_on date,zone text) returns timestamptz
language sql stable set search_path='' as $$ select (scheduled_on+1)::timestamp at time zone zone $$;
create function private.maintenance_ordinal(anchor date,cadence text,frequency integer,after_on date) returns integer
language plpgsql immutable set search_path='' as $$
declare ordinal integer:=0;
begin
 if after_on is not null and after_on>=anchor then
  ordinal:=case cadence when 'day' then (after_on-anchor)/frequency when 'week' then (after_on-anchor)/(7*frequency)
   when 'month' then ((extract(year from after_on)::integer-extract(year from anchor)::integer)*12+extract(month from after_on)::integer-extract(month from anchor)::integer)/frequency end;
  if private.maintenance_date(anchor,cadence,frequency,ordinal)<=after_on then ordinal:=ordinal+1;end if;
 end if;
 perform private.maintenance_date(anchor,cadence,frequency,ordinal);
 return ordinal;
end $$;

create table public.maintenance_plans (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),asset_id uuid not null,
 current_revision_id uuid,authorized_by uuid not null references auth.users(id),status text not null check(status in ('active','paused','archived')),
 generation_blocked text check(generation_blocked in ('person_ineligible','asset_archived','unfinished_work','quota','dependency')),
 last_checked_at timestamptz,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),version integer not null default 1 check(version>0),
 unique(organization_id,id),foreign key(organization_id,asset_id) references public.assets(organization_id,id)
);
create table public.maintenance_plan_revisions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,plan_id uuid not null,revision integer not null check(revision>0),
 author_id uuid not null references auth.users(id),title text not null check(length(trim(title)) between 1 and 200),
 instructions text not null check(length(trim(instructions)) between 1 and 4000),category text not null check(length(trim(category)) between 1 and 100),
 cadence text not null check(cadence in ('day','week','month')),frequency integer not null check(frequency between 1 and 365),anchor_on date not null check(anchor_on between date '0001-01-01' and date '9999-12-30'),
 timezone text not null,supervisor_id uuid not null references auth.users(id),assignee_ids uuid[] not null check(cardinality(assignee_ids) between 1 and 30),
 checklist jsonb not null check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist) between 1 and 100),
 created_at timestamptz not null default now(),unique(organization_id,id),unique(organization_id,plan_id,id),unique(organization_id,plan_id,revision),
 foreign key(organization_id,plan_id) references public.maintenance_plans(organization_id,id)
);
alter table public.maintenance_plans add foreign key(organization_id,id,current_revision_id) references public.maintenance_plan_revisions(organization_id,plan_id,id);
create table public.maintenance_segments (
 organization_id uuid not null,plan_id uuid not null,revision_id uuid primary key,next_ordinal integer not null default 0 check(next_ordinal between 0 and 100000),
 protected_through date,foreign key(organization_id,plan_id,revision_id) references public.maintenance_plan_revisions(organization_id,plan_id,id),
 foreign key(organization_id,plan_id) references public.maintenance_plans(organization_id,id)
);
create index maintenance_plan_pages on public.maintenance_plans(organization_id,id);
create index maintenance_revision_pages on public.maintenance_plan_revisions(organization_id,plan_id,revision);
create trigger immutable_history before update or delete on public.maintenance_plan_revisions for each row execute function private.immutable_history();

create function private.maintenance_people_eligible(org uuid,authorizer uuid,supervisor uuid,assignees uuid[]) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members where organization_id=org and user_id=authorizer and active and role in ('owner','manager','supervisor') and private.auth_user_active(user_id))
 and exists(select 1 from public.organization_members where organization_id=org and user_id=supervisor and active and role in ('owner','manager','supervisor') and private.auth_user_active(user_id))
 and cardinality(assignees) between 1 and 30 and cardinality(assignees)=(select count(distinct u) from unnest(assignees) u)
 and not exists(select 1 from unnest(assignees) u where not exists(select 1 from public.organization_members where organization_id=org and user_id=u and active and role in ('owner','manager','supervisor','technician') and private.auth_user_active(user_id)))
$$;
-- Current revision personnel explicitly replace authorization for ALL retained segments;
-- historical author/content/cadence/timezone remain on each immutable revision.
create function private.maintenance_current_people_eligible(org uuid,plan uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select private.maintenance_people_eligible(org,p.authorized_by,r.supervisor_id,r.assignee_ids)
 from public.maintenance_plans p join public.maintenance_plan_revisions r on r.organization_id=p.organization_id and r.plan_id=p.id and r.id=p.current_revision_id
 where p.organization_id=org and p.id=plan),false)
$$;
create function private.can_read_maintenance(org uuid,plan uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.operations(org) or exists(select 1 from public.maintenance_plans p join public.maintenance_plan_revisions r on r.id=p.current_revision_id and r.organization_id=p.organization_id and r.plan_id=p.id
 where p.organization_id=org and p.id=plan and private.member_role(org)='technician' and auth.uid()=any(r.assignee_ids))
$$;
create function private.validate_maintenance_fields(fields jsonb) returns void language plpgsql set search_path='' as $$
declare key text;ids uuid[];
begin
 perform private.object_fields(fields,array['id','asset_id','title','instructions','category','cadence','frequency','anchor_on','supervisor_id','assignee_ids','checklist','status']);
 foreach key in array array['asset_id','title','instructions','category','cadence','anchor_on','supervisor_id','status'] loop
  if jsonb_typeof(fields->key) is distinct from 'string' then raise exception using message='VALIDATION';end if;
 end loop;
 if fields?'id' and jsonb_typeof(fields->'id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
 if length(trim(fields->>'title')) not between 1 and 200 or length(trim(fields->>'instructions')) not between 1 and 4000 or length(trim(fields->>'category')) not between 1 and 100
 or fields->>'cadence' not in ('day','week','month') or fields->>'status' not in ('active','paused','archived') or (fields->>'anchor_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(fields->'frequency') is distinct from 'number' then raise exception using message='VALIDATION';end if;
 if (fields->>'frequency')::numeric<>trunc((fields->>'frequency')::numeric) or (fields->>'frequency')::numeric not between 1 and 365 then raise exception using message='VALIDATION';end if;
 perform (fields->>'asset_id')::uuid,(fields->>'supervisor_id')::uuid,(fields->>'id')::uuid;
 perform private.maintenance_date((fields->>'anchor_on')::date,fields->>'cadence',(fields->>'frequency')::integer,0);
 if jsonb_typeof(fields->'assignee_ids') is distinct from 'array' or jsonb_typeof(fields->'checklist') is distinct from 'array' then raise exception using message='VALIDATION';end if;
 if jsonb_array_length(fields->'assignee_ids') not between 1 and 30 or jsonb_array_length(fields->'checklist') not between 1 and 100 then raise exception using message='VALIDATION';end if;
 if exists(select 1 from jsonb_array_elements(fields->'assignee_ids') t where jsonb_typeof(t)<>'string')
 or exists(select 1 from jsonb_array_elements(fields->'checklist') t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 1 and 500) then raise exception using message='VALIDATION';end if;
 select array_agg(u::uuid) into ids from jsonb_array_elements_text(fields->'assignee_ids') u;
 if cardinality(ids)<>(select count(distinct u) from unnest(ids) u) then raise exception using message='VALIDATION';end if;
end $$;

-- A single server clock and shared calculation keep preview and save partitioning identical.
create function private.maintenance_preview(org uuid,fields jsonb,at_time timestamptz) returns jsonb
language plpgsql stable set search_path='' as $$
declare p public.maintenance_plans;prior public.maintenance_plan_revisions;zone text;old_day date;new_day date;cutoff date;ordinal integer;backlog jsonb;more boolean;first_day date;ids uuid[];
begin
 select * into p from public.maintenance_plans where organization_id=org and id=(fields->>'id')::uuid;
 if fields?'id' and p.id is null then raise exception using message='NOT_FOUND';end if;
 if not exists(select 1 from public.assets where organization_id=org and id=(fields->>'asset_id')::uuid) then raise exception using message='NOT_FOUND';end if;
 if p.id is not null and p.asset_id<>(fields->>'asset_id')::uuid then raise exception using message='VALIDATION';end if;
 select timezone into zone from public.organizations where id=org;
 new_day:=(at_time at time zone zone)::date;
 if p.id is not null then
  select * into prior from public.maintenance_plan_revisions where organization_id=org and plan_id=p.id and id=p.current_revision_id;
  old_day:=(at_time at time zone prior.timezone)::date;
  cutoff:=greatest(old_day,new_day,(select max(protected_through) from public.maintenance_segments where organization_id=org and plan_id=p.id));
 end if;
 ordinal:=private.maintenance_ordinal((fields->>'anchor_on')::date,fields->>'cadence',(fields->>'frequency')::integer,cutoff);
 first_day:=private.maintenance_date((fields->>'anchor_on')::date,fields->>'cadence',(fields->>'frequency')::integer,ordinal);
 with pending as (
  select r.id revision_id,r.author_id,s.next_ordinal,private.maintenance_date(r.anchor_on,r.cadence,r.frequency,s.next_ordinal) next_on,
   coalesce(s.protected_through,cutoff) protected_through,r.timezone
  from public.maintenance_segments s join public.maintenance_plan_revisions r on r.organization_id=s.organization_id and r.plan_id=s.plan_id and r.id=s.revision_id
  where s.organization_id=org and s.plan_id=p.id
 ), bounded as (select * from pending where next_on<=protected_through order by next_on,revision_id limit 101), numbered as (select *,row_number() over(order by next_on,revision_id) n from bounded)
 select coalesce(jsonb_agg((to_jsonb(numbered)-'n')||jsonb_build_object('due_at',private.maintenance_cutoff(next_on,timezone)) order by next_on,revision_id) filter(where n<=100),'[]'::jsonb),count(*)>100 into backlog,more from numbered;
 select array_agg(u::uuid) into ids from jsonb_array_elements_text(fields->'assignee_ids') u;
 return jsonb_build_object('plan_id',p.id,'version',p.version,'evaluated_at',at_time,'old_local_date',old_day,'new_local_date',new_day,'protected_through',cutoff,
  'timezone',zone,'due_policy','local_day_end','first_new',jsonb_build_object('scheduled_local_date',first_day,'timezone',zone,'due_at',private.maintenance_cutoff(first_day,zone)),
  'retained_backlog',backlog,'backlog_has_more',more,'personnel_eligible',private.maintenance_people_eligible(org,auth.uid(),(fields->>'supervisor_id')::uuid,ids));
end $$;

create function public.preview_maintenance_plan(organization_id uuid,fields jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
begin
 perform private.confirmed_actor();
 if not private.operations(organization_id) then raise exception using message='FORBIDDEN';end if;
 perform private.validate_maintenance_fields(fields);
 return private.maintenance_preview(organization_id,fields,statement_timestamp());
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception using message='VALIDATION';
end $$;

create function public.save_maintenance_plan(ctx jsonb,fields jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid;actor uuid:=private.confirmed_actor();request uuid;expected integer;result jsonb;p public.maintenance_plans;r public.maintenance_plan_revisions;
 prior public.maintenance_plan_revisions;asset public.assets;ids uuid[];preview jsonb;cutoff date;ordinal integer;target uuid;
begin
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 if jsonb_typeof(ctx->'organization_id') is distinct from 'string' or jsonb_typeof(ctx->'request_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
 org:=(ctx->>'organization_id')::uuid;request:=(ctx->>'request_id')::uuid;expected:=(ctx->>'expected_version')::integer;
 if ctx?'expected_version' and (jsonb_typeof(ctx->'expected_version') is distinct from 'number' or expected<=0 or (ctx->>'expected_version')::numeric<>expected) then raise exception using message='VALIDATION';end if;
 perform 1 from public.organizations where id=org for update;
 perform private.confirmed_actor();
 if not private.operations(org) then raise exception using message='FORBIDDEN';end if;
 -- Recheck present authority before durable replay; current personnel are checked before every NEW save.
 result:=private.replay(org,actor,request,'save_maintenance_plan',jsonb_build_object('ctx',ctx,'fields',fields));if result is not null then return result;end if;
 perform private.validate_maintenance_fields(fields);target:=(fields->>'id')::uuid;
 select * into p from public.maintenance_plans where organization_id=org and id=target;
 if target is not null and p.id is null then raise exception using message='NOT_FOUND';end if;
 select * into asset from public.assets where organization_id=org and id=(fields->>'asset_id')::uuid for update;
 if asset.id is null then raise exception using message='NOT_FOUND';end if;
 select * into p from public.maintenance_plans where organization_id=org and id=target for update;
 if p.id is not null and (expected is null or expected<>p.version) then raise exception using message='CONFLICT';end if;
 if p.id is null and expected is not null then raise exception using message='CONFLICT';end if;
 if asset.archived_at is not null and fields->>'status'<>'archived' then raise exception using message='INVALID_TRANSITION';end if;
 perform private.rate_check(org,actor,'save_maintenance_plan');
 preview:=private.maintenance_preview(org,fields,clock_timestamp());
 if not (preview->>'personnel_eligible')::boolean then raise exception using message='VALIDATION';end if;
 cutoff:=(preview->>'protected_through')::date;
 select array_agg(u::uuid order by u::uuid) into ids from jsonb_array_elements_text(fields->'assignee_ids') u;
 if p.id is null then
  insert into public.maintenance_plans(organization_id,asset_id,authorized_by,status,created_by) values(org,asset.id,actor,fields->>'status',actor) returning * into p;
 else
  select * into prior from public.maintenance_plan_revisions where organization_id=org and plan_id=p.id and id=p.current_revision_id;
  update public.maintenance_segments set protected_through=cutoff where organization_id=org and plan_id=p.id and protected_through is null;
 end if;
 insert into public.maintenance_plan_revisions(organization_id,plan_id,revision,author_id,title,instructions,category,cadence,frequency,anchor_on,timezone,supervisor_id,assignee_ids,checklist)
 values(org,p.id,coalesce(prior.revision,0)+1,actor,trim(fields->>'title'),trim(fields->>'instructions'),trim(fields->>'category'),fields->>'cadence',(fields->>'frequency')::integer,(fields->>'anchor_on')::date,preview->>'timezone',(fields->>'supervisor_id')::uuid,ids,fields->'checklist') returning * into r;
 ordinal:=private.maintenance_ordinal(r.anchor_on,r.cadence,r.frequency,cutoff);
 insert into public.maintenance_segments(organization_id,plan_id,revision_id,next_ordinal) values(org,p.id,r.id,ordinal);
 update public.maintenance_plans set current_revision_id=r.id,authorized_by=actor,status=fields->>'status',generation_blocked=null,version=r.revision where id=p.id returning * into p;
 -- Deliberate response allowlist stays fixed when future slices add internal plan columns.
 return private.finish_command(org,actor,request,'save_maintenance_plan',jsonb_build_object('ctx',ctx,'fields',fields),
  jsonb_build_object('id',p.id,'organization_id',p.organization_id,'asset_id',p.asset_id,'current_revision_id',p.current_revision_id,'authorized_by',p.authorized_by,'status',p.status,
   'generation_blocked',p.generation_blocked,'last_checked_at',p.last_checked_at,'created_by',p.created_by,'created_at',p.created_at,'version',p.version));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
 when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
 when foreign_key_violation then raise exception using message='NOT_FOUND';
end $$;

create function public.list_maintenance_plans(organization_id uuid,cursor uuid default null,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare org uuid:=organization_id;items jsonb;next_cursor uuid;
begin
 perform private.confirmed_actor();
 if private.member_role(org) not in ('owner','manager','supervisor','technician') or private.member_role(org) is null then raise exception using message='FORBIDDEN';end if;
 if page_size is null or page_size not between 1 and 100 then raise exception using message='VALIDATION';end if;
 with bounded as (select * from public.maintenance_plans p where p.organization_id=org and (cursor is null or p.id>cursor) and private.can_read_maintenance(org,p.id) order by p.id limit page_size+1),
 numbered as (select *,row_number() over(order by id) n from bounded)
 select coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by id) filter(where n<=page_size),'[]'::jsonb),
 case when count(*)>page_size then (select id from numbered where n=page_size) end into items,next_cursor from numbered;
 return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
create function public.list_maintenance_revisions(organization_id uuid,plan_id uuid,cursor integer default null,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare org uuid:=organization_id;target uuid:=plan_id;items jsonb;next_cursor integer;
begin
 perform private.confirmed_actor();
 if not private.can_read_maintenance(org,target) then raise exception using message='FORBIDDEN';end if;
 if not exists(select 1 from public.maintenance_plans p where p.organization_id=org and p.id=target) then raise exception using message='NOT_FOUND';end if;
 if page_size is null or page_size not between 1 and 100 or (cursor is not null and cursor<=0) then raise exception using message='VALIDATION';end if;
 with bounded as (select r.*,to_jsonb(s) segment from public.maintenance_plan_revisions r join public.maintenance_segments s on s.organization_id=r.organization_id and s.plan_id=r.plan_id and s.revision_id=r.id
 where r.organization_id=org and r.plan_id=target and (cursor is null or r.revision>cursor) order by r.revision limit page_size+1),
 numbered as (select *,row_number() over(order by revision) n from bounded)
 select coalesce(jsonb_agg(jsonb_build_object('revision',to_jsonb(numbered)-'n'-'segment','segment',segment) order by revision) filter(where n<=page_size),'[]'::jsonb),
 case when count(*)>page_size then (select revision from numbered where n=page_size) end into items,next_cursor from numbered;
 return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;

-- Reads go through bounded named RPCs; direct table access and mutations are denied.
alter table public.maintenance_plans enable row level security;
alter table public.maintenance_plan_revisions enable row level security;
alter table public.maintenance_segments enable row level security;
revoke all on public.maintenance_plans,public.maintenance_plan_revisions,public.maintenance_segments from public,anon,authenticated,service_role;
revoke all on function private.maintenance_date(date,text,integer,integer),private.maintenance_cutoff(date,text),private.maintenance_ordinal(date,text,integer,date),private.maintenance_people_eligible(uuid,uuid,uuid,uuid[]),private.maintenance_current_people_eligible(uuid,uuid),private.can_read_maintenance(uuid,uuid),private.validate_maintenance_fields(jsonb),private.maintenance_preview(uuid,jsonb,timestamptz),public.preview_maintenance_plan(uuid,jsonb),public.save_maintenance_plan(jsonb,jsonb),public.list_maintenance_plans(uuid,uuid,integer),public.list_maintenance_revisions(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.preview_maintenance_plan(uuid,jsonb),public.save_maintenance_plan(jsonb,jsonb),public.list_maintenance_plans(uuid,uuid,integer),public.list_maintenance_revisions(uuid,uuid,integer,integer) to authenticated;
