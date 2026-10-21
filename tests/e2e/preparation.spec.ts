import { expect, test } from '@playwright/test';
test('approved React build boots without browser runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to OpsPilot' })).toBeVisible();
  expect(errors).toEqual([]);
});
