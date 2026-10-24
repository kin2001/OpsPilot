import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { saveMaintenancePlan, previewMaintenancePlan, listMaintenancePlans, listMaintenanceRevisions } from './maintenance-client';

const org = '70f7906a-5061-48b6-927c-53e4bc3bdc63';
const id = 'c4a27337-9db2-4128-92db-c62b1e578397';
const requestId = '2b35c8bf-53fb-492d-80d9-2a07b98c12ec';
const fields = { asset_id: id, title: 'Monthly inspection', instructions: 'Inspect belt', category: 'routine', cadence: 'month' as const, frequency: 1, anchor_on: '2024-01-31', supervisor_id: id, assignee_ids: [id], checklist: ['Inspect belt'], status: 'active' as const };
const plan = { id, organization_id: org, asset_id: id, current_revision_id: id, authorized_by: id, status: 'active', generation_blocked: null, last_checked_at: null, created_by: id, created_at: '2026-10-24T00:00:00Z', version: 2 };
function fixture(response: unknown, status = 200) {
  const requests: { url: string; body: unknown }[] = [];
  const client = createClient<Database>('http://127.0.0.1:54321', 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const req = new Request(input, init); requests.push({ url: req.url, body: await req.json() });
    return Response.json(response, { status });
  } } });
  return { client, requests };
}

describe('maintenance client commands and bounded reads', () => {
  it('sends the exact caller-owned retry identity and optimistic version through the named RPC', async () => {
    const f = fixture({ data: plan, version: 2, request_id: requestId });
    expect(await saveMaintenancePlan(f.client, org, { ...fields, id }, requestId, 1)).toEqual(plan);
    expect(f.requests).toEqual([{ url: 'http://127.0.0.1:54321/rest/v1/rpc/save_maintenance_plan', body: { ctx: { organization_id: org, request_id: requestId, expected_version: 1 }, fields: { ...fields, id } } }]);
  });
  it('rejects an edit without a version before any network write', () => {
    const f = fixture({});
    expect(() => saveMaintenancePlan(f.client, org, { ...fields, id }, requestId)).toThrow('VALIDATION');
    expect(f.requests).toEqual([]);
  });
  it('fails closed on malformed or mismatched saved responses and preserves uncertain acknowledgement as unavailable', async () => {
    const f = fixture({ data: plan, version: 2, request_id: id });
    await expect(saveMaintenancePlan(f.client, org, fields, requestId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    const failed = fixture({ message: 'CONFLICT', code: 'P0001' }, 400);
    await expect(saveMaintenancePlan(failed.client, org, { ...fields, id }, requestId, 1)).rejects.toThrow('CONFLICT');
  });
  it('uses read-only preview and rejects malformed cutoff data', async () => {
    const f = fixture({});
    await expect(previewMaintenancePlan(f.client, org, fields)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    expect(f.requests[0]).toEqual({ url: 'http://127.0.0.1:54321/rest/v1/rpc/preview_maintenance_plan', body: { organization_id: org, fields } });
  });
  it('paginates using explicit tenant and stable continuation identities', async () => {
    const f = fixture({ items: [], next_cursor: null });
    expect(await listMaintenancePlans(f.client, org, { cursor: id, page_size: 1 })).toEqual({ items: [], next_cursor: null });
    expect(await listMaintenanceRevisions(f.client, org, id, { cursor: 2 })).toEqual({ items: [], next_cursor: null });
    expect(f.requests.map((r) => r.body)).toEqual([{ organization_id: org, cursor: id, page_size: 1 }, { organization_id: org, plan_id: id, cursor: 2, page_size: 25 }]);
  });
  it('rejects over-bound reads without a request', () => {
    const f = fixture({});
    expect(() => listMaintenancePlans(f.client, org, { page_size: 101 })).toThrow();
    expect(() => listMaintenanceRevisions(f.client, org, id, { cursor: 0 })).toThrow();
    expect(f.requests).toEqual([]);
  });
});
