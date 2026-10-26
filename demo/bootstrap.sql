-- Run only through the local Docker command in docs/demo.md, after the three synthetic signups.
-- No Auth passwords, private records, membership bypass, or operational facts are seeded.
begin;
do $$
begin
  if (select count(*) from auth.users where email in ('demo-owner@example.test','demo-tech@example.test','demo-other@example.test') and email_confirmed_at is not null) <> 3 then
    raise exception 'Confirm all three synthetic demo accounts first';
  end if;
  if exists(select 1 from auth.users where email is null or email not in ('demo-owner@example.test','demo-tech@example.test','demo-other@example.test'))
    or exists(select 1 from public.organizations) then
    raise exception 'Demo bootstrap requires an otherwise empty isolated local instance';
  end if;
end $$;
insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count)
select id,email,1 from auth.users where email in ('demo-owner@example.test','demo-other@example.test')
on conflict(user_id) do nothing;
commit;
