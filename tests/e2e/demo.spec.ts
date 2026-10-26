import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { expect, test } from '@playwright/test';
import { prepareWorkspacePage } from './workspace-fixture';

let preview: ChildProcess;
const origin = 'http://127.0.0.1:5174';
const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'anon' })).toString('base64url')}.synthetic`;

test.beforeAll(async () => {
  const previous = process.env.DEMO_PUBLISHABLE_KEY;
  process.env.DEMO_PUBLISHABLE_KEY = key;
  try {
    await build({ configFile: resolve('demo/vite.config.ts'), build: { outDir: '.cache/demo-browser-dist' }, logLevel: 'silent' });
  } finally {
    if (previous === undefined) delete process.env.DEMO_PUBLISHABLE_KEY; else process.env.DEMO_PUBLISHABLE_KEY = previous;
  }
  preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--config', 'demo/vite.config.ts', '--port', '5174', '--outDir', '.cache/demo-browser-dist'], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DEMO_PUBLISHABLE_KEY: key }, stdio: 'ignore', windowsHide: true,
  });
  await expect.poll(async () => { try { return (await fetch(origin)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  if (preview && preview.exitCode === null) {
    const exited = new Promise<void>((done) => preview.once('exit', () => done()));
    preview.kill();
    await exited;
  }
});

test('built demo keeps its banner, runs the app and blocks non-demo network connections', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Sign in to OpsPilot' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('SYNTHETIC DEMO');
  await expect(page.getByRole('note')).toContainText('AI disabled');
  expect(await page.evaluate(async () => { try { await fetch('https://private-target.invalid'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
  // Reuse accepted mocked session/records only to exercise production JavaScript under the demo CSP.
  await prepareWorkspacePage(page);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('link', { name: 'Assets', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('SYNTHETIC DEMO');
  await expect(page.getByText('Alpha pump', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '.cache/demo-preview.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(readFileSync('.cache/demo-browser-dist/index.html', 'utf8')).toContain('Content-Security-Policy');
});
