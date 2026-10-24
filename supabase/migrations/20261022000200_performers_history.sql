-- Explicit declarations add facts; they never replace conservative assignment/action participation.
create table public.work_order_performer_declarations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,work_order_id uuid not null,
 user_id uuid not null references auth.users(id),declared_by uuid not null references auth.users(id),request_id uuid not null,
 repair_revision integer not null,created_at timestamptz not null default now(),
 unique(organization_id,work_order_id,user_id),
 foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id),
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id)
);
create table public.work_order_submission_attestations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,work_order_id uuid not null,
 actor_id uuid not null references auth.users(id),request_id uuid not null,repair_revision integer not null,
 performer_ids uuid[] not null check(cardinality(performer_ids)>0),acknowledgment text not null check(length(trim(acknowledgment)) between 1 and 2000),
 created_at timestamptz not null default now(),unique(organization_id,actor_id,request_id),
 foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id)
);
create trigger immutable_history before update or delete on public.work_order_performer_declarations for each row execute function private.immutable_history();
create trigger immutable_history before update or delete on public.work_order_submission_attestations for each row execute function private.immutable_history();
alter table public.work_order_performer_declarations enable row level security;
alter table public.work_order_submission_attestations enable row level security;
revoke all on public.work_order_performer_declarations,public.work_order_submission_attestations from public,anon,authenticated;
grant select on public.work_order_performer_declarations,public.work_order_submission_attestations to authenticated;
grant all on public.work_order_performer_declarations,public.work_order_submission_attestations to service_role;
create policy declared_read on public.work_order_performer_declarations for select to authenticated using(private.can_read_work(organization_id,work_order_id));
create policy attested_read on public.work_order_submission_attestations for select to authenticated using(private.can_read_work(organization_id,work_order_id));
create function private.require_performer_attestation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('awaiting_review','completed') and not exists(select 1 from public.work_order_submission_attestations where organization_id=new.organization_id and work_order_id=new.id and repair_revision=new.repair_revision) then raise exception using message='INVALID_TRANSITION'; end if;
 return new;
end $$;
create trigger performer_attestation_required before insert or update on public.work_orders for each row execute function private.require_performer_attestation();

alter function private.operational_command(jsonb,text,jsonb) rename to operational_command_base;
create function private.operational_command(ctx jsonb,action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid; actor uuid:=auth.uid(); request uuid; expected integer; role text; job public.work_orders; asset public.assets;
 result jsonb; ids uuid[]; acknowledgment text; event uuid;
begin
 if action<>'declare_work_order_performers' and not (action='transition_work_order' and payload->>'target'='awaiting_review') then return private.operational_command_base(ctx,action,payload); end if;
 if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 org:=(ctx->>'organization_id')::uuid;request:=(ctx->>'request_id')::uuid;expected:=(ctx->>'expected_version')::integer;
 if org is null or request is null or expected is null or expected<=0 or jsonb_typeof(ctx->'expected_version')<>'number' then raise exception using message='VALIDATION'; end if;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org);
 if role is null or not private.can_read_work(org,(payload->>'id')::uuid) then raise exception using message='FORBIDDEN'; end if;
 if role not in ('owner','manager','supervisor','technician') then raise exception using message='FORBIDDEN'; end if;
 select * into job from public.work_orders where organization_id=org and id=(payload->>'id')::uuid;
 select * into asset from public.assets where organization_id=org and id=job.asset_id for update;
 perform 1 from public.work_orders where organization_id=org and asset_id=asset.id order by id for update;
 select * into job from public.work_orders where organization_id=org and id=job.id;
 result:=private.replay(org,actor,request,action,payload||jsonb_build_object('ctx',ctx));
 if result is not null then return result; end if;
 if job.version<>expected then raise exception using message='CONFLICT'; end if;
 if job.status<>'in_progress' or asset.archived_at is not null then raise exception using message='INVALID_TRANSITION'; end if;
 if action='declare_work_order_performers' then
  perform private.rate_check(org,actor,action);
  if jsonb_typeof(payload->'user_ids') is distinct from 'array' or jsonb_array_length(payload->'user_ids') not between 1 and 30 then raise exception using message='VALIDATION'; end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(payload->'user_ids');
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or exists(select 1 from unnest(ids) id where not exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=id and m.active and private.auth_user_active(id))) then raise exception using message='VALIDATION'; end if;
  if (select count(*) from public.work_order_performer_declarations where organization_id=org and work_order_id=job.id and not(user_id=any(ids)))+cardinality(ids)>30 then raise exception using message='RATE_LIMITED'; end if;
  update public.work_orders set repair_revision=repair_revision+1,submitted_revision=null,version=version+1 where id=job.id returning * into job;
  insert into public.work_order_performer_declarations(organization_id,work_order_id,user_id,declared_by,request_id,repair_revision)
   select org,job.id,id,actor,request,job.repair_revision from unnest(ids) id on conflict(organization_id,work_order_id,user_id) do nothing;
  perform private.participant(org,job.id,id,'declared_performer') from unnest(ids) id;
  insert into public.work_order_events(organization_id,work_order_id,actor_id,request_id,action,status,repair_revision,changes)
   values(org,job.id,actor,request,action,job.status,job.repair_revision,jsonb_build_object('performer_ids',ids)) returning id into event;
  return private.finish_command(org,actor,request,action,payload||jsonb_build_object('ctx',ctx),to_jsonb(job));
 end if;
 acknowledgment:=trim(payload->>'performer_acknowledgment');
 select array_agg(user_id order by user_id) into ids from public.work_order_performer_declarations where organization_id=org and work_order_id=job.id;
 if acknowledgment is null or length(acknowledgment) not between 1 and 2000 or coalesce(cardinality(ids),0)=0 or not(actor=any(ids)) then raise exception using message='INVALID_TRANSITION'; end if;
 -- The ordinary submission command performs all task/evidence checks in this same transaction.
 insert into public.work_order_submission_attestations(organization_id,work_order_id,actor_id,request_id,repair_revision,performer_ids,acknowledgment)
 values(org,job.id,actor,request,job.repair_revision,ids,acknowledgment);
 return private.operational_command_base(ctx,action,payload);
exception when invalid_text_representation or not_null_violation or check_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
 when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
 when foreign_key_violation then raise exception using message='NOT_FOUND';
end $$;
create function public.declare_work_order_performers(ctx jsonb,id uuid,user_ids uuid[]) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'declare_work_order_performers',jsonb_build_object('id',id,'user_ids',user_ids)) $$;
create function public.submit_work_order(ctx jsonb,id uuid,acknowledgment text) returns jsonb language sql security definer set search_path='' as $$ select private.operational_command(ctx,'transition_work_order',jsonb_build_object('id',id,'target','awaiting_review','reason',null,'performer_acknowledgment',acknowledgment)) $$;

create function public.get_asset_history(organization_id uuid,asset_id uuid,cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare org uuid:=organization_id; asset uuid:=asset_id; role text; page jsonb; next_cursor jsonb; at timestamptz; after_id uuid;
begin
 role:=private.member_role(org);
 if role is null or not (private.operations(org) or (role='technician' and private.known_asset(org,asset))) then raise exception using message='FORBIDDEN'; end if;
 if not exists(select 1 from public.assets where assets.organization_id=org and id=asset) then raise exception using message='NOT_FOUND'; end if;
 if cursor is not null then
  perform private.object_fields(cursor,array['at','id']);at:=(cursor->>'at')::timestamptz;after_id:=(cursor->>'id')::uuid;
  if at is null or after_id is null then raise exception using message='VALIDATION'; end if;
 end if;
 with facts as (
  select e.id,e.created_at occurred_at,'work_order_event'::text kind,e.actor_id,e.work_order_id,e.action,e.status,e.note,e.repair_revision,null::text availability,null::boolean active
  from public.work_order_events e join public.work_orders w on w.organization_id=e.organization_id and w.id=e.work_order_id where e.organization_id=org and w.asset_id=asset and private.can_read_work(org,w.id)
  union all
  select r.id,r.created_at,'review',r.reviewer_id,r.work_order_id,r.decision,null,r.reason,r.repair_revision,null,null
  from public.work_order_reviews r join public.work_orders w on w.organization_id=r.organization_id and w.id=r.work_order_id where r.organization_id=org and w.asset_id=asset and private.can_read_work(org,w.id)
  union all
  select l.id,l.created_at,'availability',l.actor_id,null,l.action,null,null,null,l.changes->>'new_status',(l.changes->>'active')::boolean
  from public.audit_logs l where l.organization_id=org and l.entity_id=asset and l.action='asset.availability_changed' and private.operations(org)
  union all
  select r.id,r.created_at,'release',r.actor_id,null,'release',null,r.acknowledgment,null,'operational',true from public.asset_releases r where r.organization_id=org and r.asset_id=asset and private.operations(org)
 ), bounded as (select * from facts where at is null or (occurred_at,id)<(at,after_id) order by occurred_at desc,id desc limit 51), numbered as (select *,row_number() over(order by occurred_at desc,id desc) n from bounded)
 select coalesce(jsonb_agg(to_jsonb(numbered)-'n' order by occurred_at desc,id desc) filter(where n<=50),'[]'::jsonb),
 case when count(*)>50 then (select jsonb_build_object('at',occurred_at,'id',id) from numbered where n=50) end into page,next_cursor from numbered;
 return jsonb_build_object('items',page,'next_cursor',next_cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception using message='VALIDATION';
end $$;
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.member_role(uuid),private.operations(uuid),private.known_asset(uuid,uuid),private.can_read_work(uuid,uuid),private.can_read_attachment(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.declare_work_order_performers(jsonb,uuid,uuid[]),public.submit_work_order(jsonb,uuid,text),public.get_asset_history(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.declare_work_order_performers(jsonb,uuid,uuid[]),public.submit_work_order(jsonb,uuid,text),public.get_asset_history(uuid,uuid,jsonb) to authenticated;
-- Rebind existing SQL shims to the declaration-aware dispatcher after its rename.
do $$ declare item regprocedure; begin
 for item in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('update_work_order','transition_work_order','add_work_order_task','review_work_order','release_asset','set_asset_hold','resolve_asset_hold','record_meter_reading','correct_meter_reading','save_organization_settings','mark_notifications_read','reserve_attachment','reserve_record_attachment') loop execute pg_get_functiondef(item); end loop;
end $$;
