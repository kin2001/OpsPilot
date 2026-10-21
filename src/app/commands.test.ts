import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { commandResult, saveAsset, saveRequest } from './commands';

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
});
