begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('00000037-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'guard37-'||n||'@example.test',now() from generate_series(1,4) n;
insert into public.organizations(id,name,timezone,currency,created_by) values('10000037-0000-4000-8000-000000000001','Synthetic guard37','UTC','PHP','00000037-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000037-0000-4000-8000-000000000001','00000037-0000-4000-8000-000000000001','owner'),
 ('10000037-0000-4000-8000-000000000001','00000037-0000-4000-8000-000000000002','technician'),
 ('10000037-0000-4000-8000-000000000001','00000037-0000-4000-8000-000000000003','inventory');
insert into public.assets(id,organization_id,code,name,category,created_by) values('20000037-0000-4000-8000-000000000001','10000037-0000-4000-8000-000000000001','J37','Synthetic pump','pump','00000037-0000-4000-8000-000000000001');
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('30000037-0000-4000-8000-000000000001','10000037-0000-4000-8000-000000000001',1,'20000037-0000-4000-8000-000000000001','Synthetic repair','Synthetic allocation','pump','normal','00000037-0000-4000-8000-000000000001','open','00000037-0000-4000-8000-000000000001');
insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('10000037-0000-4000-8000-000000000001','30000037-0000-4000-8000-000000000001','00000037-0000-4000-8000-000000000002');
insert into public.parts(id,organization_id,code,name,unit,created_by) values('40000037-0000-4000-8000-000000000001','10000037-0000-4000-8000-000000000001','KG','Synthetic stock','kg','00000037-0000-4000-8000-000000000001');
create function pg_temp.ctx(version integer) returns jsonb language sql as $$select jsonb_strip_nulls(jsonb_build_object('organization_id','10000037-0000-4000-8000-000000000001','request_id',gen_random_uuid(),'expected_version',version))$$;
create function pg_temp.fields(qty jsonb) returns jsonb language sql as $$select jsonb_build_object('work_order_id','30000037-0000-4000-8000-000000000001','lines',jsonb_build_array(jsonb_build_object('part_id','40000037-0000-4000-8000-000000000001','unit','kg','quantity',qty)))$$;
do $$begin perform set_config('request.jwt.claim.sub','00000037-0000-4000-8000-000000000001',true);end$$;
select throws_ok($$select public.request_parts(pg_temp.ctx(1),pg_temp.fields('"1"'))$$,'P0001','FORBIDDEN','Owner cannot impersonate assigned technician request');
do $$begin perform set_config('request.jwt.claim.sub','00000037-0000-4000-8000-000000000002',true);end$$;
select throws_ok($$select public.request_parts(pg_temp.ctx(1),'{"work_order_id":"30000037-0000-4000-8000-000000000001","lines":[{"part_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","quantity":"1","unit":"kg"},{"part_id":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA","quantity":"1","unit":"kg"}]}')$$,'P0001','VALIDATION','Direct request rejects case-variant part identity before lookup');
do $$begin perform set_config('request.jwt.claim.sub','00000037-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"aal":"aal2"}',true);end$$;
select ok(private.stock_consistent('10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001'),'Absent zero stock is consistent');
create temp table shelf as select public.save_stock_location(pg_temp.ctx(null),'{"code":"G37","name":"Synthetic guard shelf"}') result;
create function pg_temp.stock(qty text) returns jsonb language sql as $$select jsonb_build_object('part_id','40000037-0000-4000-8000-000000000001','location_id',(select result#>>'{data,id}' from shelf),'quantity',qty,'unit','kg')$$;
create temp table receipt as select pg_temp.ctx(null) ctx,pg_temp.stock('10') fields;
alter table receipt add column result jsonb;
update receipt set result=public.receive_stock(ctx,fields);
do $$begin perform set_config('request.jwt.claim.sub','00000037-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"aal":"aal2"}',true);end$$;
select ok(private.stock_consistent('10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001'),'Posted receipt reconciles');
select public.save_part(pg_temp.ctx(1),'{"id":"40000037-0000-4000-8000-000000000001","code":"KG","name":"Synthetic stock","unit":"kg","reorder_threshold":"10"}');
select is((select count(*)::integer from public.notifications where category='low_stock' and organization_id='10000037-0000-4000-8000-000000000001'),2,'Equality emits one event for each authorized recipient');
select public.receive_stock(pg_temp.ctx(null),pg_temp.stock('1'));
select public.adjust_stock(pg_temp.ctx(null),pg_temp.stock('1')||'{"direction":"out","reason":"Synthetic threshold crossing"}');
select is((select count(*)::integer from public.notifications where category='low_stock' and organization_id='10000037-0000-4000-8000-000000000001'),4,'Restock above then crossing starts a new cycle');
update public.inventory_balances set on_hand=on_hand+1 where organization_id='10000037-0000-4000-8000-000000000001';
select ok(not private.stock_consistent('10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001'),'Ledger mismatch detected');
select throws_ok($$select public.receive_stock(pg_temp.ctx(null),pg_temp.stock('1'))$$,'P0001','CONFLICT','Receipt blocked on discrepancy');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(null),pg_temp.stock('1')||'{"direction":"out","reason":"Cannot hide mismatch"}')$$,'P0001','CONFLICT','Adjustment cannot hide discrepancy');
select is((select public.receive_stock(ctx,fields) from receipt),(select result from receipt),'Authorized receipt replay survives later discrepancy');
update public.inventory_balances set on_hand=on_hand-1 where organization_id='10000037-0000-4000-8000-000000000001';
-- Privileged missing-row injection is restored before the independent link fault.
create temp table lost_balance as select * from public.inventory_balances where organization_id='10000037-0000-4000-8000-000000000001';
alter table public.inventory_balances disable trigger all;
delete from public.inventory_balances where organization_id='10000037-0000-4000-8000-000000000001';
alter table public.inventory_balances enable trigger all;
select ok(not private.stock_consistent('10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001'),'Missing balance with ledger facts is discrepant');
insert into public.inventory_balances(id,organization_id,part_id,location_id,on_hand,reserved) select id,organization_id,part_id,location_id,on_hand,reserved from lost_balance;
select ok(private.stock_consistent('10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001'),'Missing-row fault restored before independent link fault');
-- Inject an unlinked issue without modifying immutable posted history.
insert into public.inventory_movements(organization_id,part_id,location_id,kind,direction,quantity,unit,actor_id,request_id)
 select '10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001',(result#>>'{data,id}')::uuid,'issue','out',1,'kg','00000037-0000-4000-8000-000000000001',gen_random_uuid() from shelf;
update public.inventory_balances set on_hand=on_hand-1 where organization_id='10000037-0000-4000-8000-000000000001';
select ok(not private.stock_consistent('10000037-0000-4000-8000-000000000001','40000037-0000-4000-8000-000000000001'),'Unlinked issue is discrepant even with matching ledger balance');
set local role authenticated;
select throws_ok($$select * from private.stock_low_state$$,'42501',null,'Cycle state is private');
select throws_ok($$select private.stock_notices(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'Notification producer cannot be invoked by API caller');
select throws_ok($$select private.require_consistent_stock(gen_random_uuid(),gen_random_uuid(),null)$$,'42501',null,'Private guard has no public execution path');
reset role;
set local role service_role;
select throws_ok($$select * from private.stock_low_state$$,'42501',null,'Service role cannot bypass cycle state');
reset role;
select * from finish();
rollback;
