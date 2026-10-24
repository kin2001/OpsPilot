import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { maintenanceFields, maintenancePlan, maintenancePlanPage, maintenancePreview, maintenanceRevisionPage, type MaintenanceFields } from '../contracts/maintenance';
import { commandResult, contextFor } from './commands';

type Response = { data: Json | null; error: { message: string } | null };
async function read<T extends z.ZodType>(response: PromiseLike<Response>, schema: T): Promise<z.output<T>> {
  const result = await response;
  if (result.error) throw new Error(domainError(result.error).code);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}

export function saveMaintenancePlan(client: SupabaseClient<Database>, organizationId: string, fields: MaintenanceFields, requestId: string, expectedVersion?: number) {
  const parsed = maintenanceFields.parse(fields);
  if (Boolean(parsed.id) !== (expectedVersion !== undefined)) throw new Error('VALIDATION');
  if (expectedVersion !== undefined) z.int().positive().parse(expectedVersion);
  const ctx = contextFor(organizationId, requestId, expectedVersion);
  const response = client.rpc('save_maintenance_plan', { ctx, fields: parsed });
  return response.then((result) => {
    if (result.error) throw new Error(domainError(result.error, requestId).code);
    return commandResult(result.data, maintenancePlan, requestId);
  });
}
export function previewMaintenancePlan(client: SupabaseClient<Database>, organizationId: string, fields: MaintenanceFields, signal?: AbortSignal) {
  const response = client.rpc('preview_maintenance_plan', { organization_id: z.uuid().parse(organizationId), fields: maintenanceFields.parse(fields) });
  return read(signal ? response.abortSignal(signal) : response, maintenancePreview);
}
const pageSize = z.int().min(1).max(100);
export function listMaintenancePlans(client: SupabaseClient<Database>, organizationId: string, page: { cursor?: string; page_size?: number } = {}, signal?: AbortSignal) {
  const args = z.strictObject({ organization_id: z.uuid(), cursor: z.uuid().optional(), page_size: pageSize }).parse({ organization_id: organizationId, ...page, page_size: page.page_size ?? 25 });
  const response = client.rpc('list_maintenance_plans', args);
  return read(signal ? response.abortSignal(signal) : response, maintenancePlanPage);
}
export function listMaintenanceRevisions(client: SupabaseClient<Database>, organizationId: string, planId: string, page: { cursor?: number; page_size?: number } = {}, signal?: AbortSignal) {
  const args = z.strictObject({ organization_id: z.uuid(), plan_id: z.uuid(), cursor: z.int().positive().optional(), page_size: pageSize }).parse({ organization_id: organizationId, plan_id: planId, ...page, page_size: page.page_size ?? 25 });
  const response = client.rpc('list_maintenance_revisions', args);
  return read(signal ? response.abortSignal(signal) : response, maintenanceRevisionPage);
}
