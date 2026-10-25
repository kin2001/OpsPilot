import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { prepareWorkspacePage } from './workspace-fixture';

const organizationId = '812de877-0151-497a-a13d-2749b0a3d622';
const rowId = '10000000-0000-4000-8000-000000000001';

function workFacts(range: { from: string; to: string }, withRows = false) {
  return {
    schema_version: 1, kind: 'work_orders', timezone: 'Asia/Manila', currency: 'PHP', range,
    from: `${range.from}T00:00:00+08:00`, to: `${range.to}T00:00:00+08:00`, generated_at: '2026-10-25T00:00:00Z', next_cursor: null,
    items: withRows ? [{ id: rowId, number: 42, asset_id: '10000000-0000-4000-8000-000000000002', category: '=1+1', status: 'completed', opened_at: '2026-10-01T01:00:00Z', approved_at: '2026-10-01T02:00:00Z', completion_seconds: 3600 }] : [],
    summary: { active_work_orders: 0, blocked: 0, pending_approvals: 0, overdue: 0, completed: withRows ? 1 : 0, completion_sample_size: withRows ? 1 : 0, completion_seconds: withRows ? 3600 : null,
      daily_completed: [{ date: range.from, completed: withRows ? 1 : 0 }], recurring_faults: [], recurring_faults_has_more: false },
  };
}

function partsFacts(range: { from: string; to: string }) {
  return {
    schema_version: 1, kind: 'parts_consumption', timezone: 'Asia/Manila', currency: 'PHP', range,
    from: `${range.from}T00:00:00+08:00`, to: `${range.to}T00:00:00+08:00`, generated_at: '2026-10-25T00:00:00Z', next_cursor: null,
    items: [{ id: rowId, work_order_id: '10000000-0000-4000-8000-000000000002', part_id: '10000000-0000-4000-8000-000000000003', location_id: '10000000-0000-4000-8000-000000000004', unit: 'each', kind: 'issue', quantity: '1.000', net_quantity: '1.000', occurred_at: '2026-10-01T03:00:00Z' }],
    summary: { movement_count: 1, quantity_policy: 'net_by_part_and_unit' },
  };
}

async function mockReports(page: Page, options: { failFirst?: number; timeoutFirst?: boolean; rows?: boolean } = {}) {
  const calls: Record<string, unknown>[] = [];
  let attempts = 0;
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/get_report', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    const body = route.request().postDataJSON() as { kind: string; range: { from: string; to: string } };
    calls.push(body);
    attempts++;
    if (options.timeoutFirst && attempts === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '57014', message: 'Statement timeout' }) });
    if (options.failFirst && attempts <= options.failFirst) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Service unavailable' }) });
    const result = body.kind === 'parts_consumption' ? partsFacts(body.range) : workFacts(body.range, Boolean(options.rows));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return calls;
}

test('shows a filterable, keyboard reachable no-data report with a retryable service error', async ({ page }) => {
  await prepareWorkspacePage(page);
  const calls = await mockReports(page, { failFirst: 1 });
  await page.goto('/reports');

  await expect(page.getByRole('heading', { name: 'Report could not be loaded' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry report' }).click();
  await expect(page.getByText('No source rows match this date range.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed work orders by day' })).toBeVisible();
  await page.screenshot({ path: '.cache/por40-reports-page.png', fullPage: true });

  await page.getByLabel('Start date').fill('2026-10-01');
  await page.getByLabel('End date (exclusive)').fill('2026-10-03');
  await page.getByRole('button', { name: 'Apply filters' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => calls.at(-1)?.range).toEqual({ from: '2026-10-01', to: '2026-10-03' });
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeFocused();
  expect(calls.every((call) => (call as { ctx: { organization_id: string } }).ctx.organization_id === organizationId)).toBe(true);

  const requestCount = calls.length;
  await page.getByLabel('Start date').fill('2026-10-05');
  await page.getByLabel('End date (exclusive)').fill('2026-10-03');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a valid date range.' })).toBeVisible();
  await expect(page.getByLabel('Start date')).toHaveAttribute('aria-invalid', 'true');
  expect(calls).toHaveLength(requestCount);
});

test('recovers from a timed-out report with a narrower date range', async ({ page }) => {
  await prepareWorkspacePage(page);
  const calls = await mockReports(page, { timeoutFirst: true });
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Report could not be loaded' })).toBeVisible();
  await expect(page.getByText('The report took too long. Retry, or choose a shorter date range.')).toBeVisible();
  await page.getByLabel('Start date').fill('2026-10-01');
  await page.getByLabel('End date (exclusive)').fill('2026-10-03');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('No source rows match this date range.')).toBeVisible();
  expect(calls.at(-1)?.range).toEqual({ from: '2026-10-01', to: '2026-10-03' });
});

test('shows safe source rows and downloads the selected report as CSV', async ({ page }) => {
  await prepareWorkspacePage(page);
  await mockReports(page, { rows: true });
  await page.route('http://127.0.0.1:54321/functions/v1/report-export', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    const body = route.request().postDataJSON() as { ctx: { organization_id: string }; kind: string; range: { from: string; to: string } };
    expect(body.ctx.organization_id).toBe(organizationId);
    expect(body.kind).toBe('work_orders');
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="opspilot-work_orders-2026-10-01-2026-10-02.csv"' }, body: '\uFEFF"Report","Work orders"\r\n' });
  });
  await page.goto('/reports');
  await expect(page.getByRole('cell', { name: '=1+1' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('opspilot-work_orders-');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedBytes = await readFile(downloadPath!);
  const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
  expect(downloadedBytes.subarray(0, utf8Bom.length)).toEqual(utf8Bom);
  expect(downloadedBytes.indexOf(utf8Bom, utf8Bom.length)).toBe(-1);
  await expect(page.getByRole('status').filter({ hasText: 'CSV downloaded.' })).toBeVisible();
});

test('keeps report reads available and offers account security when export requires MFA', async ({ page }) => {
  await prepareWorkspacePage(page);
  await mockReports(page);
  await page.route('http://127.0.0.1:54321/functions/v1/report-export', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'MFA_REQUIRED', message: 'Step-up verification required.' }) });
  });
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Completed work orders by day' })).toBeVisible();

  await page.getByRole('button', { name: 'Download CSV' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This export requires fresh authenticator verification.' })).toBeVisible();
  const securityLink = page.getByRole('link', { name: 'Open account security to verify' });
  await expect(securityLink).toHaveAttribute('href', '/settings/security');
  await securityLink.click();
  await expect(page.getByRole('heading', { name: 'Authenticator verification' })).toBeVisible();
});

test('limits inventory members to the parts report', async ({ page }) => {
  await prepareWorkspacePage(page, undefined, 'inventory');
  await mockReports(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Recorded movements by type' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Report' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
});

test('keeps Reports out of navigation for technicians and denies a direct route', async ({ page }) => {
  await prepareWorkspacePage(page, undefined, 'technician');
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports unavailable' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
});

test('keeps report filters and source rows inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await prepareWorkspacePage(page);
  await mockReports(page, { rows: true });
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByLabel('Start date')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Completed work orders by day text equivalent' })).toHaveCount(1);
  await expect(page.getByRole('table').getByRole('columnheader', { name: 'Work order ID' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const sourceRows = page.getByRole('region', { name: 'Work orders source rows' });
  await sourceRows.focus();
  await expect(sourceRows).toBeFocused();
});
