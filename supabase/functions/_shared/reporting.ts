import { z } from 'zod';

export const reportKind = z.enum(['work_orders', 'asset_availability', 'pm_compliance', 'technician_assignments', 'parts_consumption', 'maintenance_costs']);
const date = z.iso.date().refine((value) => value >= '0001-01-01' && value <= '9999-12-30');
export const reportRange = z.strictObject({ from: date, to: date }).refine(({ from, to }) => to > from && Date.parse(to) - Date.parse(from) <= 366 * 86400000);
export const reportCursor = z.strictObject({ after: z.uuid().optional(), page_size: z.int().min(1).max(100).default(25) });
export const reportRequest = z.strictObject({ ctx: z.strictObject({ organization_id: z.uuid() }), kind: reportKind, range: reportRange, cursor: reportCursor.default({ page_size: 25 }) });
const count = z.int().nonnegative();
const seconds = z.number().nonnegative().nullable();
const instant = z.iso.datetime({ offset: true });
const workStatus = z.enum(['draft', 'open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review', 'completed', 'canceled']);
export const reportWorkRow = z.strictObject({ id: z.uuid(), number: count, asset_id: z.uuid(), category: z.string(), status: workStatus,
  opened_at: instant.nullable(), approved_at: instant.nullable(), completion_seconds: seconds });
export const reportAvailabilityRow = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string(), history_complete: z.boolean(), downtime_seconds: seconds, known_downtime_seconds: z.number().nonnegative() });
export const reportPmRow = z.strictObject({ id: z.uuid(), work_order_id: z.uuid(), scheduled_local_date: date, timezone: z.string(), due_at: instant,
  approved_at: instant.nullable(), status: workStatus, canceled_reason: z.string().nullable(), eligible: z.boolean(), on_time: z.boolean().nullable() });
export const reportAssignmentRow = z.strictObject({ id: z.uuid(), role: z.enum(['owner', 'manager', 'supervisor', 'technician', 'inventory']), active: z.boolean(), active_jobs: count });
export const reportPartRow = z.strictObject({ id: z.uuid(), work_order_id: z.uuid(), part_id: z.uuid(), location_id: z.uuid(), unit: z.string(),
  kind: z.enum(['issue', 'return']), quantity: z.string().regex(/^\d+\.\d{3}$/), net_quantity: z.string().regex(/^-?\d+\.\d{3}$/), occurred_at: instant });
export const reportWorkSummary = z.strictObject({ active_work_orders: count, blocked: count, pending_approvals: count, overdue: count,
  completed: count, completion_sample_size: count, completion_seconds: seconds });
const base = { schema_version: z.literal(1), timezone: z.string(), currency: z.string().regex(/^[A-Z]{3}$/), range: reportRange,
  from: instant, to: instant, generated_at: instant, next_cursor: reportCursor.nullable() };
export const reportResult = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('work_orders'), items: z.array(reportWorkRow).max(100), summary: reportWorkSummary.extend({
    daily_completed: z.array(z.strictObject({ date, completed: count })).max(366),
    recurring_faults: z.array(z.strictObject({ asset_id: z.uuid(), category: z.string(), recorded_work_orders: count })).max(100), recurring_faults_has_more: z.boolean(),
  }) }),
  z.strictObject({ ...base, kind: z.literal('asset_availability'), items: z.array(reportAvailabilityRow).max(100), summary: z.strictObject({ history_complete: z.boolean(), downtime_seconds: seconds, known_downtime_seconds: z.number().nonnegative() }) }),
  z.strictObject({ ...base, kind: z.literal('pm_compliance'), items: z.array(reportPmRow).max(100), summary: z.strictObject({ coverage: z.literal('generated_occurrences'), eligible: count, completed_on_time: count, completion_sample_size: count, unknown_completions: count, on_time_rate: z.number().min(0).max(1).nullable() }) }),
  z.strictObject({ ...base, kind: z.literal('technician_assignments'), items: z.array(reportAssignmentRow).max(100), summary: z.strictObject({ assigned_active_jobs: count }) }),
  z.strictObject({ ...base, kind: z.literal('parts_consumption'), items: z.array(reportPartRow).max(100), summary: z.strictObject({ movement_count: count, quantity_policy: z.literal('net_by_part_and_unit') }) }),
  z.strictObject({ ...base, kind: z.literal('maintenance_costs'), items: z.array(z.never()).length(0), summary: z.strictObject({
    label: z.literal('Entered maintenance-cost estimate'), entered_estimate: z.null(), coverage: z.literal('unavailable'), reason: z.literal('entered_costs_not_recorded'),
  }) }),
]);
// These rows are the allowlisted deterministic retrieval facts; no repair narratives or model arithmetic.
export type ReportFacts = z.output<typeof reportResult>;
export type ReportKind = z.output<typeof reportKind>;
