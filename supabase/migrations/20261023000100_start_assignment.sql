-- Commands already hold the tenant/asset/work locks; receipts replay before any status update.
create function private.require_start_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists (
  select 1 from public.work_order_assignments a
  join public.organization_members m on m.organization_id=a.organization_id and m.user_id=a.user_id
  where a.organization_id=new.organization_id and a.work_order_id=new.id and a.unassigned_at is null
   and m.active and m.role in ('owner','manager','supervisor','technician') and private.auth_user_active(m.user_id)
 ) then raise exception using message='INVALID_TRANSITION'; end if;
 return new;
end $$;
create trigger start_assignment_required before update of status on public.work_orders
for each row when (new.status='in_progress' and old.status in ('open','scheduled','blocked','completed'))
execute function private.require_start_assignment();
revoke all on function private.require_start_assignment() from public,anon,authenticated,service_role;
