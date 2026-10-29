import { expect, test } from '@playwright/test';
import { prepareWorkspacePage } from './workspace-fixture';

for (const form of [
  { name: 'sign in', path: '/login', label: 'Password', autocomplete: 'current-password' },
  { name: 'create account', path: '/create-account', label: 'Password', autocomplete: 'new-password' },
  { name: 'reset password', path: '/reset-password?type=recovery', label: 'New password', autocomplete: 'new-password' },
]) {
  test(`${form.name}: reveal and hide without changing or submitting the password`, async ({ page }) => {
    if (form.name === 'reset password') await prepareWorkspacePage(page);
    await page.goto(form.path);
    const password = page.getByLabel(form.label, { exact: true });
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', form.autocomplete);
    await expect(password).toHaveAttribute('required', '');
    await password.fill('Only-a-fixture-123!');
    const show = page.getByRole('button', { name: 'Show password', exact: true });
    await expect(show).toHaveAttribute('type', 'button');
    await show.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('Only-a-fixture-123!');
    await password.fill('Only-a-fixture-123!X');
    const hide = page.getByRole('button', { name: 'Hide password', exact: true });
    await hide.focus();
    await hide.press('Space');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('Only-a-fixture-123!X');
    await expect(page.getByRole('button', { name: 'Show password', exact: true })).toBeFocused();
    await expect(password).toHaveAttribute('autocomplete', form.autocomplete);
    if (form.autocomplete === 'new-password') await expect(password).toHaveAttribute('minlength', '12');
  });
}
