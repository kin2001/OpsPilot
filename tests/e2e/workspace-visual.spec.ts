import { mkdir } from 'node:fs/promises';
import { expect, test, type Route } from '@playwright/test';
import { fixtureOrganizationIds, fixtureUserId, prepareWorkspacePage } from './workspace-fixture';

const evidenceDirectory = '.cache/por23-ui';

const por24EvidenceDirectory = '.cache/por24-ui';
const visualAssetId = 'c2daf4c7-e68c-4783-87c6-26b009a1169d';
const visualWorkOrderId = 'abfc36f2-44f3-4c85-b0b5-696e4c6626bf';
const visualTaskId = '213b9951-8f2e-437f-8f22-ef2973147f67';
const visualTechnicianId = '5d3c9d7e-40a8-4b27-a7d8-e350a66b771b';

const visualAsset = {
  id: visualAssetId, organization_id: fixtureOrganizationIds.alpha, code: 'ALPHA-01', name: 'Alpha pump', category: 'pump',
  site_id: null, serial_number: null, registration: null, archived_at: null, created_by: fixtureUserId,
  created_at: '2026-10-21T01:00:00.000Z', version: 2, availability: 'under_maintenance',
};
const visualWorkOrder = {
  id: visualWorkOrderId, organization_id: fixtureOrganizationIds.alpha, number: 1, asset_id: visualAssetId,
  source_request_id: null, title: 'Review pump seal', description: 'Inspect and document the reported seal condition.',
  category: 'inspection', priority: 'normal', due_at: null, supervisor_id: fixtureUserId, status: 'in_progress',
  blocks_operation: false, created_by: fixtureUserId, created_at: '2026-10-21T03:00:00.000Z', version: 4,
  repair_revision: 2, submitted_revision: null, opened_at: '2026-10-21T05:00:00.000Z', completed_at: null, priority_reason: null,
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
  await expect(preview.getByRole('definition').filter({ hasText: 'out of service' })).toBeVisible();
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
  await expect(preview.getByRole('heading', { name: 'inspection request' })).toBeVisible();
  const vibration = page.getByRole('button', { name: /Unusual fan vibration reported/ });
  await vibration.click();
  await expect(preview.getByRole('heading', { name: 'vibration request' })).toBeVisible();
  await expect(desktopTable.locator('tr[aria-selected="true"]')).toContainText('Unusual fan vibration reported.');
  await expect(preview.getByLabel('Draft work order title')).toHaveValue('Unusual fan vibration reported.');
  await expect(preview.getByRole('button', { name: 'Convert to draft work order' })).toBeVisible();
  await page.screenshot({ path: `${evidenceDirectory}/requests-desktop.png`, fullPage: true });

  await page.getByLabel('Search requests').fill('vibration');
  await expect(page.getByRole('button', { name: /Seal inspection requested/ })).toHaveCount(0);
  await expect(preview.getByRole('heading', { name: 'vibration request' })).toBeVisible();
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
  const openLane = page.getByRole('region', { name: 'Open work orders' });
  await expect(openLane.getByRole('button', { name: /Review pump seal/ })).toContainText('draft');
  await expect(page.getByRole('region', { name: 'Selected work order details' })).toHaveCount(0);
  await openLane.getByRole('button', { name: /WO-0001/ }).click();
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await expect(details.getByRole('heading', { name: /Review pump seal/ })).toBeVisible();
  await expect(details.getByText('draft', { exact: true })).toBeVisible();
  await viewToggle.getByRole('button', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: 'Authorized work orders' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await table.getByRole('button', { name: 'Open details' }).click();
  await expect(details.getByRole('heading', { name: /Check fan vibration/ })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Tenant A private draft text')).toHaveCount(0);
  await page.getByRole('link', { name: 'Requests', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected request details' }).getByText('Beta workspace request.')).toBeVisible();
  await page.getByRole('button', { name: 'New request' }).click();
  await expect(page.getByLabel('What needs attention?')).toHaveValue('');
});

test('POR-24 dashboard, work orders, assets, team, notifications and settings render at desktop and mobile widths', async ({ page }) => {
  await mkdir(por24EvidenceDirectory, { recursive: true });
  await prepareWorkspacePage(page);
  const days = Array.from({ length: 7 }, (_, index) => new Date(Date.now() - (6 - index) * 86_400_000).toISOString().slice(0, 10));
  const notification = {
    id: '22145b0a-e2dc-4c6f-8a2e-70b6e49d95ba', organization_id: fixtureOrganizationIds.alpha,
    recipient_user_id: fixtureUserId, event_id: 'bd51d958-20af-46ac-b51a-3e95ebea771d',
    category: 'transition_work_order', source_id: visualWorkOrderId, created_at: '2026-10-22T06:00:00.000Z', read_at: null,
  };
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fallback();
    if (url.pathname === '/rest/v1/rpc/get_dashboard') {
      const body = request.postDataJSON() as { range: { from: string; to: string } };
      return fulfillJson(route, {
        counts: { active_assets: 3, available_assets: 2, active_work_orders: 4, blocked: 1, pending_approvals: 1, overdue: 0, completed: 2, completion_sample_size: 2, completion_seconds: 4200 },
        daily_availability: days.map((date, index) => ({ date, known_assets: 3, available_assets: index < 2 ? null : 2 })),
        downtime_seconds: 1800, history_complete: false, timezone: 'Asia/Manila', from: body.range.from, to: body.range.to, generated_at: new Date().toISOString(),
      });
    }
    if (url.pathname === '/rest/v1/rpc/get_team') return fulfillJson(route, [
      { user_id: fixtureUserId, role: 'owner', active: true, version: 1 },
      { user_id: visualTechnicianId, role: 'technician', active: true, version: 2 },
    ]);
    if (url.pathname === '/rest/v1/rpc/get_asset_history') return fulfillJson(route, { items: [], next_cursor: null });
    if (url.pathname === '/rest/v1/work_orders') {
      if (url.searchParams.get('id') === `eq.${visualWorkOrderId}`) return fulfillJson(route, visualWorkOrder);
      return fulfillJson(route, [visualWorkOrder]);
    }
    if (url.pathname === '/rest/v1/work_order_assignments') return fulfillJson(route, [{ user_id: visualTechnicianId, unassigned_at: null }]);
    if (url.pathname === '/rest/v1/work_order_tasks') return fulfillJson(route, [{ id: visualTaskId, organization_id: fixtureOrganizationIds.alpha, work_order_id: visualWorkOrderId, label: 'Verify bearing clearance', required: true, completed: false, completed_by: null, completed_at: null }]);
    if (['/rest/v1/work_order_events', '/rest/v1/work_order_reviews', '/rest/v1/work_order_participants', '/rest/v1/work_order_performer_declarations', '/rest/v1/work_order_submission_attestations', '/rest/v1/attachments', '/rest/v1/asset_holds', '/rest/v1/asset_releases', '/rest/v1/asset_meter_readings', '/rest/v1/organization_invitations'].includes(url.pathname)) return fulfillJson(route, []);
    if (url.pathname === '/rest/v1/notifications') return fulfillJson(route, [notification]);
    if (url.pathname === '/rest/v1/organization_settings') {
      return fulfillJson(route, url.searchParams.get('select') === 'evidence_required,version' ? { evidence_required: true, version: 1 } : { evidence_required: true });
    }
    if (url.pathname === '/rest/v1/organizations' && url.searchParams.get('select') === 'timezone,currency') return fulfillJson(route, { timezone: 'Asia/Manila', currency: 'PHP' });
    if (url.pathname === '/rest/v1/assets') {
      if (url.searchParams.get('id') === `eq.${visualAssetId}`) return fulfillJson(route, visualAsset);
      return fulfillJson(route, [visualAsset]);
    }
    return route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const screens = [
    { name: 'dashboard', path: '/', heading: 'Overview' },
    { name: 'work-orders', path: '/work-orders', heading: 'Work orders' },
    { name: 'assets', path: `/assets?asset=${visualAssetId}`, heading: 'Assets' },
    { name: 'team', path: '/team', heading: 'Team' },
    { name: 'notifications', path: '/notifications', heading: 'Notifications' },
    { name: 'settings', path: '/settings', heading: 'Settings' },
  ];
  for (const screen of screens) {
    await page.goto(screen.path);
    await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
    if (screen.name === 'work-orders') await expect(page.getByRole('group', { name: 'Work orders by status' })).toBeVisible();
    if (screen.name === 'assets') await expect(page.getByRole('region', { name: /Operational details for/ }).getByText('No private images are recorded.')).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 1440);
    await page.screenshot({ path: `${por24EvidenceDirectory}/${screen.name}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    await page.screenshot({ path: `${por24EvidenceDirectory}/${screen.name}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
    await page.setViewportSize({ width: 1440, height: 960 });
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

test('a different signed-in user cannot inherit the previous account second-factor state', async ({ page }) => {
  const fixture = await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Security', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  const [first, second] = fixture.organizationRequests();
  expect(first).toMatchObject({ name: 'North plant', timezone: 'Asia/Manila', currency: 'PHP' });
  expect(second).toEqual(first);
});
