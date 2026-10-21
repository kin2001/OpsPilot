import { expect, test } from '@playwright/test';

test('invite credentials leave the address bar before the app renders', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { rootChildrenAtReplace?: number[] };
    state.rootChildrenAtReplace = [];
    const replace = history.replaceState.bind(history);
    history.replaceState = (data, unused, url) => {
      state.rootChildrenAtReplace!.push(document.getElementById('root')?.childElementCount ?? 0);
      replace(data, unused, url);
    };
  });

  await page.goto('/invite?invitation=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#access_token=synthetic-access&refresh_token=synthetic-refresh&type=magiclink');

  await expect(page).toHaveURL('http://127.0.0.1:5173/invite');
  expect(await page.evaluate(() => (window as Window & { rootChildrenAtReplace?: number[] }).rootChildrenAtReplace)).toEqual([0]);
});

test('an unavailable invite has a safe route back to sign in', async ({ page }) => {
  await page.goto('/invite');

  await expect(page.getByRole('heading', { name: 'Invitation link unavailable' })).toBeVisible();
  const returnLink = page.getByRole('link', { name: 'Back to sign in' });
  await expect(returnLink).toBeVisible();
  await returnLink.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to OpsPilot' })).toBeVisible();
});
