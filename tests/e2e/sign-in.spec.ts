import { expect, test } from '@playwright/test';

test('unauthenticated users see the real sign-in and recovery entry points', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to OpsPilot' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/reset-password');
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/create-account');
});
