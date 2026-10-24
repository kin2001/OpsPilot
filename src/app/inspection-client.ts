import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { commandResult, contextFor } from './commands';
import { attachmentRecord, imageMetadata } from '../contracts/operational';
import { inspectionTemplateFields, inspectionResults, inspectionCorrection, type InspectionCorrection, inspectionTemplate, inspectionAssignment, inspectionSubmission, inspectionTemplatePage, inspectionRevisionPage, inspectionAssignmentPage, inspectionDetail, type InspectionTemplateFields, type InspectionResults } from '../contracts/inspections';

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
export function publishInspectionTemplate(client: SupabaseClient<Database>, organizationId: string, fields: InspectionTemplateFields, requestId: string, expectedVersion?: number) {
  const parsed = inspectionTemplateFields.parse(fields);
  if (Boolean(parsed.id) !== (expectedVersion !== undefined)) throw new Error('VALIDATION');
  if (expectedVersion !== undefined) z.int().positive().parse(expectedVersion);
  return command(client.rpc('publish_inspection_template', { ctx: contextFor(organizationId, requestId, expectedVersion), fields: parsed }), inspectionTemplate, requestId);
}
export function assignInspection(client: SupabaseClient<Database>, organizationId: string, fields: { asset_id: string; template_revision_id: string; inspector_id: string; due_on?: string }, requestId: string) {
  const parsed = z.strictObject({ asset_id: z.uuid(), template_revision_id: z.uuid(), inspector_id: z.uuid(), due_on: z.iso.date().optional() }).parse(fields);
  return command(client.rpc('assign_inspection', { ctx: contextFor(organizationId, requestId), ...parsed }), inspectionAssignment, requestId);
}
export function submitInspection(client: SupabaseClient<Database>, organizationId: string, assignmentId: string, templateRevisionId: string, results: InspectionResults, requestId: string) {
  return command(client.rpc('submit_inspection', { ctx: contextFor(organizationId, requestId), assignment_id: z.uuid().parse(assignmentId), template_revision_id: z.uuid().parse(templateRevisionId), results: inspectionResults.parse(results) }), inspectionSubmission, requestId);
}
export function correctInspection(client: SupabaseClient<Database>, organizationId: string, fields: InspectionCorrection, requestId: string, expectedVersion: number) {
  return command(client.rpc('correct_inspection', { ctx: contextFor(organizationId, requestId, z.int().min(1).max(99).parse(expectedVersion)), ...inspectionCorrection.parse(fields) }), inspectionSubmission, requestId);
}
export function reserveInspectionAttachment(client: SupabaseClient<Database>, organizationId: string, assignmentId: string, metadata: z.input<typeof imageMetadata>, requestId: string) {
  return command(client.rpc('reserve_inspection_attachment', { ctx: contextFor(organizationId, requestId), assignment_id: z.uuid().parse(assignmentId), ...imageMetadata.parse(metadata) }), attachmentRecord, requestId);
}
const pageSize = z.int().min(1).max(100);
const page = z.strictObject({ cursor: z.uuid().optional(), page_size: pageSize });
export function listInspectionTemplates(client: SupabaseClient<Database>, organizationId: string, paging: { cursor?: string; page_size?: number } = {}, signal?: AbortSignal) {
  const response = client.rpc('list_inspection_templates', { organization_id: z.uuid().parse(organizationId), ...page.parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, inspectionTemplatePage);
}
export function listInspectionRevisions(client: SupabaseClient<Database>, organizationId: string, templateId: string, paging: { cursor?: number; page_size?: number } = {}, signal?: AbortSignal) {
  const response = client.rpc('list_inspection_revisions', { organization_id: z.uuid().parse(organizationId), template_id: z.uuid().parse(templateId), ...z.strictObject({ cursor: z.int().positive().optional(), page_size: pageSize }).parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, inspectionRevisionPage);
}
export function listInspectionAssignments(client: SupabaseClient<Database>, organizationId: string, paging: { cursor?: string; page_size?: number } = {}, signal?: AbortSignal) {
  const response = client.rpc('list_inspection_assignments', { organization_id: z.uuid().parse(organizationId), ...page.parse({ ...paging, page_size: paging.page_size ?? 25 }) });
  return read(signal ? response.abortSignal(signal) : response, inspectionAssignmentPage);
}
export function getInspection(client: SupabaseClient<Database>, organizationId: string, assignmentId: string, signal?: AbortSignal) {
  const response = client.rpc('get_inspection', { organization_id: z.uuid().parse(organizationId), assignment_id: z.uuid().parse(assignmentId) });
  return read(signal ? response.abortSignal(signal) : response, inspectionDetail);
}
