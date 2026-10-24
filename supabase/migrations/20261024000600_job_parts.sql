-- Job allocations are separate from the frozen legacy movement row shape.
create table public.work_order_parts (
 organization_id uuid not null, work_order_id uuid not null, part_id uuid not null, requested numeric(14,3) not null check(requested>0),
 primary key(organization_id,work_order_id,part_id),
 foreign key(organization_id,work_order_id) references public.work_orders(organization_id,id),
 foreign key(organization_id,part_id) references public.parts(organization_id,id)
);
create table public.stock_reservations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, work_order_id uuid not null, part_id uuid not null, location_id uuid not null,
 quantity numeric(14,3) not null check(quantity>0), issued numeric(14,3) not null default 0, returned numeric(14,3) not null default 0, released numeric(14,3) not null default 0,
 check(issued>=0 and returned>=0 and released>=0 and issued+released<=quantity and returned<=issued),
 unique(organization_id,id), unique(organization_id,work_order_id,part_id,location_id),
 foreign key(organization_id,work_order_id,part_id) references public.work_order_parts(organization_id,work_order_id,part_id),
 foreign key(organization_id,part_id,location_id) references public.inventory_balances(organization_id,part_id,location_id)
);
alter table public.inventory_movements drop constraint inventory_movements_kind_check, drop constraint inventory_movements_check,
 drop constraint inventory_movements_organization_id_actor_id_request_id_key;
alter table public.inventory_movements add check(kind in ('receipt','adjustment','issue','return')),
 add check((kind='receipt' and direction='in' and reason is null and correction_of is null)
 or (kind='adjustment' and reason is not null and length(reason) between 1 and 2000)
 or (kind in ('issue','return') and direction=case when kind='issue' then 'out' else 'in' end and reason is null and source is null and correction_of is null));
create unique index inventory_legacy_request on public.inventory_movements(organization_id,actor_id,request_id) where kind in ('receipt','adjustment');
create table public.job_stock_movements (
 organization_id uuid not null, movement_id uuid not null, reservation_id uuid not null, request_id uuid not null,
 primary key(organization_id,movement_id), unique(organization_id,reservation_id,request_id),
 foreign key(organization_id,movement_id) references public.inventory_movements(organization_id,id),
 foreign key(organization_id,reservation_id) references public.stock_reservations(organization_id,id)
);
create trigger immutable_history before update or delete on public.job_stock_movements for each row execute function private.immutable_history();

create function private.can_read_job_parts(org uuid,job uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member_role(org) in ('owner','manager','supervisor','inventory') or (private.member_role(org)='technician' and exists(select 1 from public.work_order_assignments where organization_id=org and work_order_id=job and user_id=auth.uid() and unassigned_at is null))
$$;
create function private.job_parts_data(org uuid,job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',w.id,'number',w.number,'status',w.status,'version',w.version,
 'parts',coalesce((select jsonb_agg(jsonb_build_object('part_id',p.part_id,'unit',c.unit,'requested',p.requested::text,
 'reserved',coalesce(r.reserved,0)::numeric(14,3)::text,'issued',coalesce(r.issued,0)::numeric(14,3)::text,'returned',coalesce(r.returned,0)::numeric(14,3)::text,
 'shortage',greatest(0,p.requested-coalesce(r.reserved,0)-coalesce(r.issued,0)+coalesce(r.returned,0))::numeric(14,3)::text) order by p.part_id)
 from public.work_order_parts p join public.parts c on c.organization_id=p.organization_id and c.id=p.part_id
 left join lateral(select sum(quantity-issued-released) reserved,sum(issued) issued,sum(returned) returned from public.stock_reservations where organization_id=org and work_order_id=job and part_id=p.part_id) r on true
 where p.organization_id=org and p.work_order_id=job),'[]'),
 'reservations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'part_id',r.part_id,'location_id',r.location_id,'unit',p.unit,'reserved',(r.quantity-r.issued-r.released)::text,'issued',r.issued::text,'returned',r.returned::text,'released',r.released::text) order by r.part_id,r.location_id)
 from public.stock_reservations r join public.parts p on p.organization_id=r.organization_id and p.id=r.part_id where r.organization_id=org and r.work_order_id=job),'[]'),
 'reconciliation_state',case when exists(select 1 from public.inventory_balances b where b.organization_id=org and exists(select 1 from public.work_order_parts p where p.organization_id=org and p.work_order_id=job and p.part_id=b.part_id)
 and (b.reserved<>coalesce((select sum(r.quantity-r.issued-r.released) from public.stock_reservations r where r.organization_id=org and r.part_id=b.part_id and r.location_id=b.location_id),0)
 or b.on_hand<>coalesce((select sum(case when m.direction='in' then m.quantity else -m.quantity end) from public.inventory_movements m where m.organization_id=org and m.part_id=b.part_id and m.location_id=b.location_id),0))) then 'discrepancy' else 'consistent' end)
 from public.work_orders w where w.organization_id=org and w.id=job
$$;
create function public.get_job_parts(organization_id uuid,work_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
begin
 if not coalesce(private.can_read_job_parts(organization_id,work_order_id),false) then raise exception using message='FORBIDDEN';end if;
 if not exists(select 1 from public.work_orders where work_orders.organization_id=get_job_parts.organization_id and id=work_order_id) then raise exception using message='NOT_FOUND';end if;
 return private.job_parts_data(organization_id,work_order_id);
end $$;

create function private.job_parts_command(ctx jsonb,action text,fields jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare org uuid;actor uuid:=auth.uid();request uuid;expected integer;role text;job uuid;wo public.work_orders;asset public.assets;
 replayed jsonb;line jsonb;part public.parts;reservation public.stock_reservations;balance public.inventory_balances;qty numeric;unit text;target uuid;location uuid;movement uuid;data jsonb;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED';end if;
 perform private.object_fields(ctx,array['organization_id','request_id','expected_version']);
 org:=(ctx->>'organization_id')::uuid;request:=(ctx->>'request_id')::uuid;
 if org is null or request is null or jsonb_typeof(ctx->'organization_id') is distinct from 'string' or jsonb_typeof(ctx->'request_id') is distinct from 'string'
 or jsonb_typeof(ctx->'expected_version') is distinct from 'number' or (ctx->>'expected_version')!~'^[1-9][0-9]*$' then raise exception using message='VALIDATION';end if;
 expected:=(ctx->>'expected_version')::integer;
 perform 1 from public.organizations where id=org for update;
 role:=private.member_role(org);
 if role is null or (action='request_parts' and role<>'technician') or (action in ('reserve_parts','release_reservation') and role not in ('owner','manager','supervisor','inventory'))
 or (action in ('issue_reserved_stock','return_stock') and role not in ('owner','inventory')) then raise exception using message='FORBIDDEN';end if;
 perform private.object_fields(fields,array['work_order_id','lines']);job:=(fields->>'work_order_id')::uuid;
 if job is null or jsonb_typeof(fields->'work_order_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
 if not coalesce(private.can_read_job_parts(org,job),false) then raise exception using message='FORBIDDEN';end if;
 select * into wo from public.work_orders where organization_id=org and id=job;
 if wo.id is null then raise exception using message='NOT_FOUND';end if;
 select * into asset from public.assets where organization_id=org and id=wo.asset_id for update;
 select * into wo from public.work_orders where organization_id=org and id=job for update;
 -- Current membership/assignment is checked before replay; replay precedes stale-version checks.
 replayed:=private.replay(org,actor,request,action,jsonb_build_object('ctx',ctx,'fields',fields));if replayed is not null then return replayed;end if;
 if wo.version<>expected then raise exception using message='CONFLICT';end if;
 if action<>'return_stock' and (wo.status in ('completed','canceled') or asset.archived_at is not null) then raise exception using message='INVALID_TRANSITION';end if;
 if jsonb_typeof(fields->'lines') is distinct from 'array' then raise exception using message='VALIDATION';end if;
 if jsonb_array_length(fields->'lines') not between 1 and 100 then raise exception using message='VALIDATION';end if;
 if action='request_parts' and (select count(distinct value->>'part_id') from jsonb_array_elements(fields->'lines'))<>jsonb_array_length(fields->'lines')
 or action='reserve_parts' and (select count(distinct (value->>'part_id',value->>'location_id')) from jsonb_array_elements(fields->'lines'))<>jsonb_array_length(fields->'lines')
 or action in ('release_reservation','issue_reserved_stock','return_stock') and (select count(distinct value->>'reservation_id') from jsonb_array_elements(fields->'lines'))<>jsonb_array_length(fields->'lines') then raise exception using message='VALIDATION';end if;
 perform private.rate_check(org,actor,action);
 -- Tenant admission serializes stock commands; acquire dependent stock rows deterministically too.
 perform 1 from public.parts p where p.organization_id=org and (p.id in (select (value->>'part_id')::uuid from jsonb_array_elements(fields->'lines')) or p.id in (select r.part_id from public.stock_reservations r where r.organization_id=org and r.id in (select (value->>'reservation_id')::uuid from jsonb_array_elements(fields->'lines')))) order by p.id for update;
 perform 1 from public.inventory_balances b where b.organization_id=org and b.part_id in (select p.part_id from public.work_order_parts p where p.organization_id=org and p.work_order_id=job) order by b.part_id,b.location_id for update;
 for line in select value from jsonb_array_elements(fields->'lines') order by value->>'part_id',value->>'location_id',value->>'reservation_id' loop
  qty:=private.stock_decimal(line->'quantity',true);unit:=private.inventory_text(line->'unit',40);
  if action in ('request_parts','reserve_parts') then
   if action='request_parts' then perform private.object_fields(line,array['part_id','quantity','unit']);else perform private.object_fields(line,array['part_id','location_id','quantity','unit']);end if;
   if jsonb_typeof(line->'part_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
   select * into part from public.parts where organization_id=org and id=(line->>'part_id')::uuid;
   if part.id is null then raise exception using message='NOT_FOUND';end if;
   if part.archived_at is not null then raise exception using message='INVALID_TRANSITION';end if;
   if part.unit<>unit then raise exception using message='VALIDATION';end if;
   if action='request_parts' then
    insert into public.work_order_parts(organization_id,work_order_id,part_id,requested) values(org,job,part.id,qty)
    on conflict(organization_id,work_order_id,part_id) do update set requested=work_order_parts.requested+excluded.requested;
   else
    location:=(line->>'location_id')::uuid;
    if location is null or jsonb_typeof(line->'location_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
    if not exists(select 1 from public.work_order_parts where organization_id=org and work_order_id=job and part_id=part.id) then raise exception using message='NOT_FOUND';end if;
    if qty>(select requested from public.work_order_parts where organization_id=org and work_order_id=job and part_id=part.id)-coalesce((select sum(quantity-released-returned) from public.stock_reservations where organization_id=org and work_order_id=job and part_id=part.id),0) then raise exception using message='CONFLICT';end if;
    select * into balance from public.inventory_balances where organization_id=org and part_id=part.id and location_id=location for update;
    if balance.id is null then raise exception using message='NOT_FOUND';end if;
    if balance.available<qty then raise exception using message='CONFLICT';end if;
    insert into public.stock_reservations(organization_id,work_order_id,part_id,location_id,quantity) values(org,job,part.id,location,qty)
    on conflict(organization_id,work_order_id,part_id,location_id) do update set quantity=stock_reservations.quantity+excluded.quantity;
    update public.inventory_balances set reserved=reserved+qty where id=balance.id;
   end if;
  else
   perform private.object_fields(line,array['reservation_id','quantity','unit']);
   if jsonb_typeof(line->'reservation_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
   select * into reservation from public.stock_reservations where organization_id=org and work_order_id=job and id=(line->>'reservation_id')::uuid for update;
   if reservation.id is null then raise exception using message='NOT_FOUND';end if;
   select * into part from public.parts where organization_id=org and id=reservation.part_id;
   if part.unit<>unit then raise exception using message='VALIDATION';end if;
   select * into balance from public.inventory_balances where organization_id=org and part_id=reservation.part_id and location_id=reservation.location_id for update;
   if action='return_stock' then
    if qty>reservation.issued-reservation.returned then raise exception using message='CONFLICT';end if;
    update public.stock_reservations set returned=returned+qty where id=reservation.id;
    update public.inventory_balances set on_hand=on_hand+qty where id=balance.id;
   else
    if qty>reservation.quantity-reservation.issued-reservation.released then raise exception using message='CONFLICT';end if;
    if action='release_reservation' then update public.stock_reservations set released=released+qty where id=reservation.id;
    elsif action='issue_reserved_stock' then update public.stock_reservations set issued=issued+qty where id=reservation.id;
    else raise exception using message='VALIDATION';end if;
    update public.inventory_balances set reserved=reserved-qty,on_hand=on_hand-case when action='issue_reserved_stock' then qty else 0 end where id=balance.id;
   end if;
   if action in ('issue_reserved_stock','return_stock') then
    insert into public.inventory_movements(organization_id,part_id,location_id,kind,direction,quantity,unit,actor_id,request_id)
    values(org,part.id,reservation.location_id,case when action='return_stock' then 'return' else 'issue' end,case when action='return_stock' then 'in' else 'out' end,qty,unit,actor,request) returning id into movement;
    insert into public.job_stock_movements values(org,movement,reservation.id,request);
   end if;
  end if;
 end loop;
 if (select count(*) from public.work_order_parts where organization_id=org and work_order_id=job)>100 or (select count(*) from public.stock_reservations where organization_id=org and work_order_id=job)>100 then raise exception using message='VALIDATION';end if;
 update public.work_orders set version=version+1 where id=job;
 data:=private.job_parts_data(org,job);
 return private.finish_command(org,actor,request,action,jsonb_build_object('ctx',ctx,'fields',fields),data);
exception when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then raise exception using message='VALIDATION';
 when unique_violation or lock_not_available or deadlock_detected then raise exception using message='CONFLICT';
 when foreign_key_violation then raise exception using message='NOT_FOUND';
 when others then
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED') then raise log 'opspilot_command_denied action=% actor=% tenant=% code=%',action,actor,org,SQLERRM;end if;
  if SQLERRM in ('FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','VALIDATION','CONFLICT','INVALID_TRANSITION','RATE_LIMITED') then raise;end if;
  raise log 'opspilot_command_failure action=% state=%',action,SQLSTATE;raise exception using message='DEPENDENCY_UNAVAILABLE';
end $$;

create function private.cancel_job_reservations(org uuid,job uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.stock_reservations;remaining numeric;
begin
 perform 1 from public.parts p where p.organization_id=org and p.id in (select part_id from public.stock_reservations where organization_id=org and work_order_id=job) order by p.id for update;
 for r in select * from public.stock_reservations where organization_id=org and work_order_id=job order by part_id,location_id for update loop
  remaining:=r.quantity-r.issued-r.released;
  update public.inventory_balances set reserved=reserved-remaining where organization_id=org and part_id=r.part_id and location_id=r.location_id;
  update public.stock_reservations set released=released+remaining where id=r.id;
 end loop;
end $$;
do $migration$
declare definition text;anchor text:='  update public.work_orders set status=next_status,opened_at=';
begin
 definition:=pg_get_functiondef('private.operational_command_base(jsonb,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one job cancellation source anchor';end if;
 execute replace(definition,anchor,E'  if next_status=''canceled'' then perform private.cancel_job_reservations(org,wo.id);end if;\n'||anchor);
end $migration$;

create function public.request_parts(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$select private.job_parts_command(ctx,'request_parts',fields)$$;
create function public.reserve_parts(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$select private.job_parts_command(ctx,'reserve_parts',fields)$$;
create function public.release_reservation(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$select private.job_parts_command(ctx,'release_reservation',fields)$$;
create function public.issue_reserved_stock(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$select private.job_parts_command(ctx,'issue_reserved_stock',fields)$$;
create function public.return_stock(ctx jsonb,fields jsonb) returns jsonb language sql security definer set search_path='' as $$select private.job_parts_command(ctx,'return_stock',fields)$$;
do $$declare name text;begin foreach name in array array['work_order_parts','stock_reservations','job_stock_movements'] loop
 execute format('alter table public.%I enable row level security',name);execute format('alter table public.%I force row level security',name);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
end loop;end $$;
revoke all on function private.can_read_job_parts(uuid,uuid),private.job_parts_data(uuid,uuid),private.job_parts_command(jsonb,text,jsonb),private.cancel_job_reservations(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_job_parts(uuid,uuid),public.request_parts(jsonb,jsonb),public.reserve_parts(jsonb,jsonb),public.release_reservation(jsonb,jsonb),public.issue_reserved_stock(jsonb,jsonb),public.return_stock(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_job_parts(uuid,uuid),public.request_parts(jsonb,jsonb),public.reserve_parts(jsonb,jsonb),public.release_reservation(jsonb,jsonb),public.issue_reserved_stock(jsonb,jsonb),public.return_stock(jsonb,jsonb) to authenticated;
