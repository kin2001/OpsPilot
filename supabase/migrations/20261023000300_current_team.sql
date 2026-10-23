create or replace function public.get_team(organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.operations(organization_id) then raise exception using message='FORBIDDEN'; end if;
 if (select count(*) from (select 1 from public.organization_members where organization_members.organization_id=get_team.organization_id and active limit 101) current_members)>100 then
  raise exception using message='DEPENDENCY_UNAVAILABLE';
 end if;
 return coalesce((select jsonb_agg(row_to_json(m) order by m.user_id) from (select user_id,role,active,version from public.organization_members where organization_members.organization_id=get_team.organization_id order by active desc,user_id limit 100) m),'[]'::jsonb);
end $$;
