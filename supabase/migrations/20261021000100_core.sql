create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  timezone text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  version integer not null default 1
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','manager','supervisor','technician','inventory')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (organization_id,user_id)
);
create index on public.organization_members(user_id,active);
create table private.pilot_onboarding_allowlist (
  user_id uuid primary key references auth.users(id),
  email text not null,
  allowed_organization_count integer not null check (allowed_organization_count between 1 and 3),
  consumed_count integer not null default 0 check (consumed_count >= 0),
  consumed_at timestamptz
);
create table private.invitation_key (
  singleton boolean primary key default true check (singleton),
  key bytea not null
);
insert into private.invitation_key(key) values (extensions.gen_random_bytes(32));
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email text not null check (email=lower(trim(email)) and length(email) <= 254),
  role text not null check (role in ('manager','supervisor','technician','inventory')),
  inviter_id uuid not null references auth.users(id),
  token_hash text not null unique,
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id,id)
);
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 200),
  unique(organization_id,id), unique(organization_id,name)
);
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null check (length(trim(code)) between 1 and 100),
  name text not null check (length(trim(name)) between 1 and 200),
  category text not null check (length(trim(category)) between 1 and 100),
  site_id uuid,
  serial_number text check (length(serial_number) <= 200),
  registration text check (length(registration) <= 200),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id,id), unique(organization_id,code),
  foreign key (organization_id,site_id) references public.sites(organization_id,id)
);
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  asset_id uuid not null,
  reporter_id uuid not null references auth.users(id),
  description text not null check (length(trim(description)) between 1 and 4000),
  category text not null check (length(trim(category)) between 1 and 100),
  status text not null default 'draft' check (status in ('draft','submitted','returned','converted','rejected','withdrawn')),
  transition_reason text,
  converted_work_order_id uuid,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id,id),
  foreign key (organization_id,asset_id) references public.assets(organization_id,id)
);
create index on public.maintenance_requests(organization_id,reporter_id,created_at,id);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  number integer not null,
  asset_id uuid not null,
  source_request_id uuid,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 4000),
  category text not null check (length(trim(category)) between 1 and 100),
  priority text not null check (priority in ('low','normal','high','critical')),
  due_at timestamptz,
  supervisor_id uuid not null references auth.users(id),
  status text not null default 'draft' check (status='draft'),
  blocks_operation boolean not null default true check (blocks_operation),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id,id), unique(organization_id,number), unique(organization_id,source_request_id),
  foreign key (organization_id,asset_id) references public.assets(organization_id,id),
  foreign key (organization_id,source_request_id) references public.maintenance_requests(organization_id,id)
);
create table public.work_order_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_order_id uuid not null,
  user_id uuid not null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id),
  foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id)
);
create unique index on public.work_order_assignments(organization_id,work_order_id,user_id) where unassigned_at is null;
create table public.request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null,
  status text not null,
  reason text,
  created_at timestamptz not null default now(),
  foreign key(organization_id,request_id) references public.maintenance_requests(organization_id,id)
);
alter table public.maintenance_requests add foreign key (organization_id,converted_work_order_id) references public.work_orders(organization_id,id);
create index on public.work_orders(organization_id,asset_id,created_at,id);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  entity_id uuid not null,
  request_id uuid not null,
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create table private.command_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  organization_id uuid references public.organizations(id),
  action text not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct(organization_id,actor_id,request_id)
);
create index on private.command_receipts(organization_id,created_at);

create function private.member_role(org uuid) returns text
language sql stable security definer set search_path='' as $$
  select role from public.organization_members where organization_id=org and user_id=auth.uid() and active
$$;
create function private.operations(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(private.member_role(org) in ('owner','manager','supervisor'),false)
$$;
create function private.known_asset(org uuid, asset uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.member_role(org)='technician' and exists (
    select 1 from public.maintenance_requests where organization_id=org and asset_id=asset and reporter_id=auth.uid()
    union all
    select 1 from public.work_orders w join public.work_order_assignments a on a.organization_id=w.organization_id and a.work_order_id=w.id where w.organization_id=org and w.asset_id=asset and a.user_id=auth.uid() and a.unassigned_at is null
  )
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.sites enable row level security;
alter table public.assets enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.work_orders enable row level security;
alter table public.audit_logs enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.request_events enable row level security;
create policy organizations_read on public.organizations for select to authenticated using (private.member_role(id) is not null);
create policy members_read on public.organization_members for select to authenticated using (private.member_role(organization_id)='owner' or (user_id=auth.uid() and private.member_role(organization_id) is not null));
create policy invitations_read on public.organization_invitations for select to authenticated using (private.member_role(organization_id)='owner');
create policy sites_read on public.sites for select to authenticated using (private.operations(organization_id));
create policy assets_read on public.assets for select to authenticated using (private.operations(organization_id) or private.known_asset(organization_id,id));
create policy requests_read on public.maintenance_requests for select to authenticated using (private.operations(organization_id) or (reporter_id=auth.uid() and private.member_role(organization_id) is not null));
create policy work_orders_read on public.work_orders for select to authenticated using (private.operations(organization_id) or (private.member_role(organization_id)='technician' and exists(select 1 from public.work_order_assignments a where a.organization_id=work_orders.organization_id and a.work_order_id=work_orders.id and a.user_id=auth.uid() and a.unassigned_at is null)));
create policy assignments_read on public.work_order_assignments for select to authenticated using (private.operations(organization_id) or (user_id=auth.uid() and private.member_role(organization_id)='technician'));
create policy events_read on public.request_events for select to authenticated using (exists(select 1 from public.maintenance_requests r where r.organization_id=request_events.organization_id and r.id=request_events.request_id));
create policy audit_read on public.audit_logs for select to authenticated using (private.member_role(organization_id)='owner');
revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations,public.organization_members,public.sites,public.assets,public.maintenance_requests,public.work_orders,public.work_order_assignments,public.request_events,public.audit_logs to authenticated;
-- Only owners see invitation metadata; the token hash is never exposed to clients.
grant select(id,organization_id,email,role,inviter_id,expires_at,accepted_at,revoked_at,created_at,version) on public.organization_invitations to authenticated;
grant all on all tables in schema public to service_role;
revoke all on all tables in schema private from public,anon,authenticated,service_role;

create function private.object_fields(value jsonb, allowed text[]) returns void
language plpgsql set search_path='' as $$
#variable_conflict use_variable
begin
  if value is null or jsonb_typeof(value)<>'object' or exists(select 1 from jsonb_object_keys(value) k where not(k=any(allowed))) then
    raise exception using message='VALIDATION';
  end if;
end $$;
create function private.confirmed_actor() returns uuid
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and deleted_at is null) then
    raise exception using message='FORBIDDEN';
  end if;
  return actor;
end $$;
create function private.token_for(org uuid, actor uuid, request uuid) returns text
language sql security definer set search_path='' as $$
  select encode(extensions.hmac(convert_to(org::text||':'||actor::text||':'||request::text,'UTF8'),key,'sha256'),'hex') from private.invitation_key
$$;
create function private.finish_command(org uuid, actor uuid, request uuid, action text, payload jsonb, data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare result jsonb:=jsonb_build_object('data',data,'version',coalesce((data->>'version')::integer,1),'request_id',request);
begin
  insert into private.command_receipts(actor_id,request_id,organization_id,action,payload_hash,result)
    values(actor,request,case when action='create_organization' then null else org end,action,encode(extensions.digest(payload::text,'sha256'),'hex'),result);
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes)
    values(org,actor,action,(data->>'id')::uuid,request,jsonb_strip_nulls(jsonb_build_object('status',data->'status','role',data->'role','active',data->'active','version',data->'version','archived_at',data->'archived_at')));
  return result;
end $$;
create function private.replay(org uuid, actor uuid, request uuid, action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare receipt private.command_receipts;
begin
  select * into receipt from private.command_receipts where organization_id is not distinct from org and actor_id=actor and request_id=request;
  if not found then return null; end if;
  if receipt.action<>action or receipt.payload_hash<>encode(extensions.digest(payload::text,'sha256'),'hex') then
    raise exception using message='CONFLICT';
  end if;
  return receipt.result;
end $$;
create function private.rate_check(org uuid, actor uuid, action text) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
begin
  if (select count(*) from private.command_receipts where organization_id=org and created_at>=date_trunc('day',now()))>=5000
    or (select count(*) from private.command_receipts where actor_id=actor and created_at>now()-interval '1 minute')>=60
    or (action='create_organization_invitation' and (select count(*) from private.command_receipts where organization_id=org and command_receipts.action='create_organization_invitation' and created_at>=date_trunc('day',now()))>=100) then
    raise exception using message='RATE_LIMITED';
  end if;
end $$;

create function public.create_organization(name text, timezone text, currency text, request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare actor uuid:=private.confirmed_actor(); allowance private.pilot_onboarding_allowlist; org public.organizations; result jsonb;
  payload jsonb:=jsonb_build_object('name',name,'timezone',timezone,'currency',currency);
begin
  perform 1 from auth.users where id=actor for update;
  perform private.confirmed_actor();
  result:=private.replay(null,actor,request_id,'create_organization',payload);
  if result is not null then return result; end if;
  if request_id is null or length(trim(name)) not between 1 and 200 or timezone is null
    or not exists(select 1 from pg_timezone_names where pg_timezone_names.name=timezone)
    or currency is null or currency!~'^[A-Z]{3}$' then raise exception using message='VALIDATION'; end if;
  select * into allowance from private.pilot_onboarding_allowlist where user_id=actor for update;
  if not found or allowance.consumed_count>=allowance.allowed_organization_count or
    allowance.email<>(select lower(email) from auth.users where id=actor) then raise exception using message='FORBIDDEN'; end if;
  insert into public.organizations(name,timezone,currency,created_by) values(trim(name),timezone,currency,actor) returning * into org;
  insert into public.organization_members(organization_id,user_id,role) values(org.id,actor,'owner');
  update private.pilot_onboarding_allowlist set consumed_count=consumed_count+1,consumed_at=now() where user_id=actor;
  return private.finish_command(org.id,actor,request_id,'create_organization',payload,to_jsonb(org));
exception when invalid_text_representation or check_violation or not_null_violation then raise exception using message='VALIDATION';
  when lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
  when others then
    if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied actor=% code=%',actor,SQLERRM; end if;
    if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','CONFLICT','RATE_LIMITED','VALIDATION') then raise; end if;
    raise log 'opspilot_command_failure state=%',SQLSTATE;
    raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function private.core_command(ctx jsonb, action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); org uuid; request uuid; expected integer; role text; result jsonb; data jsonb;
  asset public.assets; req public.maintenance_requests; wo public.work_orders; invite public.organization_invitations;
  member public.organization_members; fields jsonb; token text; target uuid; target_role text; target_active boolean;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
  if ctx?'expected_version' and jsonb_typeof(ctx->'expected_version')<>'number' then raise exception using message='VALIDATION'; end if;
  org:=(ctx->>'organization_id')::uuid; request:=(ctx->>'request_id')::uuid; expected:=(ctx->>'expected_version')::integer;
  if org is null or request is null or expected<=0 then raise exception using message='VALIDATION'; end if;
  -- Serialize tenant writes at pilot scale; recheck membership after the lock.
  perform 1 from public.organizations where id=org for update;
  role:=private.member_role(org);
  if role is null then raise exception using message='FORBIDDEN'; end if;
  if action in ('create_organization_invitation','revoke_organization_invitation','set_organization_member','transfer_organization_ownership') and role<>'owner' then raise exception using message='FORBIDDEN'; end if;
  if action in ('save_asset','triage_request','convert_request','create_work_order','assign_work_order') and role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN'; end if;
  result:=private.replay(org,actor,request,action,payload||jsonb_build_object('ctx',ctx));
  if result is not null then
    if action='create_organization_invitation' then
      token:=private.token_for(org,actor,request);
      if not exists(select 1 from public.organization_invitations where id=(result#>>'{data,id}')::uuid and organization_id=org and accepted_at is null and revoked_at is null and expires_at>now() and token_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception using message='INVALID_TRANSITION'; end if;
      result:=jsonb_set(result,'{data,token}',to_jsonb(token));
    end if;
    return result;
  end if;
  perform private.rate_check(org,actor,action);

  case action
  when 'create_organization_invitation' then
    target_role:=payload->>'role';
    if target_role not in ('manager','supervisor','technician','inventory') or target_role is null
      or payload->>'email' is null or length(payload->>'email')>254 or (payload->>'email')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using message='VALIDATION'; end if;
    if (select count(*) from public.organization_members where organization_id=org and active)>=30 then raise exception using message='RATE_LIMITED'; end if;
    update public.organization_invitations set revoked_at=now(),version=version+1
      where organization_id=org and email=lower(trim(payload->>'email')) and accepted_at is null and revoked_at is null;
    token:=private.token_for(org,actor,request);
    insert into public.organization_invitations(organization_id,email,role,inviter_id,token_hash)
      values(org,lower(trim(payload->>'email')),target_role,actor,encode(extensions.digest(token,'sha256'),'hex')) returning * into invite;
    data:=to_jsonb(invite)-'token_hash';
  when 'revoke_organization_invitation' then
    select * into invite from public.organization_invitations where id=(payload->>'invitation_id')::uuid and organization_id=org for update;
    if not found then raise exception using message='NOT_FOUND'; end if;
    if invite.accepted_at is not null then raise exception using message='INVALID_TRANSITION'; end if;
    update public.organization_invitations set revoked_at=coalesce(revoked_at,now()),version=version+1 where id=invite.id returning * into invite;
    data:=to_jsonb(invite)-'token_hash';
  when 'set_organization_member' then
    target:=(payload->>'user_id')::uuid; target_role:=payload->>'role'; target_active:=(payload->>'active')::boolean;
    if target_role is null or target_role not in ('owner','manager','supervisor','technician','inventory') or target_active is null then raise exception using message='VALIDATION'; end if;
    select * into member from public.organization_members where organization_id=org and user_id=target for update;
    if not found then raise exception using message='NOT_FOUND'; end if;
    if expected is not null and member.version<>expected then raise exception using message='CONFLICT'; end if;
    if member.role='owner' and member.active and (not target_active or target_role<>'owner') and
      (select count(*) from public.organization_members where organization_id=org and organization_members.role='owner' and active)<=1 then raise exception using message='CONFLICT'; end if;
    if member.role<>'owner' and target_role='owner' then raise exception using message='FORBIDDEN'; end if;
    update public.organization_members set role=target_role,active=target_active,version=version+1 where organization_id=org and user_id=target returning * into member;
    data:=to_jsonb(member)||jsonb_build_object('id',member.user_id);
  when 'transfer_organization_ownership' then
    perform private.confirmed_actor();
    target:=(payload->>'new_owner_id')::uuid;
    select * into member from public.organization_members where organization_id=org and user_id=target and active for update;
    if not found then raise exception using message='NOT_FOUND'; end if;
    if member.role='owner' then raise exception using message='CONFLICT'; end if;
    if not exists(select 1 from auth.users where id=target and email_confirmed_at is not null and deleted_at is null) then raise exception using message='FORBIDDEN'; end if;
    update public.organization_members set role='manager',version=version+1 where organization_id=org and user_id=actor;
    update public.organization_members set role='owner',version=version+1 where organization_id=org and user_id=target returning * into member;
    data:=to_jsonb(member)||jsonb_build_object('id',target);
  when 'save_asset' then
    fields:=payload->'fields';
    perform private.object_fields(fields,array['code','name','category','site_id','serial_number','registration','archived']);
    if exists(select 1 from jsonb_each(fields) e where e.key<>'archived' and jsonb_typeof(e.value) not in ('string','null')) or (fields?'archived' and jsonb_typeof(fields->'archived')<>'boolean') then raise exception using message='VALIDATION'; end if;
    target:=(payload->>'asset_id')::uuid;
    if target is not null then
      select * into asset from public.assets where id=target and organization_id=org for update;
      if not found then raise exception using message='NOT_FOUND'; end if;
      if expected is null or expected<>asset.version then raise exception using message='CONFLICT'; end if;
    elsif (select count(*) from public.assets where organization_id=org)>=500 then raise exception using message='RATE_LIMITED';
    end if;
    if fields ? 'site_id' and fields->>'site_id' is not null and not exists(select 1 from public.sites where organization_id=org and id=(fields->>'site_id')::uuid) then raise exception using message='NOT_FOUND'; end if;
    if target is null then
      insert into public.assets(organization_id,code,name,category,site_id,serial_number,registration,archived_at,created_by)
        values(org,trim(fields->>'code'),trim(fields->>'name'),trim(fields->>'category'),(fields->>'site_id')::uuid,fields->>'serial_number',fields->>'registration',case when coalesce((fields->>'archived')::boolean,false) then now() end,actor) returning * into asset;
    else
      update public.assets set code=case when fields?'code' then trim(fields->>'code') else code end,
        name=case when fields?'name' then trim(fields->>'name') else name end,
        category=case when fields?'category' then trim(fields->>'category') else category end,
        site_id=case when fields?'site_id' then (fields->>'site_id')::uuid else site_id end,
        serial_number=case when fields?'serial_number' then fields->>'serial_number' else serial_number end,
        registration=case when fields?'registration' then fields->>'registration' else registration end,
        archived_at=case when fields?'archived' then case when (fields->>'archived')::boolean then coalesce(archived_at,now()) else null end else archived_at end,
        version=version+1 where id=target returning * into asset;
    end if;
    data:=to_jsonb(asset);
  when 'create_work_order' then
    fields:=payload->'fields';
    perform private.object_fields(fields,array['title','description','category','priority','supervisor_id','due_at']);
    if exists(select 1 from jsonb_each(fields) e where jsonb_typeof(e.value) not in ('string','null')) then raise exception using message='VALIDATION'; end if;
    if not exists(select 1 from public.assets where organization_id=org and id=(payload->>'asset_id')::uuid and archived_at is null) then raise exception using message='NOT_FOUND'; end if;
    target:=coalesce((fields->>'supervisor_id')::uuid,actor);
    if not exists(select 1 from public.organization_members where organization_id=org and user_id=target and active and organization_members.role in ('owner','manager','supervisor')) then raise exception using message='VALIDATION'; end if;
    if (select count(*) from public.work_orders where organization_id=org)>=10000 then raise exception using message='RATE_LIMITED'; end if;
    insert into public.work_orders(organization_id,number,asset_id,title,description,category,priority,supervisor_id,due_at,created_by)
      values(org,(select coalesce(max(number),0)+1 from public.work_orders where organization_id=org),(payload->>'asset_id')::uuid,trim(fields->>'title'),trim(fields->>'description'),trim(fields->>'category'),fields->>'priority',target,(fields->>'due_at')::timestamptz,actor) returning * into wo;
    data:=to_jsonb(wo);
  when 'assign_work_order' then
    select * into wo from public.work_orders where organization_id=org and id=(payload->>'id')::uuid for update;
    if not found then raise exception using message='NOT_FOUND'; end if;
    if expected is null or expected<>wo.version then raise exception using message='CONFLICT'; end if;
    if jsonb_typeof(payload->'user_ids')<>'array' or jsonb_array_length(payload->'user_ids')>30 then raise exception using message='VALIDATION'; end if;
    if exists(select 1 from jsonb_array_elements_text(payload->'user_ids') u where not exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=u::uuid and m.active and m.role in ('owner','manager','supervisor','technician'))) then raise exception using message='VALIDATION'; end if;
    update public.work_order_assignments set unassigned_at=now() where organization_id=org and work_order_id=wo.id and unassigned_at is null;
    insert into public.work_order_assignments(organization_id,work_order_id,user_id) select org,wo.id,u::uuid from (select distinct jsonb_array_elements_text(payload->'user_ids') as u) ids;
    update public.work_orders set version=version+1 where id=wo.id returning * into wo;
    data:=to_jsonb(wo);
  when 'save_request' then
    target:=(payload->>'id')::uuid;
    if not exists(select 1 from public.assets where organization_id=org and id=(payload->>'asset_id')::uuid and archived_at is null) then raise exception using message='NOT_FOUND'; end if;
    if target is null then
      insert into public.maintenance_requests(organization_id,asset_id,reporter_id,description,category)
        values(org,(payload->>'asset_id')::uuid,actor,trim(payload->>'description'),trim(payload->>'category')) returning * into req;
    else
      select * into req from public.maintenance_requests where id=target and organization_id=org for update;
      if not found then raise exception using message='NOT_FOUND'; end if;
      if req.reporter_id<>actor then raise exception using message='FORBIDDEN'; end if;
      if req.status not in ('draft','returned') then raise exception using message='INVALID_TRANSITION'; end if;
      if expected is null or expected<>req.version then raise exception using message='CONFLICT'; end if;
      update public.maintenance_requests set asset_id=(payload->>'asset_id')::uuid,description=trim(payload->>'description'),category=trim(payload->>'category'),version=version+1 where id=target returning * into req;
    end if;
    data:=to_jsonb(req);
  when 'submit_request','withdraw_request','triage_request','convert_request' then
    select * into req from public.maintenance_requests where id=(payload->>'id')::uuid and organization_id=org for update;
    if not found then raise exception using message='NOT_FOUND'; end if;
    if action in ('submit_request','withdraw_request') and req.reporter_id<>actor then raise exception using message='FORBIDDEN'; end if;
    if expected is not null and expected<>req.version then raise exception using message='CONFLICT'; end if;
    if action='convert_request' then
      if req.converted_work_order_id is not null then
        select * into wo from public.work_orders where id=req.converted_work_order_id and organization_id=org;
      else
        if req.status<>'submitted' then raise exception using message='INVALID_TRANSITION'; end if;
        if (select count(*) from public.work_orders where organization_id=org)>=10000 then raise exception using message='RATE_LIMITED'; end if;
        fields:=payload->'work_order_fields'; perform private.object_fields(fields,array['title','priority']);
        if exists(select 1 from jsonb_each(fields) e where jsonb_typeof(e.value)<>'string') then raise exception using message='VALIDATION'; end if;
        insert into public.work_orders(organization_id,number,asset_id,source_request_id,title,description,category,priority,supervisor_id,created_by)
          values(org,(select coalesce(max(number),0)+1 from public.work_orders where organization_id=org),req.asset_id,req.id,trim(fields->>'title'),req.description,req.category,fields->>'priority',actor,actor) returning * into wo;
        update public.maintenance_requests set status='converted',converted_work_order_id=wo.id,version=version+1 where id=req.id;
      end if;
      data:=to_jsonb(wo);
    else
      if action='submit_request' then
        if req.status not in ('draft','returned') then raise exception using message='INVALID_TRANSITION'; end if;
        req.status:='submitted'; req.transition_reason:=null;
      else
        if payload->>'reason' is null or length(trim(payload->>'reason')) not between 1 and 4000 then raise exception using message='VALIDATION'; end if;
        if action='withdraw_request' then
          if req.status not in ('draft','submitted','returned') then raise exception using message='INVALID_TRANSITION'; end if;
          req.status:='withdrawn';
        else
          if req.status<>'submitted' then raise exception using message='INVALID_TRANSITION'; end if;
          if payload->>'decision' is null or payload->>'decision' not in ('returned','rejected') then raise exception using message='VALIDATION'; end if;
          req.status:=payload->>'decision';
        end if;
        req.transition_reason:=trim(payload->>'reason');
      end if;
      update public.maintenance_requests set status=req.status,transition_reason=req.transition_reason,version=version+1 where id=req.id returning * into req;
      data:=to_jsonb(req);
    end if;
  else raise exception using message='VALIDATION';
  end case;
  if action in ('save_request','submit_request','withdraw_request','triage_request','convert_request') then
    select * into req from public.maintenance_requests where organization_id=org and id=coalesce(req.id,(payload->>'id')::uuid);
    insert into public.request_events(organization_id,request_id,actor_id,action,status,reason) values(org,req.id,actor,action,req.status,req.transition_reason);
  end if;
  result:=private.finish_command(org,actor,request,action,payload||jsonb_build_object('ctx',ctx),data);
  if action='create_organization_invitation' then result:=jsonb_set(result,'{data,token}',to_jsonb(token)); end if;
  return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation or not_null_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
  when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
  when foreign_key_violation then raise exception using message='NOT_FOUND';
  when others then
    if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=% actor=% tenant=% code=%',action,actor,org,SQLERRM; end if;
    if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','VALIDATION','CONFLICT','INVALID_TRANSITION','RATE_LIMITED') then raise; end if;
    raise log 'opspilot_command_failure action=% state=%',action,SQLSTATE;
    raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function public.accept_organization_invitation(token text, request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare actor uuid:=private.confirmed_actor(); invite public.organization_invitations; member public.organization_members;
  org uuid; result jsonb; payload jsonb:=jsonb_build_object('token_hash',encode(extensions.digest(token,'sha256'),'hex'));
begin
  if token is null or token!~'^[a-f0-9]{64}$' or request_id is null then raise exception using message='VALIDATION'; end if;
  select organization_id into org from public.organization_invitations where token_hash=payload->>'token_hash';
  if org is null then raise exception using message='FORBIDDEN'; end if;
  perform 1 from public.organizations where id=org for update;
  select * into invite from public.organization_invitations where token_hash=payload->>'token_hash' for update;
  perform private.confirmed_actor();
  if invite.email<>(select lower(email) from auth.users where id=actor) then raise exception using message='FORBIDDEN'; end if;
  result:=private.replay(org,actor,request_id,'accept_organization_invitation',payload);
  if result is not null then
    if private.member_role(org) is null then raise exception using message='FORBIDDEN'; end if;
    return result;
  end if;
  if invite.accepted_at is not null or invite.revoked_at is not null or invite.expires_at<=now()
    or not exists(select 1 from public.organization_members where organization_id=org and user_id=invite.inviter_id and role='owner' and active) then raise exception using message='FORBIDDEN'; end if;
  if (select count(*) from public.organization_members where organization_id=org and active)>=30 then raise exception using message='RATE_LIMITED'; end if;
  if exists(select 1 from public.organization_members where organization_id=org and user_id=actor and active) then raise exception using message='CONFLICT'; end if;
  perform private.rate_check(org,actor,'accept_organization_invitation');
  insert into public.organization_members(organization_id,user_id,role) values(org,actor,invite.role)
    on conflict(organization_id,user_id) do update set role=excluded.role,active=true,version=organization_members.version+1 returning * into member;
  update public.organization_invitations set accepted_at=now(),version=version+1 where id=invite.id;
  return private.finish_command(org,actor,request_id,'accept_organization_invitation',payload,to_jsonb(member)||jsonb_build_object('id',actor));
exception when invalid_text_representation or check_violation or not_null_violation then raise exception using message='VALIDATION';
  when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
  when others then
    if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=accept_invitation actor=% tenant=% code=%',actor,org,SQLERRM; end if;
    if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','VALIDATION','CONFLICT','RATE_LIMITED') then raise; end if;
    raise log 'opspilot_command_failure action=accept_invitation state=%',SQLSTATE;
    raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function public.lookup_request_asset(organization_id uuid, code text default null, asset_id uuid default null)
returns table(id uuid,code text,name text) language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  if private.member_role(organization_id) is null then raise exception using message='FORBIDDEN'; end if;
  if (code is null)=(asset_id is null) or (code is not null and length(trim(code)) not between 1 and 100) then raise exception using message='VALIDATION'; end if;
  return query select a.id,a.code,a.name from public.assets a where a.organization_id=lookup_request_asset.organization_id and a.archived_at is null
    and ((asset_id is not null and a.id=asset_id) or (code is not null and a.code=trim(lookup_request_asset.code))) limit 1;
  if not found then raise exception using message='NOT_FOUND'; end if;
end $$;

create function public.create_organization_invitation(ctx jsonb,email text,role text) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'create_organization_invitation',jsonb_build_object('email',email,'role',role)) $$;
create function public.revoke_organization_invitation(ctx jsonb,invitation_id uuid) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'revoke_organization_invitation',jsonb_build_object('invitation_id',invitation_id)) $$;
create function public.set_organization_member(ctx jsonb,user_id uuid,role text,active boolean) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'set_organization_member',jsonb_build_object('user_id',user_id,'role',role,'active',active)) $$;
create function public.transfer_organization_ownership(ctx jsonb,new_owner_id uuid) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'transfer_organization_ownership',jsonb_build_object('new_owner_id',new_owner_id)) $$;
create function public.save_asset(ctx jsonb,asset_id uuid,fields jsonb) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'save_asset',jsonb_build_object('asset_id',asset_id,'fields',fields)) $$;
create function public.save_request(ctx jsonb,id uuid,asset_id uuid,description text,category text) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'save_request',jsonb_build_object('id',id,'asset_id',asset_id,'description',description,'category',category)) $$;
create function public.create_work_order(ctx jsonb,asset_id uuid,fields jsonb) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'create_work_order',jsonb_build_object('asset_id',asset_id,'fields',fields)) $$;
create function public.assign_work_order(ctx jsonb,id uuid,user_ids uuid[]) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'assign_work_order',jsonb_build_object('id',id,'user_ids',user_ids)) $$;
create function public.submit_request(ctx jsonb,id uuid) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'submit_request',jsonb_build_object('id',id)) $$;
create function public.withdraw_request(ctx jsonb,id uuid,reason text) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'withdraw_request',jsonb_build_object('id',id,'reason',reason)) $$;
create function public.triage_request(ctx jsonb,id uuid,decision text,reason text) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'triage_request',jsonb_build_object('id',id,'decision',decision,'reason',reason)) $$;
create function public.convert_request(ctx jsonb,id uuid,work_order_fields jsonb) returns jsonb language sql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s'
as $$ select private.core_command(ctx,'convert_request',jsonb_build_object('id',id,'work_order_fields',work_order_fields)) $$;

revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.member_role(uuid),private.operations(uuid),private.known_asset(uuid,uuid) to authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.create_organization(text,text,text,uuid),public.accept_organization_invitation(text,uuid),public.lookup_request_asset(uuid,text,uuid),
  public.create_organization_invitation(jsonb,text,text),public.revoke_organization_invitation(jsonb,uuid),public.set_organization_member(jsonb,uuid,text,boolean),
  public.transfer_organization_ownership(jsonb,uuid),public.save_asset(jsonb,uuid,jsonb),public.save_request(jsonb,uuid,uuid,text,text),public.submit_request(jsonb,uuid),public.withdraw_request(jsonb,uuid,text),
  public.create_work_order(jsonb,uuid,jsonb),public.assign_work_order(jsonb,uuid,uuid[]),public.triage_request(jsonb,uuid,text,text),public.convert_request(jsonb,uuid,jsonb) to authenticated;
-- An unauthenticated call reaches the safe domain error instead of table access.
grant execute on function public.create_organization(text,text,text,uuid) to anon;
