import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page, type Route } from '@playwright/test';
import { enrollMfa } from '../integration/mfa';
import { transitionWorkOrder } from '../../src/app/commands';
import { savePart, saveStockLocation } from '../../src/app/inventory-client';
import type { Database } from '../../src/lib/database.types';
import { readIsolatedServiceConfig } from './service-config';
import { fixtureOrganizationIds, fixtureUserId, prepareWorkspacePage } from './workspace-fixture';

const serviceConfig = readIsolatedServiceConfig(process.env);
const appOrigin = 'http://127.0.0.1:5173';
const authStorageKey = serviceConfig ? `sb-${new URL(serviceConfig.url).hostname.split('.')[0]}-auth-token` : 'sb-127-auth-token';
const partId = '79000000-0000-4000-8000-000000000001';
const locationId = '79000000-0000-4000-8000-000000000002';
const workOrderId = '79000000-0000-4000-8000-000000000003';
type MockJobParts = {
  id: string; number: number; status: 'blocked' | 'in_progress'; version: number;
  parts: { part_id: string; unit: string; requested: string; reserved: string; issued: string; returned: string; shortage: string }[];
  reservations: { id: string; part_id: string; location_id: string; unit: string; reserved: string; issued: string; returned: string; released: string }[];
  reconciliation_state: 'consistent' | 'discrepancy';
};

function reply(route: Route, status: number, value: unknown) {
  const headers = route.request().headers();
  return route.fulfill({ status, contentType: 'application/json', headers: {
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': headers['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
  }, body: JSON.stringify(value) });
}

type ServicePerson = { id: string; session: Session; client: SupabaseClient<Database> };

function serviceSql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Synthetic inventory journey setup failed; raw output withheld.');
}

async function createServicePerson(label: string): Promise<ServicePerson> {
  if (!serviceConfig) throw new Error('Job-owned loopback Supabase is required.');
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}-Aa9!`;
  const admin = createClient<Database>(serviceConfig.url, serviceConfig.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic journey account setup failed.');
  const client = createClient<Database>(serviceConfig.url, serviceConfig.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error('Synthetic journey account sign-in failed.');
  await enrollMfa(client);
  const current = await client.auth.getSession();
  const session = current.data.session;
  if (current.error || !session) throw new Error('Synthetic journey session could not be confirmed.');
  const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1] ?? '', 'base64url').toString()) as { aal?: string };
  if (claims.aal !== 'aal2') throw new Error('Synthetic journey session did not satisfy the current second-factor requirement.');
  return { id: created.data.user.id, session, client };
}

async function seedServicePage(page: Page, person: ServicePerson) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: authStorageKey, value: person.session });
  await page.goto(appOrigin);
}

async function prepareInventoryPage(page: Page, role = 'owner') {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha], role);
  const requests: Record<string, unknown>[] = [];
  let available = '1.500';
  let jobParts: MockJobParts = {
    id: workOrderId, number: 42, status: 'blocked', version: 4,
    parts: [{ part_id: partId, unit: 'each', requested: '4.000', reserved: '0.000', issued: '0.000', returned: '0.000', shortage: '1.500' }],
    reservations: [], reconciliation_state: 'consistent',
  };
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const request = route.request();
    const name = new URL(request.url()).pathname.split('/').at(-1);
    const body = request.postDataJSON() as Record<string, any> | null;
    if (name === 'list_inventory_parts') return reply(route, 200, { items: [{ id: partId, organization_id: fixtureOrganizationIds.alpha, code: 'OF-204', name: 'Oil filter', unit: 'each', reorder_threshold: '1.500', archived_at: null, created_by: fixtureUserId, created_at: '2026-10-21T00:00:00Z', version: 1 }], next_cursor: null });
    if (name === 'list_stock_locations') return reply(route, 200, { items: [{ id: locationId, organization_id: fixtureOrganizationIds.alpha, code: 'WH-1', name: 'Main warehouse', created_by: fixtureUserId, created_at: '2026-10-21T00:00:00Z', version: 1 }], next_cursor: null });
    if (name === 'list_inventory_balances') return reply(route, 200, { items: [{ id: '79000000-0000-4000-8000-000000000004', organization_id: fixtureOrganizationIds.alpha, part_id: partId, location_id: locationId, on_hand: '2.500', reserved: '1.000', available, }], next_cursor: null });
    if (name === 'list_inventory_movements') return reply(route, 200, { items: [], next_cursor: null });
    if (name === 'get_job_parts') return reply(route, 200, jobParts);
    if (name === 'receive_stock') {
      requests.push(body ?? {});
      if (requests.length === 1) return reply(route, 503, { message: 'DEPENDENCY_UNAVAILABLE' });
      available = '2.000';
      const ctx = body?.ctx as Record<string, unknown>;
      const fields = body?.fields as Record<string, unknown>;
      const data = { id: '79000000-0000-4000-8000-000000000005', organization_id: fixtureOrganizationIds.alpha, part_id: fields.part_id, location_id: fields.location_id, kind: 'receipt', direction: 'in', quantity: fields.quantity, unit: fields.unit, actor_id: fixtureUserId, request_id: ctx.request_id, source: fields.source ?? null, reason: null, correction_of: null, created_at: '2026-10-21T01:00:00Z' };
      return reply(route, 200, { data, version: 1, request_id: ctx.request_id });
    }
    if (name === 'reserve_parts') {
      requests.push(body ?? {});
      jobParts = { ...jobParts, version: jobParts.version + 1, parts: [{ ...jobParts.parts[0], reserved: '2.500', shortage: '1.500' }], reservations: [{ id: '79000000-0000-4000-8000-000000000006', part_id: partId, location_id: locationId, unit: 'each', reserved: '2.500', issued: '0.000', returned: '0.000', released: '0.000' }] };
      const ctx = body?.ctx as Record<string, unknown>;
      return reply(route, 200, { data: jobParts, version: jobParts.version, request_id: ctx.request_id });
    }
    return route.fallback();
  });
  return { requests };
}

async function prepareWorkOrderPartsPage(page: Page, role: 'technician' | 'manager' = 'technician', status: 'blocked' | 'in_progress' = 'in_progress', shortage = '0.000') {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha], role);
  const order = {
    id: workOrderId, organization_id: fixtureOrganizationIds.alpha, number: 42,
    asset_id: '79000000-0000-4000-8000-000000000007', source_request_id: null,
    title: 'Synthetic repair', description: 'PRIVATE REPAIR NARRATIVE FIXTURE', category: 'inspection', priority: 'normal',
    due_at: null, planned_on: null, supervisor_id: fixtureUserId, status, blocks_operation: false,
    created_by: fixtureUserId, created_at: '2026-10-21T00:00:00Z', version: 4, repair_revision: 1,
    submitted_revision: null, opened_at: '2026-10-21T00:00:00Z', completed_at: null, priority_reason: null,
  };
  let jobParts: MockJobParts = { id: workOrderId, number: 42, status, version: 4, parts: shortage === '0.000' ? [] : [{ part_id: partId, unit: 'each', requested: '4.000', reserved: '0.000', issued: '0.000', returned: '0.000', shortage }], reservations: [], reconciliation_state: 'consistent' };
  const requests: Record<string, unknown>[] = [];
  await page.route('http://127.0.0.1:54321/rest/v1/work_orders**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('id')) return reply(route, 200, order);
    return reply(route, 200, [order]);
  });
  await page.route('http://127.0.0.1:54321/rest/v1/work_order_assignments**', async (route) => reply(route, 200, [{ user_id: fixtureUserId, unassigned_at: null }]));
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const request = route.request();
    const name = new URL(request.url()).pathname.split('/').at(-1);
    const body = request.postDataJSON() as Record<string, any> | null;
    if (name === 'get_job_parts') return reply(route, 200, jobParts);
    if (name === 'list_requestable_job_parts') return reply(route, 200, { items: [{ id: partId, code: 'OF-204', name: 'Oil filter', unit: 'each' }], next_cursor: null });
    if (name === 'request_parts') {
      requests.push(body ?? {});
      if (requests.length === 1) return reply(route, 503, { message: 'DEPENDENCY_UNAVAILABLE' });
      jobParts = { id: workOrderId, number: 42, status: 'blocked', version: 5, parts: [{ part_id: partId, unit: 'each', requested: '4.000', reserved: '0.000', issued: '0.000', returned: '0.000', shortage: '1.500' }], reservations: [], reconciliation_state: 'consistent' };
      order.status = 'blocked'; order.version = 5;
      const ctx = body?.ctx as Record<string, unknown>;
      return reply(route, 200, { data: jobParts, version: jobParts.version, request_id: ctx?.request_id });
    }
    if (name === 'transition_work_order') {
      requests.push(body ?? {});
      order.status = body?.target === 'in_progress' ? 'in_progress' : 'blocked';
      order.version += 1;
      const ctx = body?.ctx as Record<string, unknown>;
      return reply(route, 200, { data: order, version: order.version, request_id: ctx?.request_id });
    }
    return route.fallback();
  });
  return { requests };
}

test('workspace navigation opens inventory and shows exact low-stock balances', async ({ page }) => {
  await prepareInventoryPage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spare parts inventory' })).toBeVisible();
  const part = page.getByRole('row', { name: /Oil filter.*OF-204/ });
  await expect(part).toContainText('2.500');
  await expect(part).toContainText('1.000');
  await expect(part).toContainText('1.500');
  await expect(part).toContainText('Low stock');
  await page.screenshot({ path: 'test-results/por38-inventory-synthetic-desktop.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => page.locator('.side-rail').evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/por38-inventory-synthetic-320.png', fullPage: true });
  const dimensions = await page.evaluate(() => {
    const rail = document.querySelector('.side-rail')!;
    const bounds = rail.getBoundingClientRect();
    return { viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth, railRight: bounds.right, railTransform: getComputedStyle(rail).transform, railOpen: rail.getAttribute('data-open') };
  });
  expect(dimensions.content, 'inventory page content should not overflow a 320 CSS-pixel viewport').toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.railRight, `closed mobile navigation should stay offscreen: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(0);
});

test('uncertain receipt retry preserves exact fields and the original request identity', async ({ page }) => {
  const fixture = await prepareInventoryPage(page);
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await page.getByLabel('Part', { exact: true }).selectOption(partId);
  await page.getByLabel('Location', { exact: true }).selectOption(locationId);
  await page.getByLabel('Quantity', { exact: true }).fill('0.500');
  await page.getByLabel('Source', { exact: true }).fill('PO-TEST-42');
  await page.getByRole('button', { name: 'Record receipt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Confirmation is uncertain');
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('0.500');
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('PO-TEST-42');
  await page.getByRole('button', { name: 'Retry exact receipt', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Stock receipt recorded');
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[0]).toEqual(fixture.requests[1]);
  expect(fixture.requests[0]).toMatchObject({ fields: { quantity: '0.500', source: 'PO-TEST-42' } });
});

test('manager receives minimal job-parts context and may reserve without posting stock', async ({ page }) => {
  await prepareInventoryPage(page, 'manager');
  await page.goto(`/inventory?workOrder=${workOrderId}`);
  await expect(page.getByRole('heading', { name: 'WO-0042 parts' })).toBeVisible();
  await expect(page.getByText('1.500', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reserve parts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Receive stock', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Issue stock', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return stock', exact: true })).toHaveCount(0);
});

test('inventory officer sees linked quantities without reading private work-order narratives', async ({ page }) => {
  await prepareInventoryPage(page, 'inventory');
  let workOrderReads = 0;
  await page.route('http://127.0.0.1:54321/rest/v1/work_orders**', async (route) => {
    workOrderReads += 1;
    return reply(route, 200, [{ description: 'PRIVATE REPAIR NARRATIVE FIXTURE' }]);
  });
  await page.goto(`/inventory?workOrder=${workOrderId}`);
  await expect(page.getByRole('heading', { name: 'WO-0042 parts' })).toBeVisible();
  await expect(page.getByText('PRIVATE REPAIR NARRATIVE FIXTURE')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open authorized work order' })).toHaveCount(0);
  expect(workOrderReads).toBe(0);
});

test('assigned technician requests a catalog part with exact quantity and sees the shortage', async ({ page }) => {
  const fixture = await prepareWorkOrderPartsPage(page);
  await page.goto(`/work-orders?workOrder=${workOrderId}`);
  await expect(page.getByRole('heading', { name: 'Parts for this work order' })).toBeVisible();
  await page.getByLabel('Requested part').selectOption(partId);
  await page.getByLabel('Requested quantity').fill('4.000');
  await page.getByRole('button', { name: 'Request parts', exact: true }).click();
  await expect(page.getByText(/The outcome of a previous action is uncertain/)).toBeVisible();
  await expect(page.getByLabel('Requested quantity')).toHaveValue('4.000');
  await page.getByRole('button', { name: 'Retry exact parts request', exact: true }).click();
  await expect(page.getByText('1.500', { exact: true })).toBeVisible();
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[0]).toEqual(fixture.requests[1]);
  expect(fixture.requests[0]).toMatchObject({ fields: { work_order_id: workOrderId, lines: [{ part_id: partId, quantity: '4.000', unit: 'each' }] }, ctx: { expected_version: 4 } });
});

test('coordinator cannot resume blocked work while shortage or stock state is unresolved', async ({ page }) => {
  await prepareWorkOrderPartsPage(page, 'manager', 'blocked', '1.500');
  await page.goto(`/work-orders?workOrder=${workOrderId}`);
  const detail = page.getByRole('region', { name: 'Selected work order details' });
  await expect(detail.getByText(/A parts shortage remains/)).toBeVisible();
  await detail.getByLabel('Block or resume reason').fill('Parts shortage must be resolved first.');
  await detail.getByLabel('Planned work date').fill('2026-10-26');
  await expect(detail.getByRole('button', { name: 'Resume work', exact: true })).toBeDisabled();
  await expect(detail.getByRole('button', { name: 'Resume as scheduled', exact: true })).toBeDisabled();
});

test('coordinator explicitly resumes only after confirmed parts reconciliation', async ({ page }) => {
  const fixture = await prepareWorkOrderPartsPage(page, 'manager', 'blocked');
  await page.goto(`/work-orders?workOrder=${workOrderId}`);
  const detail = page.getByRole('region', { name: 'Selected work order details' });
  const status = detail.locator(':scope > .record-header .state-badge');
  await expect(status).toHaveText('blocked');
  await detail.getByLabel('Block or resume reason').fill('Parts are issued and stock is reconciled.');
  const resume = detail.getByRole('button', { name: 'Resume work', exact: true });
  await expect(resume).toBeEnabled();
  await expect(fixture.requests).toHaveLength(0);
  await resume.click();
  await expect(status).toHaveText('in progress');
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]).toMatchObject({ target: 'in_progress', reason: 'Parts are issued and stock is reconciled.' });
});

test('technician cannot open the general inventory catalog', async ({ page }) => {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha], 'technician');
  let inventoryReads = 0;
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/list_inventory_*', async (route) => {
    inventoryReads += 1;
    return route.fallback();
  });
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory is unavailable' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inventory', exact: true })).toHaveCount(0);
  expect(inventoryReads).toBe(0);
});

test('loopback inventory shortage journey replays the exact request and resumes only after issue', async ({ browser }) => {
  test.skip(!serviceConfig, 'This integrated journey runs only against job-owned loopback Supabase Auth and Postgres.');
  const config = serviceConfig!;
  const [owner, technician, manager, inventory] = await Promise.all([
    createServicePerson('por38-owner'), createServicePerson('por38-technician'), createServicePerson('por38-manager'), createServicePerson('por38-inventory'),
  ]);
  const organizationId = randomUUID(); const assetId = randomUUID(); const workOrderId = randomUUID();
  serviceSql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${organizationId}','Synthetic POR-38 ${organizationId.slice(0, 8)}','Asia/Manila','PHP','${owner.id}');
    insert into public.organization_members(organization_id,user_id,role) values('${organizationId}','${owner.id}','owner'),('${organizationId}','${technician.id}','technician'),('${organizationId}','${manager.id}','manager'),('${organizationId}','${inventory.id}','inventory');
    insert into public.assets(id,organization_id,code,name,category,created_by) values('${assetId}','${organizationId}','P38-${organizationId.slice(0, 6)}','Synthetic pump','pump','${owner.id}');
    insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('${workOrderId}','${organizationId}',38,'${assetId}','Synthetic parts shortage','Synthetic browser fixture','pump','normal','${manager.id}','open','${owner.id}');
    insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${organizationId}','${workOrderId}','${technician.id}');`);
  await transitionWorkOrder(owner.client, organizationId, workOrderId, 1, 'in_progress', undefined, randomUUID());
  const part = await savePart(inventory.client, organizationId, { code: 'P38-FLTR', name: 'Synthetic filter', unit: 'each', reorder_threshold: '1.000' }, randomUUID());
  const location = await saveStockLocation(inventory.client, organizationId, { code: 'P38-WH', name: 'Synthetic parts shelf' }, randomUUID());

  const technicianPage = await browser.newPage();
  const managerPage = await browser.newPage();
  const inventoryPage = await browser.newPage();
  await Promise.all([seedServicePage(technicianPage, technician), seedServicePage(managerPage, manager), seedServicePage(inventoryPage, inventory)]);

  const requestPayloads: unknown[] = [];
  await technicianPage.route(`${config.url}/rest/v1/rpc/request_parts`, async (route) => {
    requestPayloads.push(route.request().postDataJSON());
    if (requestPayloads.length === 1) {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      return route.fulfill({ response, status: 503, body: JSON.stringify({ message: 'DEPENDENCY_UNAVAILABLE' }) });
    }
    return route.continue();
  });
  await technicianPage.goto(`/work-orders?workOrder=${workOrderId}`);
  const technicianDetail = technicianPage.getByRole('region', { name: 'Selected work order details' });
  await expect(technicianDetail.getByRole('heading', { name: 'Parts for this work order' })).toBeVisible();
  await technicianDetail.getByLabel('Requested part').selectOption(part.id);
  await technicianDetail.getByLabel('Requested quantity').fill('2.000');
  await technicianDetail.getByRole('button', { name: 'Request parts', exact: true }).click();
  await expect(technicianPage.getByText(/The outcome of a previous action is uncertain/)).toBeVisible();
  await technicianPage.getByRole('button', { name: 'Retry pending action', exact: true }).click();
  await expect(technicianDetail.getByText('2.000', { exact: true })).toBeVisible();
  expect(requestPayloads).toHaveLength(2);
  expect(requestPayloads[0]).toEqual(requestPayloads[1]);
  expect(requestPayloads[0]).toMatchObject({ fields: { work_order_id: workOrderId, lines: [{ part_id: part.id, quantity: '2.000', unit: 'each' }] } });
  await technicianDetail.getByLabel('Block or resume reason').fill('Waiting for the requested synthetic filter.');
  await technicianDetail.getByRole('button', { name: 'Block work with reason', exact: true }).click();
  const technicianStatus = technicianDetail.locator(':scope > .record-header .state-badge');
  await expect(technicianStatus).toHaveText('blocked');

  await inventoryPage.goto(`/inventory?workOrder=${workOrderId}`);
  await inventoryPage.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await inventoryPage.getByLabel('Part', { exact: true }).selectOption(part.id);
  await inventoryPage.getByLabel('Location', { exact: true }).selectOption(location.id);
  await inventoryPage.getByLabel('Quantity', { exact: true }).fill('2.500');
  await inventoryPage.getByLabel('Source', { exact: true }).fill('Synthetic browser receipt');
  await inventoryPage.getByRole('button', { name: 'Record receipt', exact: true }).click();
  await expect(inventoryPage.getByText('Stock receipt recorded.', { exact: true })).toBeVisible();
  await expect(inventoryPage.getByText('Status: blocked', { exact: true })).toBeVisible();

  await managerPage.goto(`/inventory?workOrder=${workOrderId}`);
  await managerPage.getByLabel('Quantity', { exact: true }).fill('2.000');
  await managerPage.getByRole('button', { name: 'Reserve parts', exact: true }).click();
  await expect(managerPage.getByText('Parts reserved. Work order status was not changed.', { exact: true })).toBeVisible();
  await expect(managerPage.getByText('Status: blocked', { exact: true })).toBeVisible();

  await inventoryPage.goto(`/inventory?workOrder=${workOrderId}`);
  await inventoryPage.getByLabel('Quantity', { exact: true }).fill('2.000');
  await inventoryPage.getByRole('button', { name: 'Issue stock', exact: true }).click();
  await expect(inventoryPage.getByText('Stock issued to the work order.', { exact: true })).toBeVisible();
  await expect(inventoryPage.getByText('Status: blocked', { exact: true })).toBeVisible();

  await inventoryPage.getByLabel('Quantity', { exact: true }).fill('0.500');
  await inventoryPage.getByRole('button', { name: 'Return stock', exact: true }).click();
  await expect(inventoryPage.getByText('Returned stock recorded.', { exact: true })).toBeVisible();
  await expect(inventoryPage.getByText('Status: blocked', { exact: true })).toBeVisible();
  await managerPage.goto(`/inventory?workOrder=${workOrderId}`);
  await managerPage.getByLabel('Quantity', { exact: true }).fill('0.500');
  await managerPage.getByRole('button', { name: 'Reserve parts', exact: true }).click();
  await expect(managerPage.getByText('Parts reserved. Work order status was not changed.', { exact: true })).toBeVisible();
  await inventoryPage.goto(`/inventory?workOrder=${workOrderId}`);
  await inventoryPage.getByLabel('Quantity', { exact: true }).fill('0.500');
  await inventoryPage.getByRole('button', { name: 'Issue stock', exact: true }).click();
  await expect(inventoryPage.getByText('Stock issued to the work order.', { exact: true })).toBeVisible();
  await expect(inventoryPage.getByText('Status: blocked', { exact: true })).toBeVisible();

  await managerPage.goto(`/work-orders?workOrder=${workOrderId}`);
  const managerDetail = managerPage.getByRole('region', { name: 'Selected work order details' });
  const managerStatus = managerDetail.locator(':scope > .record-header .state-badge');
  await expect(managerStatus).toHaveText('blocked');
  await managerDetail.getByLabel('Block or resume reason').fill('Stock was received, issued and reconciled. Resume authorized.');
  const resumeButton = managerDetail.getByRole('button', { name: 'Resume work', exact: true });
  await expect(resumeButton).toBeEnabled();
  await resumeButton.click();
  await expect(managerStatus).toHaveText('in progress');
  await Promise.all([technicianPage.close(), managerPage.close(), inventoryPage.close()]);
});
