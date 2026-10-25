import { createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readIsolatedServiceConfig } from './service-config';
import { prepareWorkspacePage } from './workspace-fixture';

const serviceConfig = readIsolatedServiceConfig(process.env);
const url = serviceConfig?.url ?? '';
const anon = serviceConfig?.anon ?? '';
const service = serviceConfig?.service ?? '';
const isolated = serviceConfig !== null;
const appOrigin = 'http://127.0.0.1:5173';

declare global {
  interface Window {
    __privateImageUrls: string[];
    __revokedPrivateImageUrls: string[];
  }
}

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

async function enrollTOTP(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Authenticator verification' })).toBeVisible();
  await page.getByLabel('Authenticator name').fill(name);
  await page.getByRole('button', { name: 'Set up an authenticator' }).click();
  await expect(page.locator('.secret-value')).toBeVisible();
  const secret = await page.locator('.secret-value').innerText();
  await page.getByLabel('Six-digit authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify authenticator' }).click();
}

async function onboardingProgress(testInfo: TestInfo, progress: string[], label: string) {
  progress.push(label);
  const recentProgress = progress.slice(-4).join('\n');
  const index = String(progress.length).padStart(2, '0');
  console.info(`[onboarding-progress] ${label}`);
  await testInfo.attach(`onboarding-progress-${index}.txt`, {
    body: recentProgress,
    contentType: 'text/plain',
  });
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

test('owner onboards with native TOTP, creates maintenance records and invites a verified recipient', async ({ page }, testInfo) => {
  test.skip(!isolated, 'This journey runs only against the job-owned loopback Supabase and Mailpit services.');
  const progress: string[] = [];
  const owner = await makeConfirmedUser('por23-owner');
  const recipientEmail = `por23-recipient-${randomUUID()}@example.test`;
  await onboardingProgress(testInfo, progress, 'Bootstrap synthetic owner');
  allowWorkspaceBootstrap(owner);

  await onboardingProgress(testInfo, progress, 'Owner sign-in');
  await page.goto('/');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await onboardingProgress(testInfo, progress, 'Primary authenticator enrollment and verification');
  await expect(page.getByRole('heading', { name: 'Authenticator verification' })).toBeVisible();
  await page.getByLabel('Authenticator name').fill('OpsPilot primary authenticator');
  await page.getByRole('button', { name: 'Set up an authenticator' }).click();
  await expect(page.locator('.secret-value')).toBeVisible();
  const firstSecret = await page.locator('.secret-value').innerText();
  await page.getByLabel('Six-digit authenticator code').fill(totp(firstSecret));
  await page.getByRole('button', { name: 'Verify authenticator' }).click();

  await onboardingProgress(testInfo, progress, 'Workspace creation and dashboard readback');
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByLabel('Workspace name').fill(`Synthetic workspace ${randomUUID().slice(0, 8)}`);
  await page.getByLabel('Time zone').fill('Asia/Manila');
  await page.getByLabel('Currency code').fill('PHP');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await onboardingProgress(testInfo, progress, 'Asset registration and authorized readback');
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  const assetsHeader = page.locator('header.page-heading').filter({ has: page.getByRole('heading', { name: 'Assets', exact: true }) });
  await assetsHeader.getByRole('button', { name: 'Register asset', exact: true }).click();
  const assetForm = page.getByRole('region', { name: 'Register an asset' });
  await assetForm.getByLabel('Asset code').fill('PUMP-SYN-01');
  await assetForm.getByLabel('Name', { exact: true }).fill('Synthetic pump');
  await assetForm.getByLabel('Category').fill('pump');
  await assetForm.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic pump' })).toBeVisible();
  await expect(page.getByText('out of service', { exact: true }).first()).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Maintenance request submission');
  await primaryNavigation.getByRole('link', { name: 'Requests', exact: true }).click();
  const requestsHeader = page.locator('header.page-heading').filter({ has: page.getByRole('heading', { name: 'Maintenance requests', exact: true }) });
  await requestsHeader.getByRole('button', { name: /New request$/ }).click();
  const requestForm = page.getByRole('region', { name: 'Submit a request' });
  await requestForm.getByLabel('Asset code').fill('PUMP-SYN-01');
  await requestForm.getByLabel('What needs attention?').fill('Synthetic vibration report');
  await requestForm.getByLabel('Category').fill('vibration');
  await requestForm.getByRole('button', { name: 'Save and submit', exact: true }).click();
  const requestDetails = page.getByRole('region', { name: 'Selected request details' });
  await expect(requestDetails.getByText('submitted', { exact: true })).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Request conversion to draft work order');
  await requestDetails.getByText('Review and route request', { exact: true }).click();
  await requestDetails.getByRole('button', { name: 'Convert to draft work order', exact: true }).click();
  await expect(page.getByText('Draft work order created:')).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Converted work-order readback');
  await primaryNavigation.getByRole('link', { name: 'Work orders', exact: true }).click();
  const convertedDraft = page.getByRole('button', { name: /WO-0001.*Synthetic vibration report/ });
  await expect(convertedDraft).toBeVisible();
  await convertedDraft.click();
  const convertedDraftDetails = page.getByRole('region', { name: 'Selected work order details' });
  await expect(convertedDraftDetails.getByRole('heading', { name: 'Synthetic vibration report' })).toBeVisible();
  await expect(convertedDraftDetails.getByText('draft', { exact: true })).toBeVisible();
  await expect(convertedDraftDetails.getByText('Assignment and repair progress have not been recorded.')).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Backup authenticator enrollment and verification');
  await page.getByRole('link', { name: 'Account security' }).click();
  await expect(page.getByRole('heading', { name: 'Authenticator verification' })).toBeVisible();
  await page.getByLabel('Backup authenticator name').fill('OpsPilot backup authenticator');
  await page.getByRole('button', { name: 'Add backup authenticator' }).click();
  await expect(page.locator('.secret-value')).toBeVisible();
  const backupSecret = await page.locator('.secret-value').innerText();
  await page.getByLabel('Six-digit authenticator code').fill(totp(backupSecret));
  await page.getByRole('button', { name: 'Verify authenticator' }).click();
  await expect(page.getByText('Two verified authenticator factors are configured.')).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Teammate invitation request');
  await primaryNavigation.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('tab', { name: 'Members', exact: true }).click();
  const invitationForm = page.getByRole('region', { name: 'Invite a teammate' });
  await invitationForm.getByLabel('Email').fill(recipientEmail);
  await invitationForm.getByLabel('Workspace role').selectOption('technician');
  await invitationForm.getByRole('button', { name: 'Request invitation', exact: true }).click();
  await expect(page.getByText(`Invitation delivery was requested for ${recipientEmail}.`)).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Mailpit email polling and local redirect validation');
  const invitationUrl = await invitationRedirect(recipientEmail);
  await onboardingProgress(testInfo, progress, 'Recipient invitation acceptance');
  await page.goto(invitationUrl);
  await expect(page).toHaveURL(`${appOrigin}/invite`);
  await expect(page.getByRole('heading', { name: 'Accept workspace invitation' })).toBeVisible();
  await expect(page.getByText(`Continue as ${recipientEmail}.`)).toBeVisible();
  await page.getByRole('button', { name: `Accept as ${recipientEmail}` }).click();
  await expect(page.getByRole('heading', { name: 'Invitation accepted' })).toBeVisible();

  await onboardingProgress(testInfo, progress, 'Open recipient workspace and verify access readback');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toHaveValue(/.+/);
});

test('synthetic service completes a repair correction, preserves ambiguous create identity, and records separate asset release', async ({ browser }) => {
  test.skip(!isolated, 'This journey requires the job-owned loopback Supabase, Storage and Auth services.');
  test.setTimeout(240_000);
  const owner = await makeConfirmedUser('por24-owner');
  const technician = await makeConfirmedUser('por24-tech');
  const reviewer = await makeConfirmedUser('por24-reviewer');
  allowWorkspaceBootstrap(owner);
  const ownerPage = await browser.newPage();
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  await ownerPage.goto('/');
  await ownerPage.getByLabel('Email').fill(owner.email);
  await ownerPage.getByLabel('Password').fill(owner.password);
  await ownerPage.getByRole('button', { name: 'Sign in' }).click();
  await enrollTOTP(ownerPage, 'POR-24 owner authenticator');
  await expect(ownerPage.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await ownerPage.getByLabel('Workspace name').fill(`Synthetic repair ${randomUUID().slice(0, 8)}`);
  await ownerPage.getByLabel('Time zone').fill('Asia/Manila');
  await ownerPage.getByLabel('Currency code').fill('PHP');
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();

  const ownerMembership = await admin.from('organization_members').select('organization_id').eq('user_id', owner.id).single();
  if (ownerMembership.error) throw new Error('Synthetic owner workspace could not be read back.');
  const organizationId = ownerMembership.data.organization_id;
  sql(`insert into public.organization_members(organization_id,user_id,role) values ('${organizationId}','${technician.id}','technician');`);
  sql(`insert into public.organization_members(organization_id,user_id,role) values ('${organizationId}','${reviewer.id}','supervisor');`);
  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await reviewerPage.goto('/');
  await reviewerPage.getByLabel('Email').fill(reviewer.email);
  await reviewerPage.getByLabel('Password').fill(reviewer.password);
  await reviewerPage.getByRole('button', { name: 'Sign in' }).click();
  await reviewerPage.getByRole('link', { name: 'Account security' }).click();
  await enrollTOTP(reviewerPage, 'POR-24 reviewer authenticator');
  await expect(reviewerPage.getByText('Second factor verified', { exact: true })).toBeVisible();

  const ownerNavigation = ownerPage.getByRole('navigation', { name: 'Primary navigation' });
  const workspaceNavigation = ownerPage.getByRole('complementary', { name: 'Workspace navigation' });
  await workspaceNavigation.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(ownerPage.getByLabel('Workspace time zone')).toHaveValue('Asia/Manila');
  await ownerPage.getByRole('button', { name: 'Save settings' }).click();
  await expect(ownerPage.getByText('Workspace settings saved.')).toBeVisible();

  const assetCode = `PUMP-${randomUUID().slice(0, 8).toUpperCase()}`;
  await ownerNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  const assetsHeader = ownerPage.locator('header.page-heading').filter({ has: ownerPage.getByRole('heading', { name: 'Assets', exact: true }) });
  await assetsHeader.getByRole('button', { name: 'Register asset', exact: true }).click();
  const assetForm = ownerPage.getByRole('region', { name: 'Register an asset' });
  await assetForm.getByLabel('Asset code').fill(assetCode);
  await assetForm.getByLabel('Name', { exact: true }).fill('Synthetic service pump');
  await assetForm.getByLabel('Category').fill('pump');
  await assetForm.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Synthetic service pump' })).toBeVisible();
  const assetRecord = await admin.from('assets').select('id').eq('organization_id', organizationId).eq('code', assetCode).single();
  if (assetRecord.error) throw new Error('Synthetic asset creation could not be read back.');
  const assetId = assetRecord.data.id;
  const assetDetails = ownerPage.getByRole('region', { name: 'Selected asset details' });
  const operations = assetDetails.getByRole('region', { name: /Operational details for/ });
  await operations.getByLabel('Reason for manual safety hold').fill('Isolate pending the inspection repair.');
  await operations.getByRole('button', { name: 'Place safety hold' }).click();
  await expect(operations.getByText('Active', { exact: true })).toBeVisible();

  await ownerNavigation.getByRole('link', { name: 'Work orders', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Create work order' }).click();
  const createForm = ownerPage.getByRole('region', { name: 'Create a work order' });
  await createForm.getByLabel('Asset', { exact: true }).selectOption(assetId);
  await createForm.getByLabel('Title').fill('Inspect pump bearing assembly');
  await createForm.getByLabel('Description').fill('Inspect the bearing condition, record labor, and attach a validated repair image.');
  await createForm.getByLabel('Category').fill('inspection');
  const createBodies: unknown[] = [];
  let createCommitCount = 0;
  let workOrderId = '';
  let createReceiptRequestId = '';
  const createRpc = new URL('/rest/v1/rpc/create_work_order', url).href;
  await ownerPage.route(createRpc, async (route) => {
    createBodies.push(route.request().postDataJSON());
    const committed = await route.fetch();
    const responseValue = await committed.json() as { data?: { id?: string }; version?: number; request_id?: string };
    if (!committed.ok()) throw new Error('Synthetic create did not commit successfully before simulating a lost response.');
    const requestBody = route.request().postDataJSON() as { ctx?: { organization_id?: string; request_id?: string }; asset_id?: string; fields?: { title?: string } };
    if (!responseValue.data?.id || !responseValue.request_id || !requestBody.ctx?.request_id || !requestBody.ctx.organization_id || !requestBody.asset_id || !requestBody.fields?.title) {
      throw new Error('Synthetic create response did not contain its strict T1 receipt identity.');
    }
    if (responseValue.request_id !== requestBody.ctx.request_id) throw new Error('Synthetic create receipt did not match the submitted request identity.');
    workOrderId = responseValue.data.id;
    createReceiptRequestId = responseValue.request_id;
    createCommitCount++;
    if (createCommitCount === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Response lost after commit.' }) });
      return;
    }
    await route.fulfill({ response: committed });
  });
  await createForm.getByRole('button', { name: 'Create work order', exact: true }).click();
  await expect(createForm.getByRole('button', { name: 'Retry exact create' })).toBeVisible();
  await expect(createForm.getByLabel('Title')).toBeDisabled();
  await createForm.getByRole('button', { name: 'Retry exact create' }).click();
  await expect(ownerPage.getByRole('heading', { name: 'Inspect pump bearing assembly' })).toBeVisible();
  expect(createBodies).toHaveLength(2);
  expect(createBodies[1]).toEqual(createBodies[0]);
  expect(createCommitCount).toBe(2);
  expect(workOrderId).toMatch(/^[0-9a-f-]{36}$/);
  const createBody = createBodies[0] as { ctx: { organization_id: string; request_id: string }; asset_id: string; fields: { title: string } };
  expect(createBody.asset_id).toBe(assetId);
  expect(createBody.fields.title).toBe('Inspect pump bearing assembly');
  expect(createReceiptRequestId).toBe(createBody.ctx.request_id);
  const createdCount = await admin.from('work_orders').select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId).eq('asset_id', createBody.asset_id).eq('title', createBody.fields.title);
  if (createdCount.error) throw new Error('Synthetic work-order receipt could not be checked.');
  expect(createdCount.count).toBe(1);

  const ownerWorkOrder = ownerPage.getByRole('region', { name: 'Selected work order details' });
  await expect(ownerWorkOrder).toBeVisible();
  await expect(ownerWorkOrder.getByRole('heading', { name: 'Inspect pump bearing assembly' })).toBeVisible();
  await expect(ownerWorkOrder.getByRole('checkbox', { name: new RegExp(technician.id) })).toBeVisible();
  await ownerWorkOrder.getByRole('checkbox', { name: new RegExp(technician.id) }).check();
  await ownerWorkOrder.getByRole('button', { name: 'Save assignment' }).click();
  await expect(ownerWorkOrder.locator('.assigned-list').getByText(technician.id, { exact: true })).toBeVisible();
  await ownerWorkOrder.getByRole('button', { name: 'Publish work order' }).click();
  await expect(ownerWorkOrder.getByText('open', { exact: true })).toBeVisible();

  const technicianContext = await browser.newContext();
  const technicianPage = await technicianContext.newPage();
  const signedStorageUrls: string[] = [];
  technicianPage.on('request', (request) => {
    const target = new URL(request.url());
    if (target.pathname.includes('/storage/v1/object/sign/')) signedStorageUrls.push(target.pathname);
  });
  await technicianPage.addInitScript(() => {
    window.__privateImageUrls = [];
    window.__revokedPrivateImageUrls = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const value = create(blob); window.__privateImageUrls.push(value); return value; };
    URL.revokeObjectURL = (value) => { window.__revokedPrivateImageUrls.push(value); revoke(value); };
  });
  await technicianPage.goto('/');
  await technicianPage.getByLabel('Email').fill(technician.email);
  await technicianPage.getByLabel('Password').fill(technician.password);
  await technicianPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(technicianPage.getByRole('heading', { name: 'Dashboard not available for this role' })).toBeVisible();
  const technicianNavigation = technicianPage.getByRole('navigation', { name: 'Primary navigation' });
  await technicianPage.getByRole('link', { name: 'Account security' }).click();
  await enrollTOTP(technicianPage, 'POR-24 technician authenticator');
  await technicianNavigation.getByRole('link', { name: 'Notifications', exact: true }).click();
  const yourNotifications = technicianPage.getByRole('region', { name: 'Your notifications' });
  const assignmentNotification = yourNotifications.getByRole('button', { name: new RegExp(`assignment.*Source ${workOrderId}`) });
  await expect(assignmentNotification).toHaveCount(1);
  await assignmentNotification.click();
  const selectedNotification = technicianPage.getByRole('region', { name: 'Selected notification' });
  await expect(selectedNotification.getByRole('heading', { name: 'assignment', exact: true })).toBeVisible();
  const notificationIdentifiers = selectedNotification.locator('.notification-identifiers');
  await notificationIdentifiers.locator('summary').click();
  await expect(notificationIdentifiers.getByText(workOrderId, { exact: true })).toBeVisible();
  await selectedNotification.getByRole('link', { name: 'Open current record', exact: true }).click();
  await expect(technicianPage).toHaveURL(`${appOrigin}/work-orders?workOrder=${workOrderId}`);
  const technicianWorkOrder = technicianPage.getByRole('region', { name: 'Selected work order details' });
  await expect(technicianWorkOrder.getByRole('heading', { name: 'Inspect pump bearing assembly' })).toBeVisible();
  await technicianWorkOrder.getByRole('button', { name: 'Start work' }).click();
  await expect(technicianWorkOrder.getByText('in progress', { exact: true })).toBeVisible();

  await ownerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(ownerWorkOrder.getByText('in progress', { exact: true })).toBeVisible();
  await ownerWorkOrder.getByLabel('Add required task').fill('Verify bearing clearance');
  await ownerWorkOrder.getByRole('button', { name: 'Add task' }).click();
  await expect(ownerWorkOrder.getByText('Required task added to the repair record.')).toBeVisible();
  await technicianWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await technicianWorkOrder.getByLabel('Block or resume reason').fill('Pause for coordinator review of the inspection route.');
  await technicianWorkOrder.getByRole('button', { name: 'Block work with reason' }).click();
  await expect(technicianWorkOrder.getByText('blocked', { exact: true })).toBeVisible();
  await expect(technicianWorkOrder.getByRole('button', { name: 'Resume work' })).toHaveCount(0);
  await expect(technicianWorkOrder.getByRole('button', { name: 'Resume as scheduled' })).toHaveCount(0);
  await ownerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(ownerWorkOrder.getByRole('button', { name: 'Resume work' })).toBeVisible();
  await expect(ownerWorkOrder.getByRole('button', { name: 'Resume as scheduled' })).toBeVisible();
  await ownerWorkOrder.getByLabel('Block or resume reason').fill('Resume after the coordinator reviewed the hold point.');
  await ownerWorkOrder.getByLabel('Planned work date').fill('2026-10-23');
  await ownerWorkOrder.getByRole('button', { name: 'Resume as scheduled' }).click();
  await expect(ownerWorkOrder.getByText('scheduled', { exact: true })).toBeVisible();
  await technicianWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await technicianWorkOrder.getByRole('button', { name: 'Start work' }).click();
  await expect(technicianWorkOrder.getByText('in progress', { exact: true })).toBeVisible();
  await technicianWorkOrder.getByLabel('Block or resume reason').fill('Pause again while the coordinator confirms the final repair checkpoint.');
  await technicianWorkOrder.getByRole('button', { name: 'Block work with reason' }).click();
  await expect(technicianWorkOrder.getByText('blocked', { exact: true })).toBeVisible();
  await ownerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await ownerWorkOrder.getByLabel('Block or resume reason').fill('Resume directly for the assigned technician to continue.');
  await ownerWorkOrder.getByRole('button', { name: 'Resume work' }).click();
  await expect(ownerWorkOrder.getByText('in progress', { exact: true })).toBeVisible();
  const resumedRecord = await admin.from('work_orders').select('version,repair_revision,status,planned_on').eq('organization_id', organizationId).eq('id', workOrderId).single();
  if (resumedRecord.error) throw new Error('Synthetic resumed work-order version could not be read back.');
  expect(resumedRecord.data.status).toBe('in_progress');
  expect(resumedRecord.data.planned_on).toBe('2026-10-23');
  await technicianWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(technicianWorkOrder.getByText('in progress', { exact: true })).toBeVisible();
  const technicianVersion = technicianWorkOrder.locator('.detail-grid > div').filter({ hasText: 'Record version' }).locator('dd');
  const technicianRevision = technicianWorkOrder.locator('.detail-grid > div').filter({ hasText: 'Material revision' }).locator('dd');
  await expect(technicianVersion).toHaveText(String(resumedRecord.data.version));
  await expect(technicianRevision).toHaveText(String(resumedRecord.data.repair_revision));
  const taskBeforeToggle = await admin.from('work_order_tasks').select('id,required,completed').eq('organization_id', organizationId).eq('work_order_id', workOrderId).eq('label', 'Verify bearing clearance').single();
  if (taskBeforeToggle.error) throw new Error('Synthetic repair checklist could not be read before completion.');
  expect(taskBeforeToggle.data).toMatchObject({ required: true, completed: false });
  const bearingTask = technicianWorkOrder.getByRole('checkbox', { name: /Verify bearing clearance/ });
  await expect(bearingTask).not.toBeChecked();
  await bearingTask.click();
  await expect(technicianWorkOrder.getByText('Checklist updated.', { exact: true })).toBeVisible();
  const completedTask = await admin.from('work_order_tasks').select('required,completed,completed_by,completed_at').eq('organization_id', organizationId).eq('work_order_id', workOrderId).eq('label', 'Verify bearing clearance').single();
  if (completedTask.error) throw new Error('Synthetic repair checklist completion could not be read back.');
  expect(completedTask.data).toMatchObject({ required: true, completed: true, completed_by: technician.id });
  expect(completedTask.data.completed_at).toEqual(expect.any(String));
  const completedTaskRecord = await admin.from('work_orders').select('version,repair_revision,status').eq('organization_id', organizationId).eq('id', workOrderId).single();
  if (completedTaskRecord.error) throw new Error('Synthetic checklist update version could not be read back.');
  expect(completedTaskRecord.data.version).toBe(resumedRecord.data.version + 1);
  expect(completedTaskRecord.data.repair_revision).toBe(resumedRecord.data.repair_revision + 1);
  expect(completedTaskRecord.data.status).toBe('in_progress');
  await expect(bearingTask).toBeChecked();
  await expect(technicianVersion).toHaveText(String(completedTaskRecord.data.version));
  await expect(technicianRevision).toHaveText(String(completedTaskRecord.data.repair_revision));
  await technicianWorkOrder.getByLabel('Repair note or correction').fill('Measured bearing clearance and completed the initial inspection.');
  await technicianWorkOrder.getByLabel('Labor minutes').fill('35');
  await technicianWorkOrder.getByRole('button', { name: 'Record repair update' }).click();
  const repairRecord = technicianWorkOrder.getByRole('region', { name: 'Work and repair record', exact: true });
  const repairUpdateStatus = repairRecord.getByRole('status');
  await expect(repairUpdateStatus).toBeVisible();
  await expect(repairUpdateStatus).toHaveText('Repair update recorded.');
  const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
  await technicianWorkOrder.getByLabel('Choose a repair image').setInputFiles({ name: 'bearing-inspection.png', mimeType: 'image/png', buffer: validPng });
  await technicianWorkOrder.getByRole('button', { name: 'Upload private image' }).click();
  await expect(technicianPage.locator('img.private-image')).toBeVisible({ timeout: 20_000 });
  const privateSource = await technicianPage.locator('img.private-image').first().getAttribute('src');
  expect(privateSource).toMatch(/^blob:/);
  expect(signedStorageUrls).toEqual([]);
  await technicianWorkOrder.getByRole('checkbox', { name: /I performed this repair/ }).check();
  await technicianWorkOrder.getByRole('button', { name: 'Declare performers' }).click();
  await expect(technicianWorkOrder.getByText(/you are recorded/)).toBeVisible();
  await technicianWorkOrder.getByLabel('Submission attestation', { exact: true }).fill('I verified the declared repair performers and the submitted evidence.');
  await expect(technicianWorkOrder.getByRole('button', { name: 'Submit repair for review' })).toBeEnabled();
  await technicianWorkOrder.getByRole('button', { name: 'Submit repair for review' }).click();
  await expect(technicianWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();
  const firstReviewSubmission = await admin.from('work_orders').select('version,repair_revision,submitted_revision,status')
    .eq('organization_id', organizationId).eq('id', workOrderId).single();
  if (firstReviewSubmission.error) throw new Error('Synthetic first review revision could not be read back.');
  expect(firstReviewSubmission.data.status).toBe('awaiting_review');
  expect(firstReviewSubmission.data.submitted_revision).toBe(firstReviewSubmission.data.repair_revision);
  const firstReviewParticipants = await admin.from('work_order_participants').select('user_id,source')
    .eq('organization_id', organizationId).eq('work_order_id', workOrderId);
  if (firstReviewParticipants.error) throw new Error('Synthetic immutable participants could not be read before review.');
  const firstReviewParticipantIds = firstReviewParticipants.data.map((participant) => participant.user_id);
  expect(firstReviewParticipantIds).toEqual(expect.arrayContaining([owner.id, technician.id]));
  expect(firstReviewParticipantIds).not.toContain(reviewer.id);
  const reviewerMembership = await admin.from('organization_members').select('role,active')
    .eq('organization_id', organizationId).eq('user_id', reviewer.id).single();
  if (reviewerMembership.error) throw new Error('Synthetic independent reviewer membership could not be read back.');
  expect(reviewerMembership.data).toMatchObject({ role: 'supervisor', active: true });
  await technicianNavigation.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(technicianPage.locator('img.private-image')).toHaveCount(0);
  await expect.poll(() => technicianPage.evaluate(() => window.__revokedPrivateImageUrls)).toContain(privateSource);
  await technicianNavigation.getByRole('link', { name: 'Work orders', exact: true }).click();
  await technicianPage.goto(`/work-orders?workOrder=${workOrderId}`);

  await ownerPage.goto(`/work-orders?workOrder=${workOrderId}`);
  await ownerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(ownerWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();
  await expect(ownerWorkOrder.getByText('Your account participated in this work order and cannot review it, even if your assignment has since changed.')).toBeVisible();
  await expect(ownerWorkOrder.getByLabel('Review reason')).toHaveCount(0);
  await expect(ownerWorkOrder.getByRole('button', { name: 'Return for correction' })).toHaveCount(0);
  await expect(ownerWorkOrder.getByRole('button', { name: 'Approve repair' })).toHaveCount(0);

  await reviewerPage.goto(`/work-orders?workOrder=${workOrderId}`);
  const reviewerWorkOrder = reviewerPage.getByRole('region', { name: 'Selected work order details' });
  await reviewerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(reviewerWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();
  await expect(reviewerWorkOrder.getByLabel('Review reason')).toBeVisible();
  await reviewerWorkOrder.getByLabel('Review reason').fill('Return for the corrected bearing measurement and updated evidence.');
  await reviewerWorkOrder.getByRole('button', { name: 'Return for correction' }).click();
  await expect(reviewerWorkOrder.getByText('in progress', { exact: true })).toBeVisible();
  const returnedReview = await admin.from('work_order_reviews').select('reviewer_id,repair_revision,decision')
    .eq('organization_id', organizationId).eq('work_order_id', workOrderId).eq('decision', 'returned').single();
  if (returnedReview.error) throw new Error('Synthetic correction review could not be read back.');
  expect(returnedReview.data).toMatchObject({ reviewer_id: reviewer.id, repair_revision: firstReviewSubmission.data.repair_revision, decision: 'returned' });
  await technicianWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await technicianWorkOrder.getByLabel('Repair note or correction').fill('Corrected the bearing measurement after coordinator feedback.');
  await technicianWorkOrder.getByLabel('Labor minutes').fill('25');
  await technicianWorkOrder.getByRole('button', { name: 'Record repair update' }).click();
  await technicianWorkOrder.getByLabel('Choose a repair image').setInputFiles({ name: 'bearing-correction.png', mimeType: 'image/png', buffer: validPng });
  await technicianWorkOrder.getByRole('button', { name: 'Upload private image' }).click();
  await expect(technicianPage.locator('img.private-image')).toHaveCount(2, { timeout: 20_000 });
  await technicianWorkOrder.getByRole('checkbox', { name: /I performed this repair/ }).check();
  await technicianWorkOrder.getByRole('button', { name: 'Declare performers' }).click();
  await expect(technicianWorkOrder.getByText(/you are recorded/)).toBeVisible();
  await technicianWorkOrder.getByLabel('Submission attestation', { exact: true }).fill('The corrected measurements and current repair revision are ready for review.');
  await technicianWorkOrder.getByRole('button', { name: 'Submit repair for review' }).click();
  await expect(technicianWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();

  await ownerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(ownerWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();
  const activeTechnicianAssignment = ownerWorkOrder.getByRole('checkbox', { name: new RegExp(technician.id) });
  await activeTechnicianAssignment.uncheck();
  await ownerWorkOrder.getByRole('button', { name: 'Save assignment' }).click();
  await expect(ownerWorkOrder.getByText('No active technicians are assigned.')).toBeVisible();
  await ownerNavigation.getByRole('link', { name: 'Team', exact: true }).click();
  await ownerPage.getByRole('tab', { name: 'Members', exact: true }).click();
  const memberTable = ownerPage.getByRole('region', { name: 'Workspace members' });
  const technicianSummary = memberTable.locator(`summary[title="${technician.id}"]`);
  const technicianRow = technicianSummary.locator('xpath=../../..');
  await expect(technicianSummary).toHaveCount(1);
  await technicianSummary.click();
  await technicianRow.getByLabel(`Role for ${technician.id}`).selectOption('supervisor');
  const saveMemberResponse = ownerPage.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/rest/v1/rpc/set_organization_member',
  );
  await technicianRow.getByRole('button', { name: 'Save role', exact: true }).click();
  expect((await saveMemberResponse).ok()).toBe(true);
  await ownerPage.reload();
  await expect(ownerPage.getByRole('heading', { name: 'Team and workload', exact: true })).toBeVisible();
  await ownerPage.getByRole('tab', { name: 'Members', exact: true }).click();
  const persistedMemberTable = ownerPage.getByRole('region', { name: 'Workspace members' });
  const persistedTechnicianSummary = persistedMemberTable.locator(`summary[title="${technician.id}"]`);
  const persistedTechnicianRow = persistedTechnicianSummary.locator('xpath=../../..');
  await expect(persistedTechnicianSummary).toHaveCount(1);
  await persistedTechnicianSummary.click();
  await expect(persistedTechnicianRow.getByLabel(`Role for ${technician.id}`)).toHaveValue('supervisor');
  await technicianPage.reload();
  await technicianPage.goto('/');
  await expect(technicianPage.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();
  await technicianPage.goto(`/work-orders?workOrder=${workOrderId}`);
  await expect(technicianWorkOrder.getByText('Your account participated in this work order and cannot review it, even if your assignment has since changed.')).toBeVisible();
  await expect(technicianWorkOrder.getByRole('button', { name: 'Approve repair' })).toHaveCount(0);
  const currentWorkOrder = await admin.from('work_orders').select('version,repair_revision,submitted_revision,status')
    .eq('organization_id', organizationId).eq('id', workOrderId).single();
  if (currentWorkOrder.error) throw new Error('Synthetic work-order version could not be read back.');
  expect(currentWorkOrder.data.status).toBe('awaiting_review');
  expect(currentWorkOrder.data.submitted_revision).toBe(currentWorkOrder.data.repair_revision);
  expect(currentWorkOrder.data.repair_revision).toBeGreaterThan(firstReviewSubmission.data.repair_revision);
  const finalReviewParticipants = await admin.from('work_order_participants').select('user_id')
    .eq('organization_id', organizationId).eq('work_order_id', workOrderId);
  if (finalReviewParticipants.error) throw new Error('Synthetic immutable participants could not be read before final approval.');
  expect(finalReviewParticipants.data.map((participant) => participant.user_id)).not.toContain(reviewer.id);
  const deniedReview = await technicianPage.evaluate(async (input) => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('sb-') && item.endsWith('-auth-token'));
    if (!key) throw new Error('Current authenticated session was not found.');
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { access_token?: string } | null;
    if (!saved?.access_token) throw new Error('Current authenticated session is unavailable.');
    const response = await fetch(input.rpcUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${saved.access_token}`, apikey: input.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctx: { organization_id: input.organizationId, request_id: input.requestId, expected_version: input.version }, id: input.workOrderId, decision: 'approved', reason: 'Testing immutable participant exclusion.' }),
    });
    const body = await response.json() as { message?: string };
    return { status: response.status, message: body.message };
  }, { rpcUrl: new URL('/rest/v1/rpc/review_work_order', url).href, anon, organizationId, requestId: randomUUID(), version: currentWorkOrder.data.version, workOrderId });
  expect(deniedReview.status).not.toBe(200);
  expect(deniedReview.message).toBe('FORBIDDEN');

  await reviewerPage.goto(`/work-orders?workOrder=${workOrderId}`);
  await reviewerWorkOrder.getByRole('button', { name: 'Refresh record' }).click();
  await expect(reviewerWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();
  await expect(reviewerWorkOrder.getByRole('button', { name: 'Approve repair' })).toBeVisible();
  await reviewerWorkOrder.getByLabel('Review reason').fill('The corrected measurement and current revision are accepted.');
  await reviewerWorkOrder.getByRole('button', { name: 'Approve repair' }).click();
  await expect(reviewerWorkOrder.getByText('completed', { exact: true })).toBeVisible();
  const finalReviews = await admin.from('work_order_reviews').select('reviewer_id,repair_revision,decision')
    .eq('organization_id', organizationId).eq('work_order_id', workOrderId).order('created_at').order('id');
  if (finalReviews.error) throw new Error('Synthetic repair review history could not be read back.');
  expect(finalReviews.data).toHaveLength(2);
  expect(finalReviews.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ reviewer_id: reviewer.id, repair_revision: firstReviewSubmission.data.repair_revision, decision: 'returned' }),
    expect.objectContaining({ reviewer_id: reviewer.id, repair_revision: currentWorkOrder.data.repair_revision, decision: 'approved' }),
  ]));
  await reviewerPage.reload();
  await expect(reviewerWorkOrder.getByRole('heading', { name: 'Review history', exact: true })).toBeVisible();
  await expect(reviewerWorkOrder.getByText(`Returned · revision ${firstReviewSubmission.data.repair_revision}`, { exact: true })).toBeVisible();
  await expect(reviewerWorkOrder.getByText(`Approved · revision ${currentWorkOrder.data.repair_revision}`, { exact: true })).toBeVisible();

  await reviewerPage.goto(`/assets?asset=${assetId}`);
  const reviewerAsset = reviewerPage.getByRole('region', { name: 'Selected asset details' });
  const reviewerOperations = reviewerAsset.getByRole('region', { name: /Operational details for/ });
  await expect(reviewerOperations.getByText('Every active hold must be resolved, and a work-order hold must have approval for the current repair revision.', { exact: true })).toBeVisible();
  await expect(reviewerOperations.getByRole('button', { name: 'Record asset release' })).toBeDisabled();

  await ownerPage.goto(`/assets?asset=${assetId}`);
  const finalAsset = ownerPage.getByRole('region', { name: 'Selected asset details' });
  const finalOperations = finalAsset.getByRole('region', { name: /Operational details for/ });
  await expect(finalOperations.getByText('Your account participated in work covered by an unreleased hold. You cannot release this asset.', { exact: true })).toBeVisible();
  await expect(finalOperations.getByLabel('Release acknowledgment')).toBeDisabled();
  await expect(finalOperations.getByRole('button', { name: 'Record asset release' })).toBeDisabled();
  await finalOperations.getByLabel('Resolution reason').fill('Inspection repair completed and the safety hold is cleared.');
  await finalOperations.getByRole('button', { name: 'Resolve repaired hold' }).click();
  await expect(finalOperations.getByText('Resolved · awaiting release')).toBeVisible();
  await expect(finalOperations.getByText('Your account participated in work covered by an unreleased hold. You cannot release this asset.', { exact: true })).toBeVisible();
  await expect(finalOperations.getByLabel('Release acknowledgment')).toBeDisabled();
  await expect(finalOperations.getByRole('button', { name: 'Record asset release' })).toBeDisabled();

  await reviewerPage.goto(`/assets?asset=${assetId}`);
  await expect(reviewerOperations.getByText('Release eligibility checks passed against complete current records. The service rechecks all conditions when you submit.', { exact: true })).toBeVisible();
  await reviewerOperations.getByLabel('Release acknowledgment').fill('Reviewed the completed repair, cleared the hold, and checked the asset condition.');
  await reviewerOperations.getByRole('button', { name: 'Record asset release' }).click();
  await expect(reviewerAsset.getByText('operational', { exact: true }).first()).toBeVisible();
  const assetReleaseRecord = await admin.from('asset_releases').select('actor_id,acknowledgment')
    .eq('organization_id', organizationId).eq('asset_id', assetId).single();
  if (assetReleaseRecord.error) throw new Error('Synthetic asset release actor could not be read back.');
  expect(assetReleaseRecord.data).toMatchObject({ actor_id: reviewer.id, acknowledgment: 'Reviewed the completed repair, cleared the hold, and checked the asset condition.' });

  await ownerPage.goto(`/assets?asset=${assetId}`);
  await expect(finalAsset.getByText('operational', { exact: true }).first()).toBeVisible();
  const meterReadings = finalOperations.getByRole('region', { name: 'Meter readings', exact: true });
  await finalOperations.getByLabel('Reading', { exact: true }).fill('125');
  await finalOperations.getByLabel('Observed at').fill(new Date(Date.now() - 60_000).toISOString().slice(0, 16));
  await finalOperations.getByRole('button', { name: 'Record meter reading' }).click();
  await expect(meterReadings.getByText('125 hours', { exact: true })).toBeVisible();
  await finalOperations.getByLabel('Corrected value').fill('124.5');
  await finalOperations.getByLabel('Correction reason').fill('Corrected after the meter calibration check.');
  await finalOperations.getByRole('button', { name: 'Append correction' }).click();
  await expect(meterReadings.getByText('124.5 hours', { exact: true })).toBeVisible();
  await expect(meterReadings.getByText('125 hours', { exact: true })).toBeVisible();
  await expect(meterReadings.locator('.record-card').filter({ hasText: '124.5 hours' })).toContainText('Corrected after the meter calibration check.');
  const meterRecords = await admin.from('asset_meter_readings').select('id,value,recorded_by,correction_of,correction_reason')
    .eq('organization_id', organizationId).eq('asset_id', assetId).order('recorded_at').order('id');
  if (meterRecords.error) throw new Error('Synthetic meter correction actor could not be read back.');
  expect(meterRecords.data).toHaveLength(2);
  const originalReading = meterRecords.data.find((reading) => Number(reading.value) === 125 && reading.correction_of === null);
  expect(originalReading?.recorded_by).toBe(owner.id);
  const correctedReading = meterRecords.data.find((reading) => reading.correction_of === originalReading?.id);
  expect(correctedReading).toMatchObject({ recorded_by: owner.id, correction_reason: 'Corrected after the meter calibration check.' });
  expect(Number(correctedReading?.value)).toBe(124.5);
  await reviewerContext.close();
  await technicianContext.close();
  await ownerPage.close();
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
  await expect(page.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic asset A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic asset B' })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Workspace' }).selectOption(orgB);
  await expect(page.getByRole('heading', { name: 'Operations at a glance' })).toBeVisible();
  await primaryNavigation.getByRole('link', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic asset B' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic asset A' })).toHaveCount(0);
});
