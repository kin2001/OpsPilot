-- Keep reconciliation and notification cycles behind the existing authenticated commands.
create index stock_reservations_reconcile on public.stock_reservations(organization_id,part_id,location_id);
create function private.stock_consistent(org uuid,target_part uuid,target_location uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists (
  with pairs as (
   select part_id,location_id from public.inventory_balances where organization_id=org and part_id=target_part
   union select part_id,location_id from public.inventory_movements where organization_id=org and part_id=target_part
   union select part_id,location_id from public.stock_reservations where organization_id=org and part_id=target_part
  )
  select 1 from pairs k left join public.inventory_balances b on b.organization_id=org and b.part_id=k.part_id and b.location_id=k.location_id
  where (target_location is null or k.location_id=target_location) and (b.id is null
   or b.on_hand<>coalesce((select sum(case when m.direction='in' then m.quantity else -m.quantity end) from public.inventory_movements m where m.organization_id=org and m.part_id=k.part_id and m.location_id=k.location_id),0)
   or b.reserved<>coalesce((select sum(r.quantity-r.issued-r.released) from public.stock_reservations r where r.organization_id=org and r.part_id=k.part_id and r.location_id=k.location_id),0))
 ) and not exists (
  select 1 from public.stock_reservations r where r.organization_id=org and r.part_id=target_part and (target_location is null or r.location_id=target_location)
   and (r.issued<>coalesce((select sum(m.quantity) from public.job_stock_movements j join public.inventory_movements m on m.organization_id=j.organization_id and m.id=j.movement_id where j.organization_id=org and j.reservation_id=r.id and m.kind='issue'),0)
    or r.returned<>coalesce((select sum(m.quantity) from public.job_stock_movements j join public.inventory_movements m on m.organization_id=j.organization_id and m.id=j.movement_id where j.organization_id=org and j.reservation_id=r.id and m.kind='return'),0))
 ) and not exists (
  select 1 from public.inventory_movements m join public.parts p on p.organization_id=m.organization_id and p.id=m.part_id
  where m.organization_id=org and m.part_id=target_part and (target_location is null or m.location_id=target_location)
   and (m.unit<>p.unit or (m.kind in ('issue','return') and not exists (
    select 1 from public.job_stock_movements j join public.stock_reservations r on r.organization_id=j.organization_id and r.id=j.reservation_id
    where j.organization_id=org and j.movement_id=m.id and j.request_id=m.request_id and r.part_id=m.part_id and r.location_id=m.location_id)))
 ) and not exists (
  select 1 from public.job_stock_movements j join public.stock_reservations r on r.organization_id=j.organization_id and r.id=j.reservation_id
  join public.inventory_movements m on m.organization_id=j.organization_id and m.id=j.movement_id
  where j.organization_id=org and r.part_id=target_part and (target_location is null or r.location_id=target_location)
   and (m.kind not in ('issue','return') or m.part_id<>r.part_id or m.location_id<>r.location_id or m.request_id<>j.request_id)
 )
$$;
create function private.require_consistent_stock(org uuid,target_part uuid,target_location uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not private.stock_consistent(org,target_part,target_location) then raise exception using message='CONFLICT';end if;
end $$;

create table private.stock_low_state (
 organization_id uuid not null,part_id uuid not null,location_id uuid not null,is_low boolean not null,event_id uuid not null default gen_random_uuid(),
 primary key(organization_id,part_id,location_id),
 foreign key(organization_id,part_id,location_id) references public.inventory_balances(organization_id,part_id,location_id)
);
alter table private.stock_low_state enable row level security;
alter table private.stock_low_state force row level security;
revoke all on private.stock_low_state from public,anon,authenticated,service_role;
-- Establish the upgrade baseline without notifying historical low stock.
insert into private.stock_low_state(organization_id,part_id,location_id,is_low)
 select b.organization_id,b.part_id,b.location_id,coalesce(p.archived_at is null and b.available<=p.reorder_threshold,false)
 from public.inventory_balances b join public.parts p on p.organization_id=b.organization_id and p.id=b.part_id;

create function private.stock_notices(org uuid,target_part uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b record;previous boolean;event uuid;
begin
 for b in select b.*,coalesce(p.archived_at is null and b.available<=p.reorder_threshold,false) low
  from public.inventory_balances b join public.parts p on p.organization_id=b.organization_id and p.id=b.part_id
  where b.organization_id=org and b.part_id=target_part order by b.part_id,b.location_id loop
  -- A discrepant location cannot supply a trustworthy threshold fact.
  if not private.stock_consistent(org,target_part,b.location_id) then continue;end if;
  select is_low into previous from private.stock_low_state where organization_id=org and part_id=target_part and location_id=b.location_id;
  if b.low and not coalesce(previous,false) then
   event:=gen_random_uuid();
   insert into public.notifications(organization_id,recipient_user_id,event_id,category,source_id)
    select org,m.user_id,event,'low_stock',b.id from public.organization_members m
    where m.organization_id=org and m.active and private.auth_user_active(m.user_id) and m.role in ('owner','manager','supervisor','inventory') on conflict do nothing;
  else event:=null;end if;
  insert into private.stock_low_state(organization_id,part_id,location_id,is_low,event_id) values(org,target_part,b.location_id,b.low,coalesce(event,gen_random_uuid()))
   on conflict(organization_id,part_id,location_id) do update set is_low=excluded.is_low,event_id=coalesce(event,stock_low_state.event_id);
 end loop;
end $$;

create function private.job_shortages(org uuid,job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('part_id',p.part_id,'unit',c.unit,'shortage',s.quantity::numeric(14,3)::text) order by p.part_id),'[]'::jsonb)
 from public.work_order_parts p join public.parts c on c.organization_id=p.organization_id and c.id=p.part_id
 cross join lateral(select greatest(0,p.requested-coalesce(sum(r.quantity-r.released-r.returned),0)) quantity from public.stock_reservations r where r.organization_id=org and r.work_order_id=job and r.part_id=p.part_id) s
 where p.organization_id=org and p.work_order_id=job and s.quantity>0
$$;
create function private.capture_parts_block() returns trigger language plpgsql security definer set search_path='' as $$
declare shortages jsonb;
begin
 if new.action='transition_work_order' and new.status='blocked' then
  shortages:=private.job_shortages(new.organization_id,new.work_order_id);
  if jsonb_array_length(shortages)>0 then
   new.changes:=new.changes||jsonb_build_object('parts_shortages',shortages);
   insert into public.notifications(organization_id,recipient_user_id,event_id,category,source_id)
    select new.organization_id,m.user_id,new.id,'blocked_parts',new.work_order_id from public.organization_members m
    where m.organization_id=new.organization_id and m.active and private.auth_user_active(m.user_id) and m.role in ('owner','manager','supervisor','inventory') on conflict do nothing;
  end if;
 end if;
 return new;
end $$;
create trigger parts_block_fact before insert on public.work_order_events for each row execute function private.capture_parts_block();

-- Patch exact accepted anchors; unexpected predecessor drift aborts the migration.
do $migration$
declare definition text;patch text[];
begin
 definition:=pg_get_functiondef('private.inventory_command(jsonb,text,jsonb)'::regprocedure);
 foreach patch slice 1 in array array[
  array[$old$  insert into public.inventory_balances(organization_id,part_id,location_id) values(org,part.id,location.id)$old$,
        $new$  perform private.require_consistent_stock(org,part.id,location.id);
  insert into public.inventory_balances(organization_id,part_id,location_id) values(org,part.id,location.id)$new$],
  array[$old$ return private.finish_command(org,actor,request,action,jsonb_build_object('ctx',ctx,'fields',fields),data);$old$,
        $new$ if part.id is not null then perform private.stock_notices(org,part.id);end if;
 return private.finish_command(org,actor,request,action,jsonb_build_object('ctx',ctx,'fields',fields),data);$new$]
 ] loop
  if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception 'Inventory guardrail anchor drift';end if;
  definition:=replace(definition,patch[1],patch[2]);
 end loop;
 execute definition;
 definition:=pg_get_functiondef('private.job_parts_command(jsonb,text,jsonb)'::regprocedure);
 foreach patch slice 1 in array array[
  array[$old$    if balance.available<qty then raise exception using message='CONFLICT';end if;$old$,
        $new$    perform private.require_consistent_stock(org,part.id,location);
    if balance.available<qty then raise exception using message='CONFLICT';end if;$new$],
  array[$old$   if action='return_stock' then
    if qty>reservation.issued-reservation.returned$old$,
        $new$   perform private.require_consistent_stock(org,part.id,reservation.location_id);
   if action='return_stock' then
    if qty>reservation.issued-reservation.returned$new$],
  array[$old$ data:=private.job_parts_data(org,job);$old$,
        $new$ for target in select distinct r.part_id from public.stock_reservations r where r.organization_id=org and r.work_order_id=job order by r.part_id loop
  perform private.stock_notices(org,target);
 end loop;
 data:=private.job_parts_data(org,job);$new$]
 ] loop
  if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception 'Job parts guardrail anchor drift';end if;
  definition:=replace(definition,patch[1],patch[2]);
 end loop;
 execute definition;
 definition:=pg_get_functiondef('private.cancel_job_reservations(uuid,uuid)'::regprocedure);
 foreach patch slice 1 in array array[
  array[$old$  remaining:=r.quantity-r.issued-r.released;$old$,
        $new$  perform private.require_consistent_stock(org,r.part_id,r.location_id);
  remaining:=r.quantity-r.issued-r.released;$new$],
  array[$old$ end loop;
end $old$,$new$ end loop;
 for r in select distinct on (part_id) * from public.stock_reservations where organization_id=org and work_order_id=job order by part_id,location_id loop
  perform private.stock_notices(org,r.part_id);
 end loop;
end $new$]
 ] loop
  if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception 'Cancellation guardrail anchor drift';end if;
  definition:=replace(definition,patch[1],patch[2]);
 end loop;
 execute definition;
 definition:=pg_get_functiondef('private.operational_command_base(jsonb,text,jsonb)'::regprocedure);
 patch:=array[$old$  if next_status='canceled' then perform private.cancel_job_reservations(org,wo.id);end if;$old$,
 $new$  if wo.status='blocked' and next_status in ('scheduled','in_progress') then
   if jsonb_array_length(private.job_shortages(org,wo.id))>0 then raise exception using message='INVALID_TRANSITION';end if;
   if exists(select 1 from public.work_order_parts p where p.organization_id=org and p.work_order_id=wo.id and not private.stock_consistent(org,p.part_id)) then raise exception using message='CONFLICT';end if;
  end if;
  if next_status='canceled' then perform private.cancel_job_reservations(org,wo.id);end if;$new$];
 if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception 'Resume guardrail anchor drift';end if;
 execute replace(definition,patch[1],patch[2]);
 definition:=pg_get_functiondef('private.job_parts_data(uuid,uuid)'::regprocedure);
 -- Replace only the reconciliation expression, leaving the frozen projection unchanged.
 definition:=regexp_replace(definition,'''reconciliation_state'',case when exists\([\s\S]*?then ''discrepancy'' else ''consistent'' end\)',
 $replacement$'reconciliation_state',case when exists(select 1 from public.work_order_parts p where p.organization_id=org and p.work_order_id=job and not private.stock_consistent(org,p.part_id)) then 'discrepancy' else 'consistent' end)$replacement$);
 if definition=pg_get_functiondef('private.job_parts_data(uuid,uuid)'::regprocedure) then raise exception 'Reconciliation read anchor drift';end if;
 execute definition;
end $migration$;
revoke all on function private.stock_consistent(uuid,uuid,uuid),private.require_consistent_stock(uuid,uuid,uuid),private.stock_notices(uuid,uuid),private.job_shortages(uuid,uuid),private.capture_parts_block() from public,anon,authenticated,service_role;
