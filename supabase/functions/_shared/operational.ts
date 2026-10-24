import { z } from 'zod';

export const releaseAcknowledgment = z.string().trim().min(1).max(2000);
export const workUpdate = z.strictObject({
  note: z.string().trim().min(1).max(4000).optional(),
  labor_minutes: z.int().min(0).max(1440).optional(),
  task_id: z.uuid().optional(),
  task_completed: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().min(1).max(4000).optional(), category: z.string().trim().min(1).max(100).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(), priority_reason: releaseAcknowledgment.optional(), due_at: z.iso.datetime().nullable().optional(), supervisor_id: z.uuid().optional(),
}).refine((value) => Object.keys(value).length > 0)
  .refine((value) => (value.task_id !== undefined) === (value.task_completed !== undefined))
  .refine((value) => value.priority !== 'critical' || value.priority_reason !== undefined)
  .refine((value) => value.priority_reason === undefined || value.priority === 'critical');
export const imageMetadata = z.strictObject({
  name: z.string().trim().min(1).max(200).refine((value) => !/[\x00-\x1f\\/]/.test(value)),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.int().positive().max(5 * 1024 * 1024),
}).refine((value) => ({ 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'image/webp': /\.webp$/i })[value.media_type].test(value.name));

export const operationalWorkOrder = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), number: z.int(), asset_id: z.uuid(), source_request_id: z.uuid().nullable(),
  title: z.string(), description: z.string(), category: z.string(), priority: z.enum(['low', 'normal', 'high', 'critical']),
  due_at: z.string().nullable(), planned_on: z.iso.date().nullable().optional(), supervisor_id: z.uuid(), status: z.enum(['draft', 'open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review', 'completed', 'canceled']),
  blocks_operation: z.boolean(), created_by: z.uuid().nullable(), created_at: z.string(), version: z.int().positive(),
  creation_actor_kind: z.enum(['human', 'system']).optional(), pm_occurrence_id: z.uuid().nullable().optional(),
  repair_revision: z.int().positive(), submitted_revision: z.int().positive().nullable(), opened_at: z.string().nullable(), completed_at: z.string().nullable(), priority_reason: z.string().nullable(),
}).refine((row) => row.creation_actor_kind === 'system'
  ? row.created_by === null && row.pm_occurrence_id != null
  : row.created_by !== null && row.pm_occurrence_id == null);
export const attachmentRecord = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), work_order_id: z.uuid().nullable(), asset_id: z.uuid().nullable(), request_id: z.uuid().nullable(), object_key: z.string(), name: z.string(), media_type: imageMetadata.shape.media_type,
  size: z.int().positive(), uploader_id: z.uuid(), status: z.enum(['pending', 'ready', 'rejected']), checksum: z.string().nullable(),
  width: z.int().nullable(), height: z.int().nullable(), created_at: z.string(), ready_at: z.string().nullable(), cleanup_completed_at: z.string().nullable(),
});
export const assetHold = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), work_order_id: z.uuid().nullable(), source: z.enum(['work_order', 'manual', 'inspection']), source_id: z.uuid().nullable(),
  reason: z.string(), created_by: z.uuid(), created_at: z.string(), resolved_at: z.string().nullable(), resolution: z.string().nullable(), resolved_by: z.uuid().nullable(), released_at: z.string().nullable(),
});
export const assetRelease = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), actor_id: z.uuid(), checked_version: z.int().positive(), hold_ids: z.array(z.uuid()), acknowledgment: z.string(), created_at: z.string() });
export const meterReading = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), kind: z.enum(['hours', 'distance']), value: z.number().nonnegative(), observed_at: z.string(), recorded_at: z.string(), recorded_by: z.uuid(), correction_of: z.uuid().nullable(), correction_reason: z.string().nullable() });
export const settingsResult = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), ai_enabled: z.literal(false), evidence_required: z.boolean(), version: z.int().positive() });
export const teamResult = z.array(z.strictObject({ user_id: z.uuid(), role: z.enum(['owner', 'manager', 'supervisor', 'technician', 'inventory']), active: z.boolean(), version: z.int().positive() })).max(100);
export const performerDeclarationInput = z.array(z.uuid()).min(1).max(30).refine((ids) => new Set(ids).size === ids.length);
export const performerDeclaration = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), work_order_id: z.uuid(), user_id: z.uuid(), declared_by: z.uuid(), request_id: z.uuid(), repair_revision: z.int().positive(), created_at: z.string() });
export const submissionAttestation = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), work_order_id: z.uuid(), actor_id: z.uuid(), request_id: z.uuid(), repair_revision: z.int().positive(), performer_ids: performerDeclarationInput, acknowledgment: releaseAcknowledgment, created_at: z.string() });
export const workOrderTask = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), work_order_id: z.uuid(), label: z.string(), required: z.boolean(), completed: z.boolean(), completed_by: z.uuid().nullable(), completed_at: z.string().nullable() });
const administrativeValues = z.strictObject({ title: z.string(), description: z.string(), category: z.string(), priority: z.string(), priority_reason: z.string().nullable(), due_at: z.string().nullable(), planned_on: z.iso.date().nullable().optional(), supervisor_id: z.uuid() });
const administrativeEdit = z.strictObject({ title: z.string().optional(), description: z.string().optional(), category: z.string().optional(), priority: z.string().optional(), priority_reason: z.string().optional(), due_at: z.string().nullable().optional(), supervisor_id: z.uuid().optional() });
export const workOrderEvent = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), work_order_id: z.uuid(), actor_id: z.uuid(), request_id: z.uuid(), action: z.string(), status: operationalWorkOrder.shape.status, repair_revision: z.int().positive(), note: z.string().nullable(), labor_minutes: z.int().nullable(), changes: z.strictObject({ from_status: operationalWorkOrder.shape.status.optional(), prior_planned_on: z.iso.date().nullable().optional(), planned_on: z.iso.date().optional(), before: administrativeValues.optional(), submitted_fields: administrativeEdit.optional(), performer_ids: performerDeclarationInput.optional() }), created_at: z.string() });
export const workOrderReview = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), work_order_id: z.uuid(), reviewer_id: z.uuid(), repair_revision: z.int().positive(), decision: z.enum(['approved', 'returned']), reason: z.string(), created_at: z.string() });
export const notificationRecord = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), recipient_user_id: z.uuid(), event_id: z.uuid(), category: z.string(), source_id: z.uuid(), created_at: z.string(), read_at: z.string().nullable() });
const nonnegativeCount = z.int().nonnegative();
export const dashboardResult = z.strictObject({
  counts: z.strictObject({ active_assets: nonnegativeCount, available_assets: nonnegativeCount, active_work_orders: nonnegativeCount, blocked: nonnegativeCount, pending_approvals: nonnegativeCount, overdue: nonnegativeCount, completed: nonnegativeCount, completion_sample_size: nonnegativeCount, completion_seconds: z.number().nonnegative().nullable() }),
  daily_availability: z.array(z.strictObject({ date: z.iso.date(), known_assets: nonnegativeCount, available_assets: nonnegativeCount.nullable() })).max(7),
  downtime_seconds: z.number().nonnegative().nullable(), history_complete: z.boolean(), timezone: z.string(), from: z.string(), to: z.string(), generated_at: z.string(),
});
export const assetHistoryResult = z.strictObject({
  items: z.array(z.strictObject({ id: z.uuid(), occurred_at: z.string(), kind: z.enum(['work_order_event', 'review', 'availability', 'release']), actor_id: z.uuid(), work_order_id: z.uuid().nullable(), action: z.string(), status: z.string().nullable(), note: z.string().nullable(), repair_revision: z.int().positive().nullable(), availability: z.enum(['operational', 'under_maintenance', 'out_of_service', 'pending_release']).nullable(), active: z.boolean().nullable() })).max(50),
  next_cursor: z.strictObject({ at: z.string(), id: z.uuid() }).nullable(),
});

// Structural validation bounds decoding work; documents remain disabled until a scanner is available.
export function inspectImage(bytes: Uint8Array, mediaType: string): { width: number; height: number } {
  const invalid = (): never => { throw new Error('VALIDATION'); };
  if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024) return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  let width = 0; let height = 0;
  if (mediaType === 'image/png') {
    if (ascii(0, 8) !== '\x89PNG\r\n\x1a\n') return invalid();
    let offset = 8; let data = false; let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset); const type = ascii(offset + 4, 4);
      if (offset + 12 + length > bytes.length) return invalid();
      if (offset === 8) {
        if (type !== 'IHDR' || length !== 13) return invalid();
        width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      } else if (type === 'IHDR') return invalid();
      if (type === 'IDAT' && length > 0) data = true;
      offset += 12 + length;
      if (type === 'IEND') { if (length !== 0 || offset !== bytes.length) return invalid(); ended = true; break; }
    }
    if (!ended || !data) return invalid();
  } else if (mediaType === 'image/jpeg') {
    if (view.getUint16(0) !== 0xffd8 || view.getUint16(bytes.length - 2) !== 0xffd9) return invalid();
    let offset = 2; let scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) { scan = true; break; }
      if (offset + 2 > bytes.length) return invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker!)) {
        if (length < 8) return invalid();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      offset += length;
    }
    if (!scan) return invalid();
  } else if (mediaType === 'image/webp') {
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length || bytes.length < 30) return invalid();
    const kind = ascii(12, 4);
    if (kind === 'VP8X') {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (kind === 'VP8 ' && ascii(23, 3) === '\x9d\x01\x2a') {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else return invalid();
  } else return invalid();
  if (width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 40000000) return invalid();
  return { width, height };
}
