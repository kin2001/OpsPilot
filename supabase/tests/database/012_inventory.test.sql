begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) select ('00000035-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'inventory35-'||n||'@example.test',now() from generate_series(1,6) n;
insert into public.organizations(id,name,timezone,currency,created_by) values
 ('10000035-0000-4000-8000-000000000001','Synthetic inventory','UTC','PHP','00000035-0000-4000-8000-000000000001'),
 ('10000035-0000-4000-8000-000000000002','Other inventory','UTC','PHP','00000035-0000-4000-8000-000000000006');
insert into public.organization_members(organization_id,user_id,role) values
 ('10000035-0000-4000-8000-000000000001','00000035-0000-4000-8000-000000000001','owner'),
 ('10000035-0000-4000-8000-000000000001','00000035-0000-4000-8000-000000000002','inventory'),
 ('10000035-0000-4000-8000-000000000001','00000035-0000-4000-8000-000000000003','manager'),
 ('10000035-0000-4000-8000-000000000001','00000035-0000-4000-8000-000000000004','supervisor'),
 ('10000035-0000-4000-8000-000000000001','00000035-0000-4000-8000-000000000005','technician'),
 ('10000035-0000-4000-8000-000000000002','00000035-0000-4000-8000-000000000006','owner');
create function pg_temp.ctx(expected integer default null,request uuid default gen_random_uuid()) returns jsonb language sql as $$ select jsonb_strip_nulls(jsonb_build_object('organization_id','10000035-0000-4000-8000-000000000001','request_id',request,'expected_version',expected)) $$;
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"aal":"aal2"}',true); end $$;
create temp table part as select public.save_part(pg_temp.ctx(),'{"code":"KG","name":"Lubricant","unit":"litre","reorder_threshold":"0.100"}') result;
create temp table location as select public.save_stock_location(pg_temp.ctx(),'{"code":"L1","name":"Shelf"}') result;
create function pg_temp.fields(qty jsonb default '"0.100"'::jsonb) returns jsonb language sql as $$ select jsonb_build_object('part_id',(select result#>>'{data,id}' from part),'location_id',(select result#>>'{data,id}' from location),'quantity',qty,'unit','kg') $$;
select lives_ok($$select public.save_part(pg_temp.ctx(1),jsonb_build_object('id',(select result#>>'{data,id}' from part),'code','KG','name','Lubricant','unit','kg','reorder_threshold','0.100'))$$,'Unit can change before first movement');
select throws_ok($$select public.save_part(pg_temp.ctx(1),jsonb_build_object('id',(select result#>>'{data,id}' from part),'code','KG','name','Stale','unit','kg','reorder_threshold',null))$$,'P0001','CONFLICT','Stale catalog edit conflicts');
select throws_ok($$select public.save_part(pg_temp.ctx(),'{"code":"KG","name":"Duplicate","unit":"kg","reorder_threshold":null}')$$,'P0001','CONFLICT','Tenant code is unique');
select throws_ok($$select public.save_part(pg_temp.ctx(),'{"code":" ","name":"Invalid","unit":"kg","reorder_threshold":null}')$$,'P0001','VALIDATION','Empty code denied');
select throws_ok($$select public.save_part(pg_temp.ctx(),'{"code":"P2","name":"Invalid","unit":"kg","reorder_threshold":"0.0001"}')$$,'P0001','VALIDATION','Threshold precision never rounded');
create temp table received as select pg_temp.ctx() ctx,pg_temp.fields() fields;
alter table received add column result jsonb;
update received set result=public.receive_stock(ctx,fields);
select is((select public.receive_stock(ctx,fields) from received),(select result from received),'Lost-ack receipt replay returns original envelope');
select throws_ok($$select public.receive_stock(ctx,fields||'{"quantity":"0.200"}') from received$$,'P0001','CONFLICT','Changed-payload retry conflicts');
select lives_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('"0.200"'))$$,'Second receipt adds exact decimal');
select is((select on_hand::text from public.inventory_balances where organization_id='10000035-0000-4000-8000-000000000001'),'0.300','0.100 plus 0.200 equals exact 0.300');
select is(public.list_inventory_balances('10000035-0000-4000-8000-000000000001')->'items'->0->>'available','0.300','Available is returned as exact decimal string');
select is(public.list_inventory_parts('10000035-0000-4000-8000-000000000001')->'items'->0->>'reorder_threshold','0.100','Threshold read is decimal string');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('"0.0001"'))$$,'P0001','VALIDATION','Excess precision denied before numeric typmod');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('0.1'))$$,'P0001','VALIDATION','JSON number denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('"1e1"'))$$,'P0001','VALIDATION','Exponent denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('"0"'))$$,'P0001','VALIDATION','Zero movement denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('"-1"'))$$,'P0001','VALIDATION','Negative quantity denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields('"100000000000"'))$$,'P0001','VALIDATION','Overflow denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields()||'{"unit":"litre"}')$$,'P0001','VALIDATION','Wrong unit denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields()||'{"actor_id":"00000035-0000-4000-8000-000000000002"}')$$,'P0001','VALIDATION','Client actor authority denied');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields()||'{"location_id":"10000035-0000-4000-8000-000000000002"}')$$,'P0001','NOT_FOUND','Unknown location denied');
select throws_ok($$select public.save_part(pg_temp.ctx(2),jsonb_build_object('id',(select result#>>'{data,id}' from part),'code','KG','name','Lubricant','unit','litre','reorder_threshold',null))$$,'P0001','INVALID_TRANSITION','Unit fixed after first movement');
select throws_ok($$update public.inventory_movements set quantity=1 where organization_id='10000035-0000-4000-8000-000000000001'$$,'P0001','FORBIDDEN','Posted movement update denied even through privileged SQL');
select throws_ok($$delete from public.inventory_movements where organization_id='10000035-0000-4000-8000-000000000001'$$,'P0001','FORBIDDEN','Posted movement delete denied');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),pg_temp.fields()||'{"direction":"out","reason":" "}')$$,'P0001','VALIDATION','Adjustment reason required');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),pg_temp.fields()||jsonb_build_object('direction','out','reason',chr(160)||chr(65279)))$$,'P0001','VALIDATION','Unicode whitespace reason denied');
do $$ begin perform set_config('request.jwt.claims','{"aal":"aal1"}',true); end $$;
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),pg_temp.fields()||'{"direction":"out","reason":"Count"}')$$,'P0001','FORBIDDEN','Adjustment requires verified AAL2');
do $$ begin perform set_config('request.jwt.claims','{"aal":"aal2"}',true); end $$;
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),pg_temp.fields('"0.301"')||'{"direction":"out","reason":"Count"}')$$,'P0001','CONFLICT','Adjustment cannot overdraw');
-- Seed a future reservation without changing physical ledger facts; adjustments must preserve it.
update public.inventory_balances set reserved=0.250 where organization_id='10000035-0000-4000-8000-000000000001';
select is(public.list_inventory_balances('10000035-0000-4000-8000-000000000001')->'items'->0->>'available','0.050','Available excludes reserved stock');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),pg_temp.fields()||'{"direction":"out","reason":"Count"}')$$,'P0001','CONFLICT','Adjustment cannot consume reserved stock');
update public.inventory_balances set reserved=0 where organization_id='10000035-0000-4000-8000-000000000001';
create temp table compensated as select pg_temp.ctx() ctx,pg_temp.fields()||jsonb_build_object('direction','out','reason','Reverse incorrect receipt','correction_of',(select result#>>'{data,id}' from received)) fields;
alter table compensated add column result jsonb;
update compensated set result=public.adjust_stock(ctx,fields);
select is((select public.adjust_stock(ctx,fields) from compensated),(select result from compensated),'Compensation replays once');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),fields) from compensated$$,'P0001','CONFLICT','One compensation per predecessor');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),fields||'{"quantity":"0.001"}') from compensated$$,'P0001','VALIDATION','Linked compensation requires exact reversal');
select is((select on_hand::text from public.inventory_balances where organization_id='10000035-0000-4000-8000-000000000001'),'0.200','Compensation retains original history and adjusts balance');
select is((select count(*) from public.inventory_movements where organization_id='10000035-0000-4000-8000-000000000001'),3::bigint,'Exactly three immutable movements');
select is((select count(*) from public.audit_logs where organization_id='10000035-0000-4000-8000-000000000001' and action='inventory.movement'),3::bigint,'Exactly one detailed audit per committed movement');
select ok(not exists(select 1 from public.inventory_balances b where b.organization_id='10000035-0000-4000-8000-000000000001' and (b.available<>b.on_hand-b.reserved or b.on_hand<>(select sum(case when m.direction='in' then m.quantity else -m.quantity end) from public.inventory_movements m where m.organization_id=b.organization_id and m.part_id=b.part_id and m.location_id=b.location_id))),'Baseline ledger, balances and available reconcile');
select is(jsonb_array_length(public.list_inventory_movements('10000035-0000-4000-8000-000000000001',null,1)->'items'),1,'Movement reads bounded');
select ok(public.list_inventory_movements('10000035-0000-4000-8000-000000000001',null,1)->>'next_cursor' is not null,'More movement rows have a cursor');
select throws_ok($$select public.list_inventory_parts('10000035-0000-4000-8000-000000000001',null,101)$$,'P0001','VALIDATION','Oversize page denied');
select throws_ok($$select public.list_inventory_movements('10000035-0000-4000-8000-000000000001',null,null)$$,'P0001','VALIDATION','Null page denied');
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000002',true); end $$;
select lives_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields())$$,'Inventory role posts stock');
select lives_ok($$select public.list_inventory_movements('10000035-0000-4000-8000-000000000001')$$,'Inventory role reads ledger');
create temp table quota_receipt as select pg_temp.ctx() ctx,pg_temp.fields() fields;
alter table quota_receipt add column result jsonb;
update quota_receipt set result=public.receive_stock(ctx,fields);
-- Deliberate quota fixture retains receipts; no production limit or immutable history is reset.
insert into private.command_receipts(organization_id,actor_id,request_id,action,payload_hash,result)
 select '10000035-0000-4000-8000-000000000001','00000035-0000-4000-8000-000000000002',gen_random_uuid(),'synthetic_quota','fixture','{}'::jsonb from generate_series(1,60);
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields())$$,'P0001','RATE_LIMITED','Existing command quota protects stock writes');
select is((select public.receive_stock(ctx,fields) from quota_receipt),(select result from quota_receipt),'Durable replay bypasses new-command quota without mutating stock');
update auth.users set banned_until=now()+interval '1 day' where id='00000035-0000-4000-8000-000000000002';
select throws_ok($$select public.receive_stock(ctx,fields) from quota_receipt$$,'P0001','FORBIDDEN','Banned actor cannot replay stock receipt');
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000003',true); end $$;
select lives_ok($$select public.list_inventory_parts('10000035-0000-4000-8000-000000000001')$$,'Manager reads catalog');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields())$$,'P0001','FORBIDDEN','Manager cannot post stock');
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000004',true); end $$;
select lives_ok($$select public.list_inventory_balances('10000035-0000-4000-8000-000000000001')$$,'Supervisor reads balances');
select throws_ok($$select public.adjust_stock(pg_temp.ctx(),pg_temp.fields()||'{"direction":"out","reason":"Count"}')$$,'P0001','FORBIDDEN','Supervisor cannot adjust stock');
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000005',true); end $$;
select throws_ok($$select public.list_inventory_parts('10000035-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Technician has no unlinked tenant inventory read');
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000006',true); end $$;
select throws_ok($$select public.list_inventory_movements('10000035-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Other-tenant owner denied ledger');
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields())$$,'P0001','FORBIDDEN','Other-tenant owner denied write');
do $$ begin perform set_config('request.jwt.claim.sub','00000035-0000-4000-8000-000000000001',true); end $$;
update public.organization_members set active=false where organization_id='10000035-0000-4000-8000-000000000001' and user_id='00000035-0000-4000-8000-000000000001';
select throws_ok($$select public.receive_stock(ctx,fields) from received$$,'P0001','FORBIDDEN','Revoked membership cannot replay old receipt');
select throws_ok($$select public.list_inventory_parts('10000035-0000-4000-8000-000000000001')$$,'P0001','FORBIDDEN','Revoked reader denied');
set local role authenticated;
select throws_ok($$select * from public.inventory_balances$$,'42501',null,'Direct balances read denied');
select throws_ok($$select * from public.inventory_movements$$,'42501',null,'Direct ledger read denied');
select throws_ok($$delete from public.inventory_movements$$,'42501',null,'Direct ledger delete denied');
select throws_ok($$select private.inventory_command('{}','receive_stock','{}')$$,'42501',null,'Private dispatcher denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.parts$$,'42501',null,'Service role has no catalog bypass');
select throws_ok($$select public.receive_stock('{}','{}')$$,'42501',null,'Service role cannot call browser stock command');
reset role;
do $$ begin perform set_config('request.jwt.claim.sub','',true); end $$;
select throws_ok($$select public.receive_stock(pg_temp.ctx(),pg_temp.fields())$$,'P0001','UNAUTHENTICATED','Missing Auth actor denied');
select * from finish();
rollback;
