-- Exact stock commands share the existing tenant serialization/receipt boundary.
create table public.parts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 code text not null check(length(code) between 1 and 80), name text not null check(length(name) between 1 and 200),
 unit text not null check(length(unit) between 1 and 40), reorder_threshold numeric(14,3) check(reorder_threshold>=0), archived_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), version integer not null default 1 check(version>0),
 unique(organization_id,id), unique(organization_id,code)
);
create table public.stock_locations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 code text not null check(length(code) between 1 and 80), name text not null check(length(name) between 1 and 200),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), version integer not null default 1 check(version>0),
 unique(organization_id,id), unique(organization_id,code)
);
create table public.inventory_balances (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, part_id uuid not null, location_id uuid not null,
 on_hand numeric(14,3) not null default 0 check(on_hand>=0), reserved numeric(14,3) not null default 0 check(reserved>=0 and reserved<=on_hand),
 available numeric(14,3) generated always as (on_hand-reserved) stored,
 unique(organization_id,id), unique(organization_id,part_id,location_id),
 foreign key(organization_id,part_id) references public.parts(organization_id,id),
 foreign key(organization_id,location_id) references public.stock_locations(organization_id,id)
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, part_id uuid not null, location_id uuid not null,
 kind text not null check(kind in ('receipt','adjustment')), direction text not null check(direction in ('in','out')),
 quantity numeric(14,3) not null check(quantity>0), unit text not null check(length(unit) between 1 and 40),
 actor_id uuid not null references auth.users(id), request_id uuid not null, source text check(length(source) between 1 and 2000),
 reason text, correction_of uuid, created_at timestamptz not null default now(),
 check((kind='receipt' and direction='in' and reason is null and correction_of is null) or (kind='adjustment' and reason is not null and length(reason) between 1 and 2000)),
 unique(organization_id,id), unique(organization_id,actor_id,request_id), unique(organization_id,correction_of),
 foreign key(organization_id,part_id,location_id) references public.inventory_balances(organization_id,part_id,location_id),
 foreign key(organization_id,correction_of) references public.inventory_movements(organization_id,id)
);
create index on public.inventory_movements(organization_id,part_id,location_id,id);

create function private.inventory_text(value jsonb,maximum integer) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
 if jsonb_typeof(value) is distinct from 'string' then raise exception using message='VALIDATION'; end if;
 result:=btrim(value#>>'{}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
 if length(result) not between 1 and maximum then raise exception using message='VALIDATION'; end if;
 return result;
end $$;
create function private.stock_decimal(value jsonb,positive boolean) returns numeric language plpgsql immutable set search_path='' as $$
declare result numeric;
begin
 if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}')!~'^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$' then raise exception using message='VALIDATION'; end if;
 result:=(value#>>'{}')::numeric;
 if positive and result=0 then raise exception using message='VALIDATION'; end if;
 return result;
end $$;
create function private.inventory_unit_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.unit<>old.unit and exists(select 1 from public.inventory_movements where organization_id=old.organization_id and part_id=old.id) then raise exception using message='INVALID_TRANSITION'; end if;
 return new;
end $$;
create trigger inventory_unit_guard before update on public.parts for each row execute function private.inventory_unit_guard();
create trigger immutable_history before update or delete on public.inventory_movements for each row execute function private.immutable_history();

create function private.inventory_command(ctx jsonb,action text,fields jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
<<inventory_values>>
declare org uuid; actor uuid:=auth.uid(); request uuid; expected integer; role text; replayed jsonb; data jsonb;
 part public.parts; location public.stock_locations; balance public.inventory_balances; movement public.inventory_movements; original public.inventory_movements;
 target uuid; qty numeric; threshold numeric; direction text; unit text; reason text; source text; correction uuid; code text; name text;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 org:=(ctx->>'organization_id')::uuid;request:=(ctx->>'request_id')::uuid;
 if org is null or request is null or jsonb_typeof(ctx->'organization_id')<>'string' or jsonb_typeof(ctx->'request_id')<>'string' then raise exception using message='VALIDATION'; end if;
 if ctx?'expected_version' then
  if jsonb_typeof(ctx->'expected_version') is distinct from 'number' or (ctx->>'expected_version')!~'^[1-9][0-9]*$' then raise exception using message='VALIDATION'; end if;
  expected:=(ctx->>'expected_version')::integer;
 end if;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org);
 if role is null or role not in ('owner','inventory') then raise exception using message='FORBIDDEN'; end if;
 if action='adjust_stock' then perform private.aal2(); end if;
 replayed:=private.replay(org,actor,request,action,jsonb_build_object('ctx',ctx,'fields',fields));
 if replayed is not null then return replayed; end if;
 perform private.rate_check(org,actor,action);
 case action
 when 'save_part','save_stock_location' then
  if action='save_part' then perform private.object_fields(fields,array['id','code','name','unit','reorder_threshold','archived']);
  else perform private.object_fields(fields,array['id','code','name']); end if;
  target:=(fields->>'id')::uuid;
  if fields?'id' and (target is null or jsonb_typeof(fields->'id')<>'string') then raise exception using message='VALIDATION'; end if;
  code:=private.inventory_text(fields->'code',80);name:=private.inventory_text(fields->'name',200);
  if (target is null and expected is not null) or (target is not null and expected is null) then raise exception using message='VALIDATION'; end if;
  if action='save_part' then
   if fields?'archived' and jsonb_typeof(fields->'archived') is distinct from 'boolean' then raise exception using message='VALIDATION'; end if;
   unit:=private.inventory_text(fields->'unit',40);
   if not fields?'reorder_threshold' then raise exception using message='VALIDATION'; end if;
   if fields->'reorder_threshold'<>'null'::jsonb then threshold:=private.stock_decimal(fields->'reorder_threshold',false); end if;
   if target is null then
    insert into public.parts(organization_id,code,name,unit,reorder_threshold,archived_at,created_by) values(org,code,name,unit,threshold,case when coalesce((fields->>'archived')::boolean,false) then now() end,actor) returning * into part;
   else
    select * into part from public.parts where organization_id=org and id=target for update;
    if part.id is null then raise exception using message='NOT_FOUND'; end if;
    if part.version<>expected then raise exception using message='CONFLICT'; end if;
    update public.parts set code=inventory_values.code,name=inventory_values.name,unit=inventory_values.unit,reorder_threshold=threshold,
     archived_at=case when fields?'archived' then case when (fields->>'archived')::boolean then coalesce(archived_at,now()) else null end else archived_at end,version=version+1 where id=target returning * into part;
   end if;
   data:=to_jsonb(part)||jsonb_build_object('reorder_threshold',part.reorder_threshold::text);
  else
   if target is null then
    insert into public.stock_locations(organization_id,code,name,created_by) values(org,code,name,actor) returning * into location;
   else
    select * into location from public.stock_locations where organization_id=org and id=target for update;
    if location.id is null then raise exception using message='NOT_FOUND'; end if;
    if location.version<>expected then raise exception using message='CONFLICT'; end if;
    update public.stock_locations set code=inventory_values.code,name=inventory_values.name,version=version+1 where id=target returning * into location;
   end if;
   data:=to_jsonb(location);
  end if;
 when 'receive_stock','adjust_stock' then
  if expected is not null then raise exception using message='VALIDATION'; end if;
  if action='receive_stock' then perform private.object_fields(fields,array['part_id','location_id','quantity','unit','source']);
  else perform private.object_fields(fields,array['part_id','location_id','quantity','unit','source','direction','reason','correction_of']); end if;
  qty:=private.stock_decimal(fields->'quantity',true);unit:=private.inventory_text(fields->'unit',40);
  if fields?'source' then source:=private.inventory_text(fields->'source',2000); end if;
  direction:='in';
  if action='adjust_stock' then
   direction:=fields->>'direction';reason:=private.inventory_text(fields->'reason',2000);
   if direction is null or direction not in ('in','out') then raise exception using message='VALIDATION'; end if;
   correction:=(fields->>'correction_of')::uuid;
   if fields?'correction_of' and (correction is null or jsonb_typeof(fields->'correction_of')<>'string') then raise exception using message='VALIDATION'; end if;
  end if;
  select * into part from public.parts where organization_id=org and id=(fields->>'part_id')::uuid for update;
  select * into location from public.stock_locations where organization_id=org and id=(fields->>'location_id')::uuid;
  if part.id is null or location.id is null then raise exception using message='NOT_FOUND'; end if;
  if action='receive_stock' and part.archived_at is not null then raise exception using message='INVALID_TRANSITION'; end if;
  if unit<>part.unit then raise exception using message='VALIDATION'; end if;
  if correction is not null then
   select * into original from public.inventory_movements where organization_id=org and id=correction;
   if original.id is null then raise exception using message='NOT_FOUND'; end if;
   if original.part_id<>part.id or original.location_id<>location.id or original.unit<>unit or original.quantity<>qty or original.direction=direction then raise exception using message='VALIDATION'; end if;
   if exists(select 1 from public.inventory_movements where organization_id=org and correction_of=correction) then raise exception using message='CONFLICT'; end if;
  end if;
  insert into public.inventory_balances(organization_id,part_id,location_id) values(org,part.id,location.id) on conflict(organization_id,part_id,location_id) do nothing;
  select * into balance from public.inventory_balances where organization_id=org and part_id=part.id and location_id=location.id for update;
  if direction='out' and balance.available<qty then raise exception using message='CONFLICT'; end if;
  if direction='in' and balance.on_hand+qty>99999999999.999 then raise exception using message='VALIDATION'; end if;
  update public.inventory_balances set on_hand=on_hand+case when direction='in' then qty else -qty end where id=balance.id;
  insert into public.inventory_movements(organization_id,part_id,location_id,kind,direction,quantity,unit,actor_id,request_id,source,reason,correction_of)
   values(org,part.id,location.id,case when action='receive_stock' then 'receipt' else 'adjustment' end,direction,qty,unit,actor,request,source,reason,correction) returning * into movement;
  data:=to_jsonb(movement)||jsonb_build_object('quantity',movement.quantity::text);
  insert into public.audit_logs(organization_id,actor_id,action,entity_id,request_id,changes) values(org,actor,'inventory.movement',movement.id,request,jsonb_build_object('part_id',part.id,'location_id',location.id,'direction',direction,'quantity',qty::text,'unit',unit,'reason',reason,'correction_of',correction));
 else raise exception using message='VALIDATION';
 end case;
 return private.finish_command(org,actor,request,action,jsonb_build_object('ctx',ctx,'fields',fields),data);
exception when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
 when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
 when foreign_key_violation then raise exception using message='NOT_FOUND';
 when others then
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=% actor=% tenant=% code=%',action,actor,org,SQLERRM; end if;
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','VALIDATION','CONFLICT','INVALID_TRANSITION','RATE_LIMITED') then raise; end if;
  raise log 'opspilot_command_failure action=% state=%',action,SQLSTATE;
  raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function public.save_part(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inventory_command(ctx,'save_part',fields) $$;
create function public.save_stock_location(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inventory_command(ctx,'save_stock_location',fields) $$;
create function public.receive_stock(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inventory_command(ctx,'receive_stock',fields) $$;
create function public.adjust_stock(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.inventory_command(ctx,'adjust_stock',fields) $$;

create function private.inventory_page(org uuid,kind text,cursor uuid,page_size integer,part_id uuid default null,location_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare rows jsonb; next uuid; role text:=private.member_role(org);
begin
 if role is null or role not in ('owner','manager','supervisor','inventory') then raise exception using message='FORBIDDEN'; end if;
 if page_size is null or page_size not between 1 and 100 then raise exception using message='VALIDATION'; end if;
 if part_id is not null and not exists(select 1 from public.parts where organization_id=org and id=part_id) then raise exception using message='NOT_FOUND'; end if;
 if location_id is not null and not exists(select 1 from public.stock_locations where organization_id=org and id=location_id) then raise exception using message='NOT_FOUND'; end if;
 case kind
 when 'parts' then
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('reorder_threshold',t.reorder_threshold::text) order by id),'[]') into rows from (select * from public.parts where organization_id=org and (cursor is null or id>cursor) order by id limit page_size+1) t;
 when 'locations' then
  select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') into rows from (select * from public.stock_locations where organization_id=org and (cursor is null or id>cursor) order by id limit page_size+1) t;
 when 'balances' then
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('on_hand',t.on_hand::text,'reserved',t.reserved::text,'available',t.available::text) order by id),'[]') into rows from (select * from public.inventory_balances b where organization_id=org and (inventory_page.part_id is null or b.part_id=inventory_page.part_id) and (inventory_page.location_id is null or b.location_id=inventory_page.location_id) and (cursor is null or id>cursor) order by id limit page_size+1) t;
 when 'movements' then
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',t.quantity::text) order by id),'[]') into rows from (select * from public.inventory_movements m where organization_id=org and (inventory_page.part_id is null or m.part_id=inventory_page.part_id) and (inventory_page.location_id is null or m.location_id=inventory_page.location_id) and (cursor is null or id>cursor) order by id limit page_size+1) t;
 else raise exception using message='VALIDATION';
 end case;
 if jsonb_array_length(rows)>page_size then next:=(rows->(page_size-1)->>'id')::uuid;rows:=rows-page_size; end if;
 return jsonb_build_object('items',rows,'next_cursor',next);
end $$;
create function public.list_inventory_parts(organization_id uuid,cursor uuid default null,page_size integer default 25) returns jsonb language sql stable security definer set search_path='' as $$ select private.inventory_page(organization_id,'parts',cursor,page_size) $$;
create function public.list_stock_locations(organization_id uuid,cursor uuid default null,page_size integer default 25) returns jsonb language sql stable security definer set search_path='' as $$ select private.inventory_page(organization_id,'locations',cursor,page_size) $$;
create function public.list_inventory_balances(organization_id uuid,cursor uuid default null,page_size integer default 25,part_id uuid default null,location_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$ select private.inventory_page(organization_id,'balances',cursor,page_size,part_id,location_id) $$;
create function public.list_inventory_movements(organization_id uuid,cursor uuid default null,page_size integer default 25,part_id uuid default null,location_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$ select private.inventory_page(organization_id,'movements',cursor,page_size,part_id,location_id) $$;

-- Reads are bounded RPCs; no direct table DML or unbounded table reads, including service-role.
do $$ declare name text; begin
 foreach name in array array['parts','stock_locations','inventory_balances','inventory_movements'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('alter table public.%I force row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;
revoke all on function private.inventory_text(jsonb,integer),private.stock_decimal(jsonb,boolean),private.inventory_unit_guard(),private.inventory_command(jsonb,text,jsonb),private.inventory_page(uuid,text,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_part(jsonb,jsonb),public.save_stock_location(jsonb,jsonb),public.receive_stock(jsonb,jsonb),public.adjust_stock(jsonb,jsonb),public.list_inventory_parts(uuid,uuid,integer),public.list_stock_locations(uuid,uuid,integer),public.list_inventory_balances(uuid,uuid,integer,uuid,uuid),public.list_inventory_movements(uuid,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_part(jsonb,jsonb),public.save_stock_location(jsonb,jsonb),public.receive_stock(jsonb,jsonb),public.adjust_stock(jsonb,jsonb),public.list_inventory_parts(uuid,uuid,integer),public.list_stock_locations(uuid,uuid,integer),public.list_inventory_balances(uuid,uuid,integer,uuid,uuid),public.list_inventory_movements(uuid,uuid,integer,uuid,uuid) to authenticated;
