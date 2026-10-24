import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { commandResult, contextFor } from './commands';
import { partFields, stockLocationFields, receiveStockFields, adjustStockFields, inventoryPart, stockLocation, stockMovement, inventoryPaging, inventoryPartPage, stockLocationPage, stockBalancePage, stockMovementPage, type PartFields, type StockLocationFields, type ReceiveStockFields, type AdjustStockFields } from '../contracts/inventory';
import { requestPartsFields, reservePartsFields, reservationPartsFields, jobParts, type RequestPartsFields, type ReservePartsFields, type ReservationPartsFields } from '../contracts/inventory';

type Response = { data: Json | null; error: { message: string } | null };
async function command<T extends z.ZodType>(response: PromiseLike<Response>, schema: T, requestId: string) {
  const result = await response;
  if (result.error) throw new Error(domainError(result.error, requestId).code);
  return commandResult(result.data, schema, requestId);
}
async function read<T extends z.ZodType>(response: PromiseLike<Response>, schema: T): Promise<z.output<T>> {
  const result = await response;
  if (result.error) throw new Error(domainError(result.error).code);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}
function saveContext(organizationId: string, requestId: string, id?: string, expectedVersion?: number) {
  if (Boolean(id) !== (expectedVersion !== undefined)) throw new Error('VALIDATION');
  return contextFor(organizationId, requestId, expectedVersion === undefined ? undefined : z.int().positive().parse(expectedVersion));
}
export function savePart(client: SupabaseClient<Database>, organizationId: string, fields: PartFields, requestId: string, expectedVersion?: number) {
  const parsed = partFields.parse(fields);
  return command(client.rpc('save_part', { ctx: saveContext(organizationId, requestId, parsed.id, expectedVersion), fields: parsed }), inventoryPart, requestId);
}
export function saveStockLocation(client: SupabaseClient<Database>, organizationId: string, fields: StockLocationFields, requestId: string, expectedVersion?: number) {
  const parsed = stockLocationFields.parse(fields);
  return command(client.rpc('save_stock_location', { ctx: saveContext(organizationId, requestId, parsed.id, expectedVersion), fields: parsed }), stockLocation, requestId);
}
export function receiveStock(client: SupabaseClient<Database>, organizationId: string, fields: ReceiveStockFields, requestId: string) {
  return command(client.rpc('receive_stock', { ctx: contextFor(organizationId, requestId), fields: receiveStockFields.parse(fields) }), stockMovement, requestId);
}
export function adjustStock(client: SupabaseClient<Database>, organizationId: string, fields: AdjustStockFields, requestId: string) {
  return command(client.rpc('adjust_stock', { ctx: contextFor(organizationId, requestId), fields: adjustStockFields.parse(fields) }), stockMovement, requestId);
}
export function requestParts(client: SupabaseClient<Database>, organizationId: string, fields: RequestPartsFields, requestId: string, expectedVersion: number) {
  return command(client.rpc('request_parts', { ctx: contextFor(organizationId, requestId, z.int().positive().parse(expectedVersion)), fields: requestPartsFields.parse(fields) }), jobParts, requestId);
}
export function reserveParts(client: SupabaseClient<Database>, organizationId: string, fields: ReservePartsFields, requestId: string, expectedVersion: number) {
  return command(client.rpc('reserve_parts', { ctx: contextFor(organizationId, requestId, z.int().positive().parse(expectedVersion)), fields: reservePartsFields.parse(fields) }), jobParts, requestId);
}
export function releaseReservation(client: SupabaseClient<Database>, organizationId: string, fields: ReservationPartsFields, requestId: string, expectedVersion: number) {
  return command(client.rpc('release_reservation', { ctx: contextFor(organizationId, requestId, z.int().positive().parse(expectedVersion)), fields: reservationPartsFields.parse(fields) }), jobParts, requestId);
}
export function issueReservedStock(client: SupabaseClient<Database>, organizationId: string, fields: ReservationPartsFields, requestId: string, expectedVersion: number) {
  return command(client.rpc('issue_reserved_stock', { ctx: contextFor(organizationId, requestId, z.int().positive().parse(expectedVersion)), fields: reservationPartsFields.parse(fields) }), jobParts, requestId);
}
export function returnStock(client: SupabaseClient<Database>, organizationId: string, fields: ReservationPartsFields, requestId: string, expectedVersion: number) {
  return command(client.rpc('return_stock', { ctx: contextFor(organizationId, requestId, z.int().positive().parse(expectedVersion)), fields: reservationPartsFields.parse(fields) }), jobParts, requestId);
}
export function getJobParts(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, signal?: AbortSignal) {
  const response = client.rpc('get_job_parts', { organization_id: z.uuid().parse(organizationId), work_order_id: z.uuid().parse(workOrderId) });
  return read(signal ? response.abortSignal(signal) : response, jobParts);
}
type Paging = { cursor?: string; page_size?: number };
type StockPaging = Paging & { part_id?: string; location_id?: string };
const stockPaging = inventoryPaging.extend({ part_id: z.uuid().optional(), location_id: z.uuid().optional() });
export function listInventoryParts(client: SupabaseClient<Database>, organizationId: string, paging: Paging = {}, signal?: AbortSignal) {
  const response = client.rpc('list_inventory_parts', { organization_id: z.uuid().parse(organizationId), ...inventoryPaging.parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, inventoryPartPage);
}
export function listStockLocations(client: SupabaseClient<Database>, organizationId: string, paging: Paging = {}, signal?: AbortSignal) {
  const response = client.rpc('list_stock_locations', { organization_id: z.uuid().parse(organizationId), ...inventoryPaging.parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, stockLocationPage);
}
export function listInventoryBalances(client: SupabaseClient<Database>, organizationId: string, paging: StockPaging = {}, signal?: AbortSignal) {
  const response = client.rpc('list_inventory_balances', { organization_id: z.uuid().parse(organizationId), ...stockPaging.parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, stockBalancePage);
}
export function listInventoryMovements(client: SupabaseClient<Database>, organizationId: string, paging: StockPaging = {}, signal?: AbortSignal) {
  const response = client.rpc('list_inventory_movements', { organization_id: z.uuid().parse(organizationId), ...stockPaging.parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, stockMovementPage);
}
