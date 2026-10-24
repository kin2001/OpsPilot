-- Initial submissions are immutable; correction episodes are introduced separately in 25E.
create table public.inspection_templates (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), current_revision_id uuid not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), version integer not null default 1 check(version>0), unique(organization_id,id)
);
create table public.inspection_template_revisions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, template_id uuid not null,
 revision integer not null check(revision>0), title text not null check(length(trim(title)) between 1 and 200),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
 published_by uuid not null references auth.users(id), published_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,template_id,revision), foreign key(organization_id,template_id) references public.inspection_templates(organization_id,id)
);
alter table public.inspection_templates add foreign key(organization_id,current_revision_id) references public.inspection_template_revisions(organization_id,id) deferrable initially deferred;
create table public.inspection_assignments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, asset_id uuid not null, template_revision_id uuid not null,
 inspector_id uuid not null, assigned_by uuid not null references auth.users(id), assigned_at timestamptz not null default now(), due_on date,
 version integer not null default 1 check(version=1), unique(organization_id,id),
 foreign key(organization_id,asset_id) references public.assets(organization_id,id),
 foreign key(organization_id,template_revision_id) references public.inspection_template_revisions(organization_id,id),
 foreign key(organization_id,inspector_id) references public.organization_members(organization_id,user_id)
);
create table public.inspection_submissions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, assignment_id uuid not null, template_revision_id uuid not null,
 inspector_id uuid not null references auth.users(id), submitted_at timestamptz not null default now(),
 results jsonb not null check(jsonb_typeof(results)='array' and jsonb_array_length(results)<=100), version integer not null default 1 check(version=1),
 unique(organization_id,id), unique(organization_id,assignment_id),
 foreign key(organization_id,assignment_id) references public.inspection_assignments(organization_id,id),
 foreign key(organization_id,template_revision_id) references public.inspection_template_revisions(organization_id,id)
);
create table public.inspection_failure_episodes (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, assignment_id uuid not null, submission_id uuid not null,
 item_id uuid not null, corrective_request_id uuid not null, hold_id uuid, predecessor_id uuid, created_at timestamptz not null default now(),
 unique(organization_id,id), unique(organization_id,submission_id,item_id), unique(organization_id,corrective_request_id), unique(organization_id,hold_id),
 foreign key(organization_id,assignment_id) references public.inspection_assignments(organization_id,id),
 foreign key(organization_id,submission_id) references public.inspection_submissions(organization_id,id),
 foreign key(organization_id,corrective_request_id) references public.maintenance_requests(organization_id,id),
 foreign key(organization_id,hold_id) references public.asset_holds(organization_id,id),
 foreign key(organization_id,predecessor_id) references public.inspection_failure_episodes(organization_id,id)
);
create index on public.inspection_assignments(organization_id,inspector_id,id);
create index on public.inspection_failure_episodes(organization_id,assignment_id,id);
alter table public.attachments add column inspection_assignment_id uuid,
 add foreign key(organization_id,inspection_assignment_id) references public.inspection_assignments(organization_id,id);
do $$ declare constraint_name text; begin
 select conname into strict constraint_name from pg_catalog.pg_constraint where conrelid='public.attachments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%num_nonnulls%';
 execute format('alter table public.attachments drop constraint %I',constraint_name);
end $$;
alter table public.attachments add check(num_nonnulls(work_order_id,asset_id,request_id,inspection_assignment_id)=1);

create function private.can_read_inspection(org uuid, assignment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.member_role(org) in ('owner','manager','supervisor','technician') and exists(select 1 from public.inspection_assignments a where a.organization_id=org and a.id=assignment and (private.operations(org) or a.inspector_id=auth.uid())),false)
$$;
create function private.can_read_inspection_attachment(org uuid, assignment uuid, actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m join public.inspection_assignments a on a.organization_id=m.organization_id
 where m.organization_id=org and m.user_id=actor and m.active and private.auth_user_active(actor) and a.id=assignment
 and (m.role in ('owner','manager','supervisor') or (m.role='technician' and a.inspector_id=actor)))
$$;
create function private.can_read_attachment(org uuid, job uuid, asset uuid, request uuid, inspection uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when inspection is not null then private.can_read_inspection_attachment(org,inspection,auth.uid()) else private.can_read_attachment(org,job,asset,request) end
$$;
drop policy attachment_ready_read on public.attachments;
create policy attachment_ready_read on public.attachments for select to authenticated using(status='ready' and private.can_read_attachment(organization_id,work_order_id,asset_id,request_id,inspection_assignment_id));
drop policy evidence_download on storage.objects;
create policy evidence_download on storage.objects for select to authenticated using(storage.allow_only_operation('object.get_authenticated') and bucket_id='repair-evidence' and exists(select 1 from public.attachments a where a.object_key=storage.objects.name and a.status='ready' and private.can_read_attachment(a.organization_id,a.work_order_id,a.asset_id,a.request_id,a.inspection_assignment_id)));
create or replace function public.attachment_access(organization_id uuid,attachment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.attachments;
begin
 select * into item from public.attachments where attachments.organization_id=attachment_access.organization_id and id=attachment_id;
 if item.id is null or not private.can_read_attachment(organization_id,item.work_order_id,item.asset_id,item.request_id,item.inspection_assignment_id) then raise exception using message='NOT_FOUND'; end if;
 if item.status<>'ready' and (item.uploader_id<>auth.uid() or item.status<>'pending') then raise exception using message='NOT_FOUND'; end if;
 return to_jsonb(item);
end $$;

create function private.inspection_command(ctx jsonb,action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid; actor uuid:=auth.uid(); request uuid; expected integer; role text; replayed jsonb; data jsonb;
 fields jsonb; template public.inspection_templates; revision public.inspection_template_revisions; assignment public.inspection_assignments;
 asset public.assets; submission public.inspection_submissions; attachment public.attachments; item jsonb; result jsonb; results jsonb;
 revision_id uuid; template_id uuid; request_id uuid; episode_id uuid; hold_id uuid; event_id uuid; evidence uuid; evidence_ids uuid[];
begin
 if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 org:=(ctx->>'organization_id')::uuid;request:=(ctx->>'request_id')::uuid;expected:=(ctx->>'expected_version')::integer;
 if org is null or request is null or (ctx?'expected_version' and (expected is null or expected<=0 or jsonb_typeof(ctx->'expected_version')<>'number')) then raise exception using message='VALIDATION'; end if;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org);
 if role is null or role not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN'; end if;
 if action in ('publish_inspection_template','assign_inspection') and role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;
 if action in ('submit_inspection','reserve_inspection_attachment') then
  select * into assignment from public.inspection_assignments where organization_id=org and id=(payload->>'assignment_id')::uuid;
  if assignment.id is null then raise exception using message='NOT_FOUND'; end if;
  if assignment.inspector_id<>actor then raise exception using message='FORBIDDEN'; end if;
  select * into asset from public.assets where organization_id=org and id=assignment.asset_id for update;
 end if;
 replayed:=private.replay(org,actor,request,action,payload||jsonb_build_object('ctx',ctx));
 if replayed is not null then return replayed; end if;
 perform private.rate_check(org,actor,action);
 case action
 when 'publish_inspection_template' then
  fields:=payload->'fields';perform private.object_fields(fields,array['id','title','items']);
  if jsonb_typeof(fields->'title') is distinct from 'string' or length(trim(fields->>'title')) not between 1 and 200 or jsonb_typeof(fields->'items') is distinct from 'array' then raise exception using message='VALIDATION'; end if;
  if jsonb_array_length(fields->'items') not between 1 and 100 then raise exception using message='VALIDATION'; end if;
  for item in select value from jsonb_array_elements(fields->'items') loop
   perform private.object_fields(item,array['id','label','required','safety_relevant','evidence_required']);
   if (item->>'id')::uuid is null or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 500
    or jsonb_typeof(item->'required') is distinct from 'boolean' or jsonb_typeof(item->'safety_relevant') is distinct from 'boolean' or jsonb_typeof(item->'evidence_required') is distinct from 'boolean' then raise exception using message='VALIDATION'; end if;
  end loop;
  if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(fields->'items'))<>jsonb_array_length(fields->'items') then raise exception using message='VALIDATION'; end if;
  revision_id:=gen_random_uuid();template_id:=(fields->>'id')::uuid;
  if template_id is null then
   if expected is not null then raise exception using message='VALIDATION'; end if;
   if (select count(*) from public.inspection_templates where organization_id=org)>=500 then raise exception using message='RATE_LIMITED'; end if;
   insert into public.inspection_templates(organization_id,title,current_revision_id,created_by) values(org,trim(fields->>'title'),revision_id,actor) returning * into template;
  else
   select * into template from public.inspection_templates where organization_id=org and id=template_id for update;
   if template.id is null then raise exception using message='NOT_FOUND'; end if;
   if expected is null or template.version<>expected then raise exception using message='CONFLICT'; end if;
   update public.inspection_templates set title=trim(fields->>'title'),current_revision_id=revision_id,version=version+1 where id=template.id returning * into template;
  end if;
  insert into public.inspection_template_revisions(id,organization_id,template_id,revision,title,items,published_by) values(revision_id,org,template.id,template.version,template.title,fields->'items',actor);
  data:=to_jsonb(template);
 when 'assign_inspection' then
  select * into revision from public.inspection_template_revisions where organization_id=org and id=(payload->>'template_revision_id')::uuid;
  select * into asset from public.assets where organization_id=org and id=(payload->>'asset_id')::uuid for update;
  if revision.id is null or asset.id is null then raise exception using message='NOT_FOUND'; end if;
  if asset.archived_at is not null then raise exception using message='INVALID_TRANSITION'; end if;
  if not exists(select 1 from public.organization_members where organization_id=org and user_id=(payload->>'inspector_id')::uuid and active and organization_members.role in ('owner','manager','supervisor','technician') and private.auth_user_active(user_id)) then raise exception using message='VALIDATION'; end if;
  if (select count(*) from public.inspection_assignments a where a.organization_id=org and not exists(select 1 from public.inspection_submissions s where s.organization_id=org and s.assignment_id=a.id))>=500 then raise exception using message='RATE_LIMITED'; end if;
  insert into public.inspection_assignments(organization_id,asset_id,template_revision_id,inspector_id,assigned_by,due_on) values(org,asset.id,revision.id,(payload->>'inspector_id')::uuid,actor,(payload->>'due_on')::date) returning * into assignment;
  insert into public.notifications(organization_id,recipient_user_id,event_id,category,source_id) values(org,assignment.inspector_id,assignment.id,'inspection_assignment',assignment.id);
  data:=to_jsonb(assignment);
 when 'reserve_inspection_attachment' then
  if exists(select 1 from public.inspection_submissions where organization_id=org and assignment_id=assignment.id) then raise exception using message='INVALID_TRANSITION'; end if;
  if payload->>'media_type' not in ('image/jpeg','image/png','image/webp') or (select count(*) from public.attachments where organization_id=org and inspection_assignment_id=assignment.id and status in ('pending','ready'))>=10
   or (select coalesce(sum(size),0) from public.attachments where organization_id=org and status in ('pending','ready'))+(payload->>'size')::integer>262144000 then raise exception using message='RATE_LIMITED'; end if;
  evidence:=gen_random_uuid();
  insert into public.attachments(id,organization_id,inspection_assignment_id,object_key,name,media_type,size,uploader_id) values(evidence,org,assignment.id,org::text||'/'||assignment.id::text||'/'||evidence::text,payload->>'name',payload->>'media_type',(payload->>'size')::integer,actor) returning * into attachment;
  data:=to_jsonb(attachment);
 when 'submit_inspection' then
  if assignment.template_revision_id is distinct from (payload->>'template_revision_id')::uuid then raise exception using message='CONFLICT'; end if;
  if exists(select 1 from public.inspection_submissions where organization_id=org and assignment_id=assignment.id) then raise exception using message='CONFLICT'; end if;
  select * into revision from public.inspection_template_revisions where organization_id=org and id=assignment.template_revision_id;
  results:=payload->'results';
  if jsonb_typeof(results) is distinct from 'array' then raise exception using message='VALIDATION'; end if;
  if jsonb_array_length(results)>100 or (select count(distinct (value->>'item_id')::uuid) from jsonb_array_elements(results))<>jsonb_array_length(results) then raise exception using message='VALIDATION'; end if;
  for result in select value from jsonb_array_elements(results) loop
   perform private.object_fields(result,array['item_id','outcome','reason','remarks','evidence_ids']);
   select value into item from jsonb_array_elements(revision.items) where (value->>'id')::uuid=(result->>'item_id')::uuid;
   if item is null or result->>'outcome' is null or result->>'outcome' not in ('pass','fail','not_applicable') or jsonb_typeof(result->'evidence_ids') is distinct from 'array' then raise exception using message='VALIDATION'; end if;
   if result->>'outcome'='not_applicable' and (jsonb_typeof(result->'reason') is distinct from 'string' or length(trim(result->>'reason')) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;
   if result?'reason' and (jsonb_typeof(result->'reason') is distinct from 'string' or length(trim(result->>'reason')) not between 1 and 2000) then raise exception using message='VALIDATION'; end if;
   if (result->>'outcome'<>'pass' or result?'remarks') and (jsonb_typeof(result->'remarks') is distinct from 'string' or length(trim(result->>'remarks')) not between 1 and 4000) then raise exception using message='VALIDATION'; end if;
   select coalesce(array_agg(value::uuid),'{}'::uuid[]) into evidence_ids from jsonb_array_elements_text(result->'evidence_ids');
   if cardinality(evidence_ids)>10 or cardinality(evidence_ids)<>(select count(distinct id) from unnest(evidence_ids) id) or ((item->>'evidence_required')::boolean and cardinality(evidence_ids)=0) then raise exception using message='VALIDATION'; end if;
   if exists(select 1 from unnest(evidence_ids) ev(id) where not exists(select 1 from public.attachments a where a.organization_id=org and a.id=ev.id and a.inspection_assignment_id=assignment.id and a.status='ready')) then raise exception using message='VALIDATION'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(revision.items) i where (i->>'required')::boolean and not exists(select 1 from jsonb_array_elements(results) r where (r->>'item_id')::uuid=(i->>'id')::uuid)) then raise exception using message='VALIDATION'; end if;
  insert into public.inspection_submissions(organization_id,assignment_id,template_revision_id,inspector_id,results) values(org,assignment.id,revision.id,actor,results) returning * into submission;
  for result in select value from jsonb_array_elements(results) where value->>'outcome'='fail' loop
   select value into item from jsonb_array_elements(revision.items) where (value->>'id')::uuid=(result->>'item_id')::uuid;
   episode_id:=gen_random_uuid();hold_id:=null;
   insert into public.maintenance_requests(organization_id,asset_id,reporter_id,description,category,status) values(org,asset.id,actor,'Inspection failure: '||(item->>'label'),'inspection','submitted') returning id into request_id;
   insert into public.request_events(organization_id,request_id,actor_id,action,status,reason) values(org,request_id,actor,'inspection_failure','submitted',result->>'remarks');
   if (item->>'safety_relevant')::boolean then
    insert into public.asset_holds(organization_id,asset_id,source,source_id,reason,created_by) values(org,asset.id,'inspection',episode_id,'Inspection failure: '||(item->>'label'),actor) returning id into hold_id;
   end if;
   insert into public.inspection_failure_episodes(id,organization_id,assignment_id,submission_id,item_id,corrective_request_id,hold_id) values(episode_id,org,assignment.id,submission.id,(item->>'id')::uuid,request_id,hold_id);
   insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes) values(org,actor,'inspection.failure_episode',episode_id,request,jsonb_build_object('submission_id',submission.id,'corrective_request_id',request_id,'hold_id',hold_id,'item_id',item->>'id'));
   insert into public.notifications(organization_id,recipient_user_id,event_id,category,source_id) select org,user_id,episode_id,'inspection_failure',assignment.id from public.organization_members where organization_id=org and active and organization_members.role in ('owner','manager','supervisor') and private.auth_user_active(user_id) on conflict do nothing;
  end loop;
  if exists(select 1 from public.inspection_failure_episodes where organization_id=org and submission_id=submission.id and inspection_failure_episodes.hold_id is not null) then perform private.refresh_availability(org,asset.id); end if;
  data:=to_jsonb(submission);
 else raise exception using message='VALIDATION';
 end case;
 return private.finish_command(org,actor,request,action,payload||jsonb_build_object('ctx',ctx),data);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
 when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
 when foreign_key_violation then raise exception using message='NOT_FOUND';
 when others then
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=% actor=% tenant=% code=%',action,actor,org,SQLERRM; end if;
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','VALIDATION','CONFLICT','INVALID_TRANSITION','RATE_LIMITED') then raise; end if;
  raise log 'opspilot_command_failure action=% state=%',action,SQLSTATE;
  raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function public.publish_inspection_template(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inspection_command(ctx,'publish_inspection_template',jsonb_build_object('fields',fields)) $$;
create function public.assign_inspection(ctx jsonb,asset_id uuid,template_revision_id uuid,inspector_id uuid,due_on date default null) returns jsonb language sql security definer set search_path='' as $$ select private.inspection_command(ctx,'assign_inspection',jsonb_build_object('asset_id',asset_id,'template_revision_id',template_revision_id,'inspector_id',inspector_id,'due_on',due_on)) $$;
create function public.submit_inspection(ctx jsonb,assignment_id uuid,template_revision_id uuid,results jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inspection_command(ctx,'submit_inspection',jsonb_build_object('assignment_id',assignment_id,'template_revision_id',template_revision_id,'results',results)) $$;
create function public.reserve_inspection_attachment(ctx jsonb,assignment_id uuid,name text,media_type text,size integer) returns jsonb language sql security definer set search_path='' as $$ select private.inspection_command(ctx,'reserve_inspection_attachment',jsonb_build_object('assignment_id',assignment_id,'name',name,'media_type',media_type,'size',size)) $$;

-- Keep the existing validation and service-only finalization authority for all legacy parents.
alter function public.finalize_attachment(uuid,uuid,uuid,text,integer,integer) rename to finalize_attachment_pre_inspections;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.finalize_attachment_pre_inspections(uuid,uuid,uuid,text,integer,integer)'::regprocedure);
 if position('checksum=finalize_attachment.checksum,width=finalize_attachment.width,height=finalize_attachment.height' in definition)=0 then raise exception 'Expected legacy attachment parameter qualifiers'; end if;
 -- Renaming a PL/pgSQL function changes its implicit parameter block label.
 execute replace(definition,'finalize_attachment.','finalize_attachment_pre_inspections.');
end $$;
create function public.finalize_attachment(organization_id uuid,attachment_id uuid,actor_id uuid,checksum text,width integer,height integer) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare item public.attachments;
begin
 perform 1 from public.organizations where id=organization_id for update;
 select * into item from public.attachments where attachments.organization_id=organization_id and id=attachment_id;
 if item.inspection_assignment_id is null then return public.finalize_attachment_pre_inspections(organization_id,attachment_id,actor_id,checksum,width,height); end if;
 if item.uploader_id<>actor_id or not private.can_read_inspection_attachment(organization_id,item.inspection_assignment_id,actor_id) then raise exception using message='FORBIDDEN'; end if;
 if checksum is null or width is null or height is null or checksum!~'^[a-f0-9]{64}$' or width not between 1 and 12000 or height not between 1 and 12000 or width::bigint*height>40000000 then raise exception using message='VALIDATION'; end if;
 if item.status='ready' then if item.checksum<>checksum then raise exception using message='CONFLICT'; end if; return to_jsonb(item); end if;
 if item.status<>'pending' or item.created_at<now()-interval '24 hours' or exists(select 1 from public.inspection_submissions s where s.organization_id=finalize_attachment.organization_id and s.assignment_id=item.inspection_assignment_id) then raise exception using message='INVALID_TRANSITION'; end if;
 update public.attachments set status='ready',checksum=finalize_attachment.checksum,width=finalize_attachment.width,height=finalize_attachment.height,ready_at=now() where id=item.id returning * into item;
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes) values(organization_id,actor_id,'attachment.ready',item.id,item.id,jsonb_build_object('inspection_assignment_id',item.inspection_assignment_id,'checksum',item.checksum));
 return to_jsonb(item);
end $$;

-- A resolved inspection hold still excludes its remedy's actual/former performers until release.
create function private.inspection_release_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.asset_holds h join public.inspection_failure_episodes e on e.organization_id=h.organization_id and e.hold_id=h.id
  join public.work_orders w on w.organization_id=e.organization_id and w.source_request_id=e.corrective_request_id
  join public.work_order_participants p on p.organization_id=w.organization_id and p.work_order_id=w.id
  where h.organization_id=new.organization_id and h.asset_id=new.asset_id and h.released_at is null and p.user_id=new.actor_id) then raise exception using message='FORBIDDEN'; end if;
 return new;
end $$;
create trigger inspection_release_guard before insert on public.asset_releases for each row execute function private.inspection_release_guard();
create function private.inspection_hold_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.source='inspection' and old.resolved_at is null and new.resolved_at is not null and exists(
  select 1 from public.inspection_failure_episodes e join public.work_orders w on w.organization_id=e.organization_id and w.source_request_id=e.corrective_request_id
  where e.organization_id=old.organization_id and e.hold_id=old.id and (w.status not in ('completed','canceled') or (w.status='completed' and not exists(select 1 from public.work_order_reviews r where r.organization_id=w.organization_id and r.work_order_id=w.id and r.repair_revision=w.repair_revision and r.decision='approved')))
 ) then raise exception using message='INVALID_TRANSITION'; end if;
 return new;
end $$;
create trigger inspection_hold_guard before update on public.asset_holds for each row execute function private.inspection_hold_guard();

do $$ declare name text; begin
 foreach name in array array['inspection_templates','inspection_template_revisions','inspection_assignments','inspection_submissions','inspection_failure_episodes'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to authenticated',name);
  if name<>'inspection_templates' then execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.immutable_history()',name); end if;
 end loop;
end $$;
create policy inspection_template_read on public.inspection_templates for select to authenticated using(private.member_role(organization_id) in ('owner','manager','supervisor','technician'));
create policy inspection_revision_read on public.inspection_template_revisions for select to authenticated using(private.member_role(organization_id) in ('owner','manager','supervisor','technician'));
create policy inspection_assignment_read on public.inspection_assignments for select to authenticated using(private.can_read_inspection(organization_id,id));
create policy inspection_submission_read on public.inspection_submissions for select to authenticated using(private.can_read_inspection(organization_id,assignment_id));
create policy inspection_episode_read on public.inspection_failure_episodes for select to authenticated using(private.can_read_inspection(organization_id,assignment_id));

create function public.list_inspection_templates(organization_id uuid,cursor uuid default null,page_size integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; next uuid;
begin
 if private.member_role(organization_id) is null or private.member_role(organization_id) not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN'; end if;
 if page_size is null or page_size not between 1 and 100 then raise exception using message='VALIDATION'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into rows from (select * from public.inspection_templates where inspection_templates.organization_id=list_inspection_templates.organization_id and (cursor is null or id>cursor) order by id limit page_size+1) t;
 if jsonb_array_length(rows)>page_size then next:=(rows->(page_size-1)->>'id')::uuid;rows:=rows-page_size; end if;
 return jsonb_build_object('items',rows,'next_cursor',next);
end $$;
create function public.list_inspection_revisions(organization_id uuid,template_id uuid,cursor integer default null,page_size integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; next integer;
begin
 if private.member_role(organization_id) is null or private.member_role(organization_id) not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN'; end if;
 if page_size is null or page_size not between 1 and 100 or (cursor is not null and cursor<=0) then raise exception using message='VALIDATION'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by revision),'[]') into rows from (select * from public.inspection_template_revisions where inspection_template_revisions.organization_id=list_inspection_revisions.organization_id and inspection_template_revisions.template_id=list_inspection_revisions.template_id and (cursor is null or revision>cursor) order by revision limit page_size+1) t;
 if jsonb_array_length(rows)>page_size then next:=(rows->(page_size-1)->>'revision')::integer;rows:=rows-page_size; end if;
 return jsonb_build_object('items',rows,'next_cursor',next);
end $$;
create function public.list_inspection_assignments(organization_id uuid,cursor uuid default null,page_size integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; next uuid;
begin
 if private.member_role(organization_id) is null or private.member_role(organization_id) not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN'; end if;
 if page_size is null or page_size not between 1 and 100 then raise exception using message='VALIDATION'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into rows from (select * from public.inspection_assignments a where a.organization_id=list_inspection_assignments.organization_id and private.can_read_inspection(a.organization_id,a.id) and (cursor is null or a.id>cursor) order by a.id limit page_size+1) t;
 if jsonb_array_length(rows)>page_size then next:=(rows->(page_size-1)->>'id')::uuid;rows:=rows-page_size; end if;
 return jsonb_build_object('items',rows,'next_cursor',next);
end $$;
create function public.get_inspection(organization_id uuid,assignment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare assignment public.inspection_assignments;
begin
 if not private.can_read_inspection(organization_id,assignment_id) then raise exception using message='FORBIDDEN'; end if;
 select * into assignment from public.inspection_assignments where inspection_assignments.organization_id=get_inspection.organization_id and id=assignment_id;
 return jsonb_build_object('assignment',to_jsonb(assignment),'revision',(select to_jsonb(r) from public.inspection_template_revisions r where r.organization_id=get_inspection.organization_id and r.id=assignment.template_revision_id),
 'submission',(select to_jsonb(s) from public.inspection_submissions s where s.organization_id=get_inspection.organization_id and s.assignment_id=get_inspection.assignment_id),
 'episodes',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.inspection_failure_episodes e where e.organization_id=get_inspection.organization_id and e.assignment_id=get_inspection.assignment_id));
end $$;
revoke all on function private.inspection_command(jsonb,text,jsonb),private.can_read_inspection(uuid,uuid),private.can_read_inspection_attachment(uuid,uuid,uuid),private.can_read_attachment(uuid,uuid,uuid,uuid,uuid),private.inspection_release_guard(),private.inspection_hold_guard() from public,anon,authenticated,service_role;
grant execute on function private.can_read_inspection(uuid,uuid),private.can_read_attachment(uuid,uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.publish_inspection_template(jsonb,jsonb),public.assign_inspection(jsonb,uuid,uuid,uuid,date),public.submit_inspection(jsonb,uuid,uuid,jsonb),public.reserve_inspection_attachment(jsonb,uuid,text,text,integer),public.list_inspection_templates(uuid,uuid,integer),public.list_inspection_revisions(uuid,uuid,integer,integer),public.list_inspection_assignments(uuid,uuid,integer),public.get_inspection(uuid,uuid),public.finalize_attachment(uuid,uuid,uuid,text,integer,integer),public.finalize_attachment_pre_inspections(uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.publish_inspection_template(jsonb,jsonb),public.assign_inspection(jsonb,uuid,uuid,uuid,date),public.submit_inspection(jsonb,uuid,uuid,jsonb),public.reserve_inspection_attachment(jsonb,uuid,text,text,integer),public.list_inspection_templates(uuid,uuid,integer),public.list_inspection_revisions(uuid,uuid,integer,integer),public.list_inspection_assignments(uuid,uuid,integer),public.get_inspection(uuid,uuid) to authenticated;
grant execute on function public.finalize_attachment(uuid,uuid,uuid,text,integer,integer) to service_role;
revoke all on function public.finalize_attachment_pre_inspections(uuid,uuid,uuid,text,integer,integer) from service_role;
