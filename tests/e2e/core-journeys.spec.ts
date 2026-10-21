import { createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { readIsolatedServiceConfig } from './service-config';
import { prepareWorkspacePage } from './workspace-fixture';

const serviceConfig = readIsolatedServiceConfig(process.env);
const url = serviceConfig?.url ?? '';
const anon = serviceConfig?.anon ?? '';
const service = serviceConfig?.service ?? '';
const isolated = serviceConfig !== null;
const appOrigin = 'http://127.0.0.1:5173';

function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Synthetic browser fixture setup failed; database output withheld.');
}

async function makeConfirmedUser(label: string) {
  if (!isolated) throw new Error('Isolated loopback Supabase is required.');
  const email = `${label.toLowerCase()}-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}-Aa9!`;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic account setup failed.');
  return { id: created.data.user.id, email, password };
}

function allowWorkspaceBootstrap(user: { id: string; email: string }) {
  if (!/^[0-9a-f-]{36}$/.test(user.id) || !/^[a-z0-9._+-]+@example\.test$/.test(user.email)) throw new Error('Fixture identity was not synthetic.');
  sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values ('${user.id}','${user.email}',1);`);
}

function base32Bytes(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.toUpperCase().replace(/=+$/, '')) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Provider returned an invalid synthetic TOTP secret.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Bytes(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

async function invitationRedirect(email: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const inbox = await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json() as { messages?: { ID: string; To: { Address: string }[] }[] };
    const message = inbox.messages?.find((entry) => entry.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()));
    if (message) {
      const mail = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(message.ID)}`)).json() as { HTML?: string; Text?: string };
      const contents = `${mail.HTML ?? ''} ${mail.Text ?? ''}`;
      const match = contents.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
      if (!match) throw new Error('Synthetic invitation email did not contain a verification link.');
      const verification = new URL(match[0].replaceAll('&amp;', '&'));
      if (verification.origin !== url || verification.pathname !== '/auth/v1/verify') throw new Error('Email link did not target the isolated Auth service.');
      const response = await fetch(verification, { redirect: 'manual' });
      const location = response.headers.get('location');
      if (!location || response.status < 300 || response.status >= 400) throw new Error('Synthetic email verification did not return a local redirect.');
      const target = new URL(location, url);
      const credentials = new URLSearchParams(target.hash.slice(1));
      if (target.origin !== appOrigin || target.pathname !== '/invite' || !/^[a-f0-9]{64}$/.test(target.searchParams.get('invitation') ?? '')
        || !credentials.get('access_token') || !credentials.get('refresh_token')) throw new Error('Verified invitation redirect was incomplete or unexpected.');
      return target.href;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Synthetic invitation email did not arrive in local Mailpit.');
}

test('asset header action remains selectable beside its empty-state action', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  await page.goto('/');
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No assets are visible' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register asset', exact: true })).toHaveCount(2);

  const assetsHeader = page.locator('header.page-heading').filter({ has: page.getByRole('heading', { name: 'Assets', exact: true }) });
  await expect(assetsHeader.getByRole('button', { name: 'Register asset', exact: true })).toHaveCount(1);
  await assetsHeader.getByRole('button', { name: 'Register asset', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Register an asset' })).toBeVisible();
});

test('owner onboards with native TOTP, creates maintenance records and invites a verified recipient', async ({ page }) => {
  test.skip(!isolated, 'This journey runs only against the job-owned loopback Supabase and Mailpit services.');
  const owner = await makeConfirmedUser('por23-owner');
  const recipientEmail = `por23-recipient-${randomUUID()}@example.test`;
  allowWorkspaceBootstrap(owner);

  await page.goto('/');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Authenticator verification' })).toBeVisible();
  await page.getByLabel('Authenticator name').fill('OpsPilot primary authenticator');
  await page.getByRole('button', { name: 'Set up an authenticator' }).click();
  await expect(page.locator('.secret-value')).toBeVisible();
  const firstSecret = await page.locator('.secret-value').innerText();
  await page.getByLabel('Six-digit authenticator code').fill(totp(firstSecret));
  await page.getByRole('button', { name: 'Verify authenticator' }).click();

  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByLabel('Workspace name').fill(`Synthetic workspace ${randomUUID().slice(0, 8)}`);
  await page.getByLabel('Time zone').fill('Asia/Manila');
  await page.getByLabel('Currency code').fill('PHP');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  const assetsHeader = page.locator('header.page-heading').filter({ has: page.getByRole('heading', { name: 'Assets', exact: true }) });
  await assetsHeader.getByRole('button', { name: 'Register asset', exact: true }).click();
  const assetForm = page.getByRole('region', { name: 'Register an asset' });
  await assetForm.getByLabel('Asset code').fill('PUMP-SYN-01');
  await assetForm.getByLabel('Name', { exact: true }).fill('Synthetic pump');
  await assetForm.getByLabel('Category').fill('pump');
  await assetForm.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic pump' })).toBeVisible();
  await expect(page.getByText('Not recorded', { exact: true })).toBeVisible();

  await primaryNavigation.getByRole('link', { name: 'Requests', exact: true }).click();
  const requestsHeader = page.locator('header.page-heading').filter({ has: page.getByRole('heading', { name: 'Requests', exact: true }) });
  await requestsHeader.getByRole('button', { name: 'New request', exact: true }).click();
  const requestForm = page.getByRole('region', { name: 'Submit a request' });
  await requestForm.getByLabel('Asset code').fill('PUMP-SYN-01');
  await requestForm.getByLabel('What needs attention?').fill('Synthetic vibration report');
  await requestForm.getByLabel('Category').fill('vibration');
  await requestForm.getByRole('button', { name: 'Save and submit', exact: true }).click();
  const requestDetails = page.getByRole('region', { name: 'Selected request details' });
  await expect(requestDetails.getByText('submitted', { exact: true })).toBeVisible();
  await requestDetails.getByRole('button', { name: 'Convert to draft work order', exact: true }).click();
  await expect(page.getByText('Draft work order created:')).toBeVisible();
  await primaryNavigation.getByRole('link', { name: 'Work orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: /WO-0001/ })).toBeVisible();
  await expect(page.getByText('Assignment and repair progress have not been recorded.')).toBeVisible();

  await primaryNavigation.getByRole('link', { name: 'Security', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Authenticator verification' })).toBeVisible();
  await page.getByLabel('Backup authenticator name').fill('OpsPilot backup authenticator');
  await page.getByRole('button', { name: 'Add backup authenticator' }).click();
  await expect(page.locator('.secret-value')).toBeVisible();
  const backupSecret = await page.locator('.secret-value').innerText();
  await page.getByLabel('Six-digit authenticator code').fill(totp(backupSecret));
  await page.getByRole('button', { name: 'Verify authenticator' }).click();
  await expect(page.getByText('Two verified authenticator factors are configured.')).toBeVisible();

  await primaryNavigation.getByRole('link', { name: 'Team', exact: true }).click();
  const invitationForm = page.getByRole('region', { name: 'Invite a teammate' });
  await invitationForm.getByLabel('Email').fill(recipientEmail);
  await invitationForm.getByLabel('Workspace role').selectOption('technician');
  await invitationForm.getByRole('button', { name: 'Request invitation', exact: true }).click();
  await expect(page.getByText(`Invitation delivery was requested for ${recipientEmail}.`)).toBeVisible();

  const invitationUrl = await invitationRedirect(recipientEmail);
  await page.goto(invitationUrl);
  await expect(page).toHaveURL(`${appOrigin}/invite`);
  await expect(page.getByRole('heading', { name: 'Accept workspace invitation' })).toBeVisible();
  await expect(page.getByText(`Continue as ${recipientEmail}.`)).toBeVisible();
  await page.getByRole('button', { name: `Accept as ${recipientEmail}` }).click();
  await expect(page.getByRole('heading', { name: 'Invitation accepted' })).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toHaveValue(/.+/);
});

test('workspace switching changes the visible tenant records', async ({ page }) => {
  test.skip(!isolated, 'This journey runs only against the job-owned loopback Supabase services.');
  const ownerA = await makeConfirmedUser('por23-switch-a');
  const ownerB = await makeConfirmedUser('por23-switch-b');
  allowWorkspaceBootstrap(ownerA);
  allowWorkspaceBootstrap(ownerB);
  const clientA = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const clientB = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const [signedA, signedB] = await Promise.all([
    clientA.auth.signInWithPassword({ email: ownerA.email, password: ownerA.password }),
    clientB.auth.signInWithPassword({ email: ownerB.email, password: ownerB.password }),
  ]);
  if (signedA.error || signedB.error) throw new Error('Synthetic workspace account setup failed.');
  const [orgAResult, orgBResult] = await Promise.all([
    clientA.rpc('create_organization', { name: `Synthetic A ${randomUUID().slice(0, 6)}`, timezone: 'UTC', currency: 'USD', request_id: randomUUID() }),
    clientB.rpc('create_organization', { name: `Synthetic B ${randomUUID().slice(0, 6)}`, timezone: 'UTC', currency: 'USD', request_id: randomUUID() }),
  ]);
  if (orgAResult.error || orgBResult.error) throw new Error('Synthetic tenant setup failed.');
  const orgA = orgAResult.data.data.id as string;
  const orgB = orgBResult.data.data.id as string;
  sql(`insert into public.organization_members(organization_id,user_id,role) values ('${orgB}','${ownerA.id}','manager');`);
  const [assetA, assetB] = await Promise.all([
    clientA.rpc('save_asset', { ctx: { organization_id: orgA, request_id: randomUUID() }, asset_id: null, fields: { code: 'ASSET-A', name: 'Synthetic asset A', category: 'pump' } }),
    clientB.rpc('save_asset', { ctx: { organization_id: orgB, request_id: randomUUID() }, asset_id: null, fields: { code: 'ASSET-B', name: 'Synthetic asset B', category: 'pump' } }),
  ]);
  if (assetA.error || assetB.error) throw new Error('Synthetic tenant records could not be created.');

  await page.goto('/');
  await page.getByLabel('Email').fill(ownerA.email);
  await page.getByLabel('Password').fill(ownerA.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic asset A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic asset B' })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Workspace' }).selectOption(orgB);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic asset B' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic asset A' })).toHaveCount(0);
});
