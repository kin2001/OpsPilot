-- Tenant list pages cannot use the asset-specific index for date/id ordering before RLS filtering.
create index work_orders_tenant_page_idx on public.work_orders(organization_id,created_at desc,id desc);
