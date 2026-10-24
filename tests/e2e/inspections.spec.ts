import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient, type Session } from '@supabase/supabase-js';
import { expect, test, type Route } from '@playwright/test';
import { enrollMfa } from '../integration/mfa';
import { readIsolatedServiceConfig } from './service-config';
import { fixtureOrganizationIds, fixtureUserId, prepareWorkspacePage } from './workspace-fixture';

const origin = 'http://127.0.0.1:54321';
const serviceConfig = readIsolatedServiceConfig(process.env);
const appOrigin = 'http://127.0.0.1:5173';
const authStorageKey = serviceConfig ? `sb-${new URL(serviceConfig.url).hostname.split('.')[0]}-auth-token` : 'sb-127-auth-token';
const templateId = '40000000-0000-4000-8000-000000000001';
const revisionId = '40000000-0000-4000-8000-000000000002';
const itemId = '40000000-0000-4000-8000-000000000003';
const assignmentIds = [
  '40000000-0000-4000-8000-000000000010',
  '40000000-0000-4000-8000-000000000011',
  '40000000-0000-4000-8000-000000000012',
  '40000000-0000-4000-8000-000000000013',
];

function respond(route: Route, status: number, value: unknown) {
  const requestHeaders = route.request().headers();
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': requestHeaders['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
    },
    body: JSON.stringify(value),
  });
}

function assignment(id: string) {
  return {
    id, organization_id: fixtureOrganizationIds.alpha, asset_id: 'c2daf4c7-e68c-4783-87c6-26b009a1169d',
    template_revision_id: revisionId, inspector_id: fixtureUserId, assigned_by: fixtureUserId,
    assigned_at: '2026-10-24T00:00:00.000Z', due_on: null, version: 1,
  };
}

function submission(assignmentId: string, outcome: 'pass' | 'fail') {
  return {
    id: `${assignmentId.slice(0, -4)}${outcome === 'pass' ? '1001' : '1002'}`,
    organization_id: fixtureOrganizationIds.alpha, assignment_id: assignmentId, template_revision_id: revisionId,
    inspector_id: fixtureUserId, submitted_at: '2026-10-24T01:00:00.000Z', version: 1,
    results: [{ item_id: itemId, outcome, ...(outcome === 'fail' ? { remarks: 'Guard is loose.' } : {}), evidence_ids: [] }],
  };
}

type FixtureSubmission = {
  id: string; organization_id: string; assignment_id: string; template_revision_id: string; inspector_id: string;
  submitted_at: string; results: { item_id: string; outcome: 'pass' | 'fail' | 'not_applicable'; reason?: string; remarks?: string; evidence_ids: string[] }[];
  version: number; supersedes_id?: string | null; correction_reason?: string | null;
};

type ServicePerson = { id: string; email: string; password: string; session: Session };

function serviceSql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Synthetic inspection journey setup failed; database output withheld.');
}

async function createServicePerson(label: string): Promise<ServicePerson> {
  if (!serviceConfig) throw new Error('Isolated loopback Supabase is required.');
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}-Aa9!`;
  const admin = createClient(serviceConfig.url, serviceConfig.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic journey account setup failed.');
  const client = createClient(serviceConfig.url, serviceConfig.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error('Synthetic journey account sign-in failed.');
  await enrollMfa(client);
  const current = await client.auth.getSession();
  const session = current.data.session;
  if (current.error || !session) throw new Error('Synthetic journey account session could not be confirmed.');
  const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1] ?? '', 'base64url').toString()) as { aal?: string };
  if (claims.aal !== 'aal2') throw new Error('Synthetic journey session did not satisfy the current second-factor requirement.');
  return { id: created.data.user.id, email, password, session };
}

async function seedServicePage(page: import('@playwright/test').Page, session: Session) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: authStorageKey, value: session });
  await page.goto(appOrigin);
}

test('inspection counts describe the loaded page and keep unverified outcomes out of status totals', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepareWorkspacePage(page);
  const assignments = assignmentIds.map(assignment);
  await page.route(`${origin}/rest/v1/rpc/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'list_inspection_assignments') return respond(route, 200, { items: assignments, next_cursor: null });
    if (name === 'list_inspection_templates') return respond(route, 200, { items: [], next_cursor: null });
    if (name === 'get_inspection') {
      const { assignment_id: id } = route.request().postDataJSON() as { assignment_id: string };
      if (id === assignmentIds[3]) return respond(route, 503, { message: 'Service unavailable' });
      const row = assignments.find((item) => item.id === id)!;
      const saved = id === assignmentIds[0] ? submission(id, 'pass') : id === assignmentIds[1] ? submission(id, 'fail') : null;
      return respond(route, 200, {
        assignment: row,
        revision: {
          id: revisionId, organization_id: fixtureOrganizationIds.alpha, template_id: templateId, revision: 1,
          title: 'Daily safety check', items: [{ id: itemId, label: 'Check the guard', required: true, safety_relevant: true, evidence_required: false }],
          published_by: fixtureUserId, published_at: '2026-10-23T00:00:00.000Z',
        },
        submission: saved, episodes: [], history: saved ? [saved] : [], episode_links: [], holds: [],
      });
    }
    return route.fallback();
  });

  await page.goto('/inspections');

  await expect(page.getByRole('heading', { name: 'Inspections', level: 1 })).toBeVisible();
  const counts = page.getByRole('region', { name: 'Inspection counts' });
  await expect(counts.getByRole('group', { name: 'Inspections on this page: 4' })).toBeVisible();
  await expect(counts.getByRole('group', { name: 'Passed: 1' })).toBeVisible();
  await expect(counts.getByRole('group', { name: 'Failed: 1' })).toBeVisible();
  await expect(counts.getByRole('group', { name: 'In progress: 1' })).toBeVisible();
  await expect(page.getByText(/1 outcome could not be verified/i)).toBeVisible();
  await page.screenshot({ path: 'test-results/por34-inspections.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const pageWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
});

test('pinned checklist validates N/A reasons and retries one exact correction with linked history', async ({ page }) => {
  await prepareWorkspacePage(page);
  const id = assignmentIds[1]!;
  const evidenceId = '40000000-0000-4000-8000-000000000024';
  const original: FixtureSubmission = submission(id, 'fail');
  let latest = original;
  const episode = {
    id: '40000000-0000-4000-8000-000000000020', organization_id: fixtureOrganizationIds.alpha, assignment_id: id,
    submission_id: original.id, item_id: itemId, corrective_request_id: '40000000-0000-4000-8000-000000000021',
    hold_id: '40000000-0000-4000-8000-000000000022', predecessor_id: null, created_at: '2026-10-24T01:00:00.000Z',
  };
  const hold = {
    id: episode.hold_id, organization_id: fixtureOrganizationIds.alpha, asset_id: assignment(id).asset_id, work_order_id: null,
    source: 'inspection', source_id: episode.id, reason: 'Inspection failure: Check the guard', created_by: fixtureUserId,
    created_at: '2026-10-24T01:00:00.000Z', resolved_at: null, resolution: null, resolved_by: null, released_at: null,
  };
  const details = () => ({
    assignment: assignment(id),
    revision: {
      id: revisionId, organization_id: fixtureOrganizationIds.alpha, template_id: templateId, revision: 1,
      title: 'Daily safety check', items: [{ id: itemId, label: 'Check the guard', required: true, safety_relevant: true, evidence_required: true }],
      published_by: fixtureUserId, published_at: '2026-10-23T00:00:00.000Z',
    },
    submission: latest, episodes: [episode], history: latest === original ? [original] : [original, latest],
    episode_links: [{ submission_id: original.id, item_id: itemId, episode_id: episode.id }], holds: [hold],
  });
  const correctionBodies: Record<string, unknown>[] = [];
  let saveCount = 0;
  const evidence = (status: 'pending' | 'ready') => ({
    id: evidenceId, organization_id: fixtureOrganizationIds.alpha, inspection_assignment_id: id, work_order_id: null, asset_id: null, request_id: null,
    object_key: `${fixtureOrganizationIds.alpha}/${id}/${evidenceId}`, name: 'guard.png', media_type: 'image/png', size: 68,
    uploader_id: fixtureUserId, status, checksum: null, width: 1, height: 1, created_at: '2026-10-24T01:30:00.000Z',
    ready_at: status === 'ready' ? '2026-10-24T01:31:00.000Z' : null, cleanup_completed_at: null,
  });
  await page.route(`${origin}/rest/v1/attachments**`, async (route) => respond(route, 200, []));
  await page.route(`${origin}/functions/v1/attachment-upload**`, async (route) => respond(route, 200, evidence('ready')));
  await page.route(`${origin}/rest/v1/rpc/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'list_inspection_assignments') return respond(route, 200, { items: [assignment(id)], next_cursor: null });
    if (name === 'list_inspection_templates') return respond(route, 200, { items: [], next_cursor: null });
    if (name === 'get_inspection') return respond(route, 200, details());
    if (name === 'reserve_inspection_attachment') {
      const requestId = (route.request().postDataJSON() as { ctx: { request_id: string } }).ctx.request_id;
      return respond(route, 200, { data: evidence('pending'), version: 1, request_id: requestId });
    }
    if (name === 'correct_inspection') {
      correctionBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      saveCount++;
      if (saveCount === 1) return respond(route, 503, { message: 'Response lost after save.' });
      const first = correctionBodies[0] as { ctx: { request_id: string }; assignment_id: string; template_revision_id: string; supersedes_id: string; correction_reason: string; results: unknown[] };
      latest = {
        id: '40000000-0000-4000-8000-000000000023', organization_id: fixtureOrganizationIds.alpha, assignment_id: id,
        template_revision_id: revisionId, inspector_id: fixtureUserId, submitted_at: '2026-10-24T02:00:00.000Z',
        results: first.results as typeof latest.results, version: 2, supersedes_id: first.supersedes_id, correction_reason: first.correction_reason,
      };
      return respond(route, 200, { data: latest, version: 2, request_id: first.ctx.request_id });
    }
    return route.fallback();
  });

  await page.goto('/inspections');
  await page.getByRole('button', { name: /Assignment 40000000/ }).click();
  const detail = page.getByRole('region', { name: 'Selected inspection detail' });
  await expect(detail.getByText('Daily safety check', { exact: true })).toBeVisible();
  await expect(detail.getByText('Pinned revision 1')).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Open corrective request' })).toHaveAttribute('href', /requests\?request=/);
  await expect(detail.getByText('Unresolved hold', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Record a correction' }).click();
  await detail.getByLabel('Outcome').selectOption('not_applicable');
  await detail.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText(/explain why this item does not apply/i)).toBeVisible();
  expect(correctionBodies).toHaveLength(0);

  await detail.getByLabel('Why this item does not apply').fill('This guard is not part of this asset model.');
  await detail.getByLabel('Remarks').fill('Verified against the manufacturer plate.');
  await detail.getByLabel('Correction reason').fill('Corrected the checklist result after checking the model plate.');
  await detail.locator('input[type="file"]').setInputFiles({ name: 'guard.png', mimeType: 'image/png', buffer: Buffer.alloc(68) });
  await detail.getByRole('button', { name: 'Upload private evidence' }).click();
  await expect(detail.getByText('Private evidence uploaded and ready.')).toBeVisible();
  await detail.getByRole('button', { name: 'Save correction' }).click();
  await expect(detail.getByRole('button', { name: 'Retry exact checklist save' })).toBeVisible();
  await expect(detail.getByRole('combobox', { name: 'Outcome' })).toBeDisabled();
  await expect(detail.getByRole('button', { name: 'Close details' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Assignment 40000000/ }).first()).toBeDisabled();
  await detail.getByRole('button', { name: 'Retry exact checklist save' }).click();
  await expect(detail.getByText('Latest saved results · version 2')).toBeVisible();
  await expect(detail.getByText('Not applicable', { exact: true })).toBeVisible();
  await expect(detail.getByText('Correction reason: Corrected the checklist result after checking the model plate.')).toBeVisible();
  expect(correctionBodies).toHaveLength(2);
  expect(correctionBodies[1]).toEqual(correctionBodies[0]);
  expect(saveCount).toBe(2);
});

test('inspection correction controls are limited to the assigned inspector', async ({ page }) => {
  const workspace = await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha], 'technician');
  const other = workspace.switchToSecondUser();
  await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), workspace.sessionFor(other));
  const id = assignmentIds[0]!;
  await page.route(`${origin}/rest/v1/attachments**`, async (route) => respond(route, 200, []));
  await page.route(`${origin}/rest/v1/rpc/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'list_inspection_assignments') return respond(route, 200, { items: [assignment(id)], next_cursor: null });
    if (name === 'list_inspection_templates') return respond(route, 200, { items: [], next_cursor: null });
    if (name === 'get_inspection') return respond(route, 200, {
      assignment: assignment(id),
      revision: {
        id: revisionId, organization_id: fixtureOrganizationIds.alpha, template_id: templateId, revision: 1,
        title: 'Daily safety check', items: [{ id: itemId, label: 'Check the guard', required: true, safety_relevant: true, evidence_required: false }],
        published_by: fixtureUserId, published_at: '2026-10-23T00:00:00.000Z',
      },
      submission: submission(id, 'pass'), episodes: [], history: [submission(id, 'pass')], episode_links: [], holds: [],
    });
    return route.fallback();
  });

  await page.goto(`/inspections?assignment=${id}`);
  const detail = page.getByRole('region', { name: 'Selected inspection detail' });
  await expect(detail.getByRole('status').filter({ hasText: 'Only the assigned inspector can submit or correct this checklist.' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Record a correction' })).toHaveCount(0);
  await expect(detail.locator('form.inspection-checklist')).toHaveCount(0);
});

test('stale correction shows the version conflict and reloads the current saved submission', async ({ page }) => {
  await prepareWorkspacePage(page);
  const id = assignmentIds[0]!;
  const first: FixtureSubmission = submission(id, 'pass');
  let latest: FixtureSubmission = first;
  const templateRevision = {
    id: revisionId, organization_id: fixtureOrganizationIds.alpha, template_id: templateId, revision: 1,
    title: 'Daily safety check', items: [{ id: itemId, label: 'Check the guard', required: true, safety_relevant: true, evidence_required: false }],
    published_by: fixtureUserId, published_at: '2026-10-23T00:00:00.000Z',
  };
  let correctionAttempts = 0;
  await page.route(`${origin}/rest/v1/attachments**`, async (route) => respond(route, 200, []));
  await page.route(`${origin}/rest/v1/rpc/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'list_inspection_assignments') return respond(route, 200, { items: [assignment(id)], next_cursor: null });
    if (name === 'list_inspection_templates') return respond(route, 200, { items: [], next_cursor: null });
    if (name === 'get_inspection') return respond(route, 200, { assignment: assignment(id), revision: templateRevision, submission: latest, episodes: [], history: latest === first ? [first] : [first, latest], episode_links: [], holds: [] });
    if (name === 'correct_inspection') {
      correctionAttempts++;
      latest = {
        id: '40000000-0000-4000-8000-000000000025', organization_id: fixtureOrganizationIds.alpha, assignment_id: id,
        template_revision_id: revisionId, inspector_id: fixtureUserId, submitted_at: '2026-10-24T02:00:00.000Z',
        results: [{ item_id: itemId, outcome: 'fail', remarks: 'A newer verified reading found a loose guard.', evidence_ids: [] }],
        version: 2, supersedes_id: first.id, correction_reason: 'Saved by a separate browser session.',
      };
      return respond(route, 409, { message: 'CONFLICT' });
    }
    return route.fallback();
  });

  await page.goto(`/inspections?assignment=${id}`);
  const detail = page.getByRole('region', { name: 'Selected inspection detail' });
  await detail.getByRole('button', { name: 'Record a correction' }).click();
  await detail.getByLabel('Correction reason').fill('Update from a stale browser draft.');
  await detail.getByRole('button', { name: 'Save correction' }).click();
  await expect(detail.getByText(/This inspection changed after your draft was loaded/i)).toBeVisible();
  await detail.getByRole('button', { name: 'Discard draft and reload inspection' }).click();
  await expect(detail.getByText('Latest saved results · version 2')).toBeVisible();
  await expect(detail.getByText('A newer verified reading found a loose guard.')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Record a correction' })).toBeVisible();
  expect(correctionAttempts).toBe(1);
});

test('loopback P2 inspection failure converts to a repaired request and correction creates a fresh hold', async ({ browser }) => {
  test.skip(!serviceConfig, 'This integrated journey runs only against job-owned loopback Supabase, Storage and Auth services.');
  test.setTimeout(240_000);
  const config = serviceConfig!;
  const admin = createClient(config.url, config.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await createServicePerson('por34-owner');
  const inspector = await createServicePerson('por34-inspector');
  const repairer = await createServicePerson('por34-repairer');
  const reviewer = await createServicePerson('por34-reviewer');
  const organizationId = randomUUID();
  const assetId = randomUUID();
  const assetCode = `POR34-${randomUUID().slice(0, 8).toUpperCase()}`;
  serviceSql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${organizationId}','Synthetic POR-34 ${organizationId.slice(0, 8)}','Asia/Manila','PHP','${owner.id}');
    insert into public.organization_members(organization_id,user_id,role) values
      ('${organizationId}','${owner.id}','owner'),('${organizationId}','${inspector.id}','technician'),
      ('${organizationId}','${repairer.id}','technician'),('${organizationId}','${reviewer.id}','supervisor');
    insert into public.assets(id,organization_id,code,name,category,created_by) values('${assetId}','${organizationId}','${assetCode}','Synthetic inspection pump','pump','${owner.id}');`);

  const ownerPage = await browser.newPage();
  const inspectorPage = await browser.newPage();
  const repairerPage = await browser.newPage();
  const reviewerPage = await browser.newPage();
  await Promise.all([seedServicePage(ownerPage, owner.session), seedServicePage(inspectorPage, inspector.session), seedServicePage(repairerPage, repairer.session), seedServicePage(reviewerPage, reviewer.session)]);

  const checklistTitle = `Guard inspection ${organizationId.slice(0, 8)}`;
  await ownerPage.goto('/inspections');
  await ownerPage.getByRole('tab', { name: 'Templates' }).click();
  await ownerPage.getByRole('button', { name: 'New template' }).click();
  const templateForm = ownerPage.locator('section.inspection-form-panel').filter({ has: ownerPage.getByRole('heading', { name: 'New checklist template' }) });
  await templateForm.getByLabel('Template name').fill(checklistTitle);
  await templateForm.getByLabel('Item 1').fill('Guard fitted and secure');
  await templateForm.getByLabel('Safety relevant').check();
  await templateForm.getByLabel('Private evidence required').check();
  const publishResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/rest/v1/rpc/publish_inspection_template');
  await templateForm.getByRole('button', { name: 'Publish template' }).click();
  expect((await publishResponse).ok()).toBe(true);
  const templateRecord = await admin.from('inspection_templates').select('id,current_revision_id').eq('organization_id', organizationId).eq('title', checklistTitle).single();
  if (templateRecord.error) throw new Error('Synthetic checklist could not be read back.');
  await ownerPage.getByRole('tab', { name: 'Inspections' }).click();
  await ownerPage.getByRole('button', { name: 'New inspection' }).click();
  const assignmentForm = ownerPage.locator('section.inspection-form-panel').filter({ has: ownerPage.getByRole('heading', { name: 'New inspection' }) });
  await assignmentForm.getByLabel('Asset', { exact: true }).selectOption(assetId);
  await assignmentForm.getByLabel('Pinned checklist revision').selectOption(templateRecord.data.current_revision_id);
  await assignmentForm.getByLabel('Inspector').selectOption(inspector.id);
  const assignResponse = ownerPage.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/rest/v1/rpc/assign_inspection');
  await assignmentForm.getByRole('button', { name: 'Assign inspection' }).click();
  expect((await assignResponse).ok()).toBe(true);
  const assignmentRecord = await admin.from('inspection_assignments').select('id,template_revision_id').eq('organization_id', organizationId).eq('asset_id', assetId).single();
  if (assignmentRecord.error) throw new Error('Synthetic inspection assignment could not be read back.');
  const assignmentId = assignmentRecord.data.id;
  expect(assignmentRecord.data.template_revision_id).toBe(templateRecord.data.current_revision_id);

  await inspectorPage.goto(`/inspections?assignment=${assignmentId}`);
  const inspectorDetail = inspectorPage.getByRole('region', { name: 'Selected inspection detail' });
  await expect(inspectorDetail.getByRole('heading', { name: checklistTitle })).toBeVisible();
  await inspectorDetail.getByLabel('Outcome').selectOption('fail');
  await inspectorDetail.getByLabel('Failure remarks').fill('The guard is loose and can expose the rotating coupling.');
  const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
  await inspectorDetail.locator('input[type="file"]').setInputFiles({ name: 'guard-evidence.png', mimeType: 'image/png', buffer: validPng });
  await inspectorDetail.getByRole('button', { name: 'Upload private evidence' }).click();
  await expect(inspectorDetail.getByText('Private evidence uploaded and ready.')).toBeVisible({ timeout: 20_000 });
  await inspectorDetail.getByRole('button', { name: 'Submit inspection' }).click();
  await expect(inspectorDetail.getByText('Latest saved results · version 1')).toBeVisible();
  const initialRequestHref = await inspectorDetail.getByRole('link', { name: 'Open corrective request' }).getAttribute('href');
  expect(initialRequestHref).toMatch(/^\/requests\?request=/);
  const initialRequestId = new URL(initialRequestHref!, appOrigin).searchParams.get('request')!;
  const initialEpisode = await admin.from('inspection_failure_episodes').select('id,hold_id,corrective_request_id').eq('organization_id', organizationId).eq('assignment_id', assignmentId).single();
  if (initialEpisode.error) throw new Error('Initial inspection failure episode could not be read back.');
  expect(initialEpisode.data.corrective_request_id).toBe(initialRequestId);
  expect(initialEpisode.data.hold_id).toBeTruthy();

  await ownerPage.goto(initialRequestHref!);
  const requestDetail = ownerPage.getByRole('region', { name: 'Selected request details' });
  await expect(requestDetail.getByText('submitted', { exact: true })).toBeVisible();
  await requestDetail.getByText('Review and route request', { exact: true }).click();
  await requestDetail.getByRole('button', { name: 'Convert to draft work order', exact: true }).click();
  await expect(requestDetail.getByText('Draft work order created:')).toBeVisible();
  await requestDetail.getByRole('link', { name: 'open the linked work order' }).click();
  const workOrderId = new URL(ownerPage.url()).searchParams.get('workOrder');
  expect(workOrderId).toMatch(/^[0-9a-f-]{36}$/);
  const ownerWorkOrder = ownerPage.getByRole('region', { name: 'Selected work order details' });
  await expect(ownerWorkOrder.getByText('draft', { exact: true })).toBeVisible();
  await ownerWorkOrder.getByRole('checkbox', { name: new RegExp(repairer.id) }).check();
  await ownerWorkOrder.getByRole('button', { name: 'Save assignment' }).click();
  await expect(ownerWorkOrder.locator('.assigned-list').getByText(repairer.id, { exact: true })).toBeVisible();
  await ownerWorkOrder.getByRole('button', { name: 'Publish work order' }).click();
  await expect(ownerWorkOrder.getByText('open', { exact: true })).toBeVisible();

  await repairerPage.goto(`/work-orders?workOrder=${workOrderId}`);
  const repairerWorkOrder = repairerPage.getByRole('region', { name: 'Selected work order details' });
  await repairerWorkOrder.getByRole('button', { name: 'Start work' }).click();
  await expect(repairerWorkOrder.getByText('in progress', { exact: true })).toBeVisible();
  await repairerWorkOrder.getByLabel('Repair note or correction').fill('Replaced and secured the inspection guard assembly.');
  await repairerWorkOrder.getByLabel('Labor minutes').fill('30');
  await repairerWorkOrder.getByRole('button', { name: 'Record repair update' }).click();
  await expect(repairerWorkOrder.getByText('Repair update recorded.', { exact: true })).toBeVisible();
  await repairerWorkOrder.getByLabel('Choose a repair image').setInputFiles({ name: 'guard-repair.png', mimeType: 'image/png', buffer: validPng });
  await repairerWorkOrder.getByRole('button', { name: 'Upload private image' }).click();
  await expect(repairerPage.locator('img.private-image')).toBeVisible({ timeout: 20_000 });
  await repairerWorkOrder.getByRole('checkbox', { name: /I performed this repair/ }).check();
  await repairerWorkOrder.getByRole('button', { name: 'Declare performers' }).click();
  await expect(repairerWorkOrder.getByText(/you are recorded/)).toBeVisible();
  await repairerWorkOrder.getByLabel('Submission attestation', { exact: true }).fill('The repaired guard is secure and the private evidence shows the completed work.');
  await repairerWorkOrder.getByRole('button', { name: 'Submit repair for review' }).click();
  await expect(repairerWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();

  await reviewerPage.goto(`/work-orders?workOrder=${workOrderId}`);
  const reviewerWorkOrder = reviewerPage.getByRole('region', { name: 'Selected work order details' });
  await expect(reviewerWorkOrder.getByText('awaiting review', { exact: true })).toBeVisible();
  await reviewerWorkOrder.getByLabel('Review reason').fill('Inspected the repair record and verified the guard evidence.');
  await reviewerWorkOrder.getByRole('button', { name: 'Approve repair' }).click();
  await expect(reviewerWorkOrder.getByText('completed', { exact: true })).toBeVisible();
  const participants = await admin.from('work_order_participants').select('user_id').eq('organization_id', organizationId).eq('work_order_id', workOrderId);
  if (participants.error) throw new Error('Repair participants could not be verified.');
  expect(participants.data.map((participant) => participant.user_id)).toEqual(expect.arrayContaining([owner.id, repairer.id]));
  expect(participants.data.map((participant) => participant.user_id)).not.toContain(reviewer.id);

  await ownerPage.goto(`/assets?asset=${assetId}`);
  const ownerAsset = ownerPage.getByRole('region', { name: 'Selected asset details' });
  const ownerOperations = ownerAsset.getByRole('region', { name: /Operational details for/ });
  await ownerOperations.getByLabel('Resolution reason').fill('Independent reviewer accepted the completed inspection repair.');
  await ownerOperations.getByRole('button', { name: 'Resolve repaired hold' }).click();
  await expect(ownerOperations.getByText('Resolved · awaiting release')).toBeVisible();
  await expect(ownerOperations.getByText('Your account participated in work covered by an unreleased hold. You cannot release this asset.', { exact: true })).toBeVisible();
  await expect(ownerOperations.getByLabel('Release acknowledgment')).toBeDisabled();
  await expect(ownerOperations.getByRole('button', { name: 'Record asset release' })).toBeDisabled();
  await reviewerPage.goto(`/assets?asset=${assetId}`);
  const reviewerAsset = reviewerPage.getByRole('region', { name: 'Selected asset details' });
  const reviewerOperations = reviewerAsset.getByRole('region', { name: /Operational details for/ });
  await expect(reviewerOperations.getByText('Release eligibility checks passed against complete current records. The service rechecks all conditions when you submit.')).toBeVisible();
  await reviewerOperations.getByLabel('Release acknowledgment').fill('Reviewed the current asset condition and recorded inspection repair approval.');
  await reviewerOperations.getByRole('button', { name: 'Record asset release' }).click();
  await expect(reviewerAsset.getByText('operational', { exact: true }).first()).toBeVisible();
  const recordedRelease = await admin.from('asset_releases').select('actor_id,acknowledgment').eq('organization_id', organizationId).eq('asset_id', assetId).single();
  if (recordedRelease.error) throw new Error('Separate asset release could not be verified.');
  expect(recordedRelease.data).toMatchObject({ actor_id: reviewer.id, acknowledgment: 'Reviewed the current asset condition and recorded inspection repair approval.' });

  await inspectorPage.goto(`/inspections?assignment=${assignmentId}`);
  await inspectorPage.reload();
  const finalInspection = inspectorPage.getByRole('region', { name: 'Selected inspection detail' });
  await expect(finalInspection.getByRole('button', { name: 'Record a correction' })).toBeVisible();
  await finalInspection.getByRole('button', { name: 'Record a correction' }).click();
  await finalInspection.getByLabel('Correction reason').fill('The same unsafe guard condition returned after the prior repair was closed and released.');
  await finalInspection.getByLabel('Failure remarks').fill('The guard is loose again after the approved remedy and separate asset release.');
  await finalInspection.getByRole('button', { name: 'Save correction' }).click();
  await expect(finalInspection.getByText('Latest saved results · version 2')).toBeVisible();
  const history = finalInspection.getByRole('region', { name: 'Correction and hold history' });
  const correctiveLinks = history.getByRole('link', { name: 'Open corrective request' });
  await expect(correctiveLinks).toHaveCount(2);
  const hrefs = await correctiveLinks.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
  expect(new Set(hrefs).size).toBe(2);
  await expect(history.getByText('Released hold', { exact: true })).toBeVisible();
  await expect(history.getByText('Unresolved hold', { exact: true })).toBeVisible();
  const finalDetail = await admin.from('inspection_failure_episodes').select('id,corrective_request_id,predecessor_id,hold_id').eq('organization_id', organizationId).eq('assignment_id', assignmentId).order('created_at');
  if (finalDetail.error) throw new Error('Fresh inspection failure episode could not be verified.');
  expect(finalDetail.data).toHaveLength(2);
  expect(finalDetail.data[1]?.predecessor_id).toBe(finalDetail.data[0]?.id);
  expect(finalDetail.data[1]?.corrective_request_id).not.toBe(finalDetail.data[0]?.corrective_request_id);
  expect(finalDetail.data[1]?.hold_id).not.toBe(finalDetail.data[0]?.hold_id);
  const closedRepair = await admin.from('work_orders').select('status').eq('organization_id', organizationId).eq('id', workOrderId).single();
  if (closedRepair.error) throw new Error('Closed repair status could not be verified.');
  expect(closedRepair.data.status).toBe('completed');
  await Promise.all([ownerPage.close(), inspectorPage.close(), repairerPage.close(), reviewerPage.close()]);
});
