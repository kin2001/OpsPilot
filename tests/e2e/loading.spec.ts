import { expect, test, type Page } from '@playwright/test';
import { prepareWorkspacePage } from './workspace-fixture';

async function holdRead(page: Page, table: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`http://127.0.0.1:54321/rest/v1/${table}**`, async (route) => {
    if (route.request().method() !== 'OPTIONS') await gate;
    return route.fallback();
  });
  return release;
}

test('workspace loading shows a centered animated logo until membership is ready', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await prepareWorkspacePage(page);
  const release = await holdRead(page, 'organization_members');
  try {
    await page.goto('/');
    const loading = page.getByRole('status').filter({ hasText: 'Loading your workspace…' });
    await expect(loading.locator('.brand-loader')).toBeVisible();
    await expect(loading).toHaveAccessibleName('Loading your workspace…');
    await expect(loading.locator('.brand-loader')).toHaveCSS('animation-name', 'brand-pulse');
    const bounds = await loading.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(640);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await expect(page.locator('.loading-state--screen')).toHaveCount(0);
});

test('section loading keeps the workspace navigation available and uses a smaller logo', async ({ page }) => {
  await prepareWorkspacePage(page);
  const release = await holdRead(page, 'assets');
  try {
    await page.goto('/assets');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    const loading = page.getByRole('status').filter({ hasText: 'Loading assets…' });
    await expect(loading.locator('.brand-loader')).toBeVisible();
    expect((await loading.locator('.brand-loader').boundingBox())!.width).toBeLessThan(80);
    await expect(page.locator('.loading-state--screen')).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('status').filter({ hasText: 'Loading assets…' })).toHaveCount(0);
});

test('reduced motion leaves a static logo and long waits reveal their status', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await prepareWorkspacePage(page);
  const release = await holdRead(page, 'organization_members');
  try {
    await page.goto('/');
    const loading = page.getByRole('status').filter({ hasText: 'Loading your workspace…' });
    await expect(loading.locator('.brand-loader')).toBeVisible();
    await expect(loading.locator('.brand-loader')).toHaveCSS('animation-name', 'none');
    await expect(loading.locator('.loading-hint')).toHaveCount(0);
    await page.clock.fastForward(8_000);
    await expect(loading.locator('.loading-hint')).toBeVisible();
  } finally { release(); }
});

test('failed workspace access replaces the loader with existing recovery actions', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.route('http://127.0.0.1:54321/rest/v1/organization_members**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'FORBIDDEN' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.locator('.brand-loader')).toHaveCount(0);
});
