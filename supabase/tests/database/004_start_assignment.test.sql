begin;
set local search_path=public,extensions;
select plan(4);
select ok(exists(select 1 from pg_trigger where tgrelid='public.work_orders'::regclass and tgname='start_assignment_required' and not tgisinternal),'Starts, resumes and reopens have an authoritative assignment guard');
select ok(not has_function_privilege('authenticated','private.require_start_assignment()','EXECUTE'),'Clients cannot call the internal guard');
select ok(not has_function_privilege('anon','private.require_start_assignment()','EXECUTE'),'Anonymous callers cannot execute the guard');
select ok(not has_function_privilege('service_role','private.require_start_assignment()','EXECUTE'),'Service callers cannot execute the guard directly');
select * from finish();
rollback;
