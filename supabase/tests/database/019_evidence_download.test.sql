begin;
select no_plan();
create function pg_temp.u(n integer) returns uuid language sql immutable as $$select ('00000047-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email,email_confirmed_at) select pg_temp.u(n),'evidence47-'||n||'@example.test',now() from generate_series(1,2)n;
insert into public.organizations(id,name,timezone,currency,created_by) values(pg_temp.u(100),'Evidence47','UTC','PHP',pg_temp.u(1)),(pg_temp.u(101),'Other47','UTC','PHP',pg_temp.u(2));
insert into public.organization_members(organization_id,user_id,role) values(pg_temp.u(100),pg_temp.u(1),'owner'),(pg_temp.u(101),pg_temp.u(2),'owner');
insert into public.assets(id,organization_id,code,name,category,created_by) values(pg_temp.u(200),pg_temp.u(100),'E47','Synthetic image parent','pump',pg_temp.u(1));
insert into public.attachments(id,organization_id,asset_id,object_key,name,media_type,size,uploader_id,status,checksum,width,height,ready_at)
 values(pg_temp.u(300),pg_temp.u(100),pg_temp.u(200),'evidence47/ready','ready.png','image/png',68,pg_temp.u(1),'ready',repeat('a',64),1,1,now()),
 (pg_temp.u(301),pg_temp.u(100),pg_temp.u(200),'evidence47/pending','pending.png','image/png',68,pg_temp.u(1),'pending',null,null,null,null);
insert into storage.objects(bucket_id,name) values('repair-evidence','evidence47/ready'),('repair-evidence','evidence47/pending'),('repair-evidence','evidence47/orphan');
create function pg_temp.visible(operation text) returns integer language plpgsql as $$
begin
 perform set_config('storage.operation',operation,true);
 return (select count(*)::integer from storage.objects where bucket_id='repair-evidence' and name like 'evidence47/%');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.u(1)::text,true);
select is(pg_temp.visible('object.get_authenticated_info'),1,'Current owner can resolve ready image metadata; pending and orphan objects stay hidden');
select is(pg_temp.visible('object.get_authenticated'),1,'Current owner can download ready image bytes');
select is(pg_temp.visible('object.list'),0,'Listing does not expose evidence');
select is(pg_temp.visible('object.sign'),0,'Single signing remains denied');
select is(pg_temp.visible('object.sign_many'),0,'Bulk signing remains denied');
select is(pg_temp.visible('object.get_public'),0,'Public download remains denied');
select is(pg_temp.visible(''),0,'Missing operation fails closed');
select set_config('request.jwt.claim.sub',pg_temp.u(2)::text,true);
select is(pg_temp.visible('object.get_authenticated_info'),0,'Wrong tenant cannot resolve metadata');
select is(pg_temp.visible('object.get_authenticated'),0,'Wrong tenant cannot download bytes');
reset role;
update public.organization_members set active=false where organization_id=pg_temp.u(100) and user_id=pg_temp.u(1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.u(1)::text,true);
select is(pg_temp.visible('object.get_authenticated_info'),0,'Revoked owner cannot resolve metadata');
select is(pg_temp.visible('object.get_authenticated'),0,'Revoked owner cannot download bytes');
reset role;
select * from finish();
rollback;
