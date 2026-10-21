import type { Page, Route } from '@playwright/test';

export const fixtureUserId = 'f62f89a7-6571-498c-9f92-9019e279dfd5';
export const fixtureOrganizationIds = {
  alpha: '812de877-0151-497a-a13d-2749b0a3d622',
  beta: 'ea7716f6-1118-4e16-a6df-29a5f9f0dbde',
};

const fixtureUser = {
  id: fixtureUserId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'pilot@example.test',
  email_confirmed_at: '2026-10-21T00:00:00.000Z',
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-10-21T00:00:00.000Z',
  updated_at: '2026-10-21T00:00:00.000Z',
  last_sign_in_at: '2026-10-21T00:00:00.000Z',
  factors: [{ id: '48cae719-b951-4661-8004-5613c4c76839', factor_type: 'totp', status: 'verified', friendly_name: 'Test authenticator', created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z' }],
};

const organizations = [
  { id: fixtureOrganizationIds.alpha, name: 'Alpha workspace', currency: 'PHP', timezone: 'Asia/Manila', created_by: fixtureUserId, created_at: '2026-10-21T00:00:00.000Z', version: 1 },
  { id: fixtureOrganizationIds.beta, name: 'Beta workspace', currency: 'USD', timezone: 'UTC', created_by: fixtureUserId, created_at: '2026-10-21T00:00:00.000Z', version: 1 },
];

const assets = [
  { id: 'c2daf4c7-e68c-4783-87c6-26b009a1169d', organization_id: fixtureOrganizationIds.alpha, code: 'ALPHA-01', name: 'Alpha pump', category: 'pump', site_id: null, serial_number: null, registration: null, archived_at: null, created_by: fixtureUserId, created_at: '2026-10-21T01:00:00.000Z', version: 1 },
  { id: '25f68b8a-9711-4c0a-a619-d7a9e4133c38', organization_id: fixtureOrganizationIds.alpha, code: 'ALPHA-02', name: 'Alpha fan', category: 'fan', site_id: null, serial_number: null, registration: null, archived_at: null, created_by: fixtureUserId, created_at: '2026-10-21T02:00:00.000Z', version: 1 },
  { id: 'c3baccc6-29ed-4a97-90e5-febd413bc7c1', organization_id: fixtureOrganizationIds.beta, code: 'BETA-01', name: 'Beta pump', category: 'pump', site_id: null, serial_number: null, registration: null, archived_at: null, created_by: fixtureUserId, created_at: '2026-10-21T03:00:00.000Z', version: 1 },
];

const requests = [
  { id: '2197470a-2980-40f2-89fd-73ac1b7d8ec5', organization_id: fixtureOrganizationIds.alpha, asset_id: assets[0]!.id, reporter_id: fixtureUserId, description: 'Seal inspection requested for pump one.', category: 'inspection', status: 'submitted', transition_reason: null, converted_work_order_id: null, created_at: '2026-10-21T01:00:00.000Z', version: 1 },
  { id: '1bbdb303-ad58-4414-9abf-65e1fe77695c', organization_id: fixtureOrganizationIds.alpha, asset_id: assets[1]!.id, reporter_id: fixtureUserId, description: 'Unusual fan vibration reported.', category: 'vibration', status: 'submitted', transition_reason: null, converted_work_order_id: null, created_at: '2026-10-21T02:00:00.000Z', version: 1 },
  { id: 'a62e87ca-b088-4291-b462-7f83765287ac', organization_id: fixtureOrganizationIds.beta, asset_id: assets[2]!.id, reporter_id: fixtureUserId, description: 'Beta workspace request.', category: 'inspection', status: 'submitted', transition_reason: null, converted_work_order_id: null, created_at: '2026-10-21T03:00:00.000Z', version: 1 },
];

const workOrders = [
  { id: 'abfc36f2-44f3-4c85-b0b5-696e4c6626bf', organization_id: fixtureOrganizationIds.alpha, number: 1, asset_id: assets[0]!.id, source_request_id: requests[0]!.id, title: 'Review pump seal', description: 'Inspect and document the reported seal condition.', category: 'inspection', priority: 'normal', due_at: null, supervisor_id: fixtureUserId, status: 'draft', blocks_operation: false, created_by: fixtureUserId, created_at: '2026-10-21T03:00:00.000Z', version: 1 },
  { id: '7d014e2c-141c-4c6a-8644-5c0e7809d531', organization_id: fixtureOrganizationIds.alpha, number: 2, asset_id: assets[1]!.id, source_request_id: requests[1]!.id, title: 'Check fan vibration', description: 'Review the submitted vibration report.', category: 'vibration', priority: 'high', due_at: null, supervisor_id: fixtureUserId, status: 'draft', blocks_operation: false, created_by: fixtureUserId, created_at: '2026-10-21T04:00:00.000Z', version: 1 },
];

function jwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', role: 'authenticated', sub: fixtureUserId, email: fixtureUser.email, aal: 'aal2', amr: [{ method: 'password', timestamp: now }, { method: 'mfa', timestamp: now }], iat: now, exp: now + 3600 })}.fixture`;
}

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: jwt(), refresh_token: 'fixture-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: fixtureUser };
}

function response(route: Route, status: number, value: unknown) {
  const requestHeaders = route.request().headers();
  return route.fulfill({ status, contentType: 'application/json', headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': requestHeaders['access-control-request-headers'] ?? 'authorization, apikey, x-client-info, content-type, prefer, accept-profile, content-profile',
  }, body: status === 204 ? '' : JSON.stringify(value) });
}

export async function prepareWorkspacePage(page: Page, initialMemberships = [fixtureOrganizationIds.alpha]) {
  let memberships = [...initialMemberships];
  let authUser = fixtureUser;
  let holdIdentityUserLookups = false;
  let onIdentityUserLookup: (() => void) | null = null;
  const heldIdentityUserLookups: (() => void)[] = [];
  let membershipReads = 0;
  const organizationRequests: Record<string, unknown>[] = [];
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return response(route, 204, null);
    if (url.pathname === '/auth/v1/user') {
      if (holdIdentityUserLookups && authUser.id !== fixtureUserId) {
        await new Promise<void>((resolve) => {
          heldIdentityUserLookups.push(resolve);
          onIdentityUserLookup?.();
          onIdentityUserLookup = null;
        });
      }
      return response(route, 200, authUser);
    }
    if (url.pathname === '/rest/v1/organization_members') {
      membershipReads++;
      return response(route, 200, memberships.map((organization_id) => ({ organization_id, user_id: authUser.id, role: 'owner', active: true, created_at: '2026-10-21T00:00:00.000Z', version: 1 })));
    }
    if (url.pathname === '/rest/v1/organizations') return response(route, 200, organizations.filter((organization) => memberships.includes(organization.id)));
    if (url.pathname === '/rest/v1/assets') return response(route, 200, assets.filter((asset) => memberships.includes(asset.organization_id)));
    if (url.pathname === '/rest/v1/maintenance_requests') return response(route, 200, requests.filter((requestRow) => memberships.includes(requestRow.organization_id)));
    if (url.pathname === '/rest/v1/work_orders') return response(route, 200, workOrders.filter((workOrder) => memberships.includes(workOrder.organization_id)));
    if (url.pathname === '/rest/v1/rpc/lookup_request_asset') {
      const body = request.postDataJSON() as { asset_id?: string; asset_code?: string };
      const asset = assets.find((item) => memberships.includes(item.organization_id) && (item.id === body.asset_id || item.code === body.asset_code));
      return response(route, 200, asset ? [{ id: asset.id, code: asset.code, name: asset.name }] : []);
    }
    if (url.pathname === '/rest/v1/rpc/create_organization') {
      const body = request.postDataJSON() as Record<string, unknown>;
      organizationRequests.push(body);
      if (organizationRequests.length === 1) return response(route, 503, { message: 'Service unavailable' });
      memberships = [fixtureOrganizationIds.alpha];
      return response(route, 200, {
        data: {
          id: fixtureOrganizationIds.alpha,
          name: body.name,
          timezone: body.timezone,
          currency: body.currency,
          created_by: fixtureUserId,
          created_at: '2026-10-21T00:00:00.000Z',
          version: 1,
        },
        version: 1,
        request_id: body.request_id,
      });
    }
    return response(route, 404, { message: 'The isolated browser fixture did not define this request.' });
  });
  const savedSession = session();
  await page.addInitScript((value) => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), savedSession);
  return {
    setMemberships: (next: string[]) => { memberships = [...next]; },
    switchToSecondUser: () => {
      authUser = { ...fixtureUser, id: '5d3c9d7e-40a8-4b27-a7d8-e350a66b771b', email: 'second-user@example.test', factors: [] };
      return { id: authUser.id, email: authUser.email };
    },
    holdIdentityUserLookups: () => {
      holdIdentityUserLookups = true;
      let resolveArrival!: () => void;
      const arrived = new Promise<void>((resolve) => { resolveArrival = resolve; });
      onIdentityUserLookup = resolveArrival;
      return {
        arrived,
        release: () => {
          holdIdentityUserLookups = false;
          for (const releaseLookup of heldIdentityUserLookups.splice(0)) releaseLookup();
        },
      };
    },
    membershipReads: () => membershipReads,
    organizationRequests: () => organizationRequests,
  };
}
