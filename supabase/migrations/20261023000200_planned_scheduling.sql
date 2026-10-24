alter table public.work_orders add column planned_on date;

-- Extend the existing transaction after replay; fail closed if its source anchors have drifted.
do $migration$
declare definition text; pair text[];
begin
 definition:=pg_get_functiondef('private.operational_command_base(jsonb,text,jsonb)'::regprocedure);
 foreach pair slice 1 in array array[
  array[$old$'due_at',wo.due_at,'supervisor_id',wo.supervisor_id);$old$,
        $new$'due_at',wo.due_at,'planned_on',wo.planned_on,'supervisor_id',wo.supervisor_id);$new$],
  array[$old$  if next_status='awaiting_review' then$old$,
        $new$  if next_status='scheduled' then
   if jsonb_typeof(payload->'planned_on') is distinct from 'string' or (payload->>'planned_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or not isfinite((payload->>'planned_on')::date) then raise exception using message='VALIDATION'; end if;
  end if;
  if next_status='awaiting_review' then$new$],
  array[$old$update public.work_orders set status=next_status,opened_at=$old$,
        $new$update public.work_orders set status=next_status,planned_on=case when next_status='scheduled' then (payload->>'planned_on')::date else planned_on end,opened_at=$new$],
  array[$old$jsonb_build_object('from_status',origin_status)||case when admin_changed$old$,
        $new$jsonb_build_object('from_status',origin_status)||case when action='transition_work_order' and next_status='scheduled' then jsonb_build_object('prior_planned_on',prior_work->'planned_on','planned_on',wo.planned_on) else '{}'::jsonb end||case when admin_changed$new$]
 ] loop
  if (length(definition)-length(replace(definition,pair[1],'')))/length(pair[1])<>1 then raise exception 'Expected one scheduling source anchor'; end if;
  definition:=replace(definition,pair[1],pair[2]);
 end loop;
 execute definition;
end $migration$;

create function public.schedule_work_order(ctx jsonb,id uuid,planned_on date,reason text default null) returns jsonb
language sql security definer set search_path='' as $$
 select private.operational_command(ctx,'transition_work_order',jsonb_build_object('id',id,'target','scheduled','reason',reason,'planned_on',planned_on))
$$;
revoke all on function public.schedule_work_order(jsonb,uuid,date,text) from public,anon,authenticated,service_role;
grant execute on function public.schedule_work_order(jsonb,uuid,date,text) to authenticated;
