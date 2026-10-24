import { expect, test, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { saveAsset } from '../../src/app/commands';
import { readIsolatedServiceConfig } from './service-config';
import { enrollMfa } from '../integration/mfa';
import { prepareWorkspacePage, fixtureOrganizationIds, fixtureUserId } from './workspace-fixture';

const serviceConfig = readIsolatedServiceConfig(process.env);

function isolatedSql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Job-owned maintenance browser fixture setup failed; database output withheld.');
  return result.stdout.trim();
}

async function createMaintenancePerson(admin: SupabaseClient<Database>, url: string, anon: string, label: string) {
  const email = `por31-${label}-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}-Aa9!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic maintenance browser user setup failed.');
  const client = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error('Synthetic maintenance browser sign-in failed.');
  await enrollMfa(client);
  const session = await client.auth.getSession();
  if (session.error || !session.data.session) throw new Error('Synthetic maintenance browser session was unavailable.');
  return { id: created.data.user.id, email, client, session: session.data.session };
}

const pmIds = {
  plan: 'd2000000-0000-4000-8000-000000000001', revision: 'd2000000-0000-4000-8000-000000000002',
  occurrence: 'd2000000-0000-4000-8000-000000000003', workOrder: 'd2000000-0000-4000-8000-000000000004',
};
type Fields = { id?: string; asset_id: string; title: string; instructions: string; category: string; cadence: 'day' | 'week' | 'month'; frequency: number; anchor_on: string; supervisor_id: string; assignee_ids: string[]; checklist: string[]; status: 'active' | 'paused' | 'archived' };

function localToday(zone = 'Asia/Manila') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function shiftDate(date: string, days: number) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function displayDate(date: string) { return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
function displayInstant(value: string, timeZone: string) { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value)); }
function respond(route: Route, status: number, value: unknown) {
  const requestHeaders = route.request().headers();
  return route.fulfill({ status, contentType: 'application/json', headers: {
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': requestHeaders['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
  }, body: status === 204 ? '' : JSON.stringify(value) });
}

async function mockMaintenanceService(page: Page, seedRevisionVersion = 0, options: { seedGenerated?: boolean; seedBlocked?: boolean; seedAssetId?: string; holdAgenda?: boolean; agendaStatus?: number; snapshotAssignees?: string[]; currentAssigneeId?: string } = {}) {
  let plan: Record<string, unknown> | null = null;
  let revision: Record<string, unknown> | null = null;
  let occurrence: Record<string, unknown> | null = null;
  let order: Record<string, unknown> | null = null;
  let revisionNumber = 0;
  let failNextSave = seedRevisionVersion === 0;
  let failNextEditSave = true;
  let conflictNextEdit = true;
  const saves: Record<string, unknown>[] = [];
  const starts: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const rpcCalls: string[] = [];
  const revisionCursors: (number | undefined)[] = [];
  let releaseAgendaResponse: (() => void) | null = null;
  let agendaHeld = false;
  let resolveAgendaSeen!: () => void;
  const agendaSeen = new Promise<void>((resolve) => { resolveAgendaSeen = resolve; });
  const buildRevision = (fields: Fields, version: number) => ({
    id: `d2000000-0000-4000-8000-${String(version + 2).padStart(12, '0')}`, organization_id: fixtureOrganizationIds.alpha,
    plan_id: pmIds.plan, revision: version, author_id: fixtureUserId, title: fields.title, instructions: fields.instructions,
    category: fields.category, cadence: fields.cadence, frequency: fields.frequency, anchor_on: fields.anchor_on,
    timezone: 'Asia/Manila', supervisor_id: fields.supervisor_id, assignee_ids: fields.assignee_ids, checklist: fields.checklist,
    created_at: '2026-10-24T00:00:00.000Z',
  });
  const buildPlan = (fields: Fields, version: number, currentRevision: Record<string, unknown>) => ({
    id: pmIds.plan, organization_id: fixtureOrganizationIds.alpha, asset_id: options.seedAssetId ?? fields.asset_id,
    current_revision_id: currentRevision.id, authorized_by: fixtureUserId, status: fields.status,
    generation_blocked: options.seedBlocked ? 'person_ineligible' : null,
    last_checked_at: options.seedBlocked ? '2026-10-24T00:00:00.000Z' : null,
    created_by: fixtureUserId, created_at: '2026-10-24T00:00:00.000Z', version,
  });
  const buildGeneratedJob = (fields: Fields, currentRevision: Record<string, unknown>) => {
    const day = fields.anchor_on;
    const dueAt = `${day}T16:00:00.000Z`;
    order = { id: pmIds.workOrder, organization_id: fixtureOrganizationIds.alpha, number: 31, asset_id: fields.asset_id,
      source_request_id: null, title: fields.title, description: fields.instructions, category: fields.category, priority: 'normal',
      due_at: dueAt, planned_on: day, supervisor_id: fields.supervisor_id, status: 'scheduled', blocks_operation: false,
      created_by: null, created_at: '2026-10-24T00:00:00.000Z', version: 1, creation_actor_kind: 'system', pm_occurrence_id: pmIds.occurrence,
      repair_revision: 1, submitted_revision: null, opened_at: null, completed_at: null, priority_reason: null };
    occurrence = { id: pmIds.occurrence, organization_id: fixtureOrganizationIds.alpha, plan_id: pmIds.plan,
      revision_id: currentRevision.id, scheduled_local_date: day, timezone: 'Asia/Manila', due_policy: 'local_day_end', due_at: dueAt,
      work_order_id: pmIds.workOrder, authorized_by: fixtureUserId, supervisor_id: fields.supervisor_id, assignee_ids: fields.assignee_ids,
      generated_at: '2026-10-24T00:00:00.000Z', work_status: 'scheduled', blocks_operation: false, planned_on: day, title: fields.title };
    if (options.snapshotAssignees) occurrence = { ...occurrence, assignee_ids: options.snapshotAssignees };
  };
  if (seedRevisionVersion > 0) {
    const seed: Fields = { asset_id: options.seedAssetId ?? 'c2daf4c7-e68c-4783-87c6-26b009a1169d', title: `Plan revision ${seedRevisionVersion}`,
      instructions: 'Synthetic history cursor fixture', category: 'inspection', cadence: 'month', frequency: 1,
      anchor_on: localToday(), supervisor_id: fixtureUserId, assignee_ids: [fixtureUserId], checklist: ['Inspect'], status: 'active' };
    revisionNumber = seedRevisionVersion; revision = buildRevision(seed, seedRevisionVersion); plan = buildPlan(seed, seedRevisionVersion, revision);
    if (options.seedGenerated) buildGeneratedJob(seed, revision);
  }

  await page.route('http://127.0.0.1:54321/rest/v1/rpc/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    rpcCalls.push(name ?? 'unknown');
    const body = route.request().postDataJSON() as Record<string, any>;
    if (name === 'get_team') return respond(route, 200, [{ user_id: fixtureUserId, role: 'owner', active: true, version: 1 }]);
    if (name === 'list_maintenance_plans') return respond(route, 200, { items: plan ? [plan] : [], next_cursor: null });
    if (name === 'list_maintenance_revisions') {
      revisionCursors.push(typeof body.cursor === 'number' ? body.cursor : undefined);
      return respond(route, 200, { items: revision ? [{ revision, segment: { organization_id: fixtureOrganizationIds.alpha, plan_id: pmIds.plan, revision_id: revision.id, next_ordinal: 1, protected_through: localToday() } }] : [], next_cursor: null });
    }
    if (name === 'list_maintenance_agenda') {
      if (options.holdAgenda && !agendaHeld) {
        agendaHeld = true;
        resolveAgendaSeen();
        await new Promise<void>((resolve) => { releaseAgendaResponse = resolve; });
      }
      if (options.agendaStatus) return respond(route, options.agendaStatus, { message: 'Service unavailable' });
      const date = occurrence?.scheduled_local_date as string | undefined;
      return respond(route, 200, { items: occurrence && date && date >= body.from_on && date <= body.to_on ? [occurrence] : [], next_cursor: null });
    }
    if (name === 'list_maintenance_backlog') return respond(route, 200, { items: [], next_cursor: null, evaluated_at: '2026-10-24T00:00:00.000Z', status: plan?.status ?? 'active', generation_blocked: options.seedBlocked ? 'person_ineligible' : null, last_checked_at: options.seedBlocked ? '2026-10-24T00:00:00.000Z' : null });
    if (name === 'preview_maintenance_plan') {
      const fields = body.fields as Fields;
      return respond(route, 200, { plan_id: plan?.id ?? null, version: plan?.version ?? null, evaluated_at: '2026-10-24T00:00:00.000Z',
        old_local_date: plan ? localToday() : null, new_local_date: localToday(), protected_through: plan ? localToday() : null,
        timezone: 'Asia/Manila', due_policy: 'local_day_end', first_new: { scheduled_local_date: fields.anchor_on, timezone: 'Asia/Manila', due_at: `${fields.anchor_on}T16:00:00.000Z` },
        retained_backlog: plan ? [{ revision_id: revision?.id, author_id: fixtureUserId, next_ordinal: 0, next_on: shiftDate(localToday(), -1), protected_through: localToday(), timezone: 'Asia/Manila', due_at: `${shiftDate(localToday(), -1)}T16:00:00.000Z` }] : [], backlog_has_more: false, personnel_eligible: true });
    }
    if (name === 'save_maintenance_plan') {
      saves.push(body);
      if (failNextSave) { failNextSave = false; return respond(route, 503, { message: 'Service unavailable' }); }
      const fields = body.fields as Fields;
      if (fields.id && conflictNextEdit) {
        conflictNextEdit = false;
        revisionNumber = 2;
        revision = buildRevision({ ...fields, title: `${fields.title} from another coordinator` }, revisionNumber);
        plan = buildPlan(fields, revisionNumber, revision);
        return respond(route, 409, { message: 'CONFLICT' });
      }
      if (fields.id && failNextEditSave) { failNextEditSave = false; return respond(route, 503, { message: 'Service unavailable' }); }
      revisionNumber = (Number(plan?.version) || 0) + 1;
      revision = buildRevision(fields, revisionNumber);
      plan = buildPlan(fields, revisionNumber, revision);
      if (fields.id) buildGeneratedJob(fields, revision);
      return respond(route, 200, { data: plan, version: revisionNumber, request_id: body.ctx.request_id });
    }
    if (name === 'transition_work_order') {
      starts.push(body);
      if (!order) return respond(route, 404, { message: 'NOT_FOUND' });
      order = { ...order, status: body.target, version: Number(order.version) + 1 };
      if (occurrence) occurrence = { ...occurrence, work_status: body.target };
      return respond(route, 200, { data: order, version: order.version, request_id: body.ctx.request_id });
    }
    return route.fallback();
  });
  await page.route('http://127.0.0.1:54321/rest/v1/work_orders**', async (route) => {
    reads.push(`work_orders:${route.request().url()}`);
    if (route.request().method() === 'GET' && order) return respond(route, 200, [order]);
    return route.fallback();
  });
  await page.route('http://127.0.0.1:54321/rest/v1/work_order_assignments**', async (route) => {
    reads.push(`assignments:${route.request().url()}`);
    if (route.request().method() === 'GET' && order) return respond(route, 200, [{ id: 'd2000000-0000-4000-8000-000000000005', work_order_id: pmIds.workOrder, user_id: options.currentAssigneeId ?? fixtureUserId }]);
    return route.fallback();
  });
  return { saves, starts, reads, rpcCalls, revisionCursors, state: () => ({ occurrence, order }), waitForAgenda: () => agendaSeen, releaseAgenda: () => releaseAgendaResponse?.() };
}

test('maintenance opens from workspace navigation with Calendar and Plans tabs', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Maintenance', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Maintenance plans' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Plans' })).toBeVisible();
});

test('auth fixture keeps a changed browser session across navigation and reload', async ({ page }) => {
  const workspace = await prepareWorkspacePage(page);
  await page.goto('/');
  const secondUser = workspace.switchToSecondUser();
  await workspace.setBrowserSession(workspace.sessionFor(secondUser));
  await page.reload();
  await expect(page.locator('.account-email')).toHaveText(secondUser.email);
});

test('asset picker can find an older asset and retains the selected asset during edit', async ({ page }) => {
  await prepareWorkspacePage(page);
  await mockMaintenanceService(page, 3, { seedAssetId: 'c7000000-0000-4000-8000-000000000201' });
  const allAssets = Array.from({ length: 201 }, (_, index) => {
    const number = index + 1;
    return { id: `c7000000-0000-4000-8000-${String(number).padStart(12, '0')}`, code: `PM-${number}`, name: `Asset ${number}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, 201 - number)).toISOString() };
  });
  const target = allAssets[200]!;
  await page.route('http://127.0.0.1:54321/rest/v1/assets**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const idFilter = url.searchParams.get('id');
    const searchFilter = url.searchParams.get('or') ?? '';
    const rows = idFilter === `eq.${target.id}` || searchFilter.includes('Asset 201') ? [target] : allAssets.slice(0, 26);
    const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
    return respond(route, 200, rows.map((asset) => Object.fromEntries(columns.map((column) => [column, asset[column as keyof typeof asset]]))));
  });
  await page.goto('/maintenance');
  await page.getByRole('tab', { name: 'Plans' }).click();
  await page.getByRole('button', { name: 'Edit plan' }).click();
  const assetSelect = page.getByLabel('Asset', { exact: true });
  await expect(assetSelect).toHaveValue(target.id);
  await expect(assetSelect.locator(`option[value="${target.id}"]`)).toHaveText('PM-201 · Asset 201 (current plan asset)');
  await expect(page.getByRole('button', { name: 'Load more assets' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search active assets' }).fill('Asset 201');
  await expect(assetSelect.locator(`option[value="${target.id}"]`)).toHaveText('PM-201 · Asset 201');
  await expect(assetSelect).toHaveValue(target.id);
});

test('synthetic service keeps uncertain and stale saves safe, then requires an explicit assigned Start', async ({ page }) => {
  await prepareWorkspacePage(page);
  const service = await mockMaintenanceService(page);
  await page.goto('/maintenance');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await page.getByLabel('Asset', { exact: true }).selectOption('c2daf4c7-e68c-4783-87c6-26b009a1169d');
  await page.getByLabel('Plan title').fill('Pump inspection');
  await page.getByLabel('Category').fill('inspection');
  await page.getByLabel('Repeat').selectOption('month');
  await page.getByLabel('Every').fill('1');
  await page.getByLabel('First scheduled date').fill(shiftDate(localToday(), -1));
  await page.getByLabel('Responsible supervisor').selectOption(fixtureUserId);
  await page.locator('.maintenance-editor input[type="checkbox"]').check();
  await page.getByLabel('Instructions').fill('Inspect the pump and record the result.');
  await page.getByLabel('Checklist (one item per line)').fill('Check housing\nRecord condition');

  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  const editor = page.locator('.maintenance-editor');
  await editor.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('button', { name: 'Retry exact save' })).toBeVisible();
  await expect(page.getByLabel('Plan title')).toBeDisabled();
  await expect(page.locator('.page-heading').getByRole('button', { name: 'Create plan' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Retry exact save' }).click();
  await expect(page.getByRole('heading', { name: 'Pump inspection' })).toBeVisible();
  expect(service.saves[0]).toEqual(service.saves[1]);

  await page.getByRole('button', { name: 'Edit plan' }).click();
  await page.getByLabel('Plan title').fill('Pump inspection revised');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByText(/Existing due dates are pinned through/)).toBeVisible();
  await expect(page.getByText(/Retained backlog/)).toBeVisible();
  const firstNew = page.locator('.maintenance-preview p').filter({ hasText: 'First new occurrence:' });
  await expect(firstNew).toContainText(`First new occurrence: ${displayDate(shiftDate(localToday(), -1))}`);
  await expect(firstNew).toContainText(`Due by end of ${displayDate(shiftDate(localToday(), -1))} (Asia/Manila); exclusive cutoff ${displayInstant(`${shiftDate(localToday(), -1)}T16:00:00.000Z`, 'Asia/Manila')} (Asia/Manila)`);
  await page.locator('.maintenance-editor').getByRole('button', { name: 'Save revision' }).click();
  await expect(page.getByRole('button', { name: 'Use latest version and keep my draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Use latest version and keep my draft' }).click();
  await expect(page.getByLabel('Plan title')).toHaveValue('Pump inspection revised');
  await expect(page.locator('.maintenance-editor').getByRole('button', { name: 'Save revision' })).toBeDisabled();
  await expect(page.locator('.maintenance-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await page.locator('.maintenance-editor').getByRole('button', { name: 'Save revision' }).click();
  await expect(page.getByRole('button', { name: 'Retry exact save' })).toBeVisible();
  await expect(page.locator('.page-heading').getByRole('button', { name: 'Create plan' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit plan' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry exact save' }).click();
  await expect(page.getByRole('heading', { name: 'Pump inspection revised' })).toBeVisible();
  expect((service.saves[2]!.ctx as Record<string, unknown>).request_id).not.toBe((service.saves[3]!.ctx as Record<string, unknown>).request_id);
  expect(service.saves[3]!.ctx).toMatchObject({ expected_version: 2 });
  expect(service.saves[3]).toEqual(service.saves[4]);

  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.locator(`#maintenance-day-${shiftDate(localToday(), -1)}`).click();
  await expect(page.locator('.maintenance-agenda > ul').getByText('Pump inspection revised', { exact: true })).toBeVisible();
  await expect(page.locator('.maintenance-agenda > ul').getByText(/exclusive cutoff/)).toBeVisible();
  await expect.poll(() => service.reads.some((read) => read.startsWith('work_orders:'))).toBe(true);
  await expect.poll(() => service.reads.some((read) => read.startsWith('assignments:'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Start work' })).toBeVisible();
  expect(service.starts).toHaveLength(0);
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect(page.locator('.maintenance-agenda > ul').getByText(/in progress/)).toBeVisible();
  expect(service.starts).toHaveLength(1);
  expect(service.starts[0]).toMatchObject({ target: 'in_progress', id: pmIds.workOrder });
});

test('tenant changes clear a maintenance draft, and inventory cannot read or create plans', async ({ page }) => {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha, fixtureOrganizationIds.beta]);
  await mockMaintenanceService(page);
  await page.goto('/maintenance');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByLabel('Plan title')).toBeEnabled();
  await page.getByLabel('Plan title').fill('Alpha-only draft');
  await page.locator('#workspace-switcher').selectOption(fixtureOrganizationIds.beta);
  await expect(page.getByText(/Calendar and recurring plans for Beta workspace/)).toBeVisible();
  await expect(page.getByLabel('Plan title')).toHaveCount(0);
});

test('inventory is denied before maintenance reads or plan actions', async ({ page }) => {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha], 'inventory');
  const service = await mockMaintenanceService(page);
  await page.goto('/maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create plan' })).toHaveCount(0);
  expect(service.rpcCalls).toEqual([]);
});

test('agenda aside distinguishes pending and failed reads from an empty schedule', async ({ page }) => {
  await prepareWorkspacePage(page);
  const service = await mockMaintenanceService(page, 0, { holdAgenda: true, agendaStatus: 503 });
  await page.goto('/maintenance');
  try {
    await service.waitForAgenda();
    const aside = page.locator('.maintenance-agenda');
    await expect(aside.getByRole('status')).toContainText('Loading selected date and schedule summaries');
    await expect(aside.getByText('No overdue maintenance in this month.')).toHaveCount(0);
    await expect(aside.getByText('No upcoming maintenance is listed this month.')).toHaveCount(0);
    service.releaseAgenda();
    await expect(aside.getByText('Selected-date, overdue and upcoming maintenance could not be confirmed. Retry from the calendar.')).toBeVisible({ timeout: 15_000 });
    await expect(aside.getByText('No maintenance is scheduled for this date.')).toHaveCount(0);
  } finally {
    service.releaseAgenda();
  }
});

test('current revision lookup starts at a bounded cursor past one thousand older revisions', async ({ page }) => {
  await prepareWorkspacePage(page);
  const service = await mockMaintenanceService(page, 1001, { seedBlocked: true });
  await page.goto('/maintenance');
  await page.getByRole('tab', { name: 'Plans' }).click();
  await expect(page.getByRole('heading', { name: 'Plan revision 1001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit plan' })).toBeEnabled();
  await expect(page.getByText(/Last recorded generation blocker: person ineligible · checked .*\(Asia\/Manila\)/)).toBeVisible();
  await page.getByRole('button', { name: 'View retained backlog' }).click();
  await expect(page.locator('.maintenance-backlog')).toContainText(/Backlog evaluated .*Asia\/Manila.*Last generation check: .*Asia\/Manila.*Last recorded blocker: person ineligible/);
  expect(service.revisionCursors[0]).toBe(901);
});

test('calendar remains usable at 320px with arrow-key date navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await prepareWorkspacePage(page);
  await mockMaintenanceService(page);
  await page.goto('/maintenance');
  const today = localToday();
  const tomorrow = shiftDate(today, 1);
  const todayCell = page.locator(`#maintenance-day-${today}`);
  await todayCell.focus();
  await expect(todayCell).toBeFocused();
  await todayCell.press('ArrowRight');
  const tomorrowCell = page.locator(`#maintenance-day-${tomorrow}`);
  await expect(tomorrowCell).toBeFocused();
  await expect(tomorrowCell).toHaveAttribute('aria-selected', 'true');
  const pageWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.inner + 1);
});

test('current assigned technician can start after assignments change from the occurrence snapshot', async ({ page }) => {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha], 'technician');
  const previousAssignee = 'd2000000-0000-4000-8000-000000000006';
  const service = await mockMaintenanceService(page, 3, { seedGenerated: true, snapshotAssignees: [previousAssignee], currentAssigneeId: fixtureUserId });
  await page.goto('/maintenance');
  expect(service.state().occurrence?.assignee_ids).toEqual([previousAssignee]);
  await expect(page.getByRole('button', { name: 'Start work' })).toBeVisible();
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect(page.locator('.maintenance-agenda > ul').getByText(/in progress/)).toBeVisible();
  expect(service.starts).toHaveLength(1);
});

test('same-tenant role downgrade remounts maintenance and re-reads data', async ({ page }) => {
  const workspace = await prepareWorkspacePage(page);
  const service = await mockMaintenanceService(page);
  await page.goto('/maintenance');
  await page.getByRole('button', { name: 'Create plan' }).first().click();
  await expect(page.getByLabel('Plan title')).toBeEnabled();
  await page.getByLabel('Plan title').fill('Owner-only draft');
  const initialPlanReads = service.rpcCalls.filter((name) => name === 'list_maintenance_plans').length;
  workspace.setRole('technician');
  await expect(page.locator('.maintenance-editor')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.page-heading').getByRole('button', { name: 'Create plan' })).toHaveCount(0);
  await expect.poll(() => service.rpcCalls.filter((name) => name === 'list_maintenance_plans').length, { timeout: 20_000 }).toBeGreaterThan(initialPlanReads);
});

test('isolated Supabase browser flow creates, revises, generates, then explicitly starts assigned maintenance', async ({ page }) => {
  test.skip(!serviceConfig, 'This service journey runs only in the job-owned loopback Supabase stack.');
  const config = serviceConfig!;
  const admin = createClient<Database>(config.url, config.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await createMaintenancePerson(admin, config.url, config.anon, 'owner');
  const technician = await createMaintenancePerson(admin, config.url, config.anon, 'technician');
  const organizationId = randomUUID();
  isolatedSql(`insert into public.organizations(id,name,timezone,currency,created_by) values ('${organizationId}','Synthetic POR31 maintenance','Asia/Manila','PHP','${owner.id}');
    insert into public.organization_members(organization_id,user_id,role) values ('${organizationId}','${owner.id}','owner'),('${organizationId}','${technician.id}','technician');`);
  const asset = await saveAsset(owner.client, organizationId, { code: `PM-${randomUUID().slice(0, 8)}`, name: 'Synthetic maintenance pump', category: 'pump' }, randomUUID());
  isolatedSql(`update public.assets set availability='operational' where id='${asset.id}';`);
  const storageKey = `sb-${new URL(config.url).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(({ session, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session));
  }, { session: owner.session, key: storageKey });
  await page.goto('/maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance plans' })).toBeVisible();
  await page.getByRole('button', { name: 'Create plan' }).click();
  await page.getByLabel('Asset', { exact: true }).selectOption(asset.id);
  await page.getByLabel('Plan title').fill('Synthetic pump inspection');
  await page.getByLabel('Category').fill('inspection');
  await page.getByLabel('Repeat').selectOption('day');
  await page.getByLabel('Every').fill('1');
  const anchorOn = shiftDate(localToday(), -1);
  await page.getByLabel('First scheduled date').fill(anchorOn);
  await page.getByLabel('Responsible supervisor').selectOption(owner.id);
  await page.locator('.choice-fieldset label').filter({ hasText: `technician · ${technician.id.slice(0, 8)}` }).locator('input').check();
  await page.getByLabel('Instructions').fill('Inspect the pump guard and record its condition.');
  await page.getByLabel('Checklist (one item per line)').fill('Inspect guard\nRecord condition');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await page.locator('.maintenance-editor').getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic pump inspection' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit plan' }).click();
  await page.getByLabel('Instructions').fill('Revised: inspect the pump guard and record its condition.');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByText(/Existing due dates are pinned through/)).toBeVisible();
  await page.locator('.maintenance-editor').getByRole('button', { name: 'Save revision' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic pump inspection' })).toBeVisible();

  isolatedSql('select private.generate_due_maintenance();');
  const technicianStorage = await technician.client.auth.getSession();
  if (technicianStorage.error || !technicianStorage.data.session) throw new Error('Synthetic technician browser session was unavailable.');
  await page.evaluate(({ session, key }) => localStorage.setItem(key, JSON.stringify(session)), { session: technicianStorage.data.session, key: storageKey });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Maintenance plans' })).toBeVisible();
  await expect(page.locator('.account-email')).toHaveText(technician.email);
  await page.locator(`#maintenance-day-${anchorOn}`).click();
  const job = page.locator('.maintenance-agenda > ul').getByText('Synthetic pump inspection', { exact: true });
  await expect(job).toBeVisible();
  await expect(page.locator('.maintenance-agenda > ul').getByText(/exclusive cutoff/)).toBeVisible();
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect(page.locator('.maintenance-agenda > ul').getByText(/in progress/)).toBeVisible();
});
