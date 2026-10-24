begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('00000036-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'job36-'||n||'@example.test',now() from generate_series(1,4) n;
insert into public.organizations(id,name,timezone,currency,created_by) values('10000036-0000-4000-8000-000000000001','Synthetic job36','UTC','PHP','00000036-0000-4000-8000-000000000001');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000036-0000-4000-8000-000000000001','00000036-0000-4000-8000-000000000001','owner'),
 ('10000036-0000-4000-8000-000000000001','00000036-0000-4000-8000-000000000002','technician'),
 ('10000036-0000-4000-8000-000000000001','00000036-0000-4000-8000-000000000003','inventory');
insert into public.assets(id,organization_id,code,name,category,created_by) values('20000036-0000-4000-8000-000000000001','10000036-0000-4000-8000-000000000001','J36','Synthetic pump','pump','00000036-0000-4000-8000-000000000001');
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('30000036-0000-4000-8000-000000000001','10000036-0000-4000-8000-000000000001',1,'20000036-0000-4000-8000-000000000001','Synthetic repair','Synthetic allocation','pump','normal','00000036-0000-4000-8000-000000000001','open','00000036-0000-4000-8000-000000000001');
insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('10000036-0000-4000-8000-000000000001','30000036-0000-4000-8000-000000000001','00000036-0000-4000-8000-000000000002');
insert into public.parts(id,organization_id,code,name,unit,created_by) values('40000036-0000-4000-8000-000000000001','10000036-0000-4000-8000-000000000001','KG','Synthetic stock','kg','00000036-0000-4000-8000-000000000001');
create function pg_temp.ctx(version integer) returns jsonb language sql as $$select jsonb_strip_nulls(jsonb_build_object('organization_id','10000036-0000-4000-8000-000000000001','request_id',gen_random_uuid(),'expected_version',version))$$;
create function pg_temp.fields(qty jsonb) returns jsonb language sql as $$select jsonb_build_object('work_order_id','30000036-0000-4000-8000-000000000001','lines',jsonb_build_array(jsonb_build_object('part_id','40000036-0000-4000-8000-000000000001','unit','kg','quantity',qty)))$$;
do $$begin perform set_config('request.jwt.claim.sub','00000036-0000-4000-8000-000000000001',true);end$$;
select throws_ok($$select public.request_parts(pg_temp.ctx(1),pg_temp.fields('"1"'))$$,'P0001','FORBIDDEN','Owner cannot impersonate assigned technician request');
do $$begin perform set_config('request.jwt.claim.sub','00000036-0000-4000-8000-000000000002',true);end$$;
select throws_ok($$select public.request_parts(pg_temp.ctx(1),'{"work_order_id":"30000036-0000-4000-8000-000000000001","lines":[{"part_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","quantity":"1","unit":"kg"},{"part_id":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA","quantity":"1","unit":"kg"}]}')$$,'P0001','VALIDATION','Direct request rejects case-variant part identity before lookup');
do $$begin perform set_config('request.jwt.claim.sub','00000036-0000-4000-8000-000000000001',true);end$$;
select throws_ok(format('select public.reserve_parts(pg_temp.ctx(1),%L::jsonb)',jsonb_build_object('work_order_id','30000036-0000-4000-8000-000000000001','lines',jsonb_build_array(
 jsonb_build_object('part_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','quantity','1','unit','kg'),
 jsonb_build_object('part_id',case when variant='part' then 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' end,'location_id',case when variant='location' then 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB' else 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' end,'quantity','1','unit','kg')))),'P0001','VALIDATION','Direct reserve rejects case-variant '||variant||' identity before lookup') from (values('part'),('location')) variants(variant);
select throws_ok(format('select public.%I(pg_temp.ctx(1),%L::jsonb)',command,jsonb_build_object('work_order_id','30000036-0000-4000-8000-000000000001','lines',jsonb_build_array(
 jsonb_build_object('reservation_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','quantity','1','unit','kg'),
 jsonb_build_object('reservation_id','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA','quantity','1','unit','kg')))),'P0001','VALIDATION','Direct '||command||' rejects case-variant reservation identity before lookup') from (values('release_reservation'),('issue_reserved_stock'),('return_stock')) commands(command);
do $$begin perform set_config('request.jwt.claim.sub','00000036-0000-4000-8000-000000000002',true);end$$;
select throws_ok($$select public.request_parts(pg_temp.ctx(1),pg_temp.fields('1'))$$,'P0001','VALIDATION','Numeric JSON quantities rejected');
select throws_ok($$select public.request_parts(pg_temp.ctx(1),pg_temp.fields('"0.0001"'))$$,'P0001','VALIDATION','Extra precision rejected before rounding');
create temp table requested as select pg_temp.ctx(1) ctx,pg_temp.fields('"0.100"') fields;
alter table requested add column result jsonb;
update requested set result=public.request_parts(ctx,fields);
select is((select result#>>'{data,parts,0,requested}' from requested),'0.100','Request quantity is exact string');
select is((select public.request_parts(ctx,fields) from requested),(select result from requested),'Lost acknowledgement replays original result');
select throws_ok($$select public.request_parts(ctx,jsonb_set(fields,'{lines,0,quantity}','"0.200"')) from requested$$,'P0001','CONFLICT','Changed payload cannot reuse receipt');
select throws_ok($$select public.request_parts(pg_temp.ctx(1),pg_temp.fields('"1"'))$$,'P0001','CONFLICT','Fresh command requires current WO version');
select is((select count(*)::integer from public.inventory_movements),0,'Requests never move stock');
select is((select count(*)::integer from public.stock_reservations),0,'Requests never reserve stock');
select throws_ok($$select public.reserve_parts(pg_temp.ctx(2),pg_temp.fields('"1"'))$$,'P0001','FORBIDDEN','Technician cannot reserve stock');
-- Exercise cancellation against the composed scheduled/PM operational implementation.
do $$begin perform set_config('request.jwt.claim.sub','00000036-0000-4000-8000-000000000001',true);end$$;
create temp table location as select public.save_stock_location(pg_temp.ctx(null),'{"code":"L36","name":"Synthetic shelf"}') result;
select public.receive_stock(pg_temp.ctx(null),jsonb_build_object('part_id','40000036-0000-4000-8000-000000000001','location_id',(select result#>>'{data,id}' from location),'quantity','1.000','unit','kg'));
create temp table allocation as select public.reserve_parts(pg_temp.ctx(2),jsonb_build_object('work_order_id','30000036-0000-4000-8000-000000000001','lines',jsonb_build_array(jsonb_build_object('part_id','40000036-0000-4000-8000-000000000001','location_id',(select result#>>'{data,id}' from location),'quantity','0.100','unit','kg')))) result;
create temp table issued as select public.issue_reserved_stock(pg_temp.ctx(3),jsonb_build_object('work_order_id','30000036-0000-4000-8000-000000000001','lines',jsonb_build_array(jsonb_build_object('reservation_id',(select result#>>'{data,reservations,0,id}' from allocation),'quantity','0.040','unit','kg')))) result;
create temp table cancellation as select public.transition_work_order(pg_temp.ctx(4),'30000036-0000-4000-8000-000000000001','canceled','Synthetic cancellation') result;
select is((select reserved::text from public.inventory_balances where organization_id='10000036-0000-4000-8000-000000000001'),'0.000','Composed cancellation releases only unused allocation');
select is((select on_hand::text from public.inventory_balances where organization_id='10000036-0000-4000-8000-000000000001'),'0.960','Composed cancellation preserves physical consumption');
select is((select released::text from public.stock_reservations where organization_id='10000036-0000-4000-8000-000000000001'),'0.060','Cancellation retains exact released history');
-- Legacy linked compensation must never bypass the net-issued return bound.
do $$begin perform set_config('request.jwt.claims','{"aal":"aal2"}',true);end$$;
create function pg_temp.stock_fields(qty text) returns jsonb language sql as $$select jsonb_build_object('part_id','40000036-0000-4000-8000-000000000001','location_id',(select result#>>'{data,id}' from location),'quantity',qty,'unit','kg')$$;
select throws_ok($$select public.adjust_stock(pg_temp.ctx(null),pg_temp.stock_fields('0.040')||jsonb_build_object('direction','in','reason','Attempt issue reversal','correction_of',(select id from public.inventory_movements where kind='issue')))$$,'P0001','INVALID_TRANSITION','AAL2 adjustment cannot reverse a job issue');
create temp table returned as select pg_temp.ctx(5) ctx,jsonb_build_object('work_order_id','30000036-0000-4000-8000-000000000001','lines',jsonb_build_array(jsonb_build_object('reservation_id',(select result#>>'{data,reservations,0,id}' from allocation),'quantity','0.040','unit','kg'))) fields;
alter table returned add column result jsonb;
update returned set result=public.return_stock(ctx,fields);
select is((select public.return_stock(ctx,fields) from returned),(select result from returned),'Job return replays without a second stock addition');
select throws_ok($$select public.return_stock(pg_temp.ctx(6),fields) from returned$$,'P0001','CONFLICT','Rejected issue compensation cannot allow over-return');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(null),pg_temp.stock_fields('0.040')||jsonb_build_object('direction','out','reason','Attempt return reversal','correction_of',(select id from public.inventory_movements where kind='return')))$$,'P0001','INVALID_TRANSITION','AAL2 adjustment cannot reverse a job return');
select is((select on_hand::text from public.inventory_balances where organization_id='10000036-0000-4000-8000-000000000001'),'1.000','Issue and return do not create stock through compensation');
create temp table compensated as select pg_temp.ctx(null) ctx,pg_temp.stock_fields('1.000')||jsonb_build_object('direction','out','reason','Reverse receipt','correction_of',(select id from public.inventory_movements where kind='receipt')) fields;
alter table compensated add column result jsonb;
update compensated set result=public.adjust_stock(ctx,fields);
select is((select public.adjust_stock(ctx,fields) from compensated),(select result from compensated),'Legacy receipt compensation still replays');
create temp table restored as select pg_temp.ctx(null) ctx,pg_temp.stock_fields('1.000')||jsonb_build_object('direction','in','reason','Reverse adjustment','correction_of',(select result#>>'{data,id}' from compensated)) fields;
alter table restored add column result jsonb;
update restored set result=public.adjust_stock(ctx,fields);
select is((select public.adjust_stock(ctx,fields) from restored),(select result from restored),'Legacy adjustment compensation still replays');
select is((select on_hand::text from public.inventory_balances where organization_id='10000036-0000-4000-8000-000000000001'),'1.000','Legacy compensation preserves exact physical stock');
do $$begin perform set_config('request.jwt.claim.sub','00000036-0000-4000-8000-000000000002',true);end$$;
update public.work_order_assignments set unassigned_at=now() where work_order_id='30000036-0000-4000-8000-000000000001';
select throws_ok($$select public.request_parts(ctx,fields) from requested$$,'P0001','FORBIDDEN','Removed assignment denied before replay');
select throws_ok($$select public.get_job_parts('10000036-0000-4000-8000-000000000001','30000036-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Former technician cannot read job parts');
set local role authenticated;
select throws_ok($$select * from public.work_order_parts$$,'42501',null,'Direct job quantities read denied');
select throws_ok($$select * from public.stock_reservations$$,'42501',null,'Direct allocations read denied');
select throws_ok($$insert into public.job_stock_movements values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())$$,'42501',null,'Direct movement lineage write denied');
select throws_ok($$select private.cancel_job_reservations(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'Private cancellation bypass denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.stock_reservations$$,'42501',null,'Service role has no allocation bypass');
select throws_ok($$select public.request_parts('{}','{}')$$,'42501',null,'Service role cannot invoke user command');
reset role;
select * from finish();
rollback;
