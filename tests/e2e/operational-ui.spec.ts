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

test('work-order details keep an active assignment after more than 100 historical rows', async ({ page }) => {
  await prepareWorkspacePage(page);
  const technicianId = '8fa52100-28a7-4d2a-a49e-4aa73b7e9264';
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    return fulfill(route, 200, url.searchParams.get('id') === `eq.${oldWorkOrderId}` ? row(oldWorkOrderId) : []);
  });
  await page.route(`${origin}/rest/v1/rpc/get_team`, async (route) => fulfill(route, 200, [
    { user_id: fixtureUserId, role: 'owner', active: true, version: 1 },
    { user_id: technicianId, role: 'technician', active: true, version: 1 },
  ]));
  const historical = Array.from({ length: 101 }, (_, index) => ({
    user_id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    unassigned_at: '2026-10-22T01:00:00.000Z',
  }));
  const active = { user_id: technicianId, unassigned_at: null };
  let assignmentQuery: URLSearchParams | undefined;
  await page.route(/\/rest\/v1\/work_order_assignments(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    assignmentQuery = url.searchParams;
    expect(url.searchParams.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(url.searchParams.get('work_order_id')).toBe(`eq.${oldWorkOrderId}`);
    const matchingRows = url.searchParams.get('unassigned_at') === 'is.null' ? [active] : [...historical, active];
    return fulfill(route, 200, matchingRows.slice(0, 100));
  });

  await page.goto(`/work-orders?workOrder=${oldWorkOrderId}`);
  const details = page.getByRole('region', { name: 'Selected work order details' });
  await expect(details.locator('.assigned-list').getByText(technicianId, { exact: true })).toBeVisible();
  expect(assignmentQuery?.get('unassigned_at')).toBe('is.null');
  expect(assignmentQuery?.get('limit')).toBe('30');
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
  const exactTargetQueries: string[] = [];
  await page.route(/\/rest\/v1\/maintenance_requests(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      const requestHeaders = route.request().headers();
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': requestHeaders['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
      } });
    }
    if (route.request().method() === 'HEAD') {
      const statusFilter = url.searchParams.get('status');
      const statuses = statusFilter?.startsWith('in.(') ? statusFilter.slice(4, -1).split(',') : statusFilter?.startsWith('eq.') ? [statusFilter.slice(3)] : null;
      const count = !statuses || statuses.includes(oldRequest.status) ? 1 : 0;
      const requestHeaders = route.request().headers();
      return route.fulfill({ status: 200, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': requestHeaders['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
        'access-control-expose-headers': 'content-range', 'content-range': `*/${count}`,
      }, body: '' });
    }
    if (url.searchParams.get('id') === `eq.${oldRequestId}`) {
      exactTargetQueries.push(url.searchParams.get('id')!);
      return fulfill(route, 200, oldRequest);
    }
    return fulfill(route, 200, []);
  });
  await page.route(/\/rest\/v1\/attachments(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(query.get('request_id')).toBe(`eq.${oldRequestId}`);
    expect(query.get('status')).toBe('eq.ready');
    return fulfill(route, 200, []);
  });
  await page.goto(`/requests?request=${oldRequestId}`);
  const details = page.getByRole('region', { name: 'Selected request details' });
  await expect(details.getByRole('heading', { name: 'Older request outside the newest list page.', exact: true })).toBeVisible();
  expect(exactTargetQueries).toContain(`eq.${oldRequestId}`);
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
  let failAssetSearch = false;
  let allowAssetSearchRecovery = false;
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
    if (failAssetSearch && !allowAssetSearchRecovery && filter.includes('.ilike.')) {
      return fulfill(route, 403, { message: 'FORBIDDEN' });
    }
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
  const displayedCodes = await tableRows.locator('td:first-child small').allTextContents();
  expect(displayedCodes).toEqual([...records].sort((left, right) => right.id.localeCompare(left.id)).map((asset) => asset.code));
  expect(new Set(displayedCodes).size).toBe(101);
  expect(assetRequests.filter((request) => request.searchParams.get('or')?.includes('created_at.eq.')).length).toBeGreaterThanOrEqual(4);
  expect(assetRequests[0]!.searchParams.get('order')).toBe('created_at.desc,id.desc');

  await page.getByLabel('Search assets').fill(oldest.code);
  await expect(tableRows).toHaveCount(1);
  await expect(tableRows.first()).toContainText(oldest.name);
  expect(assetRequests.some((request) => request.searchParams.get('or')?.includes(`code.ilike.%${oldest.code}%`))).toBe(true);

  const assetSearch = page.getByLabel('Search assets');
  await assetSearch.fill('NO-MATCH-ON-PURPOSE');
  await expect(page.getByText('No assets match your search.', { exact: true })).toBeVisible();
  await expect(assetSearch).toBeVisible();
  await assetSearch.fill('');
  await expect(tableRows).toHaveCount(101);
  failAssetSearch = true;
  await assetSearch.fill('ASSET-002');
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load these records.' })).toBeVisible();
  await expect(assetSearch).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(assetSearch).toHaveValue('');
  await expect(tableRows).toHaveCount(101);
  await assetSearch.fill('ASSET-003');
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load these records.' })).toBeVisible();
  await expect(assetSearch).toHaveValue('ASSET-003');
  allowAssetSearchRecovery = true;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(tableRows).toHaveCount(1);
  await expect(tableRows.first()).toContainText('ASSET-003');

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
  await expect(details.locator('.asset-record-heading .state-badge')).toHaveText('operational');
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
  await page.getByRole('button', { name: 'Alpha fan ALPHA-02', exact: true }).click();
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
  await details.getByText('QR identity and print label', { exact: true }).click();
  const identity = details.locator('details.asset-identity');
  await expect(identity.getByRole('img', { name: 'QR code for Alpha pump' })).toHaveAttribute('src', /^data:image\/gif;base64,/);
  await expect(identity.getByRole('link', { name: 'Open asset route' })).toHaveAttribute('href', `${new URL(page.url()).origin}/assets?asset=${assetId}`);
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

test('asset controls page current holds so an older unresolved hold remains reachable', async ({ page }) => {
  await prepareWorkspacePage(page);
  const makeHold = (index: number, resolved: boolean) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, work_order_id: null, source: 'manual', source_id: null,
    reason: resolved ? `Synthetic resolved hold ${index}` : 'Older unresolved safety hold', created_by: fixtureUserId,
    created_at: resolved ? new Date(Date.UTC(2026, 9, 23 - index % 20)).toISOString() : '2020-01-01T00:00:00.000Z',
    resolved_at: resolved ? '2026-10-22T00:00:00.000Z' : null, resolution: resolved ? 'repaired: recorded check' : null,
    resolved_by: resolved ? fixtureUserId : null, released_at: null,
  });
  let holds = [...Array.from({ length: 100 }, (_, index) => makeHold(index + 1, true)), makeHold(101, false)];
  let resolutionWrites = 0;
  await page.route(/\/rest\/v1\/(asset_holds|asset_releases|asset_meter_readings|work_orders|work_order_reviews|work_order_participants|attachments)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').at(-1);
    if (table === 'asset_holds') {
      const query = url.searchParams;
      expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
      expect(query.get('asset_id')).toBe(`eq.${assetId}`);
      let rows = holds;
      if (query.get('released_at') === 'is.null') rows = rows.filter((hold) => hold.released_at === null);
      const cursor = query.get('id')?.startsWith('gt.') ? query.get('id')!.slice(3) : null;
      if (cursor) rows = rows.filter((hold) => hold.id > cursor);
      if (query.get('order')?.startsWith('id.asc')) rows = [...rows].sort((left, right) => left.id.localeCompare(right.id));
      else rows = [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at));
      return fulfill(route, 200, rows.slice(0, Number(query.get('limit') ?? '100')));
    }
    return fulfill(route, 200, []);
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));
  await page.route(`${origin}/rest/v1/rpc/resolve_asset_hold`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { expected_version: number; request_id: string }; hold_id: string; disposition: string; reason: string };
    expect(body.ctx.expected_version).toBe(1);
    expect(body.hold_id).toBe(holds.at(-1)!.id);
    expect(body.disposition).toBe('repaired');
    resolutionWrites++;
    const updated = { ...holds.at(-1)!, resolved_at: '2026-10-24T01:00:00.000Z', resolution: `repaired: ${body.reason}`, resolved_by: fixtureUserId };
    holds = [...holds.slice(0, -1), updated];
    return fulfill(route, 200, { data: updated, version: 2, request_id: body.ctx.request_id });
  });

  await page.goto(`/assets?asset=${assetId}`);
  const details = page.getByRole('region', { name: 'Selected asset details' });
  const operations = details.getByRole('region', { name: /Operational details for/ });
  const releaseButton = operations.getByRole('button', { name: 'Record asset release' });
  await expect(releaseButton).toBeDisabled();
  await expect(operations.getByLabel('Release acknowledgment')).toBeDisabled();
  await expect(operations.getByText('Every active hold must be resolved', { exact: false })).toBeVisible();
  await operations.getByRole('button', { name: 'Load more unreleased holds' }).click();
  await expect(operations.getByText('Older unresolved safety hold', { exact: true })).toBeVisible();
  await operations.getByLabel('Resolution reason').fill('The recorded safety check cleared the hold.');
  await operations.getByRole('button', { name: 'Resolve repaired hold' }).click();
  const olderHold = operations.locator('.record-card').filter({ hasText: 'Older unresolved safety hold' });
  await expect(olderHold.getByText('Resolved · awaiting release', { exact: true })).toBeVisible();
  await operations.getByLabel('Release acknowledgment').fill('Reviewed the current asset condition and all recorded checks.');
  await expect(releaseButton).toBeEnabled();
  expect(resolutionWrites).toBe(1);
});

test('asset release eligibility stays unknown when the second hold page fails', async ({ page }) => {
  await prepareWorkspacePage(page);
  const holds = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, work_order_id: null, source: 'manual', source_id: null,
    reason: `Synthetic resolved hold ${index + 1}`, created_by: fixtureUserId, created_at: `2026-10-${String(index % 20 + 1).padStart(2, '0')}T00:00:00.000Z`,
    resolved_at: '2026-10-22T00:00:00.000Z', resolution: 'repaired: recorded check', resolved_by: fixtureUserId, released_at: null,
  }));
  let eligibilityContinuationPages = 0;
  await page.route(/\/rest\/v1\/(asset_holds|asset_releases|asset_meter_readings|work_orders|work_order_reviews|work_order_participants|attachments)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').at(-1);
    if (table !== 'asset_holds') return fulfill(route, 200, []);
    const query = url.searchParams;
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(query.get('asset_id')).toBe(`eq.${assetId}`);
    if (query.get('id')?.startsWith('gt.')) {
      if (query.get('limit') === '100') eligibilityContinuationPages++;
      return fulfill(route, 503, { message: 'Synthetic second hold page unavailable.' });
    }
    return fulfill(route, 200, holds.slice(0, Number(query.get('limit') ?? '100')));
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));

  await page.goto(`/assets?asset=${assetId}`);
  const operations = page.getByRole('region', { name: /Operational details for/ });
  await expect(operations.getByLabel('Release acknowledgment')).toBeDisabled();
  await expect(operations.getByText('Release eligibility is unknown', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(eligibilityContinuationPages).toBeGreaterThan(0);
  await expect(operations.getByRole('button', { name: 'Record asset release' })).toBeDisabled();
  await expect(operations.getByRole('button', { name: 'Retry release checks' })).toBeVisible();
});

test('asset release eligibility checks beyond an exact full hold page', async ({ page }) => {
  await prepareWorkspacePage(page);
  const holds = Array.from({ length: 100 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    organization_id: fixtureOrganizationIds.alpha, asset_id: assetId, work_order_id: null, source: 'manual', source_id: null,
    reason: `Synthetic resolved hold ${index + 1}`, created_by: fixtureUserId, created_at: `2026-10-${String(index % 20 + 1).padStart(2, '0')}T00:00:00.000Z`,
    resolved_at: '2026-10-22T00:00:00.000Z', resolution: 'repaired: recorded check', resolved_by: fixtureUserId, released_at: null,
  }));
  let continuationPages = 0;
  await page.route(/\/rest\/v1\/(asset_holds|asset_releases|asset_meter_readings|work_orders|work_order_reviews|work_order_participants|attachments)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.split('/').at(-1) !== 'asset_holds') return fulfill(route, 200, []);
    const query = url.searchParams;
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(query.get('asset_id')).toBe(`eq.${assetId}`);
    expect(query.get('released_at')).toBe('is.null');
    if (query.get('id')?.startsWith('gt.')) { continuationPages++; return fulfill(route, 200, []); }
    return fulfill(route, 200, holds);
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));

  await page.goto(`/assets?asset=${assetId}`);
  const operations = page.getByRole('region', { name: /Operational details for/ });
  await operations.getByLabel('Release acknowledgment').fill('Reviewed the current asset condition and all recorded checks.');
  await expect(operations.getByText('Release eligibility checks passed', { exact: false })).toBeVisible();
  await expect(operations.getByRole('button', { name: 'Record asset release' })).toBeEnabled();
  expect(continuationPages).toBe(1);
});

test('release checks use the current repair approval and only the signed-in participant', async ({ page }) => {
  await prepareWorkspacePage(page);
  const workOrderId = 'ddc5f0e6-35b8-4e96-bd4d-97a70bd4db01';
  const hold = {
    id: '00000000-0000-4000-8000-000000000101', organization_id: fixtureOrganizationIds.alpha, asset_id: assetId,
    work_order_id: workOrderId, source: 'work_order', source_id: null, reason: 'Accepted blocking repair hold.', created_by: fixtureUserId,
    created_at: '2026-10-20T00:00:00.000Z', resolved_at: null, resolution: null, resolved_by: null, released_at: null,
  };
  const workOrder = row(workOrderId, { status: 'completed', blocks_operation: false, repair_revision: 2 });
  const currentApproval = {
    id: '00000000-0000-4000-8000-000000000201', organization_id: fixtureOrganizationIds.alpha, work_order_id: workOrderId,
    reviewer_id: '9e639e5d-20a8-4363-ad22-55d5911ce75b', repair_revision: 2, decision: 'approved', reason: 'Current repair verified.', created_at: '2024-01-01T00:00:00.000Z',
  };
  const olderReviews = Array.from({ length: 100 }, (_, index) => ({
    ...currentApproval, id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    repair_revision: 1, decision: 'returned', reason: 'Earlier revision review.', created_at: `2026-10-${String(index % 20 + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
  let participants: { work_order_id: string; user_id: string }[] = [];
  await page.route(/\/rest\/v1\/(asset_holds|asset_releases|asset_meter_readings|work_orders|work_order_reviews|work_order_participants|attachments)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').at(-1);
    const query = url.searchParams;
    if (table === 'asset_holds') return fulfill(route, 200, [hold]);
    if (table === 'work_orders') {
      expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
      expect(query.get('asset_id')).toBe(`eq.${assetId}`);
      if (query.has('blocks_operation')) {
        expect(query.get('blocks_operation')).toBe('eq.true');
        expect(query.get('status')).toBe('in.(open,scheduled,in_progress,blocked,awaiting_review)');
        expect(query.get('limit')).toBe('1');
        return fulfill(route, 200, []);
      }
      const columns = query.get('select')?.split(',') ?? [];
      return fulfill(route, 200, [columns.includes('*') ? workOrder : Object.fromEntries(columns.map((column) => [column, workOrder[column as keyof typeof workOrder]]))]);
    }
    if (table === 'work_order_reviews') {
      if (query.has('or')) {
        const filter = query.get('or')!;
        expect(filter).toContain(`work_order_id.eq.${workOrderId}`);
        expect(filter).toContain('repair_revision.eq.2');
        return fulfill(route, 200, [currentApproval]);
      }
      return fulfill(route, 200, olderReviews.slice(0, 100));
    }
    if (table === 'work_order_participants') {
      expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
      expect(query.get('user_id')).toBe(`eq.${fixtureUserId}`);
      expect(query.get('work_order_id')).toBe(`in.(${workOrderId})`);
      return fulfill(route, 200, participants);
    }
    return fulfill(route, 200, []);
  });
  await page.route(`${origin}/rest/v1/rpc/get_asset_history`, async (route) => fulfill(route, 200, { items: [], next_cursor: null }));

  await page.goto(`/assets?asset=${assetId}`);
  const operations = page.getByRole('region', { name: /Operational details for/ });
  await operations.getByLabel('Release acknowledgment').fill('Reviewed the completed repair and current approval.');
  const releaseButton = operations.getByRole('button', { name: 'Record asset release' });
  await expect(operations.getByText('Release eligibility checks passed', { exact: false })).toBeVisible();
  await expect(releaseButton).toBeEnabled();

  participants = [{ work_order_id: workOrderId, user_id: fixtureUserId }];
  await page.reload();
  const refreshedOperations = page.getByRole('region', { name: /Operational details for/ });
  await expect(refreshedOperations.getByText('Your account participated in work covered by an unreleased hold.', { exact: false })).toBeVisible();
  await expect(refreshedOperations.getByRole('button', { name: 'Record asset release' })).toBeDisabled();
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
    const readFilter = query.get('read_at');
    const categoryFilter = query.get('category');
    const matching = rows.filter((item) =>
      (!readFilter || readFilter === 'is.null' && item.read_at === null || readFilter === 'not.is.null' && item.read_at !== null)
      && (!categoryFilter || categoryFilter === `eq.${item.category}`));
    return fulfill(route, 200, matching.slice(0, 100));
  });
  await page.route(`${origin}/rest/v1/rpc/mark_notifications_read`, async (route) => {
    const body = route.request().postDataJSON() as { ctx: { request_id: string }; ids: string[] };
    writes.push(body as unknown as Record<string, unknown>);
    rows = rows.map((item) => body.ids.includes(item.id) ? { ...item, read_at: item.read_at ?? '2026-10-23T01:01:00.000Z' } : item);
    if (writes.length === 1) return fulfill(route, 503, { message: 'Response lost after read state committed.' });
    return fulfill(route, 200, { data: { id: notificationId, marked: true }, version: 1, request_id: body.ctx.request_id });
  });
  await page.goto('/notifications');
  await page.getByRole('tab', { name: 'Unread', exact: true }).click();
  const details = page.getByRole('region', { name: 'Selected notification' });
  await expect(details.getByRole('heading', { name: 'assignment', exact: true })).toBeVisible();
  await expect(details.getByRole('link', { name: 'Open current record' })).toHaveAttribute('href', `/work-orders?workOrder=${workOrderId}`);
  await details.getByRole('button', { name: 'Mark as read' }).click();
  await expect(details.getByRole('button', { name: 'Retry mark as read' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(details.getByRole('heading', { name: 'assignment', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Retry mark as read' })).toBeVisible();
  await details.getByRole('button', { name: 'Retry mark as read' }).click();
  await expect(page.getByText('Notification marked as read.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test('notification unread filters and equal-time cursors reach rows beyond the API cap', async ({ page }) => {
  await prepareWorkspacePage(page);
  const rowId = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
  const oldWorkOrderId = '82f19111-b19a-4ca2-a720-3958cc0814ab';
  const createdAt = '2026-10-23T01:00:00.000Z';
  const olderUnread = {
    id: rowId(1), organization_id: fixtureOrganizationIds.alpha, recipient_user_id: fixtureUserId, category: 'assignment',
    source_id: oldWorkOrderId, event_id: rowId(6001), created_at: createdAt, read_at: null as string | null,
  };
  const records = [
    ...Array.from({ length: 100 }, (_, index) => ({
      id: rowId(101 - index), organization_id: fixtureOrganizationIds.alpha, recipient_user_id: fixtureUserId,
      category: index === 0 ? 'assignment' : 'other', source_id: rowId(6100 + index), event_id: rowId(6200 + index),
      created_at: createdAt, read_at: '2026-10-23T01:30:00.000Z' as string | null,
    })),
    olderUnread,
  ];
  const requests: URL[] = [];
  await page.route(/\/rest\/v1\/notifications(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(new URL(route.request().url()));
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(query.get('recipient_user_id')).toBe(`eq.${fixtureUserId}`);
    expect(query.get('limit')).toBe('100');
    const readAt = query.get('read_at');
    const category = query.get('category');
    const cursor = query.get('or');
    const createdBefore = cursor?.match(/created_at\.lt\.([^,]+)/)?.[1];
    const cursorId = cursor?.match(/id\.lt\.([0-9a-f-]{36})/i)?.[1];
    const matching = records.filter((item) =>
      (!readAt || readAt === 'is.null' && item.read_at === null || readAt === 'not.is.null' && item.read_at !== null)
      && (!category || category === `eq.${item.category}`)
      && (!createdBefore || item.created_at < createdBefore || item.created_at === createdBefore && Boolean(cursorId && item.id < cursorId)))
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
    const limit = Math.max(1, Number(query.get('limit')) || 100);
    return fulfill(route, 200, matching.slice(0, Math.min(limit, 100)));
  });

  await page.goto('/notifications');
  const inbox = page.getByRole('region', { name: 'Your notifications' });
  await expect(inbox.getByRole('listitem')).toHaveCount(100);
  await page.getByRole('tab', { name: 'Unread', exact: true }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(requests.at(-1)?.searchParams.get('read_at')).toBe('is.null');
  const details = page.getByRole('region', { name: 'Selected notification' });
  await expect(details.getByRole('heading', { name: 'assignment', exact: true })).toBeVisible();
  await details.locator('.notification-identifiers summary').click();
  await expect(details.getByText(olderUnread.id, { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Load older notifications', exact: true }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(101);
  expect(requests.at(-1)?.searchParams.get('or')).toContain(`created_at.eq.${createdAt}`);
  expect(requests.at(-1)?.searchParams.get('or')).toContain(`id.lt.${rowId(2)}`);

  await page.getByRole('tab', { name: 'assignment', exact: true }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'other', exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('category')).toBe('eq.assignment');
  await inbox.locator('.notification-select').filter({ hasText: oldWorkOrderId }).click();
  await expect(details.getByRole('heading', { name: 'assignment', exact: true })).toBeVisible();
  await details.locator('.notification-identifiers summary').click();
  await expect(details.getByText(olderUnread.id, { exact: true })).toBeVisible();
});

test('dashboard totals precede the attention queue and link to exact blocked, overdue and review work', async ({ page }) => {
  await prepareWorkspacePage(page);
  await page.clock.install({ time: new Date('2026-10-23T06:00:00.000Z') });
  const blockedId = '5ce7c180-d3d6-4a67-95d7-40549d049aea';
  const reviewId = '5b8dc2dd-bb42-4cd2-a53f-3ad2cb31ff5f';
  const overdueId = 'fe8b7a76-a617-49d8-86c7-4fffb1f123f3';
  const dueLaterTodayId = 'f6c4a89d-859a-4b26-90fd-a4e1c10a7c8d';
  const workOrder = (id: string, number: number, status: string, due_at: string | null) => ({ id, number, asset_id: assetId, supervisor_id: fixtureUserId, title: `Synthetic ${status} work`, status, priority: 'high', due_at, created_at: '2026-10-22T00:00:00.000Z' });
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
  const blockedRow = queue.getByRole('row').filter({ hasText: 'Synthetic blocked work' });
  const reviewRow = queue.getByRole('row').filter({ hasText: 'Synthetic awaiting_review work' });
  const overdueRow = queue.getByRole('row').filter({ hasText: 'Synthetic in_progress work' });
  await expect(blockedRow.getByRole('link', { name: 'WO-0051', exact: true })).toHaveAttribute('href', `/work-orders?workOrder=${blockedId}`);
  await expect(reviewRow.getByRole('link', { name: 'WO-0052', exact: true })).toHaveAttribute('href', `/work-orders?workOrder=${reviewId}`);
  await expect(overdueRow.getByRole('link', { name: 'WO-0053', exact: true })).toHaveAttribute('href', `/work-orders?workOrder=${overdueId}`);
  await expect(queue.getByRole('link', { name: /WO-0054/ })).toHaveCount(0);
  const order = await page.locator('main').evaluate((main) => {
    const counts = main.querySelector('.dashboard-counts');
    const queue = main.querySelector('section[aria-labelledby="attention-queue-title"]');
    const countsPosition = counts && queue ? counts.compareDocumentPosition(queue) : 0;
    return Boolean(countsPosition & Node.DOCUMENT_POSITION_FOLLOWING);
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
    { id: 'cc6d8d1e-c756-4bb8-9896-89834145d6b1', user_id: technicianId, work_order_id: workOrderId },
  ]));
  await page.route(/\/rest\/v1\/work_orders(?:\?.*)?$/, async (route) => fulfill(route, 200, [{ id: workOrderId, number: 73, title: 'Synthetic assignment', status: 'in_progress' }]));
  await page.goto('/team');
  const workload = page.getByRole('region', { name: 'Assigned workload' });
  await expect(workload.getByRole('region', { name: 'Team totals' }).getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workspace members', exact: true })).toBeVisible();
  const order = await page.locator('main').evaluate((main) => {
    const workload = main.querySelector('.team-workload');
    const roster = main.querySelector('#team-roster-title');
    const workloadPosition = workload && roster ? workload.compareDocumentPosition(roster) : 0;
    return Boolean(workloadPosition & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

test('owner roster reaches active members after a full inactive history page', async ({ page }) => {
  await prepareWorkspacePage(page);
  const lateMemberId = 'f0000000-0000-4000-8000-000000000001';
  const inactive = Array.from({ length: 101 }, (_, index) => ({
    organization_id: fixtureOrganizationIds.alpha,
    user_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    role: 'technician', active: false, created_at: `2020-01-${String(index % 28 + 1).padStart(2, '0')}T00:00:00.000Z`, version: 1,
  }));
  const memberships = [
    ...inactive,
    { organization_id: fixtureOrganizationIds.alpha, user_id: fixtureUserId, role: 'owner', active: true, created_at: '2026-10-21T00:00:00.000Z', version: 1 },
    { organization_id: fixtureOrganizationIds.alpha, user_id: lateMemberId, role: 'technician', active: true, created_at: '2026-10-23T00:00:00.000Z', version: 1 },
  ];
  await page.route(/\/rest\/v1\/organization_members(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('select') === 'organization_id,role,active' && query.get('user_id') === `eq.${fixtureUserId}`) {
      return fulfill(route, 200, memberships.filter((member) => member.user_id === fixtureUserId).map(({ organization_id, role, active }) => ({ organization_id, role, active })));
    }
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    let rows = memberships;
    const activeFilter = query.get('active');
    if (activeFilter) rows = rows.filter((member) => member.active === (activeFilter === 'eq.true'));
    const cursor = query.get('user_id')?.startsWith('gt.') ? query.get('user_id')!.slice(3) : null;
    if (cursor) rows = rows.filter((member) => member.user_id > cursor);
    if (query.get('order') === 'created_at.asc') rows = [...rows].sort((left, right) => left.created_at.localeCompare(right.created_at));
    else rows = [...rows].sort((left, right) => left.user_id.localeCompare(right.user_id));
    return fulfill(route, 200, rows.slice(0, Number(query.get('limit') ?? '100')));
  });
  await page.route(/\/rest\/v1\/organization_invitations(?:\?.*)?$/, async (route) => fulfill(route, 200, []));

  await page.goto('/team');
  await page.getByRole('tab', { name: 'Members', exact: true }).click();
  for (const [memberId, action] of [[lateMemberId, 'Deactivate'], [inactive.at(-1)!.user_id, 'Reactivate']] as const) {
    const memberRow = page.locator('tr').filter({ has: page.locator(`summary[title="${memberId}"]`) });
    await expect(memberRow).toBeVisible();
    await memberRow.locator('summary[title]').click();
    await expect(memberRow.getByText(memberId, { exact: true })).toBeVisible();
    await expect(memberRow.getByRole('button', { name: action })).toBeVisible();
  }
});

test('owner invitations retain older pending records after closed rows are filtered', async ({ page }) => {
  await prepareWorkspacePage(page);
  const olderPendingId = '00000000-0000-4000-8000-000000000001';
  const closed = Array.from({ length: 100 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    organization_id: fixtureOrganizationIds.alpha, email: `closed-${index}@example.test`, role: 'technician', inviter_id: fixtureUserId,
    expires_at: '2026-11-01T00:00:00.000Z', accepted_at: index % 2 ? null : '2026-10-20T00:00:00.000Z',
    revoked_at: index % 2 ? '2026-10-20T00:00:00.000Z' : null, created_at: `2026-10-${String(20 - index % 10).padStart(2, '0')}T00:00:00.000Z`, version: 1,
  }));
  const pending = {
    id: olderPendingId, organization_id: fixtureOrganizationIds.alpha, email: 'older-pending@example.test', role: 'technician', inviter_id: fixtureUserId,
    expires_at: '2026-11-01T00:00:00.000Z', accepted_at: null, revoked_at: null, created_at: '2025-01-01T00:00:00.000Z', version: 1,
  };
  const invitations = [...closed, pending];
  await page.route(/\/rest\/v1\/organization_members(?:\?.*)?$/, async (route) => fulfill(route, 200, [{ organization_id: fixtureOrganizationIds.alpha, user_id: fixtureUserId, role: 'owner', active: true, created_at: '2026-10-21T00:00:00.000Z', version: 1 }]));
  await page.route(/\/rest\/v1\/organization_invitations(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('organization_id')).toBe(`eq.${fixtureOrganizationIds.alpha}`);
    expect(query.get('accepted_at')).toBe('is.null');
    expect(query.get('revoked_at')).toBe('is.null');
    let rows = invitations;
    if (query.get('accepted_at') === 'is.null') rows = rows.filter((invitation) => invitation.accepted_at === null);
    if (query.get('revoked_at') === 'is.null') rows = rows.filter((invitation) => invitation.revoked_at === null);
    const cursor = query.get('id')?.startsWith('gt.') ? query.get('id')!.slice(3) : null;
    if (cursor) rows = rows.filter((invitation) => invitation.id > cursor);
    if (query.get('order')?.startsWith('created_at.desc')) rows = [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at));
    else rows = [...rows].sort((left, right) => left.id.localeCompare(right.id));
    return fulfill(route, 200, rows.slice(0, Number(query.get('limit') ?? '100')));
  });

  await page.goto('/team');
  await page.getByRole('tab', { name: 'Members', exact: true }).click();
  const invitationsPanel = page.getByRole('region', { name: 'Invitations' });
  const pendingRow = invitationsPanel.getByRole('row').filter({ hasText: 'older-pending@example.test' });
  await expect(pendingRow).toBeVisible();
  await expect(pendingRow.getByRole('button', { name: 'Revoke' })).toBeVisible();
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
  await details.getByText('Review and route request', { exact: true }).click();
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
  await details.getByLabel('Block or resume reason').fill(reason);
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
  await details.getByLabel('Block or resume reason').fill('Correct the missed inspection step.');
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
