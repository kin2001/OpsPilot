import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { fixtureOrganizationIds, fixtureUserId, prepareWorkspacePage } from './workspace-fixture';

const pages = [
  ['dashboard', '/'], ['requests', '/requests'], ['work-orders', '/work-orders'],
  ['assets', '/assets'], ['maintenance', '/maintenance'], ['inspections', '/inspections'],
  ['inventory', '/inventory'], ['team', '/team'], ['reports', '/reports'],
  ['assistant', '/assistant'], ['notifications', '/notifications'], ['settings', '/settings'],
] as const;
const widths = [320, 375, 768, 1024, 1280, 1440, 1920];
const evidence = '.cache/por43-ui';

async function prepareVisualWorkspace(page: Page) {
  await prepareWorkspacePage(page);
  await page.route('http://127.0.0.1:54321/rest/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const name = url.pathname.split('/').at(-1)!;
    let data: unknown;
    const partId = '79000000-0000-4000-8000-000000000001';
    const locationId = '79000000-0000-4000-8000-000000000002';
    if (name === 'get_dashboard') data = {
      counts: { active_assets: 2, available_assets: 0, active_work_orders: 0, blocked: 0, pending_approvals: 0, overdue: 0, completed: 0, completion_sample_size: 0, completion_seconds: null },
      daily_availability: [{ date: '2026-10-21', known_assets: 2, available_assets: 0 }], downtime_seconds: null,
      history_complete: false, timezone: 'Asia/Manila', from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z', generated_at: '2026-10-21T12:00:00Z',
    };
    else if (name === 'get_team') data = [{ user_id: fixtureUserId, role: 'owner', active: true, version: 1 }];
    else if (name === 'list_inventory_parts') data = { items: [{ id: partId, organization_id: fixtureOrganizationIds.alpha, code: 'OF-204', name: 'Oil filter', unit: 'each', reorder_threshold: '1.500', archived_at: null, created_by: fixtureUserId, created_at: '2026-10-21T00:00:00Z', version: 1 }], next_cursor: null };
    else if (name === 'list_stock_locations') data = { items: [{ id: locationId, organization_id: fixtureOrganizationIds.alpha, code: 'WH-1', name: 'Main warehouse', created_by: fixtureUserId, created_at: '2026-10-21T00:00:00Z', version: 1 }], next_cursor: null };
    else if (name === 'list_inventory_balances') data = { items: [{ id: '79000000-0000-4000-8000-000000000004', organization_id: fixtureOrganizationIds.alpha, part_id: partId, location_id: locationId, on_hand: '2.500', reserved: '1.000', available: '1.500' }], next_cursor: null };
    else if (['list_inventory_movements', 'list_maintenance_plans', 'list_maintenance_agenda', 'list_inspection_templates', 'list_inspection_assignments', 'assistant_history', 'get_asset_history'].includes(name)) data = { items: [], next_cursor: null };
    else if (name === 'get_report') {
      const { range } = request.postDataJSON() as { range: { from: string; to: string } };
      data = { schema_version: 1, kind: 'work_orders', timezone: 'Asia/Manila', currency: 'PHP', range,
        from: `${range.from}T00:00:00+08:00`, to: `${range.to}T00:00:00+08:00`, generated_at: '2026-10-21T12:00:00Z', next_cursor: null, items: [],
        summary: { active_work_orders: 0, blocked: 0, pending_approvals: 0, overdue: 0, completed: 0, completion_sample_size: 0, completion_seconds: null, daily_completed: [], recurring_faults: [], recurring_faults_has_more: false } };
    }
    else if (['sites', 'attachments', 'asset_meter_readings', 'notifications', 'organization_invitations', 'work_order_events', 'asset_holds', 'asset_releases'].includes(name)) data = [];
    else if (name === 'work_orders' && (url.searchParams.has('status') || url.searchParams.has('planned_on'))) data = [];
    else if (name === 'organization_members' && url.searchParams.get('active') === 'eq.false') data = [];
    else if (name === 'organization_settings') data = { evidence_required: true, version: 1 };
    else if (name === 'organizations' && url.searchParams.get('select') === 'timezone,currency') data = { timezone: 'Asia/Manila', currency: 'PHP' };
    else return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

test('closed mobile navigation is hidden from keyboard and assistive technology', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
});

for (const [name, path] of pages) {
  test(`${name} reflows at every required width and preserves the supplied brand`, async ({ page }) => {
    await prepareVisualWorkspace(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main .loading-state')).toHaveCount(0);
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mkdir(evidence, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 941 });
      await expect.soft(page.locator('body'), `${name} document overflow at ${width}`).toHaveJSProperty('scrollWidth', width);
      const controls = page.locator('main input:not([type="hidden"]), main select, main textarea');
      for (const control of await controls.all()) {
        if (!await control.isVisible()) continue;
        const box = await control.boundingBox();
        expect.soft(box && box.x >= 0 && box.x + box.width <= width + 1, `${name} control clipped at ${width}`).toBeTruthy();
      }
      if (width === 320 || width === 1440) await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1280, height: 941 });
    for (const scale of [2, 4]) {
      // Browser zoom changes layout viewport; CSS zoom leaves media queries unchanged.
      const effectiveWidth = 1280 / scale;
      await page.setViewportSize({ width: effectiveWidth, height: 941 });
      await expect.soft(page.locator('body'), `${name} ${scale * 100}% zoom-equivalent reflow`).toHaveJSProperty('scrollWidth', effectiveWidth);
    }
    await page.setViewportSize({ width: 1672, height: 941 });
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('img', { name: 'OpsPilot', exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `${evidence}/${name}-native.png`, fullPage: true, animations: 'disabled' });
  });
}

for (const [path, label, first, second] of [
  ['/maintenance', 'Maintenance views', 'Calendar', 'Plans'],
  ['/inspections', 'Inspection views', 'Inspections', 'Templates'],
] as const) {
  test(`${label} supports arrow keys and one tab stop`, async ({ page }) => {
    await prepareWorkspacePage(page);
    await page.goto(path);
    const tabs = page.getByRole('tablist', { name: label });
    await tabs.getByRole('tab', { name: first, exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: second, exact: true })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: second, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: first, exact: true })).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab', { name: first, exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: second, exact: true })).toBeFocused();
  });
}

test('long asset forms and server errors remain usable at 320px', async ({ page }) => {
  await prepareVisualWorkspace(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/save_asset', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'VALIDATION' }) }));
  await page.goto('/assets');
  await page.getByRole('button', { name: 'Register asset', exact: true }).click();
  await page.getByLabel('Asset code', { exact: true }).fill('LONG-'.repeat(19));
  await page.getByLabel('Name', { exact: true }).fill('Long equipment description '.repeat(7));
  await page.getByLabel('Category', { exact: true }).fill('Pump');
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue('');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
  await page.getByLabel('Name', { exact: true }).focus();
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.screenshot({ path: `${evidence}/asset-form-error-320.png`, fullPage: true, animations: 'disabled' });
});

test('skip link moves keyboard focus past navigation into the main content', async ({ page }) => {
  await prepareVisualWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('owner navigation follows the twelve-page reference order', async ({ page }) => {
  await prepareVisualWorkspace(page);
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('link')).toHaveText(['Dashboard', 'Requests', 'Work orders', 'Assets', 'Maintenance', 'Inspections', 'Inventory', 'Team', 'Reports', 'Assistant', 'Notifications']);
});
