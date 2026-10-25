-- An assigned technician may choose parts without receiving inventory quantities or history.
create function public.list_requestable_job_parts(organization_id uuid,work_order_id uuid,cursor uuid default null,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
declare rows jsonb; next uuid;
begin
 if private.member_role(organization_id) is distinct from 'technician' or not exists(
  select 1 from public.work_orders w join public.work_order_assignments a on a.organization_id=w.organization_id and a.work_order_id=w.id
  where w.organization_id=list_requestable_job_parts.organization_id and w.id=list_requestable_job_parts.work_order_id
  and a.user_id=auth.uid() and a.unassigned_at is null
 ) then raise exception using message='FORBIDDEN';end if;
 if page_size is null or page_size not between 1 and 100 then raise exception using message='VALIDATION';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') into rows from (
  select p.id,p.code,p.name,p.unit from public.parts p
  where p.organization_id=list_requestable_job_parts.organization_id and p.archived_at is null and (cursor is null or p.id>cursor)
  order by p.id limit page_size+1
 ) t;
 if jsonb_array_length(rows)>page_size then next:=(rows->(page_size-1)->>'id')::uuid;rows:=rows-page_size;end if;
 return jsonb_build_object('items',rows,'next_cursor',next);
end $$;
revoke all on function public.list_requestable_job_parts(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_requestable_job_parts(uuid,uuid,uuid,integer) to authenticated;
