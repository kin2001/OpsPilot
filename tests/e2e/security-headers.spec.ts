import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('invite and recovery documents return private no-store and no-referrer headers', async ({ page, request }) => {
  for (const path of ['/invite?invitation=fixture', '/reset-password?code=fixture']) {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['cache-control']).toContain('private');
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
  }
  await page.goto('/');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
});

test('static-host baseline defines SPA fallback, CSP and private auth routes', async () => {
  const headers = await readFile('public/_headers', 'utf8');
  const redirects = await readFile('public/_redirects', 'utf8');
  expect(headers).toContain('Content-Security-Policy:');
  expect(headers).toMatch(/img-src 'self' data: blob:/);
  expect(headers).toContain('connect-src');
  expect(headers).toContain('Cache-Control: private, no-store');
  expect(headers).toContain('/invite\n  Referrer-Policy: no-referrer');
  expect(headers).toContain('/reset-password\n  Referrer-Policy: no-referrer');
  expect(redirects).toContain('/invite /index.html 200');
  expect(redirects).toContain('/reset-password /index.html 200');
  expect(redirects).toContain('/* /index.html 200');
});
