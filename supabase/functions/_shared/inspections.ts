import { z } from 'zod';
const item = z.strictObject({ id: z.uuid(), label: z.string().trim().min(1).max(500), required: z.boolean(), safety_relevant: z.boolean(), evidence_required: z.boolean() });
export const inspectionTemplateFields = z.strictObject({ id: z.uuid().optional(), title: z.string().trim().min(1).max(200), items: z.array(item).min(1).max(100).refine((items) => new Set(items.map((i) => i.id)).size === items.length) });
export const inspectionResults = z.array(z.strictObject({
  item_id: z.uuid(), outcome: z.enum(['pass', 'fail', 'not_applicable']),
  reason: z.string().trim().min(1).max(2000).optional(), remarks: z.string().trim().min(1).max(4000).optional(),
  evidence_ids: z.array(z.uuid()).max(10).refine((ids) => new Set(ids).size === ids.length),
}).refine((r) => r.outcome !== 'not_applicable' || r.reason !== undefined)
  .refine((r) => r.outcome === 'pass' || r.remarks !== undefined)).max(100)
  .refine((rows) => new Set(rows.map((r) => r.item_id)).size === rows.length);
export type InspectionTemplateFields = z.infer<typeof inspectionTemplateFields>;
export type InspectionResults = z.infer<typeof inspectionResults>;
export const inspectionTemplate = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), title: z.string(), current_revision_id: z.uuid(), created_by: z.uuid(), created_at: z.string(), version: z.int().positive() });
export const inspectionRevision = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), template_id: z.uuid(), revision: z.int().positive(), title: z.string(), items: z.array(item).min(1).max(100), published_by: z.uuid(), published_at: z.string() });
export const inspectionAssignment = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), template_revision_id: z.uuid(), inspector_id: z.uuid(), assigned_by: z.uuid(), assigned_at: z.string(), due_on: z.iso.date().nullable(), version: z.int().positive() });
export const inspectionSubmission = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), assignment_id: z.uuid(), template_revision_id: z.uuid(), inspector_id: z.uuid(), submitted_at: z.string(), results: inspectionResults, version: z.literal(1) });
export const inspectionEpisode = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), assignment_id: z.uuid(), submission_id: z.uuid(), item_id: z.uuid(), corrective_request_id: z.uuid(), hold_id: z.uuid().nullable(), predecessor_id: z.uuid().nullable(), created_at: z.string() });
export const inspectionTemplatePage = z.strictObject({ items: z.array(inspectionTemplate).max(100), next_cursor: z.uuid().nullable() });
export const inspectionRevisionPage = z.strictObject({ items: z.array(inspectionRevision).max(100), next_cursor: z.int().positive().nullable() });
export const inspectionAssignmentPage = z.strictObject({ items: z.array(inspectionAssignment).max(100), next_cursor: z.uuid().nullable() });
export const inspectionDetail = z.strictObject({ assignment: inspectionAssignment, revision: inspectionRevision, submission: inspectionSubmission.nullable(), episodes: z.array(inspectionEpisode).max(100) });
