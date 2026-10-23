import { z } from 'zod';
import { commandContext, type CommandContext } from '../contracts/core';
import { assetHold, assetRelease, meterReading, operationalWorkOrder, performerDeclarationInput, releaseAcknowledgment, settingsResult, workUpdate } from '../contracts/operational';
import { domainError } from '../lib/domain-errors';
import type { Database, Json } from '../lib/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

const commandEnvelope = <T extends z.ZodType>(data: T) => z.strictObject({
  data,
  version: z.number().int().positive(),
  request_id: z.uuid(),
});

export function commandResult<T extends z.ZodType>(value: unknown, data: T, requestId: string): z.output<T> {
  const parsed = commandEnvelope(data).safeParse(value);
  if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  const envelope = parsed.data as { data: z.output<T>; version: number; request_id: string };
  if (envelope.request_id !== requestId) throw new Error('DEPENDENCY_UNAVAILABLE');
  return envelope.data;
}

const organizationSchema = z.strictObject({
  id: z.uuid(), name: z.string(), timezone: z.string(), currency: z.string(), created_by: z.uuid(), created_at: z.string(), version: z.number().int(),
});
const invitationSchema = z.strictObject({ id: z.uuid(), email: z.email(), role: z.string(), expires_at: z.string(), delivery: z.literal('requested') });
const assetSchema = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), code: z.string(), name: z.string(), category: z.string(), site_id: z.uuid().nullable(),
  serial_number: z.string().nullable(), registration: z.string().nullable(), archived_at: z.string().nullable(),
  created_by: z.uuid(), created_at: z.string(), version: z.number().int(),
});
const requestSchema = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), reporter_id: z.uuid(), description: z.string(), category: z.string(),
  status: z.string(), transition_reason: z.string().nullable(), converted_work_order_id: z.uuid().nullable(), created_at: z.string(), version: z.number().int(),
});
const workOrderSchema = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), number: z.number().int(), asset_id: z.uuid(), source_request_id: z.uuid().nullable(),
  title: z.string(), description: z.string(), category: z.string(), priority: z.string(), due_at: z.string().nullable(),
  supervisor_id: z.uuid(), status: z.string(), blocks_operation: z.boolean(), created_by: z.uuid(), created_at: z.string(), version: z.number().int(),
});
const createWorkOrderFields = z.strictObject({
  title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(4000), category: z.string().trim().min(1).max(100),
  priority: z.enum(['low', 'normal', 'high', 'critical']), supervisor_id: z.uuid().nullable().optional(), due_at: z.iso.datetime().nullable().optional(),
});
const invitationAcceptedSchema = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), user_id: z.uuid(), role: z.string(), active: z.boolean(), created_at: z.string(), version: z.number().int() });
const memberSchema = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), user_id: z.uuid(), role: z.string(), active: z.boolean(), created_at: z.string(), version: z.number().int() });
const invitationRecordSchema = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), email: z.email(), role: z.string(), inviter_id: z.uuid(), expires_at: z.string(),
  accepted_at: z.string().nullable(), revoked_at: z.string().nullable(), created_at: z.string(), version: z.number().int(),
});

type RpcResponse = { data: Json | null; error: { message: string } | null };
async function parseRpc<T extends z.ZodType>(response: PromiseLike<RpcResponse>, schema: T, requestId: string): Promise<z.output<T>> {
  const result = await response;
  if (result.error) throw new Error(domainError(result.error, requestId).code);
  return commandResult(result.data, schema, requestId);
}

type SaveAssetCreateArgs = { ctx: CommandContext; asset_id: string | null; fields: { code: string; name: string; category: string; serial_number?: string | null; registration?: string | null } };
type SaveRequestCreateArgs = { ctx: CommandContext; id: string | null; asset_id: string; description: string; category: string };
function rpcWithNullableCreateKey(client: SupabaseClient<Database>, name: 'save_asset', args: SaveAssetCreateArgs): PromiseLike<RpcResponse> {
  // The generated PostgREST Args type marks this UUID non-null, while the SQL create path intentionally uses NULL as its target sentinel.
  const rpc = client.rpc as unknown as (functionName: 'save_asset', parameters: SaveAssetCreateArgs) => PromiseLike<RpcResponse>;
  return rpc.call(client, name, args);
}
function rpcWithNullableRequestId(client: SupabaseClient<Database>, name: 'save_request', args: SaveRequestCreateArgs): PromiseLike<RpcResponse> {
  // The SQL contract uses NULL to create a request; the generated function Args type cannot express that sentinel.
  const rpc = client.rpc as unknown as (functionName: 'save_request', parameters: SaveRequestCreateArgs) => PromiseLike<RpcResponse>;
  return rpc.call(client, name, args);
}

export function contextFor(organizationId: string, requestId: string, expectedVersion?: number): CommandContext {
  return commandContext.parse({ organization_id: organizationId, request_id: requestId, ...(expectedVersion ? { expected_version: expectedVersion } : {}) });
}

export function createOrganization(client: SupabaseClient<Database>, fields: { name: string; timezone: string; currency: string }, requestId: string) {
  return parseRpc(client.rpc('create_organization', { ...fields, request_id: requestId }), organizationSchema, requestId);
}

export function acceptInvitation(client: SupabaseClient<Database>, token: string, requestId: string) {
  return parseRpc(client.rpc('accept_organization_invitation', { token, request_id: requestId }), invitationAcceptedSchema, requestId);
}

export function saveAsset(client: SupabaseClient<Database>, organizationId: string, fields: { code: string; name: string; category: string; serial_number?: string | null; registration?: string | null }, requestId: string) {
  return parseRpc(rpcWithNullableCreateKey(client, 'save_asset', { ctx: contextFor(organizationId, requestId), asset_id: null, fields }), assetSchema, requestId);
}

export function saveRequest(client: SupabaseClient<Database>, organizationId: string, fields: { asset_id: string; description: string; category: string }, requestId: string) {
  return parseRpc(rpcWithNullableRequestId(client, 'save_request', { ctx: contextFor(organizationId, requestId), id: null, ...fields }), requestSchema, requestId);
}

export function submitRequest(client: SupabaseClient<Database>, organizationId: string, requestId: string, commandId: string) {
  return parseRpc(client.rpc('submit_request', { ctx: contextFor(organizationId, commandId), id: requestId }), requestSchema, commandId);
}

export function reviseRequest(client: SupabaseClient<Database>, organizationId: string, requestId: string, expectedVersion: number, fields: { asset_id: string; description: string; category: string }, commandId: string) {
  return parseRpc(client.rpc('save_request', { ctx: contextFor(organizationId, commandId, expectedVersion), id: requestId, ...fields }), requestSchema, commandId);
}

export function withdrawRequest(client: SupabaseClient<Database>, organizationId: string, requestId: string, reason: string, commandId: string) {
  return parseRpc(client.rpc('withdraw_request', { ctx: contextFor(organizationId, commandId), id: requestId, reason }), requestSchema, commandId);
}

export function triageRequest(client: SupabaseClient<Database>, organizationId: string, requestId: string, decision: 'returned' | 'rejected', reason: string, commandId: string) {
  return parseRpc(client.rpc('triage_request', { ctx: contextFor(organizationId, commandId), id: requestId, decision, reason }), requestSchema, commandId);
}

export function convertRequest(client: SupabaseClient<Database>, organizationId: string, requestId: string, fields: { title: string; priority: 'low' | 'normal' | 'high' | 'critical' }, commandId: string) {
  return parseRpc(client.rpc('convert_request', { ctx: contextFor(organizationId, commandId), id: requestId, work_order_fields: fields }), workOrderSchema, commandId);
}

export function createWorkOrder(client: SupabaseClient<Database>, organizationId: string, assetId: string, fields: z.input<typeof createWorkOrderFields>, requestId: string) {
  const parsedFields = createWorkOrderFields.parse(fields);
  return parseRpc(client.rpc('create_work_order', { ctx: contextFor(organizationId, requestId), asset_id: z.uuid().parse(assetId), fields: parsedFields as Json }), workOrderSchema, requestId);
}

export function setMember(client: SupabaseClient<Database>, organizationId: string, userId: string, role: 'manager' | 'supervisor' | 'technician' | 'inventory', active: boolean, expectedVersion: number, commandId: string) {
  return parseRpc(client.rpc('set_organization_member', { ctx: contextFor(organizationId, commandId, expectedVersion), user_id: userId, role, active }), memberSchema, commandId);
}

export function assignWorkOrder(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, userIds: string[], requestId: string) {
  const ids = z.array(z.uuid()).max(30).parse(userIds);
  return parseRpc(client.rpc('assign_work_order', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, user_ids: ids }), workOrderSchema, requestId);
}

export function updateWorkOrder(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, fields: z.output<typeof workUpdate>, requestId: string) {
  return parseRpc(client.rpc('update_work_order', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, allowed_fields: workUpdate.parse(fields) }), operationalWorkOrder, requestId);
}

export function transitionWorkOrder(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, target: 'open' | 'scheduled' | 'in_progress' | 'blocked' | 'awaiting_review' | 'completed' | 'canceled', reason: string | undefined, requestId: string) {
  return parseRpc(client.rpc('transition_work_order', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, target, ...(reason === undefined ? {} : { reason }) }), operationalWorkOrder, requestId);
}

export function addWorkOrderTask(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, label: string, required: boolean, requestId: string) {
  return parseRpc(client.rpc('add_work_order_task', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, label: z.string().trim().min(1).max(500).parse(label), required }), operationalWorkOrder, requestId);
}

export function declareWorkOrderPerformers(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, userIds: string[], requestId: string) {
  return parseRpc(client.rpc('declare_work_order_performers', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, user_ids: performerDeclarationInput.parse(userIds) }), operationalWorkOrder, requestId);
}

export function submitWorkOrder(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, acknowledgment: string, requestId: string) {
  return parseRpc(client.rpc('submit_work_order', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, acknowledgment: releaseAcknowledgment.parse(acknowledgment) }), operationalWorkOrder, requestId);
}

export function reviewWorkOrder(client: SupabaseClient<Database>, organizationId: string, workOrderId: string, expectedVersion: number, decision: 'approved' | 'returned', reason: string, requestId: string) {
  return parseRpc(client.rpc('review_work_order', { ctx: contextFor(organizationId, requestId, expectedVersion), id: workOrderId, decision, reason: releaseAcknowledgment.parse(reason) }), operationalWorkOrder, requestId);
}

export function setAssetHold(client: SupabaseClient<Database>, organizationId: string, assetId: string, expectedVersion: number, reason: string, requestId: string) {
  return parseRpc(client.rpc('set_asset_hold', { ctx: contextFor(organizationId, requestId, expectedVersion), asset_id: assetId, reason: releaseAcknowledgment.parse(reason) }), assetHold, requestId);
}

export function resolveAssetHold(client: SupabaseClient<Database>, organizationId: string, holdId: string, expectedVersion: number, disposition: 'repaired' | 'withdrawn_with_reason', reason: string, requestId: string) {
  return parseRpc(client.rpc('resolve_asset_hold', { ctx: contextFor(organizationId, requestId, expectedVersion), hold_id: holdId, disposition, reason: releaseAcknowledgment.parse(reason) }), assetHold, requestId);
}

export function releaseAsset(client: SupabaseClient<Database>, organizationId: string, assetId: string, expectedVersion: number, acknowledgment: string, requestId: string) {
  return parseRpc(client.rpc('release_asset', { ctx: contextFor(organizationId, requestId, expectedVersion), asset_id: assetId, acknowledgment: releaseAcknowledgment.parse(acknowledgment) }), assetRelease, requestId);
}

export function recordMeterReading(client: SupabaseClient<Database>, organizationId: string, assetId: string, kind: 'hours' | 'distance', value: number, observedAt: string, requestId: string) {
  return parseRpc(client.rpc('record_meter_reading', { ctx: contextFor(organizationId, requestId), asset_id: assetId, kind, value: z.number().finite().nonnegative().parse(value), observed_at: z.iso.datetime().parse(observedAt) }), meterReading, requestId);
}

export function correctMeterReading(client: SupabaseClient<Database>, organizationId: string, readingId: string, value: number, reason: string, requestId: string) {
  return parseRpc(client.rpc('correct_meter_reading', { ctx: contextFor(organizationId, requestId), id: readingId, value: z.number().finite().nonnegative().parse(value), reason: releaseAcknowledgment.parse(reason) }), meterReading, requestId);
}

export function saveOrganizationSettings(client: SupabaseClient<Database>, organizationId: string, expectedVersion: number, fields: { evidence_required?: boolean; timezone?: string; currency?: string }, requestId: string) {
  const parsed = z.strictObject({ evidence_required: z.boolean().optional(), timezone: z.string().trim().min(1).max(100).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).refine((value) => Object.keys(value).length > 0).parse(fields);
  return parseRpc(client.rpc('save_organization_settings', { ctx: contextFor(organizationId, requestId, expectedVersion), fields: parsed }), settingsResult, requestId);
}

export function markNotificationsRead(client: SupabaseClient<Database>, organizationId: string, ids: string[], requestId: string) {
  const notificationIds = z.array(z.uuid()).max(100).parse(ids);
  return parseRpc(client.rpc('mark_notifications_read', { ctx: contextFor(organizationId, requestId), ids: notificationIds }), z.strictObject({ id: z.uuid(), marked: z.literal(true) }), requestId);
}

export function revokeInvitation(client: SupabaseClient<Database>, organizationId: string, invitationId: string, expectedVersion: number, commandId: string) {
  return parseRpc(client.rpc('revoke_organization_invitation', { ctx: contextFor(organizationId, commandId, expectedVersion), invitation_id: invitationId }), invitationRecordSchema, commandId);
}

const edgeResult = z.strictObject({
  data: invitationSchema,
  version: z.number().int().positive(),
  request_id: z.uuid(),
});

export async function inviteMember(client: SupabaseClient<Database>, organizationId: string, email: string, role: 'manager' | 'supervisor' | 'technician' | 'inventory', requestId: string, signal?: AbortSignal) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('UNAUTHENTICATED');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('DEPENDENCY_UNAVAILABLE');
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/organization-invite`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ctx: contextFor(organizationId, requestId), email: email.trim().toLowerCase(), role }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('DEPENDENCY_UNAVAILABLE');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : 'DEPENDENCY_UNAVAILABLE';
    throw new Error(domainError({ message: code }, requestId).code);
  }
  const parsed = edgeResult.safeParse(body);
  if (!parsed.success || parsed.data.request_id !== requestId) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data.data;
}

export type { Json };
