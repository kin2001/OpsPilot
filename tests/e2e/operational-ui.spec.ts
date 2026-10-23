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

type MutableWorkOrder = Omit<ReturnType<typeof row>, 'due_at' | 'submitted_revision'> & {
  due_at: string | null;
  submitted_revision: number | null;
  planned_on: string | null;
};

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

test('asset registry and direct-create selector search and page past 100 equal-time records without duplicates', async ({ page }) => {
  await prepareWorkspacePage(page);
  const records = Array.from({ length: 101 }, (_, index) => {
    const sequence = index + 1;
    const id = `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
    return {
      id, organization_id: fixtureOrganizationIds.alpha, code: `ASSET-${String(sequence).padStart(3, '0')}`,
      name: `Registry asset ${String(sequence).padStart(3, '0')}`, category: 'pump', site_id: null, serial_number: null,
      registration: null, archived_at: null, created_by: fixtureUserId, created_at: '2026-10-22T00:00:00.000Z',
      version: 1, availability: 'operational',
    };
  });
  const oldest = records[0]!;
  const assetRequests: URL[] = [];
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    assetRequests.push(url);
    const query = url.searchParams;
    const exactId = query.get('id')?.match(/^eq\.([0-9a-f-]{36})$/i)?.[1];
    let result = exactId ? records.filter((asset) => asset.id === exactId) : [...records];
    const filter = query.get('or') ?? '';
    const cursor = filter.match(/created_at\.eq\.([^,)]+),id\.lt\.([0-9a-f-]{36})/i);
    if (cursor) {
      const [, createdAt, id] = cursor;
      result = result.filter((asset) => asset.created_at < createdAt! || asset.created_at === createdAt && asset.id < id!);
    }
    const searchTerms = [...filter.matchAll(/(?:name|code|category)\.ilike\.%([^%]+)%/gi)].map((match) => match[1]!.toLocaleLowerCase());
    if (searchTerms.length) result = result.filter((asset) => searchTerms.some((term) => [asset.name, asset.code, asset.category].some((value) => value.toLocaleLowerCase().includes(term))));
    result.sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
    const selectedColumns = query.get('select')?.split(',') ?? [];
    const projected = selectedColumns.includes('*') ? result : result.map((asset) => Object.fromEntries(selectedColumns.map((column) => [column, asset[column as keyof typeof asset]])));
    return fulfill(route, 200, projected.slice(0, 26));
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));
  await page.route(/\/rest\/v1\/(?:asset_holds|asset_releases|asset_meter_readings)(?:\?.*)?$/, async (route) => fulfill(route, 200, []));

  await page.goto('/assets');
  const tableRows = page.locator('.responsive-record-table tbody tr');
  await expect(tableRows).toHaveCount(25);
  for (const count of [50, 75, 100, 101]) {
    await page.getByRole('button', { name: 'Load more assets' }).click();
    await expect(tableRows).toHaveCount(count);
  }
  const displayedCodes = await tableRows.locator('td:nth-child(2)').allTextContents();
  expect(displayedCodes).toEqual([...records].sort((left, right) => right.id.localeCompare(left.id)).map((asset) => asset.code));
  expect(new Set(displayedCodes).size).toBe(101);
  expect(assetRequests.filter((request) => request.searchParams.get('or')?.includes('created_at.eq.')).length).toBeGreaterThanOrEqual(4);
  expect(assetRequests[0]!.searchParams.get('order')).toBe('created_at.desc,id.desc');

  await page.getByLabel('Search assets').fill(oldest.code);
  await expect(tableRows).toHaveCount(1);
  await expect(tableRows.first()).toContainText(oldest.name);
  expect(assetRequests.some((request) => request.searchParams.get('or')?.includes(`code.ilike.%${oldest.code}%`))).toBe(true);

  await page.goto(`/assets?asset=${oldest.id}`);
  await expect(page.getByRole('heading', { name: oldest.name, exact: true })).toBeVisible();
  await page.goto('/work-orders');
  await page.getByRole('button', { name: 'Create work order' }).click();
  const createForm = page.getByRole('region', { name: 'Create a work order' });
  const assetSelect = createForm.getByLabel('Asset', { exact: true });
  await expect(assetSelect).toBeEnabled();
  const createSearch = createForm.getByRole('searchbox', { name: 'Find active assets' });
  await createSearch.fill(oldest.code);
  await expect(assetSelect).toBeEnabled();
  await expect(assetSelect.locator('option')).toContainText(['Choose an active asset', `${oldest.code} · ${oldest.name}`]);
  await assetSelect.selectOption(oldest.id);
  expect(assetRequests.some((request) => request.searchParams.get('or')?.includes(`code.ilike.%${oldest.code}%`))).toBe(true);
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
    if (query.get('select') === 'id,code,name,created_at,archived_at') return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', created_at: '2026-10-21T01:00:00.000Z', archived_at: null }]);
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

test('asset editing and archive state use versioned save commands and show a same-origin QR route', async ({ page }) => {
  await prepareWorkspacePage(page);
  let authoritative = { ...assetRecord(assetId, 'Alpha pump'), archived_at: null as string | null, availability: 'under_maintenance' as string, version: 1 };
  const writes: Record<string, unknown>[] = [];
  let lostArchiveReply = false;
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('id') === `eq.${assetId}`) return fulfill(route, 200, authoritative);
    return fulfill(route, 200, [authoritative]);
  });
  await page.route(/\/rest\/v1\/(asset_holds|asset_releases|asset_meter_readings|work_orders|work_order_reviews|work_order_participants|attachments)(?:\?.*)?$/, async (route) => fulfill(route, 200, []));
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));
  await page.route(`${origin}/rest/v1/rpc/save_asset`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version?: number; request_id: string }; asset_id: string | null; fields: Record<string, unknown> };
    writes.push(body as unknown as Record<string, unknown>);
    expect(body.asset_id).toBe(assetId);
    if (writes.slice(0, -1).some((write) => (write.ctx as { request_id: string }).request_id === body.ctx.request_id)) {
      const { availability: _availability, ...legacyAsset } = authoritative;
      return fulfill(route, 200, { data: legacyAsset, version: authoritative.version, request_id: body.ctx.request_id });
    }
    expect(body.ctx.expected_version).toBe(authoritative.version);
    authoritative = {
      ...authoritative,
      ...Object.fromEntries(Object.entries(body.fields).filter(([key]) => key !== 'archived')),
      archived_at: body.fields.archived === true ? '2026-10-23T01:00:00.000Z' : body.fields.archived === false ? null : authoritative.archived_at,
      version: authoritative.version + 1,
    };
    if (body.fields.archived === true && !lostArchiveReply) {
      lostArchiveReply = true;
      return fulfill(route, 503, { message: 'Response lost after archive commit.' });
    }
    const { availability: _availability, ...legacyAsset } = authoritative;
    return fulfill(route, 200, { data: legacyAsset, version: authoritative.version, request_id: body.ctx.request_id });
  });

  await page.goto('/assets');
  const details = page.getByRole('region', { name: 'Selected asset details' });
  await expect(details.getByRole('heading', { name: 'Alpha pump' })).toBeVisible();
  await expect(details.getByRole('img', { name: 'QR code for Alpha pump' })).toHaveAttribute('src', /^data:image\/gif;base64,/);
  await expect(details.getByRole('link', { name: 'Open asset route' })).toHaveAttribute('href', `${page.url().split('/').slice(0, 3).join('/')}/assets?asset=${assetId}`);
  await details.getByRole('button', { name: 'Edit asset' }).click();
  await details.getByLabel('Asset name').fill('Alpha pump revised');
  await details.getByRole('button', { name: 'Save asset changes' }).click();
  await expect(details.getByRole('heading', { name: 'Alpha pump revised' })).toBeVisible();
  await details.getByRole('button', { name: 'Archive asset' }).click();
  const pending = details.getByRole('alert');
  await expect(pending.getByRole('button', { name: 'Retry pending asset action' })).toBeVisible();
  await pending.getByRole('button', { name: 'Refresh current asset records' }).click();
  await expect(details.getByText('Archived', { exact: true })).toBeVisible();
  await pending.getByRole('button', { name: 'Retry pending asset action' }).click();
  await expect(page.getByText('Asset archived. Its history remains available.', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Reactivate asset' }).click();
  await expect(details.getByText('Registered', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(4);
  expect(writes.map((write) => (write.fields as Record<string, unknown>).archived ?? null)).toEqual([null, true, true, false]);
  expect(writes[2]).toEqual(writes[1]);
  expect(writes.map((write) => (write.ctx as { expected_version: number }).expected_version)).toEqual([1, 2, 2, 3]);
});

test('notification filters show the selected event and keep a lost mark-read request retryable', async ({ page }) => {
  await prepareWorkspacePage(page);
  const notificationId = '3ce2adbe-1edf-4a03-8eb4-7cbe56d8f29a';
  const workOrderId = '82f19111-b19a-4ca2-a720-3958cc0814ab';
  let rows = [
    { id: notificationId, organization_id: fixtureOrganizationIds.alpha, recipient_user_id: fixtureUserId, category: 'assignment', source_id: workOrderId, event_id: '2a3e3888-dd28-43fc-9fae-79ed008987ae', created_at: '2026-10-23T01:00:00.000Z', read_at: null as string | null },
    { id: '4df2a0f2-9e93-4945-8dde-48d05c524eb0', organization_id: fixtureOrganizationIds.alpha, recipient_user_id: fixtureUserId, category: 'other', source_id: '00000000-0000-4000-8000-000000000001', event_id: '628b5fa5-5e14-4128-9db1-518f02c5b6cc', created_at: '2026-10-22T01:00:00.000Z', read_at: '2026-10-22T02:00:00.000Z' },
  ];
  const writes: Record<string, unknown>[] = [];
  await page.route(/\/rest\/v1\/notifications(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(query.get('recipient_user_id')).toBe(`eq.${fixtureUserId}`);
    return fulfill(route, 200, rows);
  });
  await page.route(`${origin}/rest/v1/rpc/mark_notifications_read`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { request_id: string }; ids: string[] };
    writes.push(body as unknown as Record<string, unknown>);
    rows = rows.map((item) => body.ids.includes(item.id) ? { ...item, read_at: item.read_at ?? '2026-10-23T01:01:00.000Z' } : item);
    if (writes.length === 1) return fulfill(route, 503, { message: 'Response lost after read state committed.' });
    return fulfill(route, 200, { data: { id: notificationId, marked: true }, version: 1, request_id: body.ctx.request_id });
  });
  await page.goto('/notifications');
  await page.getByLabel('Read status').selectOption('unread');
  await page.getByLabel('Category').selectOption('assignment');
  const details = page.getByRole('region', { name: 'Selected notification' });
  await expect(details.getByText(notificationId)).toBeVisible();
  await expect(details.getByRole('link', { name: 'Open current record' })).toHaveAttribute('href', `/work-orders?workOrder=${workOrderId}`);
  await details.getByRole('button', { name: 'Mark as read' }).click();
  await expect(details.getByRole('button', { name: 'Retry mark as read' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh notifications' }).click();
  await expect(details.getByText('Read', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Retry mark as read' })).toBeVisible();
  await details.getByRole('button', { name: 'Retry mark as read' }).click();
  await expect(page.getByText('Notification marked as read.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test('dashboard attention items precede totals and link to exact blocked, overdue and review work', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.clock.install({ time: new Date('2026-10-23T06:00:00.000Z') });
  const blockedId = '5ce7c180-d3d6-4a67-95d7-40549d049aea';
  const reviewId = '5b8dc2dd-bb42-4cd2-a53f-3ad2cb31ff5f';
  const overdueId = 'fe8b7a76-a617-49d8-86c7-4fffb1f123f3';
  const dueLaterTodayId = 'f6c4a89d-859a-4b26-90fd-a4e1c10a7c8d';
  const workOrder = (id: string, number: number, status: string, due_at: string | null) => ({ id, number, title: `Synthetic ${status} work`, status, priority: 'high', due_at, created_at: '2026-10-22T00:00:00.000Z' });
  await page.route(`${origin}/rest/v1/rpc/get_dashboard`, async (route) => fulfill(route, 200, {
    counts: { active_assets: 2, available_assets: 1, active_work_orders: 3, blocked: 1, pending_approvals: 1, overdue: 1, completed: 0, completion_sample_size: 0, completion_seconds: null },
    daily_availability: [{ date: '2026-10-23', known_assets: 2, available_assets: 1 }], downtime_seconds: null, history_complete: true,
    timezone: 'Asia/Manila', from: '2026-10-17', to: '2026-10-24', generated_at: new Date().toISOString(),
  }));
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const status = query.get('status');
    if (status === 'eq.blocked') return fulfill(route, 200, [workOrder(blockedId, 51, 'blocked', null)]);
    if (status === 'eq.awaiting_review') return fulfill(route, 200, [workOrder(reviewId, 52, 'awaiting_review', null)]);
    if (query.has('due_at')) {
      expect(query.get('status')).toBe('in.(open,scheduled,in_progress,blocked,awaiting_review)');
      return fulfill(route, 200, [
        workOrder(overdueId, 53, 'in_progress', '2026-10-23T13:00:00+08:00'),
        workOrder(dueLaterTodayId, 54, 'scheduled', '2026-10-23T15:00:00+08:00'),
      ]);
    }
    return fulfill(route, 200, []);
  });
  await page.goto('/');
  const queue = page.getByRole('region', { name: 'Attention queue' });
  await expect(queue.getByRole('link', { name: /WO-0051 · Synthetic blocked work/ })).toHaveAttribute('href', `/work-orders?workOrder=${blockedId}`);
  await expect(queue.getByRole('link', { name: /WO-0052 · Synthetic awaiting_review work/ })).toHaveAttribute('href', `/work-orders?workOrder=${reviewId}`);
  await expect(queue.getByRole('link', { name: /WO-0053 · Synthetic in_progress work/ })).toHaveAttribute('href', `/work-orders?workOrder=${overdueId}`);
  await expect(queue.getByRole('link', { name: /WO-0054/ })).toHaveCount(0);
  const order = await page.locator('main').evaluate((main) => {
    const queuePosition = main.querySelector('.attention-queue')?.compareDocumentPosition(main.querySelector('.dashboard-counts')!);
    return Boolean(queuePosition && (queuePosition & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
});

test('operations team places authorized active assignment counts before the roster', async ({ page }) => {
  await prepareWorkspacePage(page);
  const technicianId = '8fa52100-28a7-4d2a-a49e-4aa73b7e9264';
  const workOrderId = '6925bbbe-9862-45e8-8ce7-7fe8f42c1ca6';
  await page.route(/\/rest\/v1\/organization_members(?:\?.*)?$/, async (route) => fulfill(route, 200, [{ organization_id: fixtureOrganizationIds.alpha, user_id: fixtureUserId, role: 'manager', active: true, created_at: '2026-10-21T00:00:00.000Z', version: 1 }]));
  await page.route(`${origin}/rest/v1/rpc/get_team`, async (route) => fulfill(route, 200, [
    { user_id: fixtureUserId, role: 'manager', active: true, version: 1 },
    { user_id: technicianId, role: 'technician', active: true, version: 1 },
  ]));
  await page.route(/\/rest\/v1\/work_order_assignments(?:\?.*)?$/, async (route) => fulfill(route, 200, [
    { user_id: technicianId, work_order_id: workOrderId },
  ]));
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => fulfill(route, 200, [{ id: workOrderId, status: 'in_progress' }]));
  await page.goto('/team');
  const workload = page.getByRole('region', { name: 'Assigned workload' });
  await expect(workload.getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workspace members and roles' })).toBeVisible();
  const order = await page.locator('main').evaluate((main) => {
    const workloadPosition = main.querySelector('.team-workload')?.compareDocumentPosition(main.querySelector('.team-roster-heading')!);
    return Boolean(workloadPosition && (workloadPosition & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
});

test('critical request conversion requires a reason and sends it with the draft command', async ({ page }) => {
  await prepareWorkspacePage(page);
  const requestId = '34eb61be-f5e4-44ca-8d84-bd20430cc3b5';
  const createdId = 'd9fe9c72-2e28-4ba2-b281-d844025fb2da';
  let request: { id: string; organization_id: string; asset_id: string; reporter_id: string; description: string; category: string; status: string; transition_reason: string | null; converted_work_order_id: string | null; created_at: string; version: number } = {
    id: requestId, organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, reporter_id: fixtureUserId,
    description: 'Check the pump bearing temperature.', category: 'pump', status: 'submitted', transition_reason: null,
    converted_work_order_id: null, created_at: '2026-10-22T01:00:00.000Z', version: 1,
  };
  await page.route(/\/rest\/v1\/maintenance_requests(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    return fulfill(route, 200, query.get('id') === `eq.${requestId}` ? request : [request]);
  });
  const conversions: Record<string, unknown>[] = [];
  const legacy = { ...row(createdId, { number: 88, source_request_id: requestId, title: 'Inspect pump bearing', priority: 'critical', status: 'draft' }) };
  delete (legacy as Partial<typeof legacy>).repair_revision;
  delete (legacy as Partial<typeof legacy>).submitted_revision;
  delete (legacy as Partial<typeof legacy>).opened_at;
  delete (legacy as Partial<typeof legacy>).completed_at;
  delete (legacy as Partial<typeof legacy>).priority_reason;
  await page.route(`${origin}/rest/v1/rpc/convert_request`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    conversions.push(body);
    const requestIdFromBody = (body.ctx as { request_id: string }).request_id;
    request = { ...request, status: 'converted', converted_work_order_id: createdId, version: 2 };
    return fulfill(route, 200, { data: legacy, version: 1, request_id: requestIdFromBody });
  });
  await page.goto(`/requests?request=${requestId}`);
  const details = page.getByRole('region', { name: 'Selected request details' });
  await details.getByLabel('Draft work order title').fill('Inspect pump bearing');
  await details.getByLabel('Priority').selectOption('critical');
  await details.getByRole('button', { name: 'Convert to draft work order' }).click();
  await expect(details.getByRole('alert')).toContainText('Enter the required critical priority reason');
  expect(conversions).toHaveLength(0);

  await details.getByLabel('Critical priority reason').fill('Bearing temperature exceeded the recorded limit.');
  await details.getByRole('button', { name: 'Convert to draft work order' }).click();
  await expect(details.getByRole('link', { name: 'open the linked work order' })).toHaveAttribute('href', `/work-orders?workOrder=${createdId}`);
  expect(conversions).toHaveLength(1);
  const fields = conversions[0]!.work_order_fields as Record<string, unknown>;
  expect(fields.priority).toBe('critical');
  expect(fields.critical_reason).toBe('Bearing temperature exceeded the recorded limit.');
});

test('coordinator edits admin fields, schedules by planned date, and cancels with a reason while its hold stays active', async ({ page }) => {
  await prepareWorkspacePage(page);
  const workOrderId = '69528d6d-5e61-48ea-a526-889f1b3eccbb';
  const managerId = '8a4c1595-0a94-4284-8de0-f70ff9a618a2';
  const holdId = 'ab00a9cc-5af4-48e0-870c-88f9f6704b42';
  let authoritative: MutableWorkOrder = { ...row(workOrderId, { number: 71, status: 'open', version: 4, repair_revision: 2, due_at: null, blocks_operation: true }), planned_on: null };
  const hold = {
    id: holdId, organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, work_order_id: workOrderId, source: 'work_order', source_id: null,
    reason: 'Pressure risk under investigation.', created_by: fixtureUserId, created_at: '2026-10-22T01:00:00.000Z', resolved_at: null, resolution: null, resolved_by: null, released_at: null,
  };
  const events: Record<string, unknown>[] = [];
  const writes: { name: string; body: Record<string, unknown> }[] = [];
  let releaseCalls = 0;
  let eventSequence = 0;
  const addEvent = (requestId: string, action: string, status: string, note: string | null, changes: Record<string, unknown>) => {
    eventSequence++;
    events.unshift({
      id: `00000000-0000-4000-8000-${String(eventSequence).padStart(12, '0')}`,
      organization_id: fixtureOrganizationIds.alpha, work_order_id: workOrderId, actor_id: fixtureUserId, request_id: requestId,
      action, status, repair_revision: authoritative.repair_revision, note, labor_minutes: null, changes, created_at: `2026-10-23T01:0${eventSequence}:00.000Z`,
    });
  };
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    return fulfill(route, 200, query.has('id') ? authoritative : [authoritative]);
  });
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const selectedAsset = { ...assetRecord(assetId, 'Alpha pump'), availability: 'out_of_service' };
    if (query.has('id')) {
      const columns = query.get('select')?.split(',') ?? [];
      return fulfill(route, 200, columns.includes('*') ? selectedAsset : Object.fromEntries(columns.map((column) => [column, selectedAsset[column as keyof typeof selectedAsset]])));
    }
    return fulfill(route, 200, [selectedAsset]);
  });
  await page.route(`${origin}/rest/v1/rpc/get_team`, async (route) => fulfill(route, 200, [
    { user_id: fixtureUserId, role: 'owner', active: true, version: 1 },
    { user_id: managerId, role: 'manager', active: true, version: 1 },
    { user_id: '8fa52100-28a7-4d2a-a49e-4aa73b7e9264', role: 'technician', active: true, version: 1 },
  ]));
  await page.route(/\/rest\/v1\/(work_order_assignments|work_order_events|work_order_tasks|work_order_reviews|work_order_participants|work_order_performer_declarations|work_order_submission_attestations|attachments|asset_holds|asset_releases|asset_meter_readings)(?:\?.*)?$/, async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').at(-1);
    if (table === 'work_order_events') return fulfill(route, 200, events);
    if (table === 'asset_holds') return fulfill(route, 200, [hold]);
    return fulfill(route, 200, []);
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));
  await page.route(`${origin}/rest/v1/rpc/update_work_order`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; id: string; allowed_fields: Record<string, unknown> };
    writes.push({ name: 'update_work_order', body: body as unknown as Record<string, unknown> });
    expect(body.id).toBe(workOrderId);
    expect(body.ctx.expected_version).toBe(authoritative.version);
    const before = {
      title: authoritative.title, description: authoritative.description, category: authoritative.category, priority: authoritative.priority,
      priority_reason: authoritative.priority_reason, due_at: authoritative.due_at, planned_on: authoritative.planned_on, supervisor_id: authoritative.supervisor_id,
    };
    authoritative = {
      ...authoritative, category: body.allowed_fields.category as string, priority: body.allowed_fields.priority as string,
      due_at: body.allowed_fields.due_at as string, supervisor_id: body.allowed_fields.supervisor_id as string, version: authoritative.version + 1,
    };
    addEvent(body.ctx.request_id, 'update_work_order', authoritative.status, null, { from_status: authoritative.status, before, submitted_fields: body.allowed_fields });
    return fulfill(route, 200, { data: authoritative, version: authoritative.version, request_id: body.ctx.request_id });
  });
  await page.route(`${origin}/rest/v1/rpc/schedule_work_order`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; id: string; planned_on: string; reason?: string };
    writes.push({ name: 'schedule_work_order', body: body as unknown as Record<string, unknown> });
    expect(body.id).toBe(workOrderId);
    expect(body.ctx.expected_version).toBe(authoritative.version);
    const previousPlannedOn = authoritative.planned_on;
    authoritative = { ...authoritative, status: 'scheduled', planned_on: body.planned_on, version: authoritative.version + 1 };
    addEvent(body.ctx.request_id, 'transition_work_order', 'scheduled', body.reason ?? null, { from_status: 'open', prior_planned_on: previousPlannedOn, planned_on: body.planned_on });
    return fulfill(route, 200, { data: authoritative, version: authoritative.version, request_id: body.ctx.request_id });
  });
  await page.route(`${origin}/rest/v1/rpc/transition_work_order`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; id: string; target: string; reason: string };
    writes.push({ name: 'transition_work_order', body: body as unknown as Record<string, unknown> });
    expect(body.id).toBe(workOrderId);
    expect(body.target).toBe('canceled');
    expect(body.reason).toBe('Unsafe access area remains under review.');
    expect(body.ctx.expected_version).toBe(authoritative.version);
    authoritative = { ...authoritative, status: 'canceled', version: authoritative.version + 1 };
    addEvent(body.ctx.request_id, 'transition_work_order', 'canceled', body.reason, { from_status: 'scheduled' });
    return fulfill(route, 200, { data: authoritative, version: authoritative.version, request_id: body.ctx.request_id });
  });
  await page.route(`${origin}/rest/v1/rpc/release_asset`, async (route) => { releaseCalls++; return fulfill(route, 200, {}); });

  await page.goto(`/work-orders?workOrder=${workOrderId}`);
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await expect(details.getByRole('heading', { name: 'Older authorized repair' })).toBeVisible();
  await details.getByLabel('Due date and time (optional)').fill('2026-11-01T18:00');
  const expectedDueAt = await page.evaluate(() => new Date('2026-11-01T18:00').toISOString());
  await details.getByLabel('Category', { exact: true }).fill('pump maintenance');
  await details.getByLabel('Priority', { exact: true }).selectOption('high');
  await details.getByLabel('Responsible supervisor').selectOption(managerId);
  await details.getByRole('button', { name: 'Save administrative changes' }).click();
  await expect(details.getByText('Administrative work order changes recorded.', { exact: true }).first()).toBeVisible();
  await expect(details.getByText('pump maintenance', { exact: true })).toBeVisible();
  await expect(details.getByText('Not scheduled', { exact: true })).toBeVisible();
  expect(writes[0]!.name).toBe('update_work_order');
  expect((writes[0]!.body.ctx as { expected_version: number }).expected_version).toBe(4);
  expect(writes[0]!.body.allowed_fields).toEqual(expect.objectContaining({ category: 'pump maintenance', priority: 'high', due_at: expectedDueAt, supervisor_id: managerId }));
  await expect(details.getByText(/update work order · open · revision 2/)).toBeVisible();

  await details.getByLabel('Planned work date').fill('2026-11-03');
  await details.getByRole('button', { name: 'Schedule with planned date' }).click();
  await expect(details.locator('.record-header .state-badge')).toHaveText('scheduled');
  await expect(details.getByText('2026-11-03', { exact: true })).toBeVisible();
  expect(writes[1]!.name).toBe('schedule_work_order');
  expect((writes[1]!.body.ctx as { expected_version: number }).expected_version).toBe(5);
  expect(writes[1]!.body).toEqual(expect.objectContaining({ id: workOrderId, planned_on: '2026-11-03' }));
  expect(writes[1]!.body).not.toHaveProperty('due_at');
  await expect(details.getByText(/transition work order · scheduled · revision 2/)).toBeVisible();

  const reason = 'Unsafe access area remains under review.';
  const cancellation = details.getByRole('button', { name: 'Cancel work order' });
  await expect(cancellation).toBeDisabled();
  await details.getByLabel('Reason for block, resume, reopen or cancellation').fill(reason);
  await cancellation.click();
  await expect(details.locator('.record-header .state-badge')).toHaveText('canceled');
  await expect(details.getByText(reason, { exact: true })).toBeVisible();
  expect((writes[2]!.body.ctx as { expected_version: number }).expected_version).toBe(6);
  expect(releaseCalls).toBe(0);

  await page.goto(`/assets?asset=${assetId}`);
  const assetDetails = page.getByRole('region', { name: 'Selected asset details' });
  await expect(assetDetails.getByRole('heading', { name: 'Safety holds' })).toBeVisible();
  await expect(assetDetails.getByText('Pressure risk under investigation.', { exact: true })).toBeVisible();
  await expect(assetDetails.getByText('Active', { exact: true })).toBeVisible();
  expect(releaseCalls).toBe(0);
});

test('reopening completed work starts a new revision that must be declared and submitted again', async ({ page }) => {
  await prepareWorkspacePage(page);
  const workOrderId = 'b9d5de34-5e14-49b8-aafe-135bb5ac8b7e';
  let authoritative: MutableWorkOrder = { ...row(workOrderId, { number: 72, status: 'completed', version: 9, repair_revision: 4, submitted_revision: 4, completed_at: '2026-10-22T01:00:00.000Z' }), planned_on: null };
  const writes: { name: string; body: Record<string, unknown> }[] = [];
  const events: Record<string, unknown>[] = [];
  const declarations: Record<string, unknown>[] = [];
  const attestations: Record<string, unknown>[] = [];
  let eventSequence = 0;
  const addEvent = (requestId: string, action: string, status: string, repairRevision: number, note: string | null, changes: Record<string, unknown>) => {
    eventSequence++;
    events.unshift({
      id: `00000000-0000-4000-8000-${String(eventSequence + 100).padStart(12, '0')}`,
      organization_id: fixtureOrganizationIds.alpha, work_order_id: workOrderId, actor_id: fixtureUserId, request_id: requestId,
      action, status, repair_revision: repairRevision, note, labor_minutes: null, changes, created_at: `2026-10-23T02:0${eventSequence}:00.000Z`,
    });
  };
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    return fulfill(route, 200, query.has('id') ? authoritative : [authoritative]);
  });
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const summary = { id: assetId, code: 'ALPHA-01', name: 'Alpha pump', availability: 'pending_release', archived_at: null };
    return fulfill(route, 200, query.has('id') ? summary : [summary]);
  });
  await page.route(`${origin}/rest/v1/rpc/get_team`, async (route) => fulfill(route, 200, [
    { user_id: fixtureUserId, role: 'owner', active: true, version: 1 },
  ]));
  await page.route(/\/rest\/v1\/(work_order_assignments|work_order_events|work_order_tasks|work_order_reviews|work_order_participants|work_order_performer_declarations|work_order_submission_attestations|attachments|organization_settings)(?:\?.*)?$/, async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').at(-1);
    if (table === 'work_order_assignments') return fulfill(route, 200, [{ user_id: fixtureUserId, unassigned_at: null }]);
    if (table === 'work_order_events') return fulfill(route, 200, events);
    if (table === 'work_order_performer_declarations') return fulfill(route, 200, declarations);
    if (table === 'work_order_submission_attestations') return fulfill(route, 200, attestations);
    if (table === 'work_order_participants' && authoritative.status === 'awaiting_review') return fulfill(route, 200, [{ user_id: fixtureUserId, source: 'declared_performer', recorded_at: '2026-10-23T02:03:00.000Z' }]);
    if (table === 'organization_settings') return fulfill(route, 200, { evidence_required: false });
    return fulfill(route, 200, []);
  });
  await page.route(`${origin}/rest/v1/rpc/transition_work_order`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; id: string; target: string; reason: string };
    writes.push({ name: 'transition_work_order', body: body as unknown as Record<string, unknown> });
    expect(body.ctx.expected_version).toBe(9);
    expect(body.id).toBe(workOrderId);
    expect(body.target).toBe('in_progress');
    expect(body.reason).toBe('Correct the missed inspection step.');
    authoritative = { ...authoritative, status: 'in_progress', version: 10, repair_revision: 5, submitted_revision: null, completed_at: null };
    addEvent(body.ctx.request_id, 'transition_work_order', 'in_progress', 5, body.reason, { from_status: 'completed' });
    return fulfill(route, 200, { data: authoritative, version: authoritative.version, request_id: body.ctx.request_id });
  });
  await page.route(`${origin}/rest/v1/rpc/declare_work_order_performers`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; id: string; user_ids: string[] };
    writes.push({ name: 'declare_work_order_performers', body: body as unknown as Record<string, unknown> });
    expect(body.ctx.expected_version).toBe(10);
    expect(body.id).toBe(workOrderId);
    expect(body.user_ids).toEqual([fixtureUserId]);
    authoritative = { ...authoritative, version: 11 };
    addEvent(body.ctx.request_id, 'declare_work_order_performers', 'in_progress', 5, null, { from_status: 'in_progress', performer_ids: [fixtureUserId] });
    declarations.push({ id: '00000000-0000-4000-8000-000000000201', organization_id: fixtureOrganizationIds.alpha, work_order_id: workOrderId, user_id: fixtureUserId, declared_by: fixtureUserId, request_id: body.ctx.request_id, repair_revision: 5, created_at: '2026-10-23T02:01:00.000Z' });
    return fulfill(route, 200, { data: authoritative, version: authoritative.version, request_id: body.ctx.request_id });
  });
  await page.route(`${origin}/rest/v1/rpc/submit_work_order`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; id: string; acknowledgment: string };
    writes.push({ name: 'submit_work_order', body: body as unknown as Record<string, unknown> });
    expect(body.ctx.expected_version).toBe(11);
    expect(body.id).toBe(workOrderId);
    expect(body.acknowledgment).toBe('I confirm the declared performers and current repair record are ready for review.');
    authoritative = { ...authoritative, status: 'awaiting_review', version: 12, submitted_revision: 5 };
    addEvent(body.ctx.request_id, 'submit_work_order', 'awaiting_review', 5, null, { from_status: 'in_progress' });
    attestations.push({ id: '00000000-0000-4000-8000-000000000202', organization_id: fixtureOrganizationIds.alpha, work_order_id: workOrderId, actor_id: fixtureUserId, request_id: body.ctx.request_id, repair_revision: 5, performer_ids: [fixtureUserId], acknowledgment: body.acknowledgment, created_at: '2026-10-23T02:02:00.000Z' });
    return fulfill(route, 200, { data: authoritative, version: authoritative.version, request_id: body.ctx.request_id });
  });

  await page.goto(`/work-orders?workOrder=${workOrderId}`);
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await expect(details.locator('.record-header .state-badge')).toHaveText('completed');
  await details.getByLabel('Reason for block, resume, reopen or cancellation').fill('Correct the missed inspection step.');
  await details.getByRole('button', { name: 'Reopen for correction' }).click();
  await expect(details.locator('.record-header .state-badge')).toHaveText('in progress');
  const revision = details.locator('.detail-grid div').filter({ hasText: 'Material revision' });
  await expect(revision).toContainText('5');
  await expect(revision).not.toContainText('submitted');
  await expect(details.getByRole('heading', { name: 'Performers and submission' })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Approve repair' })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Submit repair for review' })).toBeDisabled();

  await details.getByRole('checkbox', { name: new RegExp(fixtureUserId) }).check();
  await details.getByRole('button', { name: 'Declare performers' }).click();
  await expect(details.getByRole('button', { name: 'Submit repair for review' })).toBeEnabled();
  await details.getByLabel('Submission attestation').fill('I confirm the declared performers and current repair record are ready for review.');
  await details.getByRole('button', { name: 'Submit repair for review' }).click();
  await expect(details.locator('.record-header .state-badge')).toHaveText('awaiting review');
  await expect(revision).toContainText('5 · submitted 5');
  await expect(details.getByText('Your account participated in this work order and cannot review it, even if your assignment has since changed.')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Approve repair' })).toHaveCount(0);
  expect(writes.map((write) => write.name)).toEqual(['transition_work_order', 'declare_work_order_performers', 'submit_work_order']);
});

test('a lost direct-create response retries the same immutable request body and keeps fields locked', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('select') === 'id,code,name,created_at,archived_at') return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', created_at: '2026-10-21T01:00:00.000Z', archived_at: null }]);
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
  await expect(form.getByLabel('Asset', { exact: true })).toBeEnabled();
  await form.getByLabel('Asset', { exact: true }).selectOption(assetId);
  await form.getByLabel('Title').fill('Inspect pump coupling');
  await form.getByLabel('Description').fill('Check alignment and document the reading.');
  await form.getByLabel('Category').fill('inspection');
  await form.getByRole('button', { name: 'Create work order', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Retry exact create' })).toBeVisible();
  await expect(form.getByLabel('Title')).toBeDisabled();
  await expect(form.getByLabel('Description')).toBeDisabled();
  await expect(form.getByLabel('Category')).toBeDisabled();
  await expect(form.getByLabel('Priority')).toBeDisabled();
  await expect(form.getByLabel('Asset', { exact: true })).toBeDisabled();
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

test('critical direct work orders require an audit reason and keep unavailable-status guidance visible', async ({ page }) => {
  await prepareWorkspacePage(page);
  const createdId = '7a4d07e1-30a0-44ef-9668-88301f106027';
  const created = row(createdId, { number: 77, title: 'Inspect hot pump', priority: 'critical', priority_reason: 'Bearing temperature exceeded the recorded limit.' });
  const legacy = { ...created };
  delete (legacy as Partial<typeof created>).repair_revision;
  delete (legacy as Partial<typeof created>).submitted_revision;
  delete (legacy as Partial<typeof created>).opened_at;
  delete (legacy as Partial<typeof created>).completed_at;
  delete (legacy as Partial<typeof created>).priority_reason;
  await page.route(/\/rest\/v1\/assets(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('select') === 'id,code,name,created_at,archived_at') return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', created_at: '2026-10-21T01:00:00.000Z', archived_at: null }]);
    if (query.get('select') === 'id,code,name,archived_at') return fulfill(route, 200, [{ id: assetId, code: 'ALPHA-01', name: 'Alpha pump', archived_at: null }]);
    return fulfill(route, 200, [{ ...assetRecord(assetId, 'Alpha pump'), availability: 'out_of_service' }]);
  });
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    return fulfill(route, 200, query.get('id') === `eq.${createdId}` ? created : []);
  });
  const createBodies: Record<string, unknown>[] = [];
  await page.route(`${origin}/rest/v1/rpc/create_work_order`, async (route) => {
    const createBody = route.request().postDataJSON() as Record<string, unknown>;
    createBodies.push(createBody);
    const requestId = (createBody.ctx as { request_id: string }).request_id;
    return fulfill(route, 200, { data: legacy, version: 1, request_id: requestId });
  });

  await page.goto('/work-orders');
  await page.getByRole('button', { name: 'Create work order' }).click();
  const form = page.getByRole('region', { name: 'Create a work order' });
  await expect(form.getByLabel('Asset', { exact: true })).toBeEnabled();
  await form.getByLabel('Asset', { exact: true }).selectOption(assetId);
  await form.getByLabel('Title').fill('Inspect hot pump');
  await form.getByLabel('Description').fill('Investigate the unusually high bearing temperature.');
  await form.getByLabel('Category').fill('pump');
  await form.getByLabel('Priority').selectOption('critical');
  const reason = form.getByLabel('Critical priority reason');
  await expect(reason).toBeVisible();
  await expect(form.getByText(/does not change asset availability/)).toBeVisible();
  await reason.fill('Bearing temperature exceeded the recorded limit.');
  await form.getByRole('button', { name: 'Create work order', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inspect hot pump' })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  const fields = createBodies[0]!.fields as Record<string, unknown>;
  expect(fields.priority).toBe('critical');
  expect(fields.critical_reason).toBe('Bearing temperature exceeded the recorded limit.');
});
