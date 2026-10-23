import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Route } from '@playwright/test';
import { fixtureOrganizationIds, fixtureUserId, prepareWorkspacePage } from './workspace-fixture';

const evidenceDirectory = '.cache/por23-ui';

const por24EvidenceDirectory = '.cache/por24-ui';
const visualPrivateImage = readFileSync(new URL('./visual-fixtures/private-maintenance.png', import.meta.url));
const visualPrivateImageChecksum = createHash('sha256').update(visualPrivateImage).digest('hex');
const visualRequestImage = readFileSync(new URL('./visual-fixtures/request-evidence-portrait.png', import.meta.url));
const visualRequestImageChecksum = createHash('sha256').update(visualRequestImage).digest('hex');
const visualAssetId = 'c2daf4c7-e68c-4783-87c6-26b009a1169d';
const visualWorkOrderId = 'abfc36f2-44f3-4c85-b0b5-696e4c6626bf';
const visualTaskId = '213b9951-8f2e-437f-8f22-ef2973147f67';
const visualTechnicianId = '5d3c9d7e-40a8-4b27-a7d8-e350a66b771b';
const visualTechnicianTwoId = '7b8fda86-ec61-4c21-8f64-d0fdcb36bf42';
const visualBlockedWorkOrderId = 'c81edcaf-805e-46f4-a6ba-e818f41dde2d';
const visualReviewWorkOrderId = '6bb867e4-b244-4bc5-a45d-2e22912be14c';
const visualRequestId = 'bcb59f0c-e0b3-4d77-a94d-8a07f3317503';

const visualAsset = {
  id: visualAssetId, organization_id: fixtureOrganizationIds.alpha, code: 'ALPHA-01', name: 'Alpha pump', category: 'pump',
  site_id: '00000000-0000-4000-8000-0000000002bd', serial_number: null, registration: null, archived_at: null, created_by: fixtureUserId,
  created_at: '2026-10-21T01:00:00.000Z', version: 2, availability: 'under_maintenance',
};
const visualWorkOrder = {
  id: visualWorkOrderId, organization_id: fixtureOrganizationIds.alpha, number: 1, asset_id: visualAssetId,
  source_request_id: null, title: 'Review pump seal', description: 'Inspect and document the reported seal condition.',
  category: 'inspection', priority: 'normal', due_at: null, supervisor_id: fixtureUserId, status: 'in_progress',
  blocks_operation: false, created_by: fixtureUserId, created_at: '2026-10-21T03:00:00.000Z', version: 4,
  repair_revision: 2, submitted_revision: null, opened_at: '2026-10-21T05:00:00.000Z', completed_at: null, priority_reason: null, planned_on: null,
};
const visualBlockedWorkOrder = {
  ...visualWorkOrder, id: visualBlockedWorkOrderId, number: 4, title: 'Blocked air handler check',
  status: 'blocked', version: 7,
};
const visualReviewWorkOrder = {
  ...visualWorkOrder, id: visualReviewWorkOrderId, number: 5, title: 'Bearing repair submitted',
  status: 'awaiting_review', version: 8, repair_revision: 3, submitted_revision: 3,
};
const visualRequest = {
  id: visualRequestId, organization_id: fixtureOrganizationIds.alpha, asset_id: visualAssetId, reporter_id: fixtureUserId,
  description: 'Inspect the pump seal and record the reported condition.', category: 'repair', status: 'submitted',
  transition_reason: null, converted_work_order_id: null, created_at: '2026-10-21T04:00:00.000Z', version: 1,
};
const visualRequestEvent = {
  id: 'f143f0c8-ea64-4e16-a7e0-f8c8cdfb7771', organization_id: fixtureOrganizationIds.alpha,
  request_id: visualRequestId, actor_id: fixtureUserId, action: 'submit_request', status: 'submitted',
  reason: null, created_at: '2026-10-21T04:00:00.000Z',
};
const visualRecordId = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const visualSiteIds = [visualRecordId(701), visualRecordId(702), visualRecordId(703)];
const visualSites = [
  { id: visualSiteIds[0], organization_id: fixtureOrganizationIds.alpha, name: 'Fixture depot north' },
  { id: visualSiteIds[1], organization_id: fixtureOrganizationIds.alpha, name: 'Fixture depot south' },
  { id: visualSiteIds[2], organization_id: fixtureOrganizationIds.alpha, name: 'Fixture service yard' },
];
const additionalVisualAssets = Array.from({ length: 7 }, (_, index) => ({
  ...visualAsset, id: visualRecordId(710 + index), code: `FIX-${String(index + 2).padStart(2, '0')}`,
  name: `Fixture asset ${String(index + 2).padStart(2, '0')}`, category: ['bus', 'pump', 'compressor', 'generator'][index % 4],
  site_id: visualSiteIds[index % visualSiteIds.length], availability: ['operational', 'operational', 'out_of_service', 'operational', 'operational', 'under_maintenance', 'operational'][index],
  created_at: `2026-10-${String(20 - index).padStart(2, '0')}T01:00:00.000Z`,
}));
const visualAssets = [visualAsset, ...additionalVisualAssets];
const additionalVisualWorkOrders = [2, 3, 6, 7, 8].map((number, index) => ({
  ...visualWorkOrder, id: visualRecordId(720 + index), number, asset_id: visualAssets[index + 1].id,
  title: `Fixture work order ${String(number).padStart(4, '0')}`,
  status: index < 3 ? 'open' : 'in_progress',
  planned_on: index < 3 ? '2026-10-21' : null,
  due_at: index === 2 ? '2026-10-20T08:00:00.000Z' : null,
  opened_at: index < 3 ? null : '2026-10-20T05:00:00.000Z',
  created_at: `2026-10-${String(20 - index).padStart(2, '0')}T03:00:00.000Z`,
}));
const additionalBlockedWorkOrder = { ...visualBlockedWorkOrder, id: visualRecordId(725), number: 9, asset_id: visualAssets[6].id, title: 'Fixture blocked review 0009', created_at: '2026-10-19T03:00:00.000Z' };
const additionalReviewWorkOrder = { ...visualReviewWorkOrder, id: visualRecordId(726), number: 10, asset_id: visualAssets[7].id, title: 'Fixture approval review 0010', created_at: '2026-10-18T03:00:00.000Z' };
const visualWorkOrders = [visualWorkOrder, visualBlockedWorkOrder, visualReviewWorkOrder, ...additionalVisualWorkOrders, additionalBlockedWorkOrder, additionalReviewWorkOrder];
const additionalVisualRequests = Array.from({ length: 5 }, (_, index) => ({
  ...visualRequest, id: visualRecordId(730 + index), asset_id: visualAssets[index + 1].id,
  description: `Fixture request ${String(index + 2).padStart(2, '0')}`, category: ['inspection', 'repair', 'safety', 'service', 'other'][index],
  status: ['submitted', 'returned', 'draft', 'submitted', 'closed'][index],
  created_at: `2026-10-${String(20 - index).padStart(2, '0')}T04:00:00.000Z`,
}));
const visualRequests = [visualRequest, ...additionalVisualRequests];
const visualRequestEvents = visualRequests.map((request, index) => ({
  ...visualRequestEvent, id: visualRecordId(740 + index), request_id: request.id,
  action: index === 0 ? 'submit_request' : 'review_request', status: request.status,
  reason: index === 1 ? 'Returned for additional recorded detail.' : null,
  created_at: request.created_at,
}));
const visualTeamIds = [fixtureUserId, visualTechnicianId, visualTechnicianTwoId, ...Array.from({ length: 5 }, (_, index) => visualRecordId(750 + index))];
const visualTeam = visualTeamIds.map((userId, index) => ({
  user_id: userId, role: index === 0 ? 'owner' : 'technician', active: true, version: index + 1,
}));
const visualAssignments = visualWorkOrders.map((workOrder, index) => ({
  id: visualRecordId(770 + index), organization_id: fixtureOrganizationIds.alpha,
  user_id: [visualTechnicianId, visualTechnicianTwoId, visualTeamIds[3], visualTeamIds[4]][index % 4],
  work_order_id: workOrder.id, unassigned_at: null,
}));
const visualMeterReadings = visualAssets.map((asset, index) => ({
  id: visualRecordId(790 + index), organization_id: fixtureOrganizationIds.alpha, asset_id: asset.id,
  kind: index % 2 ? 'hours' : 'distance', value: 1200 + index * 137,
  observed_at: `2026-10-${String(20 - (index % 5)).padStart(2, '0')}T02:00:00.000Z`,
  recorded_at: `2026-10-${String(20 - (index % 5)).padStart(2, '0')}T03:00:00.000Z`,
  recorded_by: fixtureUserId, correction_of: null, correction_reason: null,
}));
const visualAttachment = {
  id: visualRecordId(810), organization_id: fixtureOrganizationIds.alpha, work_order_id: null,
  object_key: `${fixtureOrganizationIds.alpha}/${visualAssetId}/${visualRecordId(810)}`, name: 'fixture-asset.png',
  asset_id: visualAssetId, request_id: null, media_type: 'image/png', size: visualPrivateImage.byteLength, uploader_id: fixtureUserId,
  status: 'ready', checksum: visualPrivateImageChecksum, width: 640, height: 360,
  created_at: '2026-10-20T04:00:00.000Z', ready_at: '2026-10-20T04:01:00.000Z', cleanup_completed_at: null,
};
const visualRequestAttachment = {
  ...visualAttachment, id: visualRecordId(811), object_key: `${fixtureOrganizationIds.alpha}/${visualRequestId}/${visualRecordId(811)}`,
  name: 'fixture-request.png', asset_id: null, request_id: visualRequestId,
  size: visualRequestImage.byteLength, checksum: visualRequestImageChecksum, width: 360, height: 640,
};

async function fulfillJson(route: Route, value: unknown) {
  const headers = route.request().headers();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': headers['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
    },
    body: JSON.stringify(value),
  });
}

test('assets use a searchable registry with a selected detail preview on desktop and mobile', async ({ page }) => {
  await mkdir(evidenceDirectory, { recursive: true });
  await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Assets', exact: true }).click();

  const preview = page.getByRole('region', { name: 'Selected asset details' });
  const desktopTable = page.locator('.record-workspace .responsive-record-table');
  const mobileList = page.locator('.record-workspace .mobile-record-list');
  await expect(desktopTable).toBeVisible();
  await expect(mobileList).toBeHidden();
  await expect(preview.getByRole('heading', { name: 'Alpha pump' })).toBeVisible();
  const fan = page.getByRole('button', { name: 'Alpha fan' });
  await fan.focus();
  await fan.press('Enter');
  await expect(preview.getByRole('heading', { name: 'Alpha fan' })).toBeVisible();
  await expect(desktopTable.locator('tr[aria-selected="true"]')).toContainText('ALPHA-02');
  await expect(preview.locator('.asset-record-heading .state-badge')).toHaveText('out of service');
  await page.screenshot({ path: `${evidenceDirectory}/assets-desktop.png`, fullPage: true });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await expect(desktopTable).toBeHidden();
  await expect(mobileList).toBeVisible();
  await expect(page.getByRole('button', { name: /ALPHA-02 · fan/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${evidenceDirectory}/assets-mobile.png`, fullPage: true });
});

test('requests use searchable selection and triage preview controls', async ({ page }) => {
  await mkdir(evidenceDirectory, { recursive: true });
  await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Requests', exact: true }).click();

  const preview = page.getByRole('region', { name: 'Selected request details' });
  const desktopTable = page.locator('.record-workspace .responsive-record-table');
  const mobileList = page.locator('.record-workspace .mobile-record-list');
  await expect(desktopTable).toBeVisible();
  await expect(mobileList).toBeHidden();
  const requestControls = page.locator('.request-controls');
  await expect(requestControls).toBeVisible();
  await expect(page.locator('.request-controls .request-tabs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All requests 2', exact: true })).toBeVisible();
  const requestSort = page.getByRole('combobox', { name: 'Sort requests' });
  await expect(requestSort).toHaveValue('desc');
  await requestSort.selectOption('asc');
  await expect(requestSort).toHaveValue('asc');
  await requestSort.selectOption('desc');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByLabel('Filter by category').fill('inspection');
  await expect(desktopTable.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(desktopTable.locator('tbody tr')).toHaveCount(2);
  expect((await requestControls.boundingBox())?.y).toBeLessThan((await page.locator('.request-inbox').boundingBox())?.y ?? 0);
  await expect(preview.getByRole('heading', { name: 'inspection request' })).toBeVisible();
  const detailViews = preview.getByRole('group', { name: 'Request detail views' });
  await expect(detailViews.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-pressed', 'true');
  await expect(detailViews.getByRole('button', { name: 'AI draft' })).toBeDisabled();
  await detailViews.getByRole('button', { name: 'Activity' }).click();
  await expect(preview.getByRole('region', { name: 'Request activity' })).toContainText('Submitted for workspace review');
  await detailViews.getByRole('button', { name: 'Details' }).click();
  const vibrationRow = desktopTable.getByRole('row').filter({ hasText: 'Unusual fan vibration reported.' });
  await expect(vibrationRow).toHaveCount(1);
  await vibrationRow.getByRole('button').click();
  await expect(vibrationRow).toHaveAttribute('aria-selected', 'true');
  await expect(preview.getByRole('heading', { name: 'Unusual fan vibration reported.' })).toBeVisible();
  await expect(desktopTable.locator('tr[aria-selected="true"]')).toContainText('Unusual fan vibration reported.');
  await page.setViewportSize({ width: 1672, height: 941 });
  await expect(preview.getByText('Review and route request', { exact: true })).toBeVisible();
  await expect(preview.getByLabel('Draft work order title')).toBeHidden();
  await page.screenshot({ path: `${evidenceDirectory}/requests-desktop.png`, fullPage: true });
  await preview.getByText('Review and route request', { exact: true }).click();
  await expect(preview.getByLabel('Draft work order title')).toHaveValue('Unusual fan vibration reported.');
  await expect(preview.getByRole('button', { name: 'Convert to draft work order' })).toBeVisible();

  await page.getByLabel('Search requests').fill('vibration');
  await expect(page.getByRole('button', { name: /Seal inspection requested/ })).toHaveCount(0);
  await expect(preview.getByRole('heading', { name: 'Unusual fan vibration reported.' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await expect(desktopTable).toBeHidden();
  await expect(mobileList).toBeVisible();
  await expect(page.getByRole('button', { name: /Unusual fan vibration reported/ })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${evidenceDirectory}/requests-mobile.png`, fullPage: true });
});

test('work orders group their statuses and toggle between a board and table', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Work orders', exact: true }).click();
  const viewToggle = page.getByRole('group', { name: 'Work order view' });
  await expect(viewToggle.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  const board = page.getByRole('group', { name: 'Work orders by status' });
  await expect(board).toBeVisible();
  const toolbar = page.locator('.work-order-toolbar');
  await expect(toolbar).toBeVisible();
  const assignee = page.getByLabel('Assignee');
  const priority = page.getByLabel('Priority filter');
  const assetFilter = page.getByLabel('Asset filter');
  await expect(assignee).toBeVisible();
  await expect(priority).toBeVisible();
  await expect(assetFilter).toBeVisible();
  await expect(page.locator('#work-order-status')).toHaveCount(0);
  await expect(board.locator('.board-lane')).toHaveCount(4);
  expect((await board.boundingBox())?.y).toBeLessThan(340);
  await expect(page.locator('.work-order-selected-summary')).toHaveCount(0);
  const openLane = page.getByRole('region', { name: 'Open work orders' });
  await expect(openLane.getByRole('button', { name: /Review pump seal/ })).toContainText('Assigned to');
  await priority.selectOption('high');
  await expect(openLane.getByRole('button', { name: /Review pump seal/ })).toHaveCount(0);
  await priority.selectOption('all');
  await assignee.selectOption('all');
  await expect(page.getByRole('region', { name: 'Selected work order details' })).toHaveCount(0);
  await openLane.getByRole('button', { name: /WO-0001/ }).click();
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await expect(details.getByRole('heading', { name: /Review pump seal/ })).toBeVisible();
  await expect(details.getByText('draft', { exact: true })).toBeVisible();
  await viewToggle.getByRole('button', { name: 'Table' }).click();
  const statusFilter = page.locator('#work-order-status');
  await expect(statusFilter).toBeVisible();
  await expect(statusFilter.locator('option')).toContainText(['canceled']);
  const table = page.getByRole('table', { name: 'Authorized work orders' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await table.getByRole('button', { name: 'Open details' }).click();
  await expect(details.getByRole('heading', { name: /Check fan vibration/ })).toBeVisible();

  const rowId = (value: number) => visualRecordId(value);
  const pagedAssets = Array.from({ length: 27 }, (_, index) => ({
    id: rowId(1200 + index), organization_id: fixtureOrganizationIds.alpha,
    code: `PUMP-${String(index + 1).padStart(3, '0')}`, name: `Synthetic pump ${index + 1}`,
    availability: 'operational', archived_at: null,
  }));
  const pagedOrders = pagedAssets.map((asset, index) => ({
    ...visualWorkOrder, id: rowId(1300 + index), number: 200 + index, asset_id: asset.id,
    title: `Synthetic asset check ${index + 1}`, status: 'open',
    created_at: new Date(Date.UTC(2026, 9, 21, 23, 59 - index)).toISOString(),
  }));
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id')?.startsWith('eq.')) return route.fallback();
    const nextPage = url.searchParams.get('or')?.includes('created_at.lt.') ?? false;
    return fulfillJson(route, nextPage ? pagedOrders.slice(25) : pagedOrders.slice(0, 26));
  });
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('id');
    if (filter?.startsWith('in.(')) {
      const requested = new Set(filter.slice(4, -1).split(',').map((id) => id.replace(/^"|"$/g, '').trim()));
      const columns = url.searchParams.get('select')?.split(',') ?? [];
      return fulfillJson(route, pagedAssets.filter((asset) => requested.has(asset.id)).map((asset) => Object.fromEntries(columns.map((column) => [column, asset[column as keyof typeof asset]]))));
    }
    return route.fallback();
  });
  await page.reload();
  const pagedOpenLane = page.getByRole('region', { name: 'Open work orders' });
  await expect(pagedOpenLane.getByRole('button', { name: /WO-0200/ })).toContainText('PUMP-001 · Synthetic pump 1');
  await page.getByRole('button', { name: 'Load more work orders' }).click();
  await expect(pagedOpenLane.getByRole('button', { name: /WO-0226/ })).toContainText('PUMP-027 · Synthetic pump 27');
  const pagedAssetFilter = page.getByLabel('Asset filter');
  await expect(pagedAssetFilter).toBeEnabled();
  await expect(pagedAssetFilter.getByRole('option', { name: /PUMP-027 · Synthetic pump 27/ })).toHaveCount(1);
  await pagedAssetFilter.selectOption(pagedAssets[26]!.id);
  await expect(pagedOpenLane.getByRole('button', { name: /WO-0226/ })).toBeVisible();
  await expect(pagedOpenLane.getByRole('button', { name: /WO-0225/ })).toHaveCount(0);
});

test('work order board reads all assignments and assets across the API row cap', async ({ page }) => {
  await prepareWorkspacePage(page);
  const rowId = (value: number) => visualRecordId(value);
  const pagedAssets = Array.from({ length: 101 }, (_, index) => ({
    ...visualAsset, id: rowId(1200 + index), code: `CAP-${String(index + 1).padStart(3, '0')}`, name: `Bounded asset ${index + 1}`,
  }));
  const pagedOrders = pagedAssets.map((asset, index) => ({
    ...visualWorkOrder, id: rowId(1300 + index), number: 300 + index, asset_id: asset.id,
    title: `Capped assignment check ${index + 1}`, status: 'open',
    created_at: new Date(Date.UTC(2026, 9, 21, 23, 59 - index)).toISOString(),
  }));
  const assignedUsers = [visualTechnicianId, visualTechnicianTwoId, visualTeamIds[3]!, visualTeamIds[4]!];
  const overflowAssignee = visualTeamIds[7]!;
  let includeOverflowAssignment = false;
  const assignmentRows = () => [
    ...pagedOrders.slice(0, 25).flatMap((workOrder, workOrderIndex) => assignedUsers.map((userId, userIndex) => ({
      id: rowId(4000 + workOrderIndex * assignedUsers.length + userIndex), organization_id: fixtureOrganizationIds.alpha,
      work_order_id: workOrder.id, user_id: userId, unassigned_at: null,
    }))),
    ...(includeOverflowAssignment ? [{
      id: rowId(4100), organization_id: fixtureOrganizationIds.alpha, work_order_id: pagedOrders[24]!.id,
      user_id: overflowAssignee, unassigned_at: null,
    }] : []),
  ];
  const assignmentRequests: URL[] = [];
  const boardAssetRequests: URL[] = [];

  await page.route(/\/rest\/v1\/rpc\/get_team(?:\?.*)?$/, (route) => fulfillJson(route, visualTeam));
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const columns = url.searchParams.get('select')?.split(',') ?? Object.keys(visualWorkOrder);
    const project = (row: Record<string, unknown>) => columns.includes('*') ? row : Object.fromEntries(columns.map((column) => [column, row[column]]));
    const exactId = url.searchParams.get('id');
    if (exactId?.startsWith('eq.')) {
      const exact = pagedOrders.find((row) => row.id === exactId.slice(3));
      return fulfillJson(route, exact ? project(exact) : null);
    }
    const cursorId = url.searchParams.get('or')?.match(/id\.lt\.([0-9a-f-]{36})/i)?.[1];
    const start = cursorId ? pagedOrders.findIndex((row) => row.id === cursorId) + 1 : 0;
    expect(start).toBeGreaterThanOrEqual(0);
    const limit = Math.max(1, Number(url.searchParams.get('limit')) || 100);
    return fulfillJson(route, pagedOrders.slice(start, start + Math.min(limit, 100)).map(project));
  });
  await page.route(/\/rest\/v1\/work_order_assignments(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    assignmentRequests.push(url);
    expect(url.searchParams.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    const filter = url.searchParams.get('work_order_id');
    if (filter?.startsWith('in.(')) expect(url.searchParams.get('unassigned_at')).toBe('is.null');
    const workOrderIds = filter?.startsWith('in.(') ? filter.slice(4, -1).split(',') : filter?.startsWith('eq.') ? [filter.slice(3)] : null;
    const cursor = url.searchParams.get('id')?.match(/^gt\.([0-9a-f-]{36})$/i)?.[1];
    const selected = url.searchParams.get('select')?.split(',') ?? [];
    const matchingRows = assignmentRows().filter((row) => (!workOrderIds || workOrderIds.includes(row.work_order_id)) && (!cursor || row.id > cursor)).sort((left, right) => left.id.localeCompare(right.id));
    const requestedLimit = Math.max(1, Number(url.searchParams.get('limit')) || 100);
    const serverRows = matchingRows.slice(0, Math.min(requestedLimit, 100));
    return fulfillJson(route, serverRows.map((row) => Object.fromEntries(selected.map((column) => [column, row[column as keyof typeof row]]))));
  });
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('id');
    if (!filter?.startsWith('in.(')) return route.fallback();
    boardAssetRequests.push(url);
    expect(url.searchParams.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    const requestedIds = new Set(filter.slice(4, -1).split(',').map((id) => id.replace(/^"|"$/g, '').trim()));
    const columns = url.searchParams.get('select')?.split(',') ?? [];
    const rows = pagedAssets.filter((asset) => requestedIds.has(asset.id)).slice(0, 100);
    return fulfillJson(route, rows.map((asset) => Object.fromEntries(columns.map((column) => [column, asset[column as keyof typeof asset]]))));
  });

  await page.goto('/work-orders');
  const assignee = page.getByLabel('Assignee');
  const assignmentBoardPages = () => assignmentRequests.filter((url) => url.searchParams.get('work_order_id')?.startsWith('in.('));
  await expect(assignee).toBeEnabled();
  await expect.poll(() => assignmentBoardPages().length).toBe(2);
  expect(assignmentBoardPages().map((url) => Number(url.searchParams.get('limit')))).toEqual([100, 100]);
  expect(assignmentBoardPages()[1]?.searchParams.get('id')).toMatch(/^gt\./);

  includeOverflowAssignment = true;
  assignmentRequests.splice(0);
  await page.reload();
  await expect(assignee.locator(`option[value="${overflowAssignee}"]`)).toHaveCount(1);
  await expect.poll(() => assignmentBoardPages().length).toBe(2);
  expect(assignmentBoardPages().map((url) => Number(url.searchParams.get('limit')))).toEqual([100, 100]);
  await assignee.selectOption(overflowAssignee);
  const openLane = page.getByRole('region', { name: 'Open work orders' });
  const overflowCard = openLane.getByRole('button', { name: /WO-0324/ });
  await expect(overflowCard).toContainText(overflowAssignee.slice(0, 8));
  await expect(openLane.getByRole('button', { name: /WO-0323/ })).toHaveCount(0);
  await assignee.selectOption('all');

  for (const count of [50, 75, 100, 101]) {
    await page.getByRole('button', { name: 'Load more work orders' }).click();
    await expect(openLane.getByRole('button', { name: `WO-${String(299 + count).padStart(4, '0')}` })).toBeVisible();
  }
  const lastAssetId = pagedAssets[100]!.id;
  const lastCard = openLane.getByRole('button', { name: /WO-0400/ });
  await expect(lastCard).toContainText('CAP-101 · Bounded asset 101');
  const assetBatches = boardAssetRequests.slice(-2).map((url) => url.searchParams.get('id')!.slice(4, -1).split(',').length);
  expect(assetBatches).toEqual([100, 1]);
  const assetFilter = page.getByLabel('Asset filter');
  await assetFilter.selectOption(lastAssetId);
  await expect(lastCard).toBeVisible();
  await expect(openLane.getByRole('button', { name: /WO-0399/ })).toHaveCount(0);
});

test('empty workspace access settles without deleting its authorization result or leaving tenant data visible', async ({ page }) => {
  const fixture = await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alpha pump' })).toBeVisible();

  fixture.setMemberships([]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'No active workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha pump' })).toHaveCount(0);
  const reads = fixture.membershipReads();
  await page.waitForTimeout(350);
  expect(fixture.membershipReads()).toBe(reads);
});

test('automatic selected-workspace revocation navigates away and remounts form state', async ({ page }) => {
  const fixture = await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha, fixtureOrganizationIds.beta]);
  await page.goto('/');
  await page.getByRole('link', { name: 'Requests', exact: true }).click();
  await page.getByRole('button', { name: 'New request' }).click();
  await page.getByLabel('What needs attention?').fill('Tenant A private draft text');

  fixture.setMemberships([fixtureOrganizationIds.beta]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();
  await expect(page.getByText('Tenant A private draft text')).toHaveCount(0);
  await page.getByRole('link', { name: 'Requests', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected request details' }).getByText('Beta workspace request.')).toBeVisible();
  await page.getByRole('button', { name: 'New request' }).click();
  await expect(page.getByLabel('What needs attention?')).toHaveValue('');
});

test('POR-24 dashboard, work orders, assets, team, notifications and settings render at desktop and mobile widths', async ({ page }) => {
  await mkdir(por24EvidenceDirectory, { recursive: true });
  await page.clock.install({ time: new Date('2026-10-21T12:00:00.000Z') });
  await prepareWorkspacePage(page);
  const days = Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2026, 9, 15 + index)).toISOString().slice(0, 10));
  const notification = {
    id: '22145b0a-e2dc-4c6f-8a2e-70b6e49d95ba', organization_id: fixtureOrganizationIds.alpha,
    recipient_user_id: fixtureUserId, event_id: 'bd51d958-20af-46ac-b51a-3e95ebea771d',
    category: 'transition_work_order', source_id: visualWorkOrderId, created_at: '2026-10-21T11:00:00.000Z', read_at: null,
  };
  const visualNotifications = [notification, ...visualWorkOrders.slice(1, 9).map((workOrder, index) => ({
    ...notification, id: visualRecordId(830 + index), event_id: visualRecordId(840 + index),
    category: index % 2 ? 'assignment' : 'transition_work_order', source_id: workOrder.id,
    created_at: `2026-10-21T${String(10 - index).padStart(2, '0')}:00:00.000Z`,
    read_at: index % 3 === 0 ? null : '2026-10-21T11:30:00.000Z',
  }))];
  const visualWorkOrderEvents = visualWorkOrders.map((workOrder, index) => ({
    id: visualRecordId(850 + index), organization_id: fixtureOrganizationIds.alpha, work_order_id: workOrder.id,
    actor_id: fixtureUserId, request_id: visualRecordId(870 + index), action: index === 0 ? 'transition_work_order' : 'update_work_order',
    status: workOrder.status, repair_revision: workOrder.repair_revision, note: null, labor_minutes: null,
    changes: {}, created_at: workOrder.created_at,
  }));
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS' && url.pathname === '/functions/v1/attachment-upload') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-methods': 'GET,OPTIONS', 'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type' } });
    if (request.method() === 'OPTIONS') return route.fallback();
    if (url.pathname === '/rest/v1/rpc/get_dashboard') {
      const body = request.postDataJSON() as { range: { from: string; to: string } };
      return fulfillJson(route, {
        counts: { active_assets: visualAssets.length, available_assets: 5, active_work_orders: visualWorkOrders.filter((row) => ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'].includes(row.status)).length, blocked: visualWorkOrders.filter((row) => row.status === 'blocked').length, pending_approvals: visualWorkOrders.filter((row) => row.status === 'awaiting_review').length, overdue: visualWorkOrders.filter((row) => row.due_at !== null && Date.parse(row.due_at) < Date.parse('2026-10-21T12:00:00.000Z')).length, completed: 0, completion_sample_size: 0, completion_seconds: null },
        daily_availability: days.map((date, index) => ({ date, known_assets: visualAssets.length, available_assets: 5 + (index % 2) })),
        downtime_seconds: 1800, history_complete: false, timezone: 'Asia/Manila', from: body.range.from, to: body.range.to, generated_at: new Date().toISOString(),
      });
    }
    if (url.pathname === '/rest/v1/rpc/get_team') return fulfillJson(route, visualTeam);
    if (url.pathname === '/rest/v1/organization_members') {
      const membershipRows = visualTeam.map((member, index) => ({
        organization_id: fixtureOrganizationIds.alpha, ...member, created_at: `2026-10-21T0${index}:00:00.000Z`,
      }));
      const organizationFilter = url.searchParams.get('organization_id');
      const userFilter = url.searchParams.get('user_id');
      const activeFilter = url.searchParams.get('active');
      const cursor = userFilter?.match(/^gt\.(.+)$/)?.[1];
      let rows = membershipRows.filter((member) =>
        (!organizationFilter?.startsWith('eq.') || member.organization_id === organizationFilter.slice(3))
        && (!userFilter?.startsWith('eq.') || member.user_id === userFilter.slice(3))
        && (!activeFilter?.startsWith('eq.') || String(member.active) === activeFilter.slice(3))
        && (!cursor || member.user_id > cursor),
      );
      const order = url.searchParams.get('order') ?? '';
      if (order.split(',').some((column) => column.startsWith('user_id.'))) rows = rows.sort((left, right) => left.user_id.localeCompare(right.user_id));
      else if (order.split(',').some((column) => column.startsWith('created_at.'))) rows = rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
      const limit = Number(url.searchParams.get('limit') ?? rows.length);
      const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
      return fulfillJson(route, rows.slice(0, limit).map((member) => columns.includes('*') ? member : Object.fromEntries(columns.map((column) => [column, member[column as keyof typeof member]]))));
    }
    if (url.pathname === '/rest/v1/rpc/get_asset_history') return fulfillJson(route, { items: [], next_cursor: null });
    if (url.pathname === '/rest/v1/maintenance_requests') {
      if (request.method() === 'HEAD') {
        const status = url.searchParams.get('status');
        const count = status?.startsWith('eq.') ? visualRequests.filter((row) => row.status === status.slice(3)).length : visualRequests.length;
        return route.fulfill({ status: 200, headers: {
          'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
          'access-control-expose-headers': 'content-range', 'content-range': `*/${count}`,
        }, body: '' });
      }
      const idFilter = url.searchParams.get('id');
      const rows = idFilter?.startsWith('eq.') ? visualRequests.filter((row) => row.id === idFilter.slice(3)) : visualRequests;
      const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
      return fulfillJson(route, rows.map((row) => columns.includes('*') ? row : Object.fromEntries(columns.map((column) => [column, row[column as keyof typeof row]]))));
    }
    if (url.pathname === '/rest/v1/request_events') {
      const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
      const requestId = url.searchParams.get('request_id');
      const rows = requestId?.startsWith('eq.') ? visualRequestEvents.filter((row) => row.request_id === requestId.slice(3)) : visualRequestEvents;
      return fulfillJson(route, rows.map((row) => columns.includes('*') ? row : Object.fromEntries(columns.map((column) => [column, row[column as keyof typeof row]]))));
    }
    if (url.pathname === '/rest/v1/work_orders') {
      const columns = url.searchParams.get('select')?.split(',') ?? Object.keys(visualWorkOrder);
      const project = (row: Record<string, unknown>, selectedColumns: string[]) => Object.fromEntries(selectedColumns.map((column) => [column, row[column]]));
      const id = url.searchParams.get('id');
      if (id?.startsWith('eq.')) {
        const exact = visualWorkOrders.find((row) => row.id === id.slice(3));
        return fulfillJson(route, exact ? project(exact, columns) : null);
      }
      const status = url.searchParams.get('status');
      if (status?.startsWith('eq.')) return fulfillJson(route, visualWorkOrders.filter((row) => row.status === status.slice(3)).map((row) => project(row, columns)));
      if (url.searchParams.get('planned_on') === 'eq.2026-10-21') return fulfillJson(route, visualWorkOrders.filter((row) => row.planned_on === '2026-10-21').map((row) => project(row, columns)));
      if (url.searchParams.get('due_at') === 'not.is.null') {
        const requestedStatuses = status?.startsWith('in.(')
          ? status.slice(4, -1).split(',').map((value) => value.replace(/^['"]|['"]$/g, ''))
          : null;
        const dueRows = visualWorkOrders.filter((row) => row.due_at !== null && (!requestedStatuses || requestedStatuses.includes(row.status)));
        return fulfillJson(route, dueRows.map((row) => project(row, columns)));
      }
      const selected = url.searchParams.get('select');
      const rows = visualWorkOrders;
      if (selected === 'id,number,title,status') return fulfillJson(route, [...rows].sort((left, right) => left.id.localeCompare(right.id)).map((row) => project(row, columns)));
      if (selected && selected !== '*') return fulfillJson(route, rows.map((row) => project(row, columns)));
      return fulfillJson(route, rows);
    }
    if (url.pathname === '/rest/v1/work_order_assignments') {
      const rows = visualAssignments;
      const selected = url.searchParams.get('select')?.split(',') ?? [];
      const workOrderFilter = url.searchParams.get('work_order_id');
      const workOrderIds = workOrderFilter?.startsWith('in.(') ? workOrderFilter.slice(4, -1).split(',') : workOrderFilter?.startsWith('eq.') ? [workOrderFilter.slice(3)] : null;
      const permittedRows = rows.filter((row) => !workOrderIds || workOrderIds.includes(row.work_order_id));
      return fulfillJson(route, permittedRows.map((row) => Object.fromEntries(selected.map((column) => [column, row[column as keyof typeof row]]))));
    }
    if (url.pathname === '/rest/v1/work_order_tasks') return fulfillJson(route, [{ id: visualTaskId, organization_id: fixtureOrganizationIds.alpha, work_order_id: visualWorkOrderId, label: 'Verify bearing clearance', required: true, completed: false, completed_by: null, completed_at: null }]);
    if (url.pathname === '/rest/v1/work_order_events') {
      const workOrderId = url.searchParams.get('work_order_id');
      const rows = workOrderId?.startsWith('eq.') ? visualWorkOrderEvents.filter((row) => row.work_order_id === workOrderId.slice(3)) : visualWorkOrderEvents;
      const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
      return fulfillJson(route, rows.map((row) => columns.includes('*') ? row : Object.fromEntries(columns.map((column) => [column, row[column as keyof typeof row]]))));
    }
    if (url.pathname === '/rest/v1/sites') {
      const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
      return fulfillJson(route, visualSites.map((site) => columns.includes('*') ? site : Object.fromEntries(columns.map((column) => [column, site[column as keyof typeof site]]))));
    }
    if (url.pathname === '/rest/v1/asset_meter_readings') {
      const assetId = url.searchParams.get('asset_id');
      return fulfillJson(route, assetId?.startsWith('eq.') ? visualMeterReadings.filter((row) => row.asset_id === assetId.slice(3)) : visualMeterReadings);
    }
    if (url.pathname === '/rest/v1/attachments') {
      const assetId = url.searchParams.get('asset_id');
      const requestId = url.searchParams.get('request_id');
      return fulfillJson(route, assetId === `eq.${visualAssetId}` ? [visualAttachment] : requestId === `eq.${visualRequestId}` ? [visualRequestAttachment] : []);
    }
    if (url.pathname === '/functions/v1/attachment-upload') {
      const image = url.searchParams.get('attachment_id') === visualRequestAttachment.id ? visualRequestImage : visualPrivateImage;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173' }, body: image });
    }
    if (['/rest/v1/work_order_reviews', '/rest/v1/work_order_participants', '/rest/v1/work_order_performer_declarations', '/rest/v1/work_order_submission_attestations', '/rest/v1/asset_holds', '/rest/v1/asset_releases', '/rest/v1/organization_invitations'].includes(url.pathname)) return fulfillJson(route, []);
    if (url.pathname === '/rest/v1/notifications') return fulfillJson(route, visualNotifications);
    if (url.pathname === '/rest/v1/organization_settings') {
      return fulfillJson(route, url.searchParams.get('select') === 'evidence_required,version' ? { evidence_required: true, version: 1 } : { evidence_required: true });
    }
    if (url.pathname === '/rest/v1/organizations' && url.searchParams.get('select') === 'timezone,currency') return fulfillJson(route, { timezone: 'Asia/Manila', currency: 'PHP' });
    if (url.pathname === '/rest/v1/assets') {
      const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
      const projectAsset = (asset: typeof visualAsset) => columns.includes('*') ? asset : Object.fromEntries(columns.map((column) => [column, asset[column as keyof typeof visualAsset]]));
      const id = url.searchParams.get('id');
      const selected = id?.startsWith('eq.') ? visualAssets.find((asset) => asset.id === id.slice(3)) : null;
      if (id?.startsWith('eq.')) return fulfillJson(route, selected ? projectAsset(selected) : null);
      return fulfillJson(route, visualAssets.map(projectAsset));
    }
    return route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const screens = [
    { name: 'dashboard', path: '/', heading: 'Operations at a glance' },
    { name: 'requests', path: `/requests?request=${visualRequestId}`, heading: 'Maintenance requests' },
    { name: 'work-orders', path: '/work-orders', heading: 'Work orders' },
    { name: 'assets', path: `/assets?asset=${visualAssetId}`, heading: 'Assets' },
    { name: 'team', path: '/team', heading: 'Team and workload' },
    { name: 'notifications', path: '/notifications', heading: 'Notifications' },
    { name: 'settings', path: '/settings', heading: 'Organization settings' },
  ];
  for (const screen of screens) {
    await page.goto(screen.path);
    await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
    if (screen.name === 'requests') {
      await expect(page.getByRole('table', { name: 'Request inbox results' }).getByRole('row')).toHaveCount(7);
      await expect(page.getByRole('region', { name: 'Selected request details' }).getByRole('img', { name: 'fixture-request.png' })).toBeVisible();
    }
    if (screen.name === 'work-orders') {
      const board = page.getByRole('group', { name: 'Work orders by status' });
      await expect(board).toBeVisible();
      await expect(board.getByText('ALPHA-01 · Alpha pump').first()).toBeVisible();
      for (const [laneName, expectedCount] of [['Open work orders', 3], ['In progress work orders', 3], ['Blocked work orders', 2], ['Awaiting review work orders', 2]] as const) {
        await expect(page.getByRole('region', { name: laneName }).getByRole('button')).toHaveCount(expectedCount);
      }
    }
    if (screen.name === 'assets') {
      await expect(page.getByRole('table', { name: 'Asset registry results' }).getByRole('row')).toHaveCount(9);
      await expect(page.getByRole('region', { name: 'Asset registry' }).getByRole('columnheader', { name: 'Site' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Selected asset details' }).locator('dl.detail-grid').getByText('Fixture depot north', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: /Operational details for/ }).locator('.asset-operation-summary dd').nth(1)).toHaveText('1,200 distance');
      await expect(page.getByRole('region', { name: 'Selected asset details' }).getByRole('img', { name: 'fixture-asset.png' })).toBeVisible();
      await expect(page.locator('details.asset-identity')).not.toHaveAttribute('open', '');
    }
    if (screen.name === 'dashboard') {
      const attention = page.getByRole('region', { name: 'Attention queue' });
      await expect(attention.getByRole('row').first().getByRole('columnheader')).toHaveText(['ID', 'Problem', 'Asset', 'Supervisor ID', 'Reason', 'Status']);
      await expect(attention.locator('tbody').getByRole('link')).toHaveCount(5);
      const blockedRow = attention.getByRole('row').filter({ hasText: 'WO-0004' });
      await expect(blockedRow).toContainText('Blocked air handler check');
      await expect(blockedRow.getByRole('cell').nth(2)).toContainText('ALPHA-01');
      await expect(attention.getByRole('row').filter({ hasText: 'WO-0005' })).toContainText('Bearing repair submitted');
      await expect(attention.getByRole('row').filter({ hasText: 'WO-0006' })).toContainText('Past due');
    }
    if (screen.name === 'requests') {
      const evidence = page.getByRole('region', { name: 'Selected request details' }).getByRole('img', { name: 'fixture-request.png' });
      await expect(evidence).toBeVisible();
      await expect(evidence).toHaveJSProperty('naturalWidth', 360);
      await expect(evidence).toHaveJSProperty('naturalHeight', 640);
      await expect(evidence).toHaveCSS('object-fit', 'contain');
    }
    if (screen.name === 'team') {
      const workload = page.getByRole('region', { name: 'Assigned workload' });
      const firstTechnician = workload.getByRole('row').filter({ hasText: visualTechnicianId });
      const secondTechnician = workload.getByRole('row').filter({ hasText: visualTechnicianTwoId });
      await expect(firstTechnician.getByRole('cell').nth(2)).toHaveText('3');
      await expect(secondTechnician.getByRole('cell').nth(2)).toHaveText('3');
      await expect(page.getByRole('heading', { name: 'Workspace members', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Workspace members' }).getByRole('row')).toHaveCount(9);
      await page.getByRole('tab', { name: 'Members' }).click();
      await expect(page.getByRole('heading', { name: 'Invite a teammate', exact: true })).toBeVisible();
      await expect(page.getByLabel(`Role for ${visualTechnicianId}`)).toBeVisible();
      await page.getByRole('tab', { name: 'Workload' }).click();
    }
    if (screen.name === 'notifications') {
      await expect(page.getByRole('region', { name: 'Your notifications' }).getByRole('listitem')).toHaveCount(9);
      await expect(page.locator('.notification-identifiers')).toContainText(notification.id);
      await expect(page.getByRole('region', { name: 'Notification source details' })).toContainText('Review pump seal');
      await expect(page.getByRole('region', { name: 'Notification source details' })).toContainText('in progress');
      await expect(page.getByRole('region', { name: 'Notification source details' })).toContainText('transition work order');
      await expect(page.locator('.notification-identifiers')).not.toHaveAttribute('open', '');
    }
    if (screen.name === 'settings') await expect(page.getByLabel('Workspace time zone')).toHaveValue('Asia/Manila');
    if (screen.name === 'settings') {
      await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('region', { name: 'Workspace locations' })).toContainText('Fixture depot north');
      await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Members & roles' })).toHaveAttribute('href', '/team');
      await expect(page.locator('body')).toHaveCSS('font-family', /^system-ui/);
      const pageSave = page.getByRole('button', { name: 'Save settings' });
      const pageSaveBox = await pageSave.boundingBox();
      const sideBox = await page.getByRole('complementary', { name: 'Workspace and account information' }).boundingBox();
      expect(pageSaveBox?.y ?? 0).toBeGreaterThan((sideBox?.y ?? 0) + (sideBox?.height ?? 0) - 12);
    }
    const native = screen.name === 'dashboard' ? { width: 1673, height: 940 } : { width: 1672, height: 941 };
    await page.setViewportSize(native);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', native.width);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', native.width);
    await page.screenshot({ path: `${por24EvidenceDirectory}/${screen.name}-desktop.png` });
    if (screen.name === 'assets') {
      const identity = page.locator('details.asset-identity');
      await identity.locator('summary').click();
      await expect(identity.getByRole('img', { name: 'QR code for Alpha pump' })).toBeVisible();
      await identity.locator('summary').click();
    }
    if (screen.name === 'notifications') {
      const identifiers = page.locator('.notification-identifiers');
      await identifiers.locator('summary').click();
      await expect(identifiers.getByText(notification.id)).toBeVisible();
      await identifiers.locator('summary').click();
    }
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 });
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      if (width === 390) await page.screenshot({ path: `${por24EvidenceDirectory}/${screen.name}-mobile.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 320, height: 740 });
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const elements = [...document.body.querySelectorAll<HTMLElement>('*')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(), id: element.id, className: String(element.className).slice(0, 100),
          text: (element.innerText ?? '').slice(0, 60), left: Math.round(rect.left), right: Math.round(rect.right),
          width: Math.round(rect.width), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
          overflowX: getComputedStyle(element).overflowX,
        };
      }).filter((element) => element.right > width + 1).sort((left, right) => right.right - left.right).slice(0, 20);
      const drawer = document.querySelector<HTMLElement>('.side-rail');
      const rootOverflowBranches = [...document.body.querySelectorAll<HTMLElement>('*')].filter((element) => {
        if (element.getBoundingClientRect().right <= width + 1) return false;
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) return false;
          parent = parent.parentElement;
        }
        return true;
      }).map((element) => {
        const rect = element.getBoundingClientRect();
        const parentRect = element.parentElement?.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), className: String(element.className).slice(0, 100), text: (element.innerText ?? '').slice(0, 60), right: Math.round(rect.right), width: Math.round(rect.width), parentRight: parentRect ? Math.round(parentRect.right) : null, minWidth: getComputedStyle(element).minWidth, overflowX: getComputedStyle(element).overflowX };
      }).sort((left, right) => right.right - left.right).slice(0, 12);
      return { bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth, drawer: drawer ? { right: Math.round(drawer.getBoundingClientRect().right), transform: getComputedStyle(drawer).transform, boxShadow: getComputedStyle(drawer).boxShadow } : null, elements, rootOverflowBranches };
    });
    if (overflow.bodyWidth !== 320 || overflow.documentWidth !== 320) console.log(`320px overflow diagnostic ${screen.name}: ${JSON.stringify(overflow)}`);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 320);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
    await page.setViewportSize(native);
  }

  await page.goto(`/work-orders?workOrder=${visualWorkOrderId}`);
  await expect(page.getByRole('heading', { name: 'Work orders', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Work orders', exact: true })).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toBeFocused();
});

test('team workload pages beyond the API row cap and fails closed beyond its review bound', async ({ page }) => {
  await prepareWorkspacePage(page);
  const firstTechnician = visualTechnicianId;
  const secondTechnician = visualTechnicianTwoId;
  const rowId = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
  const memberRows = [
    { organization_id: fixtureOrganizationIds.alpha, user_id: fixtureUserId, role: 'owner', active: true, created_at: '2026-10-21T01:00:00.000Z', version: 1 },
    { organization_id: fixtureOrganizationIds.alpha, user_id: firstTechnician, role: 'technician', active: true, created_at: '2026-10-21T02:00:00.000Z', version: 2 },
    { organization_id: fixtureOrganizationIds.alpha, user_id: secondTechnician, role: 'technician', active: true, created_at: '2026-10-21T03:00:00.000Z', version: 3 },
    ...Array.from({ length: 3 }, (_, index) => ({ organization_id: fixtureOrganizationIds.alpha, user_id: rowId(300 + index), role: 'technician', active: true, created_at: `2026-10-21T0${4 + index}:00:00.000Z`, version: 4 + index })),
  ];
  let rowCount = 101;
  const assignmentRequests: URL[] = [];
  const workOrderRequests: URL[] = [];
  await page.route(/\/rest\/v1\/organization_members(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const organizationFilter = url.searchParams.get('organization_id');
    const activeFilter = url.searchParams.get('active');
    const userFilter = url.searchParams.get('user_id');
    const cursor = userFilter?.match(/^gt\.(.+)$/)?.[1];
    let rows = memberRows.filter((member) =>
      (!organizationFilter?.startsWith('eq.') || member.organization_id === organizationFilter.slice(3))
      && (!activeFilter?.startsWith('eq.') || String(member.active) === activeFilter.slice(3))
      && (!userFilter?.startsWith('eq.') || member.user_id === userFilter.slice(3))
      && (!cursor || member.user_id > cursor),
    );
    if ((url.searchParams.get('order') ?? '').split(',').some((column) => column.startsWith('user_id.'))) {
      rows = rows.sort((left, right) => left.user_id.localeCompare(right.user_id));
    }
    const limit = Number(url.searchParams.get('limit') ?? rows.length);
    const columns = url.searchParams.get('select')?.split(',') ?? ['*'];
    return fulfillJson(route, rows.slice(0, limit).map((member) => columns.includes('*') ? member : Object.fromEntries(columns.map((column) => [column, member[column as keyof typeof member]]))));
  });
  await page.route(/\/rest\/v1\/work_order_assignments(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    assignmentRequests.push(url);
    expect(url.searchParams.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(url.searchParams.get('unassigned_at')).toBe('is.null');
    const cursor = url.searchParams.get('id')?.match(/^gt\.([0-9a-f-]{36})$/i)?.[1];
    const workloadMembers = [secondTechnician, rowId(300), rowId(301), rowId(302)];
    const records = Array.from({ length: rowCount }, (_, index) => ({
      id: rowId(index + 1), user_id: index < 51 ? firstTechnician : index < 76 ? secondTechnician : workloadMembers[index < 89 ? 1 : index < 96 ? 2 : 3]!,
      work_order_id: rowId(rowCount - index),
    }));
    const columns = url.searchParams.get('select')?.split(',') ?? [];
    const pageRows = records.filter((record) => !cursor || record.id > cursor).slice(0, 100);
    return fulfillJson(route, pageRows.map((record) => Object.fromEntries(columns.map((column) => [column, record[column as keyof typeof record]]))));
  });
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    workOrderRequests.push(url);
    expect(url.searchParams.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(url.searchParams.get('status')).toContain('in.(');
    const cursor = url.searchParams.get('id')?.match(/^gt\.([0-9a-f-]{36})$/i)?.[1];
    const records = Array.from({ length: rowCount }, (_, index) => ({ id: rowId(index + 1), number: index + 1, title: `Synthetic assignment ${index + 1}`, status: index % 2 ? 'scheduled' : 'open' }));
    const columns = url.searchParams.get('select')?.split(',') ?? [];
    const pageRows = records.filter((record) => !cursor || record.id > cursor).slice(0, 100);
    return fulfillJson(route, pageRows.map((record) => Object.fromEntries(columns.map((column) => [column, record[column as keyof typeof record]]))));
  });

  await page.goto('/team');
  const workload = page.getByRole('region', { name: 'Assigned workload' });
  const firstCount = workload.getByRole('row').filter({ hasText: firstTechnician }).getByRole('cell').nth(2);
  const secondCount = workload.getByRole('row').filter({ hasText: secondTechnician }).getByRole('cell').nth(2);
  await expect(firstCount).toHaveText('51');
  await expect(secondCount).toHaveText('25');
  const memberIdSummaries = workload.locator('details.member-id-details summary');
  const firstMemberId = memberIdSummaries.first();
  await expect(firstMemberId).toHaveAttribute('aria-label', firstTechnician);
  await expect(memberIdSummaries.nth(1)).toHaveAttribute('aria-label', secondTechnician);
  const workloadDisclosure = workload.getByText(`View workload for all ${memberRows.length} active members`, { exact: true });
  await workloadDisclosure.click();
  const allMemberWorkload = workload.locator('.team-workload-remainder');
  await expect(allMemberWorkload.getByRole('row')).toHaveCount(memberRows.length + 1);
  const expectedCounts = [13, 7, 5, 51, 25, 0];
  for (let index = 0; index < expectedCounts.length; index++) {
    await expect(allMemberWorkload.getByRole('row').nth(index + 1).getByRole('cell').nth(2)).toHaveText(String(expectedCounts[index]));
  }
  await expect(allMemberWorkload.getByRole('row').nth(1).locator('summary')).toHaveAttribute('aria-label', rowId(300));
  await expect(allMemberWorkload.getByRole('row').nth(3).locator('summary')).toHaveAttribute('aria-label', rowId(302));
  await firstMemberId.focus();
  await expect(firstMemberId).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(firstMemberId.locator('xpath=../code')).toHaveText(firstTechnician);
  await page.keyboard.press('Space');
  await expect(firstMemberId.locator('xpath=../code')).toBeHidden();
  await expect(firstMemberId).toBeFocused();
  expect(assignmentRequests.some((request) => request.searchParams.get('id') === `gt.${rowId(100)}`)).toBe(true);
  expect(workOrderRequests.some((request) => request.searchParams.get('id') === `gt.${rowId(100)}`)).toBe(true);

  rowCount = 2001;
  await page.reload();
  await expect(workload.getByText('Workload is unknown because the current authorized assignment data could not be read completely.')).toBeVisible({ timeout: 15000 });
  await expect(workload.getByRole('table')).toHaveCount(0);
});

test('a different signed-in user cannot inherit the previous account second-factor state', async ({ page }) => {
  const fixture = await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Account security' }).click();
  await expect(page.getByText('Test authenticator', { exact: true })).toBeVisible();
  await expect(page.getByText('Second factor verified', { exact: true })).toBeVisible();

  const pendingLookups = fixture.holdIdentityUserLookups();
  const nextUser = fixture.switchToSecondUser();
  try {
    await page.evaluate((identity) => {
      const storageKey = 'sb-127-auth-token';
      const session = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { access_token: string; user: Record<string, unknown>; [key: string]: unknown } | null;
      if (!session) throw new Error('The synthetic auth fixture did not create a session.');
      const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const now = Math.floor(Date.now() / 1000);
      const user = { ...session.user, id: identity.id, email: identity.email, factors: [] };
      const payload = { aud: 'authenticated', role: 'authenticated', sub: identity.id, email: identity.email, aal: 'aal1', amr: [{ method: 'password', timestamp: now }], iat: now, exp: now + 3600 };
      const nextSession = { ...session, user, access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.fixture` };
      localStorage.setItem(storageKey, JSON.stringify(nextSession));
      const channel = new BroadcastChannel(storageKey);
      channel.postMessage({ event: 'SIGNED_IN', session: nextSession });
      (window as Window & { testAuthChannel?: BroadcastChannel }).testAuthChannel = channel;
    }, nextUser);
    await pendingLookups.arrived;
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
    await expect(page.getByLabel('Authenticator name')).toBeVisible();
    await expect(page.getByText('Test authenticator', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Second factor verified', { exact: true })).toHaveCount(0);
  } finally {
    pendingLookups.release();
    await page.evaluate(() => (window as Window & { testAuthChannel?: BroadcastChannel }).testAuthChannel?.close()).catch(() => {});
  }
  await expect(page.getByRole('button', { name: 'Set up an authenticator' })).toBeEnabled();
});

test('ambiguous workspace creation can be retried with the same payload and request ID', async ({ page }) => {
  const fixture = await prepareWorkspacePage(page, []);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByLabel('Workspace name').fill('North plant');
  await page.getByLabel('Time zone').fill('Asia/Manila');
  await page.getByLabel('Currency code').fill('PHP');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');

  const retry = page.getByRole('button', { name: 'Retry with the same request' });
  await expect(retry).toBeEnabled();
  await expect(page.getByLabel('Workspace name')).toHaveValue('North plant');
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();

  const [first, second] = fixture.organizationRequests();
  expect(first).toMatchObject({ name: 'North plant', timezone: 'Asia/Manila', currency: 'PHP' });
  expect(second).toEqual(first);
});
