-- Preserve submitted facts and durable receipts; corrections append one successor under the organization/asset locks.
alter table public.inspection_submissions
 drop constraint inspection_submissions_organization_id_assignment_id_key,
 drop constraint inspection_submissions_version_check,
 add column supersedes_id uuid,
 add column correction_reason text,
 add constraint inspection_submission_version check(version between 1 and 100),
 add constraint inspection_submission_lineage check((version=1 and supersedes_id is null and correction_reason is null) or (version>1 and supersedes_id is not null and length(trim(correction_reason)) between 1 and 2000 and correction_reason is not null)),
 add unique(organization_id,assignment_id,version),
 add unique(organization_id,assignment_id,id),
 add unique(organization_id,supersedes_id),
 add constraint inspection_submission_predecessor foreign key(organization_id,assignment_id,supersedes_id) references public.inspection_submissions(organization_id,assignment_id,id);
create unique index inspection_episode_successor on public.inspection_failure_episodes(organization_id,predecessor_id) where predecessor_id is not null;

create or replace function private.inspection_command(ctx jsonb,action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid; actor uuid:=auth.uid(); request uuid; expected integer; role text; replayed jsonb; data jsonb;
 fields jsonb; template public.inspection_templates; revision public.inspection_template_revisions; assignment public.inspection_assignments;
 asset public.assets; submission public.inspection_submissions; attachment public.attachments; item jsonb; result jsonb; results jsonb;
 revision_id uuid; template_id uuid; request_id uuid; episode_id uuid; hold_id uuid; event_id uuid; evidence uuid; evidence_ids uuid[]; previous public.inspection_submissions; prior_episode public.inspection_failure_episodes; remedy public.maintenance_requests;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 org:=(ctx->>'organization_id')::uuid;request:=(ctx->>'request_id')::uuid;expected:=(ctx->>'expected_version')::integer;
 if org is null or request is null or (ctx?'expected_version' and (expected is null or expected<=0 or jsonb_typeof(ctx->'expected_version')<>'number')) then raise exception using message='VALIDATION'; end if;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org);
 if role is null or role not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN'; end if;
 if action in ('publish_inspection_template','assign_inspection') and role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;
 if action in ('submit_inspection','correct_inspection','reserve_inspection_attachment') then
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
  if (select count(*) from public.inspection_submissions where organization_id=org and assignment_id=assignment.id)>=100 then raise exception using message='RATE_LIMITED'; end if;
  if payload->>'media_type' not in ('image/jpeg','image/png','image/webp') or (select count(*) from public.attachments where organization_id=org and inspection_assignment_id=assignment.id and status in ('pending','ready'))>=10
   or (select coalesce(sum(size),0) from public.attachments where organization_id=org and status in ('pending','ready'))+(payload->>'size')::integer>262144000 then raise exception using message='RATE_LIMITED'; end if;
  evidence:=gen_random_uuid();
  insert into public.attachments(id,organization_id,inspection_assignment_id,object_key,name,media_type,size,uploader_id) values(evidence,org,assignment.id,org::text||'/'||assignment.id::text||'/'||evidence::text,payload->>'name',payload->>'media_type',(payload->>'size')::integer,actor) returning * into attachment;
  data:=to_jsonb(attachment);
 when 'submit_inspection','correct_inspection' then
  if assignment.template_revision_id is distinct from (payload->>'template_revision_id')::uuid then raise exception using message='CONFLICT'; end if;
  select * into previous from public.inspection_submissions where organization_id=org and assignment_id=assignment.id order by version desc limit 1;
  if action='submit_inspection' then
   if previous.id is not null then raise exception using message='CONFLICT'; end if;
  else
   perform private.object_fields(payload,array['assignment_id','template_revision_id','supersedes_id','correction_reason','results']);
   if jsonb_typeof(payload->'correction_reason') is distinct from 'string' or length(trim(payload->>'correction_reason')) not between 1 and 2000 or (payload->>'supersedes_id')::uuid is null or expected is null then raise exception using message='VALIDATION'; end if;
   if previous.id is null then raise exception using message='INVALID_TRANSITION'; end if;
   if previous.id is distinct from (payload->>'supersedes_id')::uuid or previous.version<>expected then raise exception using message='CONFLICT'; end if;
   if previous.version>=100 then raise exception using message='RATE_LIMITED'; end if;
  end if;
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
  insert into public.inspection_submissions(organization_id,assignment_id,template_revision_id,inspector_id,results,version,supersedes_id,correction_reason) values(org,assignment.id,revision.id,actor,results,coalesce(previous.version,0)+1,previous.id,case when action='correct_inspection' then trim(payload->>'correction_reason') end) returning * into submission;
  for result in select value from jsonb_array_elements(results) where value->>'outcome'='fail' loop
   select value into item from jsonb_array_elements(revision.items) where (value->>'id')::uuid=(result->>'item_id')::uuid;
   select * into prior_episode from public.inspection_failure_episodes e where e.organization_id=org and e.assignment_id=assignment.id and e.item_id=(item->>'id')::uuid and not exists(select 1 from public.inspection_failure_episodes child where child.organization_id=org and child.predecessor_id=e.id);
   if prior_episode.id is not null then
    select * into remedy from public.maintenance_requests where organization_id=org and id=prior_episode.corrective_request_id;
    if remedy.status in ('draft','submitted','returned') or (remedy.status='converted' and exists(select 1 from public.work_orders w where w.organization_id=org and w.id=remedy.converted_work_order_id and w.status not in ('completed','canceled'))) then continue; end if;
   end if;
   episode_id:=gen_random_uuid();hold_id:=null;
   insert into public.maintenance_requests(organization_id,asset_id,reporter_id,description,category,status) values(org,asset.id,actor,'Inspection failure: '||(item->>'label'),'inspection','submitted') returning id into request_id;
   insert into public.request_events(organization_id,request_id,actor_id,action,status,reason) values(org,request_id,actor,'inspection_failure','submitted',result->>'remarks');
   if (item->>'safety_relevant')::boolean then
    insert into public.asset_holds(organization_id,asset_id,source,source_id,reason,created_by) values(org,asset.id,'inspection',episode_id,'Inspection failure: '||(item->>'label'),actor) returning id into hold_id;
   end if;
   insert into public.inspection_failure_episodes(id,organization_id,assignment_id,submission_id,item_id,corrective_request_id,hold_id,predecessor_id) values(episode_id,org,assignment.id,submission.id,(item->>'id')::uuid,request_id,hold_id,prior_episode.id);
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

create or replace function public.finalize_attachment(organization_id uuid,attachment_id uuid,actor_id uuid,checksum text,width integer,height integer) returns jsonb
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
 if item.status<>'pending' or item.created_at<now()-interval '24 hours' or (select count(*) from public.inspection_submissions s where s.organization_id=finalize_attachment.organization_id and s.assignment_id=item.inspection_assignment_id)>=100 then raise exception using message='INVALID_TRANSITION'; end if;
 update public.attachments set status='ready',checksum=finalize_attachment.checksum,width=finalize_attachment.width,height=finalize_attachment.height,ready_at=now() where id=item.id returning * into item;
 insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes) values(organization_id,actor_id,'attachment.ready',item.id,item.id,jsonb_build_object('inspection_assignment_id',item.inspection_assignment_id,'checksum',item.checksum));
 return to_jsonb(item);
end $$;

create or replace function public.get_inspection(organization_id uuid,assignment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare assignment public.inspection_assignments;
begin
 if not private.can_read_inspection(organization_id,assignment_id) then raise exception using message='FORBIDDEN'; end if;
 select * into assignment from public.inspection_assignments where inspection_assignments.organization_id=get_inspection.organization_id and id=assignment_id;
 return jsonb_build_object('assignment',to_jsonb(assignment),'revision',(select to_jsonb(r) from public.inspection_template_revisions r where r.organization_id=get_inspection.organization_id and r.id=assignment.template_revision_id),
 'submission',(select to_jsonb(s) from public.inspection_submissions s where s.organization_id=get_inspection.organization_id and s.assignment_id=get_inspection.assignment_id order by version desc limit 1),
 'history',(select coalesce(jsonb_agg(to_jsonb(s) order by version),'[]') from public.inspection_submissions s where s.organization_id=get_inspection.organization_id and s.assignment_id=get_inspection.assignment_id),
 'episodes',(select coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]') from public.inspection_failure_episodes e where e.organization_id=get_inspection.organization_id and e.assignment_id=get_inspection.assignment_id),
 'episode_links',(select coalesce(jsonb_agg(jsonb_build_object('submission_id',s.id,'item_id',r.value->>'item_id','episode_id',link.id) order by s.version,r.value->>'item_id'),'[]')
 from public.inspection_submissions s cross join lateral jsonb_array_elements(s.results) r
 cross join lateral (select e.id from public.inspection_failure_episodes e join public.inspection_submissions origin on origin.organization_id=e.organization_id and origin.id=e.submission_id where e.organization_id=s.organization_id and e.assignment_id=s.assignment_id and e.item_id=(r.value->>'item_id')::uuid and origin.version<=s.version order by origin.version desc limit 1) link
 where s.organization_id=get_inspection.organization_id and s.assignment_id=get_inspection.assignment_id and r.value->>'outcome'='fail'),
 'holds',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]') from public.asset_holds h join public.inspection_failure_episodes e on e.organization_id=h.organization_id and e.hold_id=h.id where e.organization_id=get_inspection.organization_id and e.assignment_id=get_inspection.assignment_id));
end $$;
create function public.correct_inspection(ctx jsonb,assignment_id uuid,template_revision_id uuid,supersedes_id uuid,correction_reason text,results jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inspection_command(ctx,'correct_inspection',jsonb_build_object('assignment_id',assignment_id,'template_revision_id',template_revision_id,'supersedes_id',supersedes_id,'correction_reason',correction_reason,'results',results)) $$;
revoke all on function public.correct_inspection(jsonb,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.correct_inspection(jsonb,uuid,uuid,uuid,text,jsonb) to authenticated;
