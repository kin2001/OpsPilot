-- Forward-only P1 operational contracts. Existing command receipts and T1 payloads stay valid.
alter table public.assets add column availability text not null default 'out_of_service'
  check(availability in ('operational','under_maintenance','out_of_service','pending_release'));
alter table public.work_orders drop constraint work_orders_status_check;
alter table public.work_orders add constraint work_orders_status_check check(status in ('draft','open','scheduled','in_progress','blocked','awaiting_review','completed','canceled'));
alter table public.work_orders drop constraint work_orders_blocks_operation_check;
alter table public.work_orders add column repair_revision integer not null default 1 check(repair_revision>0),
  add column submitted_revision integer, add column opened_at timestamptz, add column completed_at timestamptz, add column priority_reason text;
alter table public.work_orders add check(length(trim(category)) between 1 and 100),add check(priority_reason is null or length(trim(priority_reason)) between 1 and 2000);
create table public.work_order_participants (
  organization_id uuid not null, work_order_id uuid not null, user_id uuid not null references auth.users(id),
  source text not null, recorded_at timestamptz not null default now(),
  primary key(organization_id,work_order_id,user_id),
  foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id)
);
insert into public.work_order_participants(organization_id,work_order_id,user_id,source,recorded_at)
select organization_id,work_order_id,user_id,'assignment_backfill',min(assigned_at) from public.work_order_assignments group by 1,2,3;
create table public.work_order_tasks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, work_order_id uuid not null,
  label text not null check(length(trim(label)) between 1 and 500), required boolean not null default true,
  completed boolean not null default false, completed_by uuid references auth.users(id), completed_at timestamptz,
  unique(organization_id,id), foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id)
);
create table public.work_order_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, work_order_id uuid not null,
  actor_id uuid not null references auth.users(id), request_id uuid not null, action text not null, status text not null,
  repair_revision integer not null, note text check(length(note)<=4000), labor_minutes integer check(labor_minutes between 0 and 1440), changes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id)
);
create index on public.work_order_events(organization_id,work_order_id,created_at,id);
create table public.work_order_reviews (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, work_order_id uuid not null,
  reviewer_id uuid not null references auth.users(id), repair_revision integer not null,
  decision text not null check(decision in ('approved','returned')), reason text not null check(length(trim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id)
);
create table public.asset_holds (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, asset_id uuid not null, work_order_id uuid,
  source text not null check(source in ('work_order','manual','inspection')), source_id uuid,
  reason text not null check(length(trim(reason)) between 1 and 2000), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), resolved_at timestamptz, resolution text, resolved_by uuid references auth.users(id),
  released_at timestamptz, unique(organization_id,id),
  foreign key(organization_id,asset_id) references public.assets(organization_id,id),
  foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id),
  check((source='work_order')=(work_order_id is not null))
);
create unique index on public.asset_holds(organization_id,work_order_id) where work_order_id is not null and released_at is null;
create index on public.asset_holds(organization_id,asset_id,released_at,id);
create table public.asset_releases (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, asset_id uuid not null,
  actor_id uuid not null references auth.users(id), checked_version integer not null, hold_ids uuid[] not null,
  acknowledgment text not null check(length(trim(acknowledgment)) between 1 and 2000), created_at timestamptz not null default now(),
  foreign key(organization_id,asset_id) references public.assets(organization_id,id)
);
create table public.asset_meter_readings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, asset_id uuid not null,
  kind text not null check(kind in ('hours','distance')), value numeric(14,3) not null check(value>=0),
  observed_at timestamptz not null, recorded_at timestamptz not null default now(), recorded_by uuid not null references auth.users(id),
  correction_of uuid, correction_reason text, unique(organization_id,id),
  foreign key(organization_id,correction_of) references public.asset_meter_readings(organization_id,id),
  check((correction_of is null and correction_reason is null) or (correction_of is not null and length(trim(correction_reason)) between 1 and 2000)),
  foreign key(organization_id,asset_id) references public.assets(organization_id,id)
);
create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id), ai_enabled boolean not null default false check(not ai_enabled),
  evidence_required boolean not null default true, version integer not null default 1
);
insert into public.organization_settings(organization_id) select id from public.organizations;
create function private.initialize_settings() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.organization_settings(organization_id) values(new.id); return new; end $$;
create trigger organization_settings_initialized after insert on public.organizations for each row execute function private.initialize_settings();
create table public.notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, recipient_user_id uuid not null,
  event_id uuid not null, category text not null, source_id uuid not null, created_at timestamptz not null default now(), read_at timestamptz,
  foreign key(organization_id,recipient_user_id) references public.organization_members(organization_id,user_id),
  unique(organization_id,event_id,recipient_user_id,category)
);
create index on public.notifications(organization_id,recipient_user_id,read_at,created_at,id);
create table public.attachments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, work_order_id uuid,
  object_key text not null unique, name text not null check(length(name) between 1 and 200 and name!~'[\\/[:cntrl:]]'),
  asset_id uuid, request_id uuid,
  media_type text not null check(media_type in ('image/jpeg','image/png','image/webp')), size integer not null check(size between 1 and 5242880),
  uploader_id uuid not null references auth.users(id), status text not null default 'pending' check(status in ('pending','ready','rejected')),
  checksum text check(checksum~'^[a-f0-9]{64}$'), width integer, height integer, created_at timestamptz not null default now(), ready_at timestamptz, cleanup_completed_at timestamptz,
  check(status<>'ready' or (checksum is not null and width is not null and height is not null and ready_at is not null)),
  check((media_type='image/png' and name~*'\.png$') or (media_type='image/jpeg' and name~*'\.jpe?g$') or (media_type='image/webp' and name~*'\.webp$')),
  unique(organization_id,id), foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id),
  foreign key(organization_id,asset_id) references public.assets(organization_id,id),
  foreign key(organization_id,request_id) references public.maintenance_requests(organization_id,id),
  check(num_nonnulls(work_order_id,asset_id,request_id)=1)
);
create index on public.attachments(organization_id,work_order_id,status,id);

create function private.aal2() returns void language plpgsql stable set search_path='' as $$
begin if auth.jwt()->>'aal' is distinct from 'aal2' then raise exception using message='FORBIDDEN'; end if; end $$;
create function private.refresh_availability(org uuid, asset uuid) returns void language sql set search_path='' as $$
 update public.assets set availability=case
 when exists(select 1 from public.asset_holds where organization_id=org and asset_id=asset and source<>'work_order' and resolved_at is null and released_at is null) then 'out_of_service'
 when exists(select 1 from public.work_orders where organization_id=org and asset_id=asset and blocks_operation and status='in_progress') then 'under_maintenance'
 when exists(select 1 from public.work_orders where organization_id=org and asset_id=asset and blocks_operation and status in ('open','scheduled','blocked','awaiting_review')) then 'out_of_service'
 when exists(select 1 from public.asset_holds h join public.work_orders w on w.id=h.work_order_id and w.organization_id=h.organization_id where h.organization_id=org and h.asset_id=asset and h.released_at is null and w.status='completed') then 'pending_release'
 else 'out_of_service' end,version=version+1 where id=asset and organization_id=org
$$;
create function private.can_read_work(org uuid, job uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_orders w where w.organization_id=org and w.id=job and
 (private.operations(org) or (private.member_role(org)='technician' and exists(select 1 from public.work_order_assignments a where a.organization_id=org and a.work_order_id=job and a.user_id=auth.uid() and a.unassigned_at is null))))
$$;
create function private.can_read_attachment(org uuid, job uuid, asset uuid, request uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member_role(org) is not null and (private.operations(org) or
 (job is not null and private.can_read_work(org,job)) or (asset is not null and private.known_asset(org,asset)) or
 (request is not null and exists(select 1 from public.maintenance_requests where organization_id=org and id=request and reporter_id=auth.uid())))
$$;
create function private.participant(org uuid, job uuid, actor uuid, source text) returns void language sql set search_path='' as $$
 insert into public.work_order_participants(organization_id,work_order_id,user_id,source) values(org,job,actor,source) on conflict do nothing
$$;
create function private.capture_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.participant(new.organization_id,new.work_order_id,new.user_id,'assignment');
 insert into public.notifications(organization_id,recipient_user_id,event_id,category,source_id) values(new.organization_id,new.user_id,new.id,'assignment',new.work_order_id) on conflict do nothing;
 return new;
end $$;
create trigger assignment_participant after insert on public.work_order_assignments for each row execute function private.capture_assignment();

create function private.availability_event() returns trigger language plpgsql security definer set search_path='' as $$
declare previous text; occurred timestamptz:=clock_timestamp();
begin
 if TG_OP='UPDATE' then
  if old.availability=new.availability and old.archived_at is not distinct from new.archived_at then return new; end if;
  previous:=old.availability;
 end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes,created_at)
 values(new.organization_id,coalesce(auth.uid(),new.created_by),'asset.availability_changed',new.id,gen_random_uuid(),
 jsonb_build_object('prior_status',previous,'new_status',new.availability,'active',new.archived_at is null,'occurred_at',occurred,
 'provenance',case when TG_OP='INSERT' then 'initial_availability_unverified' else 'recorded_transition' end,
 'hold_ids',coalesce((select jsonb_agg(id order by id) from public.asset_holds where organization_id=new.organization_id and asset_id=new.id and released_at is null),'[]'::jsonb),
 'release_id',(select id from public.asset_releases where organization_id=new.organization_id and asset_id=new.id order by created_at desc,id desc limit 1)),occurred);
 return new;
end $$;

create trigger asset_availability after insert or update on public.assets for each row execute function private.availability_event();
insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes)
select organization_id,created_by,'asset.availability_changed',id,gen_random_uuid(),jsonb_build_object('prior_status',null,'new_status','out_of_service','active',archived_at is null,'occurred_at',clock_timestamp(),'provenance','migration_availability_unverified','hold_ids','[]'::jsonb) from public.assets;
create index audit_availability on public.audit_logs(organization_id,entity_id,created_at,id) where action='asset.availability_changed';

-- Freeze legacy row shapes before any new columns can escape into strict T1 clients or receipts.
alter function private.finish_command(uuid,uuid,uuid,text,jsonb,jsonb) rename to finish_command_t1;
create function private.finish_command(org uuid, actor uuid, request uuid, action text, payload jsonb, data jsonb) returns jsonb language plpgsql set search_path='' as $$
declare fields text[];
begin
 if action='save_asset' then fields:=array['id','organization_id','code','name','category','site_id','serial_number','registration','archived_at','created_by','created_at','version'];
 elsif action in ('create_work_order','assign_work_order','convert_request') then fields:=array['id','organization_id','number','asset_id','source_request_id','title','description','category','priority','due_at','supervisor_id','status','blocks_operation','created_by','created_at','version'];
 end if;
 if fields is not null then select jsonb_object_agg(k,data->k) into data from unnest(fields) k; end if;
 return private.finish_command_t1(org,actor,request,action,payload,data);
end $$;

-- Keep tenant serialization and acquire the asset before work orders in every old safety path.
alter function private.core_command(jsonb,text,jsonb) rename to core_command_t1;
-- Extend only the two original field allowlists; preserve the original implementation and receipt hashing.
do $$ declare definition text; updated text;
begin
 definition:=pg_get_functiondef('private.core_command_t1(jsonb,text,jsonb)'::regprocedure);
 if position('array[''title'',''description'',''category'',''priority'',''supervisor_id'',''due_at'']' in definition)=0 or position('array[''title'',''priority'']' in definition)=0 then raise exception 'Both original T1 allowlists are required'; end if;
 updated:=replace(replace(definition,
  'array[''title'',''description'',''category'',''priority'',''supervisor_id'',''due_at'']',
  'array[''title'',''description'',''category'',''priority'',''supervisor_id'',''due_at'',''critical_reason'']'),
  'array[''title'',''priority'']','array[''title'',''priority'',''critical_reason'']');
 if updated=definition or updated not like '%''critical_reason''%' then raise exception 'T1 allowlist definition changed'; end if;
 execute updated;
end $$;
create function private.core_command(ctx jsonb, action text, payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; asset uuid; target uuid; result jsonb; role text; fields jsonb; new_work boolean; replayed boolean;
begin
 if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
 org:=(ctx->>'organization_id')::uuid;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org);
 if role is null then raise exception using message='FORBIDDEN'; end if;
 if action in ('create_organization_invitation','revoke_organization_invitation','set_organization_member','transfer_organization_ownership') then perform private.aal2(); end if;
 if action in ('save_asset','create_work_order','assign_work_order','convert_request') then
  if role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;
  if action in ('save_asset','create_work_order') then asset:=(payload->>'asset_id')::uuid;
  elsif action='assign_work_order' then select asset_id into asset from public.work_orders where organization_id=org and id=(payload->>'id')::uuid;
  else select asset_id into asset from public.maintenance_requests where organization_id=org and id=(payload->>'id')::uuid; end if;
  if asset is not null then
   perform 1 from public.assets where organization_id=org and id=asset for update;
   perform 1 from public.work_orders where organization_id=org and asset_id=asset order by id for update;
   if action='assign_work_order' and exists(select 1 from public.assets where organization_id=org and id=asset and archived_at is not null) then raise exception using message='INVALID_TRANSITION'; end if;
  end if;
 end if;
 replayed:=exists(select 1 from private.command_receipts where organization_id=org and actor_id=auth.uid() and request_id=(ctx->>'request_id')::uuid);
 if not replayed and action='save_asset' and payload#>>'{fields,archived}'='false' and exists(select 1 from public.assets where organization_id=org and id=asset and archived_at is not null) then
  update public.assets set availability='out_of_service' where organization_id=org and id=asset;
 end if;
 fields:=case when action='create_work_order' then payload->'fields' when action='convert_request' then payload->'work_order_fields' end;
 new_work:=action='create_work_order' or (action='convert_request' and exists(select 1 from public.maintenance_requests where organization_id=org and id=(payload->>'id')::uuid and converted_work_order_id is null));
 if fields->>'priority'='critical' and not replayed and new_work and (jsonb_typeof(fields->'critical_reason') is distinct from 'string' or length(trim(fields->>'critical_reason')) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;
 if fields?'critical_reason' and (fields->>'priority' is distinct from 'critical' or length(trim(fields->>'critical_reason')) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;
 result:=private.core_command_t1(ctx,action,payload);
 if fields->>'priority'='critical' and new_work and not replayed then
  update public.work_orders set priority_reason=trim(fields->>'critical_reason') where organization_id=org and id=(result#>>'{data,id}')::uuid;
  if not exists(select 1 from public.audit_logs where organization_id=org and actor_id=auth.uid() and request_id=(ctx->>'request_id')::uuid and audit_logs.action='work_order.critical_priority') then
   insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes) values(org,auth.uid(),'work_order.critical_priority',(result#>>'{data,id}')::uuid,(ctx->>'request_id')::uuid,jsonb_build_object('priority','critical','reason',trim(fields->>'critical_reason')));
  end if;
 end if;
 return result;
exception when invalid_text_representation then raise exception using message='VALIDATION';
 when others then
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=% actor=% tenant=% code=%',action,auth.uid(),org,SQLERRM; end if;
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','VALIDATION','CONFLICT','INVALID_TRANSITION','RATE_LIMITED','DEPENDENCY_UNAVAILABLE') then raise; end if;
  raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function private.operational_command(ctx jsonb, action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid; actor uuid:=auth.uid(); request uuid; expected integer; role text; result jsonb; data jsonb; asset public.assets; wo public.work_orders;
 hold public.asset_holds; settings public.organization_settings; target uuid; next_status text; reason text; fields jsonb; event uuid; holds uuid[];
 attachment public.attachments; req public.maintenance_requests; reading public.asset_meter_readings; prior_work jsonb; origin_status text; repair_changed boolean:=false; admin_changed boolean:=false; execution_changed boolean:=false;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 org:=(ctx->>'organization_id')::uuid; request:=(ctx->>'request_id')::uuid; expected:=(ctx->>'expected_version')::integer;
 if org is null or request is null or expected<=0 or (ctx?'expected_version' and jsonb_typeof(ctx->'expected_version')<>'number') then raise exception using message='VALIDATION'; end if;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org); if role is null then raise exception using message='FORBIDDEN'; end if;
 if action in ('review_work_order','release_asset','save_organization_settings') then perform private.aal2(); end if;
 if action='save_organization_settings' and role<>'owner' then raise exception using message='FORBIDDEN'; end if;
 if action in ('review_work_order','release_asset','set_asset_hold','resolve_asset_hold','add_work_order_task','record_meter_reading','correct_meter_reading') and role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;

 if action in ('update_work_order','transition_work_order','review_work_order','add_work_order_task','reserve_attachment') then
  target:=(payload->>'id')::uuid;
 elsif action='resolve_asset_hold' then select work_order_id into target from public.asset_holds where organization_id=org and id=(payload->>'hold_id')::uuid;
 end if;
 if target is not null then
  if not private.can_read_work(org,target) then raise exception using message='FORBIDDEN'; end if;
  select * into wo from public.work_orders where organization_id=org and id=target;
  select * into asset from public.assets where organization_id=org and id=wo.asset_id for update;
 elsif action='resolve_asset_hold' then
  select * into hold from public.asset_holds where organization_id=org and id=(payload->>'hold_id')::uuid;
  select * into asset from public.assets where organization_id=org and id=hold.asset_id for update;
 elsif action='correct_meter_reading' then
  select * into reading from public.asset_meter_readings where organization_id=org and id=(payload->>'id')::uuid;
  select * into asset from public.assets where organization_id=org and id=reading.asset_id for update;
 elsif action='reserve_record_attachment' then
  if payload->>'parent_type'='request' then
   select * into req from public.maintenance_requests where organization_id=org and id=(payload->>'parent_id')::uuid;
   if req.id is null or (not private.operations(org) and req.reporter_id<>actor) then raise exception using message='NOT_FOUND'; end if;
   select * into asset from public.assets where organization_id=org and id=req.asset_id for update;
  elsif payload->>'parent_type'='asset' then
   if not private.operations(org) then raise exception using message='FORBIDDEN'; end if;
   select * into asset from public.assets where organization_id=org and id=(payload->>'parent_id')::uuid for update;
  else raise exception using message='VALIDATION'; end if;
 elsif action in ('release_asset','set_asset_hold','record_meter_reading') then
  select * into asset from public.assets where organization_id=org and id=(payload->>'asset_id')::uuid for update;
 end if;
 if asset.id is not null then
  perform 1 from public.work_orders where organization_id=org and asset_id=asset.id order by id for update;
  if target is not null then select * into wo from public.work_orders where organization_id=org and id=target; end if;
 end if;
 prior_work:=jsonb_build_object('title',wo.title,'description',wo.description,'category',wo.category,'priority',wo.priority,'priority_reason',wo.priority_reason,'due_at',wo.due_at,'supervisor_id',wo.supervisor_id);
 origin_status:=coalesce((select changes->>'from_status' from public.work_order_events where organization_id=org and work_order_id=wo.id and actor_id=actor and request_id=request and work_order_events.action=action limit 1),wo.status);
 if action='update_work_order' and role not in ('owner','manager','supervisor') and ((payload->'fields')-array['note','labor_minutes','task_id','task_completed'])<>'{}'::jsonb then raise exception using message='FORBIDDEN'; end if;
 if action='transition_work_order' and role='technician' and not ((origin_status in ('open','scheduled') and payload->>'target'='in_progress') or (origin_status='in_progress' and payload->>'target' in ('blocked','awaiting_review'))) then raise exception using message='FORBIDDEN'; end if;
 if action='review_work_order' and exists(select 1 from public.work_order_participants where organization_id=org and work_order_id=wo.id and user_id=actor) then raise exception using message='FORBIDDEN'; end if;
 if action='release_asset' and exists(select 1 from public.asset_holds h join public.work_order_participants p on p.organization_id=h.organization_id and p.work_order_id=h.work_order_id where h.organization_id=org and h.asset_id=asset.id and h.released_at is null and p.user_id=actor) then raise exception using message='FORBIDDEN'; end if;
 result:=private.replay(org,actor,request,action,payload||jsonb_build_object('ctx',ctx)); if result is not null then return result; end if;
 perform private.rate_check(org,actor,action);
 if action in ('update_work_order','transition_work_order','review_work_order','add_work_order_task','reserve_attachment') and (wo.id is null or asset.id is null) then raise exception using message='NOT_FOUND'; end if;
 if action in ('update_work_order','transition_work_order','review_work_order','add_work_order_task') and (expected is null or expected<>wo.version) then raise exception using message='CONFLICT'; end if;
 reason:=trim(payload->>'reason');
 if action in ('review_work_order','set_asset_hold','resolve_asset_hold') and (reason is null or length(reason) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;

 case action
 when 'add_work_order_task' then
  if wo.status not in ('draft','open','scheduled','in_progress') then raise exception using message='INVALID_TRANSITION'; end if;
  if (select count(*) from public.work_order_tasks where organization_id=org and work_order_id=wo.id)>=100 then raise exception using message='RATE_LIMITED'; end if;
  insert into public.work_order_tasks(organization_id,work_order_id,label,required) values(org,wo.id,trim(payload->>'label'),coalesce((payload->>'required')::boolean,true));
  repair_changed:=true;
 when 'update_work_order' then
  fields:=payload->'fields'; perform private.object_fields(fields,array['note','labor_minutes','task_id','task_completed','title','description','category','priority','priority_reason','due_at','supervisor_id']);
  admin_changed:=(fields-array['note','labor_minutes','task_id','task_completed'])<>'{}'::jsonb;
  execution_changed:=(fields-array['title','description','category','priority','priority_reason','due_at','supervisor_id'])<>'{}'::jsonb;
  repair_changed:=execution_changed or fields?'title' or fields?'description';
  if admin_changed and role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;
  if wo.status='canceled' or asset.archived_at is not null or (execution_changed and wo.status<>'in_progress') or ((fields?'title' or fields?'description') and wo.status not in ('draft','open','scheduled','in_progress')) then raise exception using message='INVALID_TRANSITION'; end if;
  if exists(select 1 from jsonb_each(fields) f where f.key in ('title','description','category','priority','priority_reason','supervisor_id') and jsonb_typeof(f.value)<>'string') then raise exception using message='VALIDATION'; end if;
  if fields?'due_at' and jsonb_typeof(fields->'due_at') not in ('string','null') then raise exception using message='VALIDATION'; end if;
  if fields->>'priority'='critical' and (fields->>'priority_reason' is null or length(trim(fields->>'priority_reason')) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;
  if fields?'priority_reason' and fields->>'priority' is distinct from 'critical' then raise exception using message='VALIDATION'; end if;
  if fields?'supervisor_id' and not exists(select 1 from public.organization_members where organization_id=org and user_id=(fields->>'supervisor_id')::uuid and active and organization_members.role in ('owner','manager','supervisor')) then raise exception using message='VALIDATION'; end if;
  if fields='{}'::jsonb or (fields?'note' and (jsonb_typeof(fields->'note')<>'string' or length(trim(fields->>'note')) not between 1 and 4000))
    or (fields?'labor_minutes' and (jsonb_typeof(fields->'labor_minutes')<>'number' or (fields->>'labor_minutes')::numeric<>trunc((fields->>'labor_minutes')::numeric) or (fields->>'labor_minutes')::integer not between 0 and 1440))
    or (fields?'task_id')<>(fields?'task_completed') or (fields?'task_completed' and jsonb_typeof(fields->'task_completed')<>'boolean') then raise exception using message='VALIDATION'; end if;
  if fields?'task_id' then
   update public.work_order_tasks set completed=(fields->>'task_completed')::boolean,completed_by=actor,completed_at=now() where organization_id=org and work_order_id=wo.id and id=(fields->>'task_id')::uuid;
   if not found then raise exception using message='NOT_FOUND'; end if;
  end if;
  if admin_changed then update public.work_orders set title=coalesce(trim(fields->>'title'),title),description=coalesce(trim(fields->>'description'),description),category=coalesce(trim(fields->>'category'),category),priority=coalesce(fields->>'priority',priority),priority_reason=case when fields?'priority' then case when fields->>'priority'='critical' then trim(fields->>'priority_reason') end else priority_reason end,due_at=case when fields?'due_at' then (fields->>'due_at')::timestamptz else due_at end,supervisor_id=coalesce((fields->>'supervisor_id')::uuid,supervisor_id) where id=wo.id; end if;
  if execution_changed then perform private.participant(org,wo.id,actor,'repair_update'); end if;
 when 'transition_work_order' then
  next_status:=payload->>'target';
  if asset.archived_at is not null then raise exception using message='INVALID_TRANSITION'; end if;
  if role='technician' then
   if not ((wo.status in ('open','scheduled') and next_status='in_progress') or (wo.status='in_progress' and next_status in ('blocked','awaiting_review'))) then raise exception using message='FORBIDDEN'; end if;
  elsif role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;
  if not ((wo.status='draft' and next_status='open') or (wo.status='open' and next_status in ('scheduled','in_progress','canceled'))
   or (wo.status='scheduled' and next_status in ('open','in_progress','canceled')) or (wo.status='in_progress' and next_status in ('blocked','awaiting_review','canceled'))
   or (wo.status='blocked' and next_status in ('scheduled','in_progress','canceled')) or (wo.status='completed' and next_status='in_progress')
   or (wo.status in ('draft','awaiting_review') and next_status='canceled')) then raise exception using message='INVALID_TRANSITION'; end if;
  if (next_status in ('blocked','canceled') or wo.status in ('blocked','completed')) and (reason is null or length(reason) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;
  if next_status='awaiting_review' then
   if exists(select 1 from public.work_order_tasks where organization_id=org and work_order_id=wo.id and required and not completed) then raise exception using message='INVALID_TRANSITION'; end if;
   select * into settings from public.organization_settings where organization_id=org;
   if coalesce(settings.evidence_required,true) and not exists(select 1 from public.attachments where organization_id=org and work_order_id=wo.id and status='ready') then raise exception using message='INVALID_TRANSITION'; end if;
   perform private.participant(org,wo.id,actor,'submission');
   wo.submitted_revision:=wo.repair_revision;
  end if;
  if next_status='in_progress' then perform private.participant(org,wo.id,actor,'start'); end if;
  if wo.status='completed' then wo.repair_revision:=wo.repair_revision+1; wo.submitted_revision:=null; wo.completed_at:=null; end if;
  if wo.blocks_operation and not (wo.status='draft' and next_status='canceled') then
   insert into public.asset_holds(organization_id,asset_id,work_order_id,source,reason,created_by) values(org,asset.id,wo.id,'work_order','Accepted blocking work',actor) on conflict(organization_id,work_order_id) where work_order_id is not null and released_at is null do update set resolved_at=null,resolution=null,resolved_by=null;
  end if;
  update public.work_orders set status=next_status,opened_at=coalesce(opened_at,case when next_status not in ('draft','canceled') then now() end),submitted_revision=wo.submitted_revision,repair_revision=wo.repair_revision,completed_at=wo.completed_at where id=wo.id returning * into wo;
 when 'review_work_order' then
  if wo.status<>'awaiting_review' or wo.submitted_revision is distinct from wo.repair_revision or payload->>'decision' not in ('approved','returned') then raise exception using message='INVALID_TRANSITION'; end if;
  insert into public.work_order_reviews(organization_id,work_order_id,reviewer_id,repair_revision,decision,reason) values(org,wo.id,actor,wo.repair_revision,payload->>'decision',reason);
  update public.work_orders set status=case when payload->>'decision'='approved' then 'completed' else 'in_progress' end,completed_at=case when payload->>'decision'='approved' then now() end where id=wo.id returning * into wo;
 when 'set_asset_hold' then
  if asset.id is null then raise exception using message='NOT_FOUND'; end if;
  if expected is null or expected<>asset.version then raise exception using message='CONFLICT'; end if;
  insert into public.asset_holds(organization_id,asset_id,source,reason,created_by) values(org,asset.id,'manual',reason,actor) returning * into hold;
  update public.assets set availability='out_of_service',version=version+1 where id=asset.id;
  data:=to_jsonb(hold);
 when 'resolve_asset_hold' then
  select * into hold from public.asset_holds where organization_id=org and id=(payload->>'hold_id')::uuid for update;
  if hold.id is null then raise exception using message='NOT_FOUND'; end if;
  if expected is null or expected<>asset.version then raise exception using message='CONFLICT'; end if;
  if hold.released_at is not null or hold.resolved_at is not null or payload->>'disposition' not in ('repaired','withdrawn_with_reason') then raise exception using message='INVALID_TRANSITION'; end if;
  if hold.work_order_id is not null and exists(select 1 from public.work_orders where id=hold.work_order_id and organization_id=org and (status<>'canceled' or status in ('open','scheduled','in_progress','blocked','awaiting_review'))) then raise exception using message='INVALID_TRANSITION'; end if;
  update public.asset_holds set resolved_at=now(),resolved_by=actor,resolution=(payload->>'disposition')||': '||reason where id=hold.id returning * into hold;
  update public.assets set version=version+1 where id=asset.id;
  data:=to_jsonb(hold);
 when 'release_asset' then
  if asset.id is null then raise exception using message='NOT_FOUND'; end if;
  if expected is null or expected<>asset.version then raise exception using message='CONFLICT'; end if;
  if asset.archived_at is not null or length(trim(payload->>'acknowledgment')) not between 1 and 2000 or payload->>'acknowledgment' is null then raise exception using message='INVALID_TRANSITION'; end if;
  if exists(select 1 from public.work_orders where organization_id=org and asset_id=asset.id and blocks_operation and status in ('open','scheduled','in_progress','blocked','awaiting_review')) then raise exception using message='INVALID_TRANSITION'; end if;
  if exists(select 1 from public.asset_holds h left join public.work_orders w on w.organization_id=h.organization_id and w.id=h.work_order_id
    where h.organization_id=org and h.asset_id=asset.id and h.released_at is null and h.resolved_at is null and
    (h.source<>'work_order' or w.status<>'completed' or not exists(select 1 from public.work_order_reviews r where r.organization_id=org and r.work_order_id=w.id and r.repair_revision=w.repair_revision and r.decision='approved'))) then raise exception using message='INVALID_TRANSITION'; end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into holds from public.asset_holds where organization_id=org and asset_id=asset.id and released_at is null;
  insert into public.asset_releases(organization_id,asset_id,actor_id,checked_version,hold_ids,acknowledgment) values(org,asset.id,actor,asset.version,holds,trim(payload->>'acknowledgment')) returning to_jsonb(asset_releases.*) into data;
  update public.asset_holds set released_at=now() where organization_id=org and id=any(holds);
  update public.assets set availability='operational',version=version+1 where id=asset.id;
 when 'record_meter_reading' then
  if asset.id is null then raise exception using message='NOT_FOUND'; end if;
  insert into public.asset_meter_readings(organization_id,asset_id,kind,value,observed_at,recorded_by) values(org,asset.id,payload->>'kind',(payload->>'value')::numeric,(payload->>'observed_at')::timestamptz,actor) returning to_jsonb(asset_meter_readings.*) into data;
 when 'correct_meter_reading' then
  if reading.id is null then raise exception using message='NOT_FOUND'; end if;
  if reason is null or length(reason) not between 1 and 2000 then raise exception using message='VALIDATION'; end if;
  insert into public.asset_meter_readings(organization_id,asset_id,kind,value,observed_at,recorded_by,correction_of,correction_reason) values(org,asset.id,reading.kind,(payload->>'value')::numeric,reading.observed_at,actor,reading.id,reason) returning to_jsonb(asset_meter_readings.*) into data;
 when 'save_organization_settings' then
  fields:=payload->'fields'; perform private.object_fields(fields,array['evidence_required','timezone','currency']);
  insert into public.organization_settings(organization_id) values(org) on conflict do nothing;
  select * into settings from public.organization_settings where organization_id=org for update;
  if expected is null or expected<>settings.version then raise exception using message='CONFLICT'; end if;
  if fields?'evidence_required' and jsonb_typeof(fields->'evidence_required')<>'boolean' then raise exception using message='VALIDATION'; end if;
  if fields?'timezone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=fields->>'timezone') then raise exception using message='VALIDATION'; end if;
  if fields?'currency' and (fields->>'currency')!~'^[A-Z]{3}$' then raise exception using message='VALIDATION'; end if;
  update public.organizations set timezone=coalesce(fields->>'timezone',timezone),currency=coalesce(fields->>'currency',currency),version=version+1 where id=org;
  update public.organization_settings set evidence_required=coalesce((fields->>'evidence_required')::boolean,evidence_required),version=version+1 where organization_id=org returning * into settings; data:=to_jsonb(settings)||jsonb_build_object('id',org);
 when 'mark_notifications_read' then
  if jsonb_typeof(payload->'ids')<>'array' or jsonb_array_length(payload->'ids')>100 then raise exception using message='VALIDATION'; end if;
  update public.notifications set read_at=coalesce(read_at,now()) where organization_id=org and recipient_user_id=actor and id in (select value::uuid from jsonb_array_elements_text(payload->'ids'));
  data:=jsonb_build_object('id',actor,'marked',true);
 when 'reserve_attachment','reserve_record_attachment' then
  if asset.id is null then raise exception using message='NOT_FOUND'; end if;
  if (action='reserve_attachment' and wo.status<>'in_progress') or asset.archived_at is not null or (req.id is not null and req.status not in ('draft','returned')) then raise exception using message='INVALID_TRANSITION'; end if;
  if payload->>'media_type' not in ('image/jpeg','image/png','image/webp') or (select count(*) from public.attachments where organization_id=org and coalesce(work_order_id,asset_id,request_id)=coalesce(wo.id,req.id,asset.id) and status in ('pending','ready'))>=10 or (select coalesce(sum(size),0) from public.attachments where organization_id=org and status in ('pending','ready'))+(payload->>'size')::integer>262144000 then raise exception using message='RATE_LIMITED'; end if;
  target:=gen_random_uuid();
  insert into public.attachments(id,organization_id,work_order_id,asset_id,request_id,object_key,name,media_type,size,uploader_id) values(target,org,wo.id,case when wo.id is null and req.id is null then asset.id end,req.id,org::text||'/'||coalesce(wo.id,req.id,asset.id)::text||'/'||target::text,payload->>'name',payload->>'media_type',(payload->>'size')::integer,actor) returning * into attachment;
  data:=to_jsonb(attachment);
 else raise exception using message='VALIDATION';
 end case;
 if action in ('add_work_order_task','update_work_order','transition_work_order','review_work_order') then
  update public.work_orders set version=version+1,repair_revision=repair_revision+case when repair_changed then 1 else 0 end,submitted_revision=case when repair_changed then null else submitted_revision end where id=wo.id returning * into wo;
  insert into public.work_order_events(organization_id,work_order_id,actor_id,request_id,action,status,repair_revision,note,labor_minutes,changes)
   values(org,wo.id,actor,request,action,wo.status,wo.repair_revision,coalesce(fields->>'note',reason),(fields->>'labor_minutes')::integer,jsonb_build_object('from_status',origin_status)||case when admin_changed then jsonb_build_object('before',prior_work,'submitted_fields',fields-array['note','labor_minutes','task_id','task_completed']) else '{}'::jsonb end) returning id into event;
  insert into public.notifications(organization_id,recipient_user_id,event_id,category,source_id)
  select org,m.user_id,event,action,wo.id from public.organization_members m where m.organization_id=org and m.active and (m.role in ('owner','manager','supervisor') or exists(select 1 from public.work_order_assignments a where a.organization_id=org and a.work_order_id=wo.id and a.user_id=m.user_id and a.unassigned_at is null)) and m.user_id<>actor on conflict do nothing;
  data:=to_jsonb(wo);
 end if;
 if action='review_work_order' or (action='transition_work_order' and not (next_status='canceled' and wo.opened_at is null)) then perform private.refresh_availability(org,asset.id); end if;
 return private.finish_command(org,actor,request,action,payload||jsonb_build_object('ctx',ctx),data);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
 when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
 when foreign_key_violation then raise exception using message='NOT_FOUND';
 when others then
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=% actor=% tenant=% code=%',action,actor,org,SQLERRM; end if;
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','VALIDATION','CONFLICT','INVALID_TRANSITION','RATE_LIMITED','DEPENDENCY_UNAVAILABLE') then raise; end if;
  raise log 'opspilot_command_failure action=% state=%',action,SQLSTATE;
  raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function public.update_work_order(ctx jsonb,id uuid,allowed_fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'update_work_order',jsonb_build_object('id',id,'fields',allowed_fields)) $$;
create function public.transition_work_order(ctx jsonb,id uuid,target text,reason text default null) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'transition_work_order',jsonb_build_object('id',id,'target',target,'reason',reason)) $$;
create function public.add_work_order_task(ctx jsonb,id uuid,label text,required boolean default true) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'add_work_order_task',jsonb_build_object('id',id,'label',label,'required',required)) $$;
create function public.review_work_order(ctx jsonb,id uuid,decision text,reason text) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'review_work_order',jsonb_build_object('id',id,'decision',decision,'reason',reason)) $$;
create function public.release_asset(ctx jsonb,asset_id uuid,acknowledgment text) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'release_asset',jsonb_build_object('asset_id',asset_id,'acknowledgment',acknowledgment)) $$;
create function public.set_asset_hold(ctx jsonb,asset_id uuid,reason text) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'set_asset_hold',jsonb_build_object('asset_id',asset_id,'reason',reason)) $$;
create function public.resolve_asset_hold(ctx jsonb,hold_id uuid,disposition text,reason text) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'resolve_asset_hold',jsonb_build_object('hold_id',hold_id,'disposition',disposition,'reason',reason)) $$;
create function public.record_meter_reading(ctx jsonb,asset_id uuid,kind text,value numeric,observed_at timestamptz) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'record_meter_reading',jsonb_build_object('asset_id',asset_id,'kind',kind,'value',value,'observed_at',observed_at)) $$;
create function public.correct_meter_reading(ctx jsonb,id uuid,value numeric,reason text) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'correct_meter_reading',jsonb_build_object('id',id,'value',value,'reason',reason)) $$;
create function public.save_organization_settings(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'save_organization_settings',jsonb_build_object('fields',fields)) $$;
create function public.mark_notifications_read(ctx jsonb,ids uuid[]) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'mark_notifications_read',jsonb_build_object('ids',ids)) $$;
create function public.reserve_attachment(ctx jsonb,id uuid,name text,media_type text,size integer) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'reserve_attachment',jsonb_build_object('id',id,'name',name,'media_type',media_type,'size',size)) $$;
create function public.reserve_record_attachment(ctx jsonb,parent_type text,parent_id uuid,name text,media_type text,size integer) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'reserve_record_attachment',jsonb_build_object('parent_type',parent_type,'parent_id',parent_id,'name',name,'media_type',media_type,'size',size)) $$;

create function public.get_team(organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.operations(organization_id) then raise exception using message='FORBIDDEN'; end if;
 return coalesce((select jsonb_agg(row_to_json(m) order by m.user_id) from (select user_id,role,active,version from public.organization_members where organization_members.organization_id=get_team.organization_id order by user_id limit 100) m),'[]'::jsonb);
end $$;
create function public.get_dashboard(organization_id uuid,range jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare org uuid:=organization_id; zone text; start_at timestamptz; end_at timestamptz; days integer; counts jsonb; trend jsonb; downtime numeric;
begin
 if not private.operations(org) then raise exception using message='FORBIDDEN'; end if;
 perform private.object_fields(range,array['from','to']);
 select timezone into zone from public.organizations where id=org;
 days:=(range->>'to')::date-(range->>'from')::date;
 if days is null or days not between 1 and 366 then raise exception using message='VALIDATION'; end if;
 start_at:=(range->>'from')::date::timestamp at time zone zone; end_at:=(range->>'to')::date::timestamp at time zone zone;
 select jsonb_build_object('active_assets',(select count(*) from public.assets where assets.organization_id=org and archived_at is null),
 'available_assets',(select count(*) from public.assets a where a.organization_id=org and a.archived_at is null and a.availability='operational' and not exists(select 1 from public.asset_holds h where h.organization_id=org and h.asset_id=a.id and h.released_at is null and h.resolved_at is null)),
 'active_work_orders',count(*) filter(where status in ('open','scheduled','in_progress','blocked','awaiting_review')),
 'blocked',count(*) filter(where status='blocked'),'pending_approvals',count(*) filter(where status='awaiting_review'),
 'overdue',count(*) filter(where status in ('open','scheduled','in_progress','blocked','awaiting_review') and due_at<now()),
 'completed',count(*) filter(where status='completed' and completed_at>=start_at and completed_at<end_at),
 'completion_sample_size',count(*) filter(where status='completed' and completed_at>=start_at and completed_at<end_at and opened_at is not null),
 'completion_seconds',avg(extract(epoch from completed_at-opened_at)) filter(where status='completed' and completed_at>=start_at and completed_at<end_at and opened_at is not null)) into counts from public.work_orders where work_orders.organization_id=org;
 select coalesce(jsonb_agg(jsonb_build_object('date',day::date,'known_assets',known,'available_assets',case when known<total then null else available end) order by day),'[]'::jsonb) into trend from (
  select d.day,count(a.id) as total,count(e.id) as known,count(e.id) filter(where e.changes->>'new_status'='operational' and (e.changes->>'active')::boolean) as available
  from generate_series(greatest((range->>'from')::date,(range->>'to')::date-7)::timestamp,((range->>'to')::date-1)::timestamp,interval '1 day') d(day)
  left join public.assets a on a.organization_id=org and a.created_at<(d.day+interval '1 day') at time zone zone
  left join lateral(select id,changes from public.audit_logs l where l.organization_id=org and l.entity_id=a.id and l.action='asset.availability_changed' and l.created_at<(d.day+interval '1 day') at time zone zone order by l.created_at desc,l.id desc limit 1)e on true group by d.day
 ) daily;
 select sum(greatest(0,extract(epoch from least(coalesce(next_at,end_at),end_at)-greatest(created_at,start_at)))) into downtime from (
  select created_at,changes,lead(created_at) over(partition by entity_id order by created_at,id) next_at from public.audit_logs where audit_logs.organization_id=org and action='asset.availability_changed'
 ) intervals where changes->>'new_status'<>'operational' and (changes->>'active')::boolean and created_at<end_at;
 return jsonb_build_object('counts',counts,'daily_availability',trend,'downtime_seconds',downtime,'history_complete',not exists(select 1 from public.assets a where a.organization_id=org and a.created_at<start_at and not exists(select 1 from public.audit_logs l where l.organization_id=org and l.entity_id=a.id and l.action='asset.availability_changed' and l.created_at<=start_at)),
 'timezone',zone,'from',start_at,'to',end_at,'generated_at',now());
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception using message='VALIDATION';
end $$;

create function public.attachment_access(organization_id uuid,attachment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.attachments;
begin
 select * into item from public.attachments where attachments.organization_id=attachment_access.organization_id and id=attachment_id;
 if item.id is null or not private.can_read_attachment(organization_id,item.work_order_id,item.asset_id,item.request_id) then raise exception using message='NOT_FOUND'; end if;
 if item.status<>'ready' and (item.uploader_id<>auth.uid() or item.status<>'pending') then raise exception using message='NOT_FOUND'; end if;
 return to_jsonb(item);
end $$;
create function public.finalize_attachment(organization_id uuid,attachment_id uuid,actor_id uuid,checksum text,width integer,height integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare item public.attachments; job public.work_orders; asset public.assets; req public.maintenance_requests; actor_role text;
begin
 perform 1 from public.organizations where id=organization_id for update;
 select * into item from public.attachments where attachments.organization_id=organization_id and id=attachment_id;
 if item.id is null or item.uploader_id<>actor_id then raise exception using message='NOT_FOUND'; end if;
 select role into actor_role from public.organization_members where organization_members.organization_id=organization_id and user_id=actor_id and active and private.auth_user_active(actor_id);
 if item.work_order_id is not null then select * into job from public.work_orders where work_orders.organization_id=organization_id and id=item.work_order_id;
 elsif item.request_id is not null then select * into req from public.maintenance_requests where maintenance_requests.organization_id=organization_id and id=item.request_id; end if;
 if actor_role is null or not (actor_role in ('owner','manager','supervisor') or (item.request_id is not null and req.reporter_id=actor_id) or (actor_role='technician' and exists(select 1 from public.work_order_assignments where work_order_assignments.organization_id=organization_id and work_order_id=item.work_order_id and user_id=actor_id and unassigned_at is null))) then raise exception using message='FORBIDDEN'; end if;
 select * into asset from public.assets where assets.organization_id=organization_id and id=coalesce(job.asset_id,req.asset_id,item.asset_id) for update;
 perform 1 from public.work_orders where work_orders.organization_id=organization_id and asset_id=asset.id order by id for update;
 if checksum is null or width is null or height is null or checksum!~'^[a-f0-9]{64}$' or width not between 1 and 12000 or height not between 1 and 12000 or width::bigint*height>40000000 then raise exception using message='VALIDATION'; end if;
 if item.status='ready' then if item.checksum<>checksum then raise exception using message='CONFLICT'; end if; return to_jsonb(item); end if;
 if (job.id is not null and job.status<>'in_progress') or (req.id is not null and req.status not in ('draft','returned')) or asset.archived_at is not null or item.status<>'pending' or item.created_at<now()-interval '24 hours' then raise exception using message='INVALID_TRANSITION'; end if;
 if checksum!~'^[a-f0-9]{64}$' or width not between 1 and 12000 or height not between 1 and 12000 or width::bigint*height>40000000 then raise exception using message='VALIDATION'; end if;
 update public.attachments set status='ready',checksum=finalize_attachment.checksum,width=finalize_attachment.width,height=finalize_attachment.height,ready_at=now() where id=item.id returning * into item;
 if job.id is not null then
  perform private.participant(organization_id,job.id,actor_id,'completion_evidence');
  update public.work_orders set repair_revision=repair_revision+1,submitted_revision=null,version=version+1 where id=job.id;
  insert into public.work_order_events(organization_id,work_order_id,actor_id,request_id,action,status,repair_revision) select organization_id,job.id,actor_id,item.id,'attachment_ready',status,repair_revision from public.work_orders where id=job.id;
 elsif req.id is not null then update public.maintenance_requests set version=version+1 where id=req.id;
 else update public.assets set version=version+1 where id=asset.id; end if;
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes) values(organization_id,actor_id,'attachment.ready',item.id,item.id,jsonb_build_object('work_order_id',item.work_order_id,'asset_id',item.asset_id,'request_id',item.request_id,'checksum',item.checksum));
 return to_jsonb(item);
end $$;
create function public.attachment_cleanup_batch() returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare item record; result jsonb:='[]'::jsonb; key text;
begin
 for item in select id,organization_id from public.attachments where status in ('pending','rejected') and cleanup_completed_at is null and created_at<now()-interval '24 hours' order by organization_id,id limit 100 loop
  perform 1 from public.organizations where id=item.organization_id for update;
  update public.attachments set status='rejected' where id=item.id and status in ('pending','rejected') and cleanup_completed_at is null and created_at<now()-interval '24 hours' returning object_key into key;
  if found then result:=result||jsonb_build_array(jsonb_build_object('id',item.id,'object_key',key)); end if;
 end loop;
 return result;
end
$$;
create function public.attachment_cleanup_done(attachment_id uuid) returns void language sql security definer set search_path='' as $$
 update public.attachments set cleanup_completed_at=now() where id=attachment_id and status='rejected' and created_at<now()-interval '24 hours'
$$;

create function private.immutable_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception using message='FORBIDDEN'; end $$;
do $$ declare name text; begin
 foreach name in array array['work_order_participants','work_order_events','work_order_reviews','asset_releases','asset_meter_readings','audit_logs','request_events'] loop
  execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.immutable_history()',name);
 end loop;
 foreach name in array array['work_order_participants','work_order_tasks','work_order_events','work_order_reviews','asset_holds','asset_releases','asset_meter_readings','organization_settings','notifications','attachments'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from anon,authenticated',name);
  execute format('grant select on public.%I to authenticated',name);
  execute format('grant all on public.%I to service_role',name);
 end loop;
 foreach name in array array['work_order_participants','work_order_tasks','work_order_events','work_order_reviews'] loop
  execute format('create policy authorized_read on public.%I for select to authenticated using (private.can_read_work(organization_id,work_order_id))',name);
 end loop;
end $$;
create trigger immutable_history before update or delete on private.command_receipts for each row execute function private.immutable_history();
create policy hold_read on public.asset_holds for select to authenticated using(private.operations(organization_id) or (work_order_id is not null and private.can_read_work(organization_id,work_order_id)));
create policy release_read on public.asset_releases for select to authenticated using(private.operations(organization_id));
create policy reading_read on public.asset_meter_readings for select to authenticated using(private.operations(organization_id) or private.known_asset(organization_id,asset_id));
create policy settings_read on public.organization_settings for select to authenticated using(private.member_role(organization_id) is not null);
create policy notification_read on public.notifications for select to authenticated using(recipient_user_id=auth.uid() and private.member_role(organization_id) is not null);
create policy attachment_ready_read on public.attachments for select to authenticated using(status='ready' and private.can_read_attachment(organization_id,work_order_id,asset_id,request_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('repair-evidence','repair-evidence',false,5242880,array['image/jpeg','image/png','image/webp']);
do $$ begin
 if to_regprocedure('storage.allow_only_operation(text)') is null then raise exception 'Pinned Storage lacks required operation-aware download guard'; end if;
end $$;
create policy evidence_download on storage.objects for select to authenticated using(storage.allow_only_operation('object.get_authenticated') and bucket_id='repair-evidence' and exists(select 1 from public.attachments a where a.object_key=storage.objects.name and a.status='ready' and private.can_read_attachment(a.organization_id,a.work_order_id,a.asset_id,a.request_id)));
-- Direct client writes remain denied. Downloads use the current JWT and ready-parent RLS.
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.member_role(uuid),private.operations(uuid),private.known_asset(uuid,uuid),private.can_read_work(uuid,uuid) to authenticated;
grant execute on function private.can_read_attachment(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.correct_meter_reading(jsonb,uuid,numeric,text),public.reserve_record_attachment(jsonb,text,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.correct_meter_reading(jsonb,uuid,numeric,text),public.reserve_record_attachment(jsonb,text,uuid,text,text,integer) to authenticated;
revoke all on function public.update_work_order(jsonb,uuid,jsonb),public.transition_work_order(jsonb,uuid,text,text),public.add_work_order_task(jsonb,uuid,text,boolean),public.review_work_order(jsonb,uuid,text,text),public.release_asset(jsonb,uuid,text),public.set_asset_hold(jsonb,uuid,text),public.resolve_asset_hold(jsonb,uuid,text,text),public.record_meter_reading(jsonb,uuid,text,numeric,timestamptz),public.save_organization_settings(jsonb,jsonb),public.mark_notifications_read(jsonb,uuid[]),public.reserve_attachment(jsonb,uuid,text,text,integer),public.get_team(uuid),public.get_dashboard(uuid,jsonb),public.attachment_access(uuid,uuid),public.finalize_attachment(uuid,uuid,uuid,text,integer,integer),public.attachment_cleanup_batch(),public.attachment_cleanup_done(uuid) from public,anon,authenticated;
grant execute on function public.update_work_order(jsonb,uuid,jsonb),public.transition_work_order(jsonb,uuid,text,text),public.add_work_order_task(jsonb,uuid,text,boolean),public.review_work_order(jsonb,uuid,text,text),public.release_asset(jsonb,uuid,text),public.set_asset_hold(jsonb,uuid,text),public.resolve_asset_hold(jsonb,uuid,text,text),public.record_meter_reading(jsonb,uuid,text,numeric,timestamptz),public.save_organization_settings(jsonb,jsonb),public.mark_notifications_read(jsonb,uuid[]),public.reserve_attachment(jsonb,uuid,text,text,integer),public.get_team(uuid),public.get_dashboard(uuid,jsonb),public.attachment_access(uuid,uuid) to authenticated;
grant execute on function public.finalize_attachment(uuid,uuid,uuid,text,integer,integer),public.attachment_cleanup_batch(),public.attachment_cleanup_done(uuid) to service_role;
-- Recompile the public SQL shims after renaming the private dispatcher, including warm T1 connections.
do $$ declare item regprocedure; begin
 for item in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_organization_invitation','revoke_organization_invitation','set_organization_member','transfer_organization_ownership','save_asset','save_request','create_work_order','assign_work_order','submit_request','withdraw_request','triage_request','convert_request') loop
  execute pg_get_functiondef(item);
 end loop;
end $$;
