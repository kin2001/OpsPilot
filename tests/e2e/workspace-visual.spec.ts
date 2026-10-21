import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { fixtureOrganizationIds, prepareWorkspacePage } from './workspace-fixture';

const evidenceDirectory = '.cache/por23-ui';

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
  await expect(preview.getByText('Not recorded')).toBeVisible();
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

test('work orders keep one Draft lane and a working table toggle', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Work orders', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Draft work orders' })).toBeVisible();
  await expect(page.getByText('Draft · Not started')).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: /WO-0002/ }).click();
  await expect(page.getByRole('region', { name: 'Selected work order details' }).getByRole('heading', { name: /Check fan vibration/ })).toBeVisible();
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Draft work orders' })).toBeVisible();
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
