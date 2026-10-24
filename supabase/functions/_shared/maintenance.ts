import { z } from 'zod';

const status = z.enum(['active', 'paused', 'archived']);
export const maintenanceFields = z.strictObject({
  id: z.uuid().optional(), asset_id: z.uuid(), title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(4000), category: z.string().trim().min(1).max(100),
  cadence: z.enum(['day', 'week', 'month']), frequency: z.int().min(1).max(365),
  anchor_on: z.iso.date().refine((date) => date >= '0001-01-01' && date <= '9999-12-30'),
  supervisor_id: z.uuid(), assignee_ids: z.array(z.uuid()).min(1).max(30).refine((ids) => new Set(ids).size === ids.length),
  checklist: z.array(z.string().trim().min(1).max(500)).min(1).max(100), status,
});
export type MaintenanceFields = z.infer<typeof maintenanceFields>;

export const maintenancePlan = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), current_revision_id: z.uuid(), authorized_by: z.uuid(), status,
  generation_blocked: z.enum(['person_ineligible', 'asset_archived', 'unfinished_work', 'quota', 'dependency']).nullable(),
  last_checked_at: z.string().nullable(), created_by: z.uuid(), created_at: z.string(), version: z.int().positive(),
});
export const maintenanceRevision = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), plan_id: z.uuid(), revision: z.int().positive(), author_id: z.uuid(),
  title: z.string(), instructions: z.string(), category: z.string(), cadence: maintenanceFields.shape.cadence,
  frequency: maintenanceFields.shape.frequency, anchor_on: z.iso.date(), timezone: z.string(),
  supervisor_id: z.uuid(), assignee_ids: z.array(z.uuid()).min(1).max(30), checklist: z.array(z.string()).min(1).max(100), created_at: z.string(),
});
const instant = z.iso.datetime({ offset: true });
const datedCutoff = z.strictObject({ scheduled_local_date: z.iso.date(), timezone: z.string(), due_at: instant });
export const maintenancePreview = z.strictObject({
  plan_id: z.uuid().nullable(), version: z.int().positive().nullable(), evaluated_at: instant, old_local_date: z.iso.date().nullable(),
  new_local_date: z.iso.date(), protected_through: z.iso.date().nullable(), timezone: z.string(), due_policy: z.literal('local_day_end'),
  first_new: datedCutoff, retained_backlog: z.array(z.strictObject({
    revision_id: z.uuid(), author_id: z.uuid(), next_ordinal: z.int().nonnegative(), next_on: z.iso.date(), protected_through: z.iso.date(),
    timezone: z.string(), due_at: instant,
  })).max(100), backlog_has_more: z.boolean(), personnel_eligible: z.boolean(),
});
export const maintenancePlanPage = z.strictObject({ items: z.array(maintenancePlan).max(100), next_cursor: z.uuid().nullable() });
export const maintenanceRevisionPage = z.strictObject({
  items: z.array(z.strictObject({ revision: maintenanceRevision, segment: z.strictObject({
    organization_id: z.uuid(), plan_id: z.uuid(), revision_id: z.uuid(), next_ordinal: z.int().nonnegative(), protected_through: z.iso.date().nullable(),
  }) })).max(100), next_cursor: z.int().positive().nullable(),
});
