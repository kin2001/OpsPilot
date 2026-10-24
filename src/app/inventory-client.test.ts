import { expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { receiveStock, adjustStock, savePart, saveStockLocation, listInventoryParts, listStockLocations, listInventoryBalances, listInventoryMovements, requestParts, reserveParts, releaseReservation, issueReservedStock, returnStock, getJobParts } from './inventory-client';
const id = '00000035-0000-4000-8000-000000000001';
const org = '10000035-0000-4000-8000-000000000001';
const requestId = '30000035-0000-4000-8000-000000000001';
const fields = { part_id: id, location_id: id, quantity: '0.100', unit: 'kg' };
const movement = { ...fields, id, organization_id: org, kind: 'receipt', direction: 'in', actor_id: id, request_id: requestId, source: null, reason: null, correction_of: null, created_at: '2026-10-24T00:00:00Z' };
const job = { id, number: 1, status: 'open', version: 2, parts: [], reservations: [], reconciliation_state: 'consistent' };
it('sends job commands with mandatory WO version, exact quantities and replay identity', async () => {
  const f = fixture({ data: job, version: 2, request_id: requestId });
  const request = { work_order_id: id, lines: [{ part_id: id, quantity: '0.100', unit: 'kg' }] };
  const reserve = { work_order_id: id, lines: [fields] };
  const reservation = { work_order_id: id, lines: [{ reservation_id: id, quantity: '0.100', unit: 'kg' }] };
  await requestParts(f.client, org, request, requestId, 1);
  await reserveParts(f.client, org, reserve, requestId, 1);
  await releaseReservation(f.client, org, reservation, requestId, 1);
  await issueReservedStock(f.client, org, reservation, requestId, 1);
  await returnStock(f.client, org, reservation, requestId, 1);
  expect(f.sent.map((r) => r.url.split('/').at(-1))).toEqual(['request_parts', 'reserve_parts', 'release_reservation', 'issue_reserved_stock', 'return_stock']);
  expect(f.sent[0].body).toEqual({ ctx: { organization_id: org, request_id: requestId, expected_version: 1 }, fields: request });
  expect(() => requestParts(f.client, org, request, requestId, 0)).toThrow();
  expect(await getJobParts(fixture(job).client, org, id)).toEqual(job);
  await expect(getJobParts(fixture({ ...job, people: [] }).client, org, id)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
function fixture(body: unknown, status = 200) {
  const sent: { url: string; body: unknown }[] = [];
  const client = createClient<Database>('http://127.0.0.1:54321', 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const request = new Request(input, init); sent.push({ url: request.url, body: await request.json() }); return Response.json(body, { status });
  } } });
  return { client, sent };
}
it('preserves decimal strings and retry identity without client authority claims', async () => {
  const f = fixture({ data: movement, version: 1, request_id: requestId });
  expect(await receiveStock(f.client, org, fields, requestId)).toEqual(movement);
  expect(f.sent[0].body).toEqual({ ctx: { organization_id: org, request_id: requestId }, fields });
  expect(f.sent[0].url).toMatch(/\/rpc\/receive_stock$/);
});
it('fails closed on numeric response quantities, mismatched receipts and server conflicts', async () => {
  await expect(receiveStock(fixture({ data: { ...movement, quantity: 0.1 }, version: 1, request_id: requestId }).client, org, fields, requestId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(receiveStock(fixture({ data: movement, version: 1, request_id: id }).client, org, fields, requestId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  await expect(receiveStock(fixture({ message: 'CONFLICT', code: 'P0001' }, 400).client, org, fields, requestId)).rejects.toThrow('CONFLICT');
});
it('rejects invalid precision, stale-update omissions, adjustment reasons and excessive reads before transport', () => {
  const f = fixture({});
  expect(() => receiveStock(f.client, org, { ...fields, quantity: '1.0001' }, requestId)).toThrow();
  expect(() => adjustStock(f.client, org, { ...fields, direction: 'out', reason: '\t\n' }, requestId)).toThrow();
  expect(() => savePart(f.client, org, { id, code: 'P1', name: 'Part', unit: 'kg', reorder_threshold: null }, requestId)).toThrow('VALIDATION');
  expect(() => saveStockLocation(f.client, org, { code: 'L1', name: 'Shelf' }, requestId, 1)).toThrow('VALIDATION');
  expect(() => listInventoryParts(f.client, org, { page_size: 101 })).toThrow();
  expect(f.sent).toEqual([]);
});
it('uses bounded separate catalog/stock reads with typed decimal-only responses', async () => {
  const f = fixture({ items: [], next_cursor: null });
  await listInventoryParts(f.client, org); await listStockLocations(f.client, org, { page_size: 1 });
  await listInventoryBalances(f.client, org, { part_id: id }); await listInventoryMovements(f.client, org, { cursor: id, location_id: id });
  expect(f.sent.map((r) => r.body)).toEqual([{ organization_id: org, page_size: 25 }, { organization_id: org, page_size: 1 }, { organization_id: org, page_size: 25, part_id: id }, { organization_id: org, page_size: 25, cursor: id, location_id: id }]);
  await expect(listInventoryMovements(fixture({ items: [movement], next_cursor: null, unexpected: 1 }).client, org)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
it('sends linked adjustment lineage explicitly and preserves decimal spelling', async () => {
  const adjusted = { ...movement, kind: 'adjustment', direction: 'out', reason: 'Reverse receipt', correction_of: id };
  const f = fixture({ data: adjusted, version: 1, request_id: requestId });
  const input = { ...fields, direction: 'out' as const, reason: 'Reverse receipt', correction_of: id };
  expect(await adjustStock(f.client, org, input, requestId)).toEqual(adjusted);
  expect(f.sent[0].body).toEqual({ ctx: { organization_id: org, request_id: requestId }, fields: input });
  expect(f.sent[0].url).toMatch(/\/rpc\/adjust_stock$/);
});
it('includes optimistic version only on catalog updates', async () => {
  const input = { id, code: 'KG', name: 'Lubricant', unit: 'kg', reorder_threshold: '0.100' };
  const f = fixture({ data: { ...input, organization_id: org, archived_at: null, created_by: id, created_at: movement.created_at, version: 2 }, version: 2, request_id: requestId });
  expect((await savePart(f.client, org, input, requestId, 1)).version).toBe(2);
  expect(f.sent[0].body).toEqual({ ctx: { organization_id: org, request_id: requestId, expected_version: 1 }, fields: input });
  expect(f.sent[0].url).toMatch(/\/rpc\/save_part$/);
});
it('sends archival intent through the optimistic catalog contract and reads archived history', async () => {
  const input = { id, code: 'KG', name: 'Lubricant', unit: 'kg', reorder_threshold: null, archived: true };
  const row = { id, code: input.code, name: input.name, unit: input.unit, reorder_threshold: null, organization_id: org, created_by: id, created_at: movement.created_at, archived_at: '2026-10-24T01:00:00Z', version: 2 };
  const f = fixture({ data: row, version: 2, request_id: requestId });
  expect((await savePart(f.client, org, input, requestId, 1)).archived_at).toBe(row.archived_at);
  expect(f.sent[0].body).toEqual({ ctx: { organization_id: org, request_id: requestId, expected_version: 1 }, fields: input });
  expect((await listInventoryParts(fixture({ items: [row], next_cursor: null }).client, org)).items).toEqual([row]);
});
