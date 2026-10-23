import { expect, test, type Route } from '@playwright/test';
import { fixtureOrganizationIds, fixtureUserId, prepareWorkspacePage } from './workspace-fixture';

const origin = 'http://127.0.0.1:54321';
const assetId = 'c2daf4c7-e68c-4783-87c6-26b009a1169d';
const oldWorkOrderId = '82f19111-b19a-4ca2-a720-3958cc0814ab';
const oldRequestId = '91e98b83-3578-4fee-91cc-6b5824ab7391';

declare global {
  interface Window {
    __createdPrivateImageUrls: string[];
    __privateDownloadAborted: boolean;
    __resolvePrivateImageDownload?: () => void;
  }
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, organization_id: fixtureOrganizationIds.alpha, number: 41, asset_id: assetId, source_request_id: null,
    title: 'Older authorized repair', description: 'A work order outside the newest list page.', category: 'inspection', priority: 'normal', due_at: null,
    supervisor_id: fixtureUserId, status: 'open', blocks_operation: false, created_by: fixtureUserId, created_at: '2026-10-01T00:00:00.000Z', version: 1,
    repair_revision: 1, submitted_revision: null, opened_at: null, completed_at: null, priority_reason: null,
    ...overrides,
  };
}

async function fulfill(route: Route, status: number, value: unknown) {
  const headers = route.request().headers();
  await route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': headers['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile' },
    body: JSON.stringify(value),
  });
}

test('a work-order link loads its exact older target even when it is outside the newest list page', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') === `eq.${oldWorkOrderId}`) return fulfill(route, 200, row(oldWorkOrderId));
    return fulfill(route, 200, []);
  });
  await page.goto(`/work-orders?workOrder=${oldWorkOrderId}`);
  await expect(page.getByRole('heading', { name: 'Older authorized repair' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Work order unavailable' })).toHaveCount(0);
});

test('an inaccessible work-order target remains unavailable instead of opening the newest row', async ({ page }) => {
  await prepareWorkspacePage(page);
  const newest = row('e8f3ef4c-ae2e-4c23-850f-3b9f4a80c51c', { title: 'Unrelated recent repair' });
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    return fulfill(route, 200, url.searchParams.get('id') === `eq.${oldWorkOrderId}` ? [] : [newest]);
  });
  await page.goto(`/work-orders?workOrder=${oldWorkOrderId}`);
  await expect(page.getByRole('heading', { name: 'Work order unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unrelated recent repair' })).toHaveCount(0);
});

test('a request notification target loads the exact older request without selecting another request', async ({ page }) => {
  await prepareWorkspacePage(page);
  const oldRequest = {
    id: oldRequestId, organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, reporter_id: fixtureUserId,
    description: 'Older request outside the newest list page.', category: 'inspection', status: 'submitted', transition_reason: null,
    converted_work_order_id: null, created_at: '2026-10-01T00:00:00.000Z', version: 1,
  };
  await page.route(/\/rest\/v1\/maintenance_requests(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') === `eq.${oldRequestId}`) return fulfill(route, 200, oldRequest);
    return fulfill(route, 200, []);
  });
  await page.goto(`/requests?request=${oldRequestId}`);
  await expect(page.getByRole('heading', { name: 'inspection request' })).toBeVisible();
  await expect(page.getByText('Older request outside the newest list page.', { exact: true })).toBeVisible();
});

test('an inaccessible request target does not fall through to the newest request', async ({ page }) => {
  await prepareWorkspacePage(page);
  const newest = { id: 'e8f3ef4c-ae2e-4c23-850f-3b9f4a80c51c', organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, reporter_id: fixtureUserId, description: 'Unrelated recent request.', category: 'inspection', status: 'submitted', transition_reason: null, converted_work_order_id: null, created_at: '2026-10-22T00:00:00.000Z', version: 1 };
  await page.route(/\/rest\/v1\/maintenance_requests(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    return fulfill(route, 200, url.searchParams.get('id') === `eq.${oldRequestId}` ? null : [newest]);
  });
  await page.goto(`/requests?request=${oldRequestId}`);
  const details = page.getByRole('region', { name: 'Selected request details' });
  await expect(details.getByRole('heading', { name: 'Request unavailable' })).toBeVisible();
  await expect(details.getByText('This target is not visible under your current workspace access.')).toBeVisible();
  await expect(details.getByText('Unrelated recent request.', { exact: true })).toHaveCount(0);
});

test('an asset target resolves its exact RLS-visible asset and reports a removed target explicitly', async ({ page }) => {
  await prepareWorkspacePage(page);
  const targetAssetId = '25f68b8a-9711-4c0a-a619-d7a9e4133c38';
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const target = url.searchParams.get('id');
    if (target === `eq.${targetAssetId}`) return fulfill(route, 200, { ...assetRecord(targetAssetId, 'Alpha fan'), availability: 'operational' });
    if (target === 'eq.00000000-0000-4000-8000-000000000001') return fulfill(route, 200, null);
    return fulfill(route, 200, [assetRecord(assetId, 'Alpha pump')]);
  });
  await page.goto(`/assets?asset=${targetAssetId}`);
  await expect(page.getByRole('heading', { name: 'Alpha fan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha pump' })).toHaveCount(0);

  await page.goto('/assets?asset=00000000-0000-4000-8000-000000000001');
  const details = page.getByRole('region', { name: 'Selected asset details' });
  await expect(details.getByRole('heading', { name: 'Asset unavailable' })).toBeVisible();
  await expect(details.getByText('This target is not visible under your current workspace access.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha pump' })).toHaveCount(0);
});

test('a lost asset-release response retains its request while refreshing an older exact target', async ({ page }) => {
  await prepareWorkspacePage(page);
  const targetAssetId = '25f68b8a-9711-4c0a-a619-d7a9e4133c38';
  let authoritativeAsset = { ...assetRecord(targetAssetId, 'Alpha fan'), availability: 'out_of_service' };
  let committedRelease: Record<string, unknown> | null = null;
  let assetTargetReads = 0;
  const attempts: Record<string, unknown>[] = [];
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('id') === `eq.${targetAssetId}`) {
      assetTargetReads++;
      return fulfill(route, 200, authoritativeAsset);
    }
    return fulfill(route, 200, [assetRecord(assetId, 'Alpha pump')]);
  });
  await page.route(/\/rest\/v1\/(asset_holds|asset_releases|asset_meter_readings|work_orders|attachments)(?:\?.*)?$/, async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').at(-1);
    if (table === 'asset_releases' && committedRelease) return fulfill(route, 200, [committedRelease]);
    return fulfill(route, 200, []);
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));
  await page.route(`${origin}/rest/v1/rpc/release_asset`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    attempts.push(body);
    const ctx = body.ctx as { request_id: string };
    if (attempts.length === 1) {
      committedRelease = {
        id: 'f02b90c9-9324-4e64-9be6-f7878fbe0871', organization_id: fixtureOrganizationIds.alpha,
        asset_id: targetAssetId, actor_id: fixtureUserId, checked_version: 1, hold_ids: [],
        acknowledgment: 'Inspected and confirmed ready for operation.', created_at: '2026-10-23T01:00:00.000Z',
      };
      authoritativeAsset = { ...authoritativeAsset, version: 2, availability: 'operational' };
      return fulfill(route, 503, { message: 'Response lost after commit.' });
    }
    return fulfill(route, 200, { data: committedRelease, version: 2, request_id: ctx.request_id });
  });

  await page.goto(`/assets?asset=${targetAssetId}`);
  const details = page.getByRole('region', { name: 'Selected asset details' });
  await expect(details.getByRole('heading', { name: 'Alpha fan' })).toBeVisible();
  await details.getByLabel('Release acknowledgment').fill('Inspected and confirmed ready for operation.');
  await details.getByRole('button', { name: 'Record asset release' }).click();
  const pending = details.getByRole('alert');
  await expect(pending.getByRole('button', { name: 'Retry pending asset action' })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Retry exact release' })).toBeDisabled();

  await pending.getByRole('button', { name: 'Refresh current asset records' }).click();
  await expect.poll(() => assetTargetReads).toBeGreaterThan(1);
  await expect(details.getByRole('definition').filter({ hasText: /^operational$/ })).toBeVisible();
  await expect(pending.getByRole('button', { name: 'Retry pending asset action' })).toBeVisible();
  await pending.getByRole('button', { name: 'Retry pending asset action' }).click();
  await expect(details.getByText('Asset release recorded.', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((attempts[0]!.ctx as { expected_version: number }).expected_version).toBe(1);
  expect(committedRelease).not.toBeNull();
});

test('a delayed private download cannot create or retain an image URL after the asset context changes', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.addInitScript(() => {
    window.__createdPrivateImageUrls = [];
    window.__privateDownloadAborted = false;
    const nativeCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const value = nativeCreate(blob);
      window.__createdPrivateImageUrls.push(value);
      return value;
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/functions/v1/attachment-upload?') && init?.method === 'GET') {
        init.signal?.addEventListener('abort', () => { window.__privateDownloadAborted = true; }, { once: true });
        return new Promise<Response>((resolve) => {
          window.__resolvePrivateImageDownload = () => resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
        });
      }
      return nativeFetch(input, init);
    };
  });
  const attachmentId = 'bb5d65a4-034e-42d3-aa2c-c9868d57470b';
  const privateAttachment = {
    id: attachmentId, organization_id: fixtureOrganizationIds.alpha, work_order_id: null, asset_id: assetId, request_id: null,
    object_key: `${fixtureOrganizationIds.alpha}/${assetId}/${attachmentId}`, name: 'pump.png', media_type: 'image/png', size: 12,
    uploader_id: fixtureUserId, status: 'ready', checksum: 'sha256:synthetic', width: 1, height: 1, created_at: '2026-10-21T01:00:00.000Z',
    ready_at: '2026-10-21T01:01:00.000Z', cleanup_completed_at: null,
  };
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => fulfill(route, 200, [
    { ...assetRecord(assetId, 'Alpha pump'), availability: 'operational' },
    { ...assetRecord('25f68b8a-9711-4c0a-a619-d7a9e4133c38', 'Alpha fan'), availability: 'operational' },
  ]));
  await page.route(/\/rest\/v1\/attachments(?:\?.*)?$/, async (route) => {
    const asset = new URL(route.request().url()).searchParams.get('asset_id');
    await fulfill(route, 200, asset === `eq.${assetId}` ? [privateAttachment] : []);
  });
  await page.goto(`/assets?asset=${assetId}`);
  await expect(page.getByRole('heading', { name: 'Alpha pump' })).toBeVisible();
  await page.waitForFunction(() => typeof window.__resolvePrivateImageDownload === 'function');
  await page.getByRole('button', { name: 'Alpha fan', exact: true }).click();
  await expect(page).toHaveURL(/asset=25f68b8a-9711-4c0a-a619-d7a9e4133c38/);
  await page.waitForFunction(() => window.__privateDownloadAborted);
  await page.evaluate(() => window.__resolvePrivateImageDownload?.());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__createdPrivateImageUrls)).toEqual([]);
  await expect(page.locator('img.private-image')).toHaveCount(0);
});

test('switching workspaces closes and clears an unfinished direct-create form', async ({ page }) => {
  await prepareWorkspacePage(page, [fixtureOrganizationIds.alpha, fixtureOrganizationIds.beta]);
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('select') === 'id,code,name,archived_at') return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', archived_at: null }]);
    return fulfill(route, 200, []);
  });
  await page.goto('/work-orders');
  await page.getByRole('button', { name: 'Create work order' }).click();
  const form = page.getByRole('region', { name: 'Create a work order' });
  await form.getByLabel('Title').fill('Private draft title for Alpha');
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption(fixtureOrganizationIds.beta);
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Private draft title for Alpha', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption(fixtureOrganizationIds.alpha);
  await page.goto('/work-orders');
  await page.getByRole('button', { name: 'Create work order' }).click();
  await expect(page.getByRole('region', { name: 'Create a work order' }).getByLabel('Title')).toHaveValue('');
});

test('an immutable listed participant is excluded from review even when the work order awaits review', async ({ page }) => {
  await prepareWorkspacePage(page);
  const awaitingReview = row(oldWorkOrderId, { status: 'awaiting_review', submitted_revision: 1 });
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    return fulfill(route, 200, url.searchParams.get('id') === `eq.${oldWorkOrderId}` ? awaitingReview : [awaitingReview]);
  });
  await page.route(/\/rest\/v1\/work_order_participants(?:\?.*)?$/, async (route) => fulfill(route, 200, [{
    user_id: fixtureUserId, source: 'declared_performer', recorded_at: '2026-10-22T00:00:00.000Z',
  }]));
  await page.goto(`/work-orders?workOrder=${oldWorkOrderId}`);
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await expect(details.getByText('Your account participated in this work order and cannot review it, even if your assignment has since changed.')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Approve repair' })).toHaveCount(0);
});

test('a lost review response keeps its original request after refreshing an advanced record', async ({ page }) => {
  await prepareWorkspacePage(page);
  let authoritative = row(oldWorkOrderId, { status: 'awaiting_review', version: 5, repair_revision: 3, submitted_revision: 3 });
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    return fulfill(route, 200, url.searchParams.get('id') === `eq.${oldWorkOrderId}` ? authoritative : [authoritative]);
  });
  await page.route(/\/rest\/v1\/work_order_participants(?:\?.*)?$/, async (route) => fulfill(route, 200, []));
  const attempts: Record<string, unknown>[] = [];
  let committedReviewCount = 0;
  await page.route(`${origin}/rest/v1/rpc/review_work_order`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    attempts.push(body);
    if (attempts.length === 1) {
      committedReviewCount++;
      authoritative = row(oldWorkOrderId, { status: 'completed', version: 6, repair_revision: 3, submitted_revision: 3, completed_at: '2026-10-23T01:00:00.000Z' });
      return fulfill(route, 503, { message: 'Response lost after commit.' });
    }
    return fulfill(route, 200, { data: authoritative, version: 6, request_id: (body.ctx as { request_id: string }).request_id });
  });
  await page.goto(`/work-orders?workOrder=${oldWorkOrderId}`);
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await details.getByLabel('Review reason').fill('Reviewed measurements against the repair record.');
  await details.getByRole('button', { name: 'Approve repair' }).click();
  await expect(details.getByRole('button', { name: 'Retry pending action' })).toBeVisible();
  await details.getByRole('button', { name: 'Refresh record' }).click();
  await expect(details.getByText('completed', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Approve repair' })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Return for correction' })).toHaveCount(0);
  await details.getByRole('button', { name: 'Retry pending action' }).click();
  await expect(details.getByText('Repair approved. Asset release remains a separate recorded action.')).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect((attempts[0]!.ctx as { expected_version: number }).expected_version).toBe(5);
  expect(committedReviewCount).toBe(1);
});

function assetRecord(id: string, name: string) {
  return { id, organization_id: fixtureOrganizationIds.alpha, code: id === assetId ? 'ALPHA-01' : 'ALPHA-02', name, category: 'pump', site_id: null, serial_number: null, registration: null, archived_at: null, created_by: fixtureUserId, created_at: '2026-10-21T01:00:00.000Z', version: 1, availability: 'under_maintenance' };
}

test('a lost direct-create response retries the same immutable request body and keeps fields locked', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('select') === 'id,code,name,archived_at') return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', archived_at: null }]);
    return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', availability: 'under_maintenance', archived_at: null }]);
  });
  const requests: unknown[] = [];
  const createdId = '22242424-5b0b-4a58-984f-8f4ae3557c2c';
  const createdRead = row(createdId, { title: 'Inspect pump coupling', status: 'draft', number: 3, description: 'Check alignment and document the reading.' });
  const created = { ...createdRead };
  delete (created as Partial<typeof createdRead>).repair_revision;
  delete (created as Partial<typeof createdRead>).submitted_revision;
  delete (created as Partial<typeof createdRead>).opened_at;
  delete (created as Partial<typeof createdRead>).completed_at;
  delete (created as Partial<typeof createdRead>).priority_reason;
  await page.route(`${origin}/rest/v1/rpc/create_work_order`, async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1) return fulfill(route, 503, { message: 'Service unavailable' });
    return fulfill(route, 200, { data: created, version: 1, request_id: (body as { ctx: { request_id: string } }).ctx.request_id });
  });
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') === `eq.${createdId}`) return fulfill(route, 200, createdRead);
    return fulfill(route, 200, []);
  });
  await page.goto('/work-orders');
  await page.getByRole('button', { name: 'Create work order' }).click();
  const form = page.getByRole('region', { name: 'Create a work order' });
  await form.getByLabel('Asset').selectOption(assetId);
  await form.getByLabel('Title').fill('Inspect pump coupling');
  await form.getByLabel('Description').fill('Check alignment and document the reading.');
  await form.getByLabel('Category').fill('inspection');
  await form.getByRole('button', { name: 'Create work order', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Retry exact create' })).toBeVisible();
  await expect(form.getByLabel('Title')).toBeDisabled();
  await expect(form.getByLabel('Description')).toBeDisabled();
  await expect(form.getByLabel('Category')).toBeDisabled();
  await expect(form.getByLabel('Priority')).toBeDisabled();
  await expect(form.getByLabel('Asset')).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Retry exact create' }).click();
  await expect(page.getByRole('heading', { name: 'Inspect pump coupling' })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const createBody = requests[0] as { ctx: { request_id: string }; asset_id: string; fields: { title: string } };
  expect(createBody.ctx.request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(createBody.asset_id).toBe(assetId);
  expect(createBody.fields.title).toBe('Inspect pump coupling');
});
