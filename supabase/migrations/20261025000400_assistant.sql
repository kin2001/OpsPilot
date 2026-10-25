-- Synthetic AI is deny-by-default. No client or organization-owner enablement RPC exists.
create table private.assistant_organizations (
 organization_id uuid primary key references public.organizations(id),
 synthetic_only boolean not null default true check(synthetic_only), enabled boolean not null default false
);
create table private.assistant_conversations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index assistant_conversations_owner on private.assistant_conversations(organization_id,user_id,id);
create table private.ai_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id), request_id uuid not null, conversation_id uuid references private.assistant_conversations(id) on delete set null,
 mode text not null check(mode in ('draft','priority','operations','asset_history','daily_brief')), role text not null,
 admitted_at timestamptz not null default now(), finished_at timestamptz, outcome text not null default 'active' check(outcome in ('active','succeeded','failed','abandoned')),
 source_ids uuid[] not null default '{}', unique(user_id,request_id)
);
create index assistant_user_quota on private.ai_runs(user_id,admitted_at);
create index assistant_org_quota on private.ai_runs(organization_id,admitted_at);
create table private.assistant_messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references private.assistant_conversations(id) on delete cascade,
 run_id uuid not null references private.ai_runs(id), role text not null check(role in ('user','assistant')),
 prompt text check(length(prompt) between 1 and 4000), result jsonb check(octet_length(result::text)<=64000), created_at timestamptz not null default now(),
 unique(run_id,role), check((role='user' and prompt is not null and result is null) or (role='assistant' and prompt is null and result is not null))
);
create index assistant_message_expiry on private.assistant_messages(created_at,id);

create function private.assistant_role(org uuid,actor uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.organization_members where organization_id=org and user_id=actor and active and private.auth_user_active(actor)
$$;
create function private.assistant_source_access(org uuid,actor uuid,source uuid,role text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_orders w where w.organization_id=org and w.id=source and (
 role in ('owner','manager','supervisor') or
 (role='technician' and exists(select 1 from public.work_order_assignments a where a.organization_id=org and a.work_order_id=w.id and a.user_id=actor and a.unassigned_at is null)) or
 (role='inventory' and exists(select 1 from public.work_order_parts p where p.organization_id=org and p.work_order_id=w.id))))
$$;
create function private.assistant_enabled(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and synthetic_only from private.assistant_organizations where organization_id=org),false)
$$;
create function private.assistant_message_access(message private.assistant_messages,actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.ai_runs r where r.id=(message).run_id and r.user_id=actor
 and r.role=private.assistant_role(r.organization_id,actor) and private.assistant_enabled(r.organization_id)
 and exists(select 1 from private.assistant_messages answer where answer.run_id=r.id and answer.role='assistant'
  and not exists(select 1 from jsonb_array_elements(answer.result->'retrieval'->'sources') s
   where not private.assistant_source_access(r.organization_id,actor,(s->>'id')::uuid,r.role))))
$$;

create function public.assistant_admit(organization_id uuid,request_id uuid,conversation_id uuid,mode text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid();role text;run uuid;conversation uuid:=conversation_id;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED';end if;
 role:=private.assistant_role(organization_id,actor);
 if role is null then raise exception using message='FORBIDDEN';end if;
 if not private.assistant_enabled(organization_id) then raise exception using message='AI_DISABLED';end if;
 if request_id is null or mode is null or mode not in ('draft','priority','operations','asset_history','daily_brief') then raise exception using message='VALIDATION';end if;
 if mode in ('draft','priority') and role not in ('owner','manager','supervisor') then raise exception using message='FORBIDDEN';end if;
 -- Both locks are needed: a user can belong to multiple organizations.
 perform pg_advisory_xact_lock(hashtextextended('assistant-org:'||organization_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('assistant-user:'||actor::text,0));
 if exists(select 1 from private.ai_runs r where r.user_id=actor and r.request_id=request_id) then raise exception using message='AI_REQUEST_REUSED';end if;
 update private.ai_runs r set outcome='abandoned',finished_at=now() where r.user_id=actor and r.outcome='active' and r.admitted_at<now()-interval '60 seconds';
 if exists(select 1 from private.ai_runs r where r.user_id=actor and r.outcome='active') then raise exception using message='AI_BUSY';end if;
 if (select count(*) from private.ai_runs r where r.user_id=actor and r.admitted_at>=now()-interval '1 hour')>=5
 or (select count(*) from private.ai_runs r where r.organization_id=organization_id and r.admitted_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=50 then raise exception using message='AI_QUOTA';end if;
 if conversation is not null then
  if not exists(select 1 from private.assistant_conversations c where c.id=conversation and c.organization_id=organization_id and c.user_id=actor) then raise exception using message='FORBIDDEN';end if;
  if exists(select 1 from private.assistant_messages m where m.conversation_id=conversation and not private.assistant_message_access(m,actor)) then raise exception using message='FORBIDDEN';end if;
  if (select count(*) from private.assistant_messages m where m.conversation_id=conversation)>=49 then raise exception using message='AI_HISTORY_LIMIT';end if;
 else
  if (select count(*) from private.assistant_conversations c where c.user_id=actor)>=50 then raise exception using message='AI_HISTORY_LIMIT';end if;
  insert into private.assistant_conversations(organization_id,user_id) values(organization_id,actor) returning id into conversation;
 end if;
 insert into private.ai_runs(organization_id,user_id,request_id,conversation_id,mode,role) values(organization_id,actor,request_id,conversation,mode,role) returning id into run;
 return jsonb_build_object('run_id',run,'conversation_id',conversation);
end $$;

create function public.assistant_retrieve(organization_id uuid,mode text,query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid();role text;kind text;start_on date;end_on date;start_at timestamptz;end_at timestamptz;zone text;
 asset uuid;category text;sources jsonb;facts jsonb;total integer;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED';end if;
 role:=private.assistant_role(organization_id,actor);
 if role is null then raise exception using message='FORBIDDEN';end if;
 if not private.assistant_enabled(organization_id) then raise exception using message='AI_DISABLED';end if;
 perform private.object_fields(query,array['kind','range','asset_id','category']);
 perform private.object_fields(query->'range',array['from','to']);
 kind:=query->>'kind';category:=query->>'category';
 if kind is null or kind not in ('blocked_work_orders','completed_work','overdue_work','awaiting_parts','asset_history','daily_metrics','recurring_fault_counts')
 or mode is null or mode not in ('draft','priority','operations','asset_history','daily_brief')
 or (mode='asset_history' and kind<>'asset_history') or (mode='daily_brief' and kind<>'daily_metrics') then raise exception using message='VALIDATION';end if;
 if (mode in ('draft','priority') and role not in ('owner','manager','supervisor')) or (role='inventory' and (mode<>'operations' or kind<>'awaiting_parts')) then raise exception using message='FORBIDDEN';end if;
 if jsonb_typeof(query->'range'->'from') is distinct from 'string' or jsonb_typeof(query->'range'->'to') is distinct from 'string'
 or (query->'range'->>'from')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (query->'range'->>'to')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using message='VALIDATION';end if;
 start_on:=(query->'range'->>'from')::date;end_on:=(query->'range'->>'to')::date;
 if end_on-start_on not between 1 and 366 or start_on<date '0001-01-01' or end_on>date '9999-12-30' then raise exception using message='VALIDATION';end if;
 if kind='asset_history' then
  if jsonb_typeof(query->'asset_id') is distinct from 'string' then raise exception using message='VALIDATION';end if;
  asset:=(query->>'asset_id')::uuid;
  if not exists(select 1 from public.assets a where a.organization_id=organization_id and a.id=asset and (role in ('owner','manager','supervisor') or private.known_asset(organization_id,a.id))) then raise exception using message='FORBIDDEN';end if;
  if query?'category' and (jsonb_typeof(query->'category') is distinct from 'string' or length(category) not between 1 and 100) then raise exception using message='VALIDATION';end if;
 elsif query?'asset_id' or query?'category' then raise exception using message='VALIDATION';end if;
 select timezone into zone from public.organizations where id=organization_id;
 start_at:=start_on::timestamp at time zone zone;end_at:=end_on::timestamp at time zone zone;
 with scoped as (
  select w.id,w.asset_id,w.title,w.description,w.category,w.status,w.created_at,f.approved_at,w.due_at from public.work_orders w
  join private.report_work_facts(organization_id) f on f.id=w.id
  where w.organization_id=organization_id and private.assistant_source_access(organization_id,actor,w.id,role)
  and case kind
   when 'blocked_work_orders' then w.status='blocked'
   when 'completed_work' then f.approved_at>=start_at and f.approved_at<end_at
   when 'overdue_work' then w.status in ('open','scheduled','in_progress','blocked','awaiting_review') and w.due_at<now()
   when 'awaiting_parts' then exists(select 1 from public.work_order_parts p where p.organization_id=organization_id and p.work_order_id=w.id and p.requested>coalesce((select sum(r.quantity-r.released-r.returned) from public.stock_reservations r where r.organization_id=organization_id and r.work_order_id=w.id and r.part_id=p.part_id),0))
   when 'asset_history' then w.asset_id=asset and (category is null or w.category=category) and w.created_at>=start_at and w.created_at<end_at
   else w.created_at>=start_at and w.created_at<end_at end
 ), page as (select * from scoped order by id limit 50), groups as (
  select scoped.asset_id,scoped.category,count(*) recorded_work_orders from scoped group by scoped.asset_id,scoped.category order by scoped.asset_id,scoped.category limit 50
 ) select (select count(*) from scoped),
 coalesce((select jsonb_agg(jsonb_build_object('id',id,'asset_id',asset_id,'label',left(title,200),'status',status,'category',left(page.category,100),
  'note',case when role='inventory' then '' else left(description,4000) end,'occurred_at',coalesce(approved_at,created_at)) order by id) from page),'[]'),
 jsonb_build_object('scope','current_authorized_work','matching_work_orders',(select count(*) from scoped),
 'completed',(select count(*) from scoped where approved_at>=start_at and approved_at<end_at),
 'blocked',(select count(*) from scoped where status='blocked'),
 'overdue',(select count(*) from scoped where status in ('open','scheduled','in_progress','blocked','awaiting_review') and due_at<now()),
 'recurring_fault_counts',case when kind='recurring_fault_counts' then coalesce((select jsonb_agg(to_jsonb(groups)) from groups),'[]') else '[]'::jsonb end)
 into total,sources,facts;
 while octet_length(sources::text)+octet_length(facts::text)>18000 and jsonb_array_length(sources)>0 loop sources:=sources-(jsonb_array_length(sources)-1);end loop;
 if role in ('technician','inventory') then
  -- Restricted-role history retains only facts backed by the saved source set, so lost access hides all associated facts.
  select jsonb_build_object('scope','retrieved_source_sample','matching_work_orders',jsonb_array_length(sources),
   'completed',count(*) filter(where f.approved_at>=start_at and f.approved_at<end_at),
   'blocked',count(*) filter(where f.status='blocked'),
   'overdue',count(*) filter(where f.status in ('open','scheduled','in_progress','blocked','awaiting_review') and f.due_at<now()),
   'recurring_fault_counts',case when kind='recurring_fault_counts' then coalesce((select jsonb_agg(to_jsonb(g)) from (
    select w.asset_id,w.category,count(*) recorded_work_orders from public.work_orders w where w.organization_id=organization_id
    and w.id in (select (value->>'id')::uuid from jsonb_array_elements(sources)) group by w.asset_id,w.category order by w.asset_id,w.category
   )g),'[]') else '[]'::jsonb end) into facts
  from private.report_work_facts(organization_id) f where f.id in (select (value->>'id')::uuid from jsonb_array_elements(sources));
 end if;
 return jsonb_build_object('schema_version',1,'retrieved_at',now(),'range',query->'range','role',role,'sources',sources,'facts',facts,'truncated',total>jsonb_array_length(sources));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception using message='VALIDATION';
end $$;

-- Only the trusted Edge service may persist validated output. Ordinary callers cannot forge transcripts.
create function public.assistant_finish(run_id uuid,actor_id uuid,outcome text,prompt text,result jsonb) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare run private.ai_runs;role text;source jsonb;
begin
 select * into run from private.ai_runs where id=run_id for update;
 if run.id is null or run.outcome<>'active' then raise exception using message='FORBIDDEN';end if;
 if outcome='failed' then update private.ai_runs set outcome='failed',finished_at=now() where id=run_id;return;end if;
 role:=private.assistant_role(run.organization_id,run.user_id);
 if outcome<>'succeeded' or actor_id is distinct from run.user_id or run.role is distinct from role
 or not private.assistant_enabled(run.organization_id) or run.admitted_at<now()-interval '60 seconds' or run.conversation_id is null then raise exception using message='FORBIDDEN';end if;
 if prompt is null or length(prompt) not between 1 and 4000 or result is null or octet_length(result::text)>64000
 or result->>'schema_version' is distinct from '1' or result->>'mode' is distinct from run.mode or result->>'run_id' is distinct from run.id::text
 or result->>'conversation_id' is distinct from run.conversation_id::text or jsonb_typeof(result->'source_ids') is distinct from 'array'
 or jsonb_typeof(result->'retrieval'->'sources') is distinct from 'array' then raise exception using message='VALIDATION';end if;
 if jsonb_array_length(result->'source_ids')>50 or jsonb_array_length(result->'retrieval'->'sources')>50 then raise exception using message='VALIDATION';end if;
 if exists(select 1 from jsonb_array_elements_text(result->'source_ids') cited(id) where not exists(
  select 1 from jsonb_array_elements(result->'retrieval'->'sources') s where s->>'id'=cited.id)) then raise exception using message='VALIDATION';end if;
 for source in select value from jsonb_array_elements(result->'retrieval'->'sources') loop
  if not private.assistant_source_access(run.organization_id,run.user_id,(source->>'id')::uuid,role) then raise exception using message='FORBIDDEN';end if;
 end loop;
 if (select count(*) from private.assistant_messages where conversation_id=run.conversation_id)>=49 then raise exception using message='AI_HISTORY_LIMIT';end if;
 insert into private.assistant_messages(conversation_id,run_id,role,prompt,result,created_at) values(run.conversation_id,run.id,'user',prompt,null,clock_timestamp()),(run.conversation_id,run.id,'assistant',null,result,clock_timestamp());
 update private.ai_runs set outcome='succeeded',finished_at=now(),source_ids=array(select jsonb_array_elements_text(result->'source_ids')::uuid) where id=run_id;
end $$;

create function public.assistant_history(organization_id uuid,conversation_id uuid default null,after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='15s' as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid();items jsonb;next_id uuid;
begin
 if actor is null then raise exception using message='UNAUTHENTICATED';end if;
 if private.assistant_role(organization_id,actor) is null then raise exception using message='FORBIDDEN';end if;
 if not private.assistant_enabled(organization_id) then raise exception using message='AI_DISABLED';end if;
 if conversation_id is null then
  if after_id is not null and not exists(select 1 from private.assistant_conversations c where c.id=after_id and c.organization_id=organization_id and c.user_id=actor) then raise exception using message='FORBIDDEN';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'created_at',c.created_at) order by c.created_at desc,c.id desc),'[]') into items from (
   select c.* from private.assistant_conversations c where c.organization_id=organization_id and c.user_id=actor and (after_id is null or (c.created_at,c.id)<(select a.created_at,a.id from private.assistant_conversations a where a.id=after_id))
   and not exists(select 1 from private.assistant_messages m where m.conversation_id=c.id and m.created_at>now()-interval '30 days' and not private.assistant_message_access(m,actor)) order by c.created_at desc,c.id desc limit 26
  ) c;
 else
  if not exists(select 1 from private.assistant_conversations c where c.id=conversation_id and c.organization_id=organization_id and c.user_id=actor) then raise exception using message='FORBIDDEN';end if;
  if exists(select 1 from private.assistant_messages m where m.conversation_id=conversation_id and m.created_at>now()-interval '30 days' and not private.assistant_message_access(m,actor)) then raise exception using message='FORBIDDEN';end if;
  if after_id is not null and not exists(select 1 from private.assistant_messages m where m.id=after_id and m.conversation_id=conversation_id) then raise exception using message='FORBIDDEN';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'created_at',m.created_at,'role',m.role,'prompt',m.prompt,'result',m.result) order by m.created_at,m.id),'[]') into items from (
   select m.* from private.assistant_messages m where m.conversation_id=conversation_id and m.created_at>now()-interval '30 days' and (after_id is null or (m.created_at,m.id)>(select a.created_at,a.id from private.assistant_messages a where a.id=after_id)) order by m.created_at,m.id limit 26
  ) m;
 end if;
 if jsonb_array_length(items)>25 then items:=items-25;next_id:=(items->24->>'id')::uuid;end if;
 return jsonb_build_object('items',items,'next_cursor',next_id);
end $$;
create function public.assistant_delete(organization_id uuid,conversation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
begin
 if auth.uid() is null then raise exception using message='UNAUTHENTICATED';end if;
 if private.assistant_role(organization_id,auth.uid()) is null then raise exception using message='FORBIDDEN';end if;
 delete from private.assistant_conversations c where c.id=conversation_id and c.organization_id=organization_id and c.user_id=auth.uid();
 if not found then raise exception using message='FORBIDDEN';end if;
end $$;
create function private.assistant_cleanup() returns integer language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare removed integer;
begin
 delete from private.assistant_messages where id in (select id from private.assistant_messages where created_at<=now()-interval '30 days' order by created_at,id limit 1000);
 get diagnostics removed=row_count;return removed;
end $$;
select cron.schedule('opspilot-assistant-retention','17 2 * * *',$cron$select private.assistant_cleanup();$cron$);

revoke all on table private.assistant_organizations,private.assistant_conversations,private.assistant_messages,private.ai_runs from public,anon,authenticated,service_role;
revoke all on function private.assistant_role(uuid,uuid),private.assistant_source_access(uuid,uuid,uuid,text),private.assistant_enabled(uuid),private.assistant_message_access(private.assistant_messages,uuid),private.assistant_cleanup() from public,anon,authenticated,service_role;
revoke all on function public.assistant_admit(uuid,uuid,uuid,text),public.assistant_retrieve(uuid,text,jsonb),public.assistant_finish(uuid,uuid,text,text,jsonb),public.assistant_history(uuid,uuid,uuid),public.assistant_delete(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assistant_admit(uuid,uuid,uuid,text),public.assistant_retrieve(uuid,text,jsonb),public.assistant_history(uuid,uuid,uuid),public.assistant_delete(uuid,uuid) to authenticated;
grant execute on function public.assistant_finish(uuid,uuid,text,text,jsonb) to service_role;
