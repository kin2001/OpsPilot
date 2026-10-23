import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { assignWorkOrder, commandResult, createWorkOrder, declareWorkOrderPerformers, saveAsset, saveRequest, submitWorkOrder, updateWorkOrder } from './commands';

const item = z.strictObject({ id: z.uuid(), name: z.string() });
const requestId = 'e0de249a-e9f0-4bed-932e-4c15bc14b7da';

describe('command response boundary', () => {
  it('parses a typed payload only from the canonical command envelope', () => {
    expect(commandResult({
      data: { id: '7af015af-aadc-44cb-bca9-ffafbd0897d4', name: 'Pump' },
      version: 1,
      request_id: requestId,
    }, item, requestId)).toEqual({ id: '7af015af-aadc-44cb-bca9-ffafbd0897d4', name: 'Pump' });
  });

  it('rejects malformed or mismatched envelopes without leaking response data', () => {
    expect(() => commandResult({ data: { id: 'not-an-id', name: 'Pump' }, version: 1, request_id: requestId }, item, requestId))
      .toThrow('DEPENDENCY_UNAVAILABLE');
    expect(() => commandResult({ data: { id: '7af015af-aadc-44cb-bca9-ffafbd0897d4', name: 'Pump' }, version: 1, request_id: 'f29bbd1c-7fb0-46cb-9e60-e4c67ceba5af' }, item, requestId))
      .toThrow('DEPENDENCY_UNAVAILABLE');
  });
});

describe('nullable create RPC wrappers', () => {
  const organizationId = '8261c3e9-4c0c-45e1-9c6f-0fc3ba927bd2';
  const actorId = 'c1c1b688-5127-4f55-88f6-c979f04733e3';
  const assetId = '37c8de72-06b5-4e45-aeed-8ba833814ae1';
  const createdAt = '2026-10-22T00:00:00.000Z';

  function createRpcClient(expectedName: string, response: object, expectedBody: object) {
    const requests: { url: string; body: unknown }[] = [];
    const client = createClient<Database>('http://127.0.0.1:54321', 'synthetic-publishable-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push({ url: request.url, body: await request.json() });
          return Response.json(response);
        },
      },
    });
    return { client, requests, expectedUrl: `http://127.0.0.1:54321/rest/v1/rpc/${expectedName}`, expectedBody };
  }

  it('saves an asset through the bound Supabase RPC method and preserves its nullable create key', async () => {
    const response = {
      data: {
        id: assetId,
        organization_id: organizationId,
        code: 'PUMP-01',
        name: 'Synthetic pump',
        category: 'pump',
        site_id: null,
        serial_number: null,
        registration: null,
        archived_at: null,
        created_by: actorId,
        created_at: createdAt,
        version: 1,
      },
      version: 1,
      request_id: requestId,
    };
    const expectedBody = {
      ctx: { organization_id: organizationId, request_id: requestId },
      asset_id: null,
      fields: { code: 'PUMP-01', name: 'Synthetic pump', category: 'pump' },
    };
    const fixture = createRpcClient('save_asset', response, expectedBody);

    await expect(saveAsset(fixture.client, organizationId, expectedBody.fields, requestId)).resolves.toEqual(response.data);
    expect(fixture.requests).toEqual([{ url: fixture.expectedUrl, body: fixture.expectedBody }]);
  });

  it('saves a request through the bound Supabase RPC method and preserves its nullable create key', async () => {
    const response = {
      data: {
        id: 'a791e713-3a7a-4770-94f4-12542aef0d7e',
        organization_id: organizationId,
        asset_id: assetId,
        reporter_id: actorId,
        description: 'Synthetic vibration report',
        category: 'vibration',
        status: 'draft',
        transition_reason: null,
        converted_work_order_id: null,
        created_at: createdAt,
        version: 1,
      },
      version: 1,
      request_id: requestId,
    };
    const expectedBody = {
      ctx: { organization_id: organizationId, request_id: requestId },
      id: null,
      asset_id: assetId,
      description: 'Synthetic vibration report',
      category: 'vibration',
    };
    const fixture = createRpcClient('save_request', response, expectedBody);

    await expect(saveRequest(fixture.client, organizationId, { asset_id: assetId, description: 'Synthetic vibration report', category: 'vibration' }, requestId))
      .resolves.toEqual(response.data);
    expect(fixture.requests).toEqual([{ url: fixture.expectedUrl, body: fixture.expectedBody }]);
  });

  it('creates a direct work order through the strict command envelope', async () => {
    const workOrder = {
      id: 'f0ffae76-6e12-4b24-a858-8f1984e298cb', organization_id: organizationId, number: 4, asset_id: assetId, source_request_id: null,
      title: 'Inspect pump coupling', description: 'Check alignment and document the reading.', category: 'inspection', priority: 'normal', due_at: null,
      supervisor_id: actorId, status: 'draft', blocks_operation: false, created_by: actorId, created_at: createdAt, version: 1,
    };
    const fields = {
      title: 'Inspect pump coupling', description: 'Check alignment and document the reading.', category: 'inspection', priority: 'normal' as const,
      due_at: null, supervisor_id: actorId,
    };
    const expectedBody = {
      ctx: { organization_id: organizationId, request_id: requestId }, asset_id: assetId, fields,
    };
    const fixture = createRpcClient('create_work_order', { data: workOrder, version: 1, request_id: requestId }, expectedBody);

    await expect(createWorkOrder(fixture.client, organizationId, assetId, fields, requestId)).resolves.toEqual(workOrder);
    expect(fixture.requests).toEqual([{ url: fixture.expectedUrl, body: expectedBody }]);
    expect(() => createWorkOrder(fixture.client, organizationId, assetId, { ...fields, title: ' ' }, requestId)).toThrow();

    const incompatible = createRpcClient('create_work_order', { data: { ...workOrder, repair_revision: 1 }, version: 1, request_id: requestId }, expectedBody);
    await expect(createWorkOrder(incompatible.client, organizationId, assetId, fields, requestId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    expect(incompatible.requests).toEqual([{ url: incompatible.expectedUrl, body: expectedBody }]);
  });

  it('keeps assignment responses on the strict legacy work-order projection', async () => {
    const workOrder = {
      id: 'f0ffae76-6e12-4b24-a858-8f1984e298cb', organization_id: organizationId, number: 4, asset_id: assetId, source_request_id: null,
      title: 'Inspect pump coupling', description: 'Check alignment and document the reading.', category: 'inspection', priority: 'normal', due_at: null,
      supervisor_id: actorId, status: 'draft', blocks_operation: false, created_by: actorId, created_at: createdAt, version: 2,
    };
    const assigneeId = '7d93f61d-9a2b-4262-973c-a82aa3a94120';
    const body = { ctx: { organization_id: organizationId, request_id: requestId, expected_version: 1 }, id: workOrder.id, user_ids: [assigneeId] };
    const fixture = createRpcClient('assign_work_order', { data: workOrder, version: 2, request_id: requestId }, body);

    await expect(assignWorkOrder(fixture.client, organizationId, workOrder.id, 1, [assigneeId], requestId)).resolves.toEqual(workOrder);
    expect(fixture.requests).toEqual([{ url: fixture.expectedUrl, body }]);

    const incompatible = createRpcClient('assign_work_order', { data: { ...workOrder, repair_revision: 1 }, version: 2, request_id: requestId }, body);
    await expect(assignWorkOrder(incompatible.client, organizationId, workOrder.id, 1, [assigneeId], requestId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  });

  it('uses the exact work-order revision and retains an uncertain command identity for retry', async () => {
    const workOrder = {
      id: 'f0ffae76-6e12-4b24-a858-8f1984e298cb', organization_id: organizationId, number: 3, asset_id: assetId, source_request_id: null,
      title: 'Repair pump', description: 'Investigate vibration', category: 'pump', priority: 'normal', due_at: null,
      supervisor_id: actorId, status: 'in_progress', blocks_operation: true, created_by: actorId, created_at: createdAt, version: 2,
      repair_revision: 1, submitted_revision: null, opened_at: createdAt, completed_at: null, priority_reason: null,
    };
    const expectedBody = {
      ctx: { organization_id: organizationId, request_id: requestId, expected_version: 2 },
      id: workOrder.id,
      allowed_fields: { note: 'Checked the assembly', labor_minutes: 30 },
    };
    const fixture = createRpcClient('update_work_order', { data: workOrder, version: 2, request_id: requestId }, expectedBody);

    await expect(updateWorkOrder(fixture.client, organizationId, workOrder.id, 2, expectedBody.allowed_fields, requestId)).resolves.toEqual(workOrder);
    await expect(updateWorkOrder(fixture.client, organizationId, workOrder.id, 2, expectedBody.allowed_fields, requestId)).resolves.toEqual(workOrder);
    expect(fixture.requests).toEqual([
      { url: fixture.expectedUrl, body: expectedBody },
      { url: fixture.expectedUrl, body: expectedBody },
    ]);
  });

  it('declares the performers and submits their attested repair at the current revision', async () => {
    const workOrderId = 'f0ffae76-6e12-4b24-a858-8f1984e298cb';
    const performerId = '7d93f61d-9a2b-4262-973c-a82aa3a94120';
    const workOrder = {
      id: workOrderId, organization_id: organizationId, number: 3, asset_id: assetId, source_request_id: null,
      title: 'Repair pump', description: 'Investigate vibration', category: 'pump', priority: 'normal', due_at: null,
      supervisor_id: actorId, status: 'in_progress', blocks_operation: true, created_by: actorId, created_at: createdAt, version: 3,
      repair_revision: 2, submitted_revision: null, opened_at: createdAt, completed_at: null, priority_reason: null,
    };
    const declarationBody = { ctx: { organization_id: organizationId, request_id: requestId, expected_version: 2 }, id: workOrderId, user_ids: [actorId, performerId] };
    const declaration = createRpcClient('declare_work_order_performers', { data: workOrder, version: 3, request_id: requestId }, declarationBody);
    await expect(declareWorkOrderPerformers(declaration.client, organizationId, workOrderId, 2, [actorId, performerId], requestId)).resolves.toEqual(workOrder);
    expect(declaration.requests).toEqual([{ url: declaration.expectedUrl, body: declarationBody }]);

    const acknowledgment = 'I confirm these are the people who performed this repair.';
    const submitBody = { ctx: { organization_id: organizationId, request_id: requestId, expected_version: 3 }, id: workOrderId, acknowledgment };
    const submitted = { ...workOrder, status: 'awaiting_review', version: 4, repair_revision: 2, submitted_revision: 2 };
    const submit = createRpcClient('submit_work_order', { data: submitted, version: 4, request_id: requestId }, submitBody);
    await expect(submitWorkOrder(submit.client, organizationId, workOrderId, 3, acknowledgment, requestId)).resolves.toEqual(submitted);
    expect(submit.requests).toEqual([{ url: submit.expectedUrl, body: submitBody }]);
  });
});
