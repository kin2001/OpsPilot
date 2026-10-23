import { describe, expect, it } from 'vitest';
import { imageMetadata, inspectImage, workUpdate, releaseAcknowledgment, performerDeclarationInput, dashboardResult, assetHistoryResult, operationalWorkOrder } from '../../supabase/functions/_shared/operational';

describe('operational trust boundaries', () => {
  it('keeps legacy receipts strict while accepting an independent planned calendar date', () => {
    const id = 'c2daf4c7-e68c-4783-87c6-26b009a1169d';
    const legacy = { id, organization_id: id, number: 1, asset_id: id, source_request_id: null,
      title: 'Synthetic repair', description: 'Synthetic', category: 'pump', priority: 'normal', due_at: '2026-11-05T01:00:00Z',
      supervisor_id: id, status: 'scheduled', blocks_operation: true, created_by: id, created_at: '2026-10-23T00:00:00Z', version: 2,
      repair_revision: 1, submitted_revision: null, opened_at: '2026-10-23T00:00:00Z', completed_at: null, priority_reason: null };
    expect(operationalWorkOrder.parse(legacy)).toEqual(legacy);
    expect(operationalWorkOrder.parse({ ...legacy, planned_on: null }).planned_on).toBeNull();
    const scheduled = operationalWorkOrder.parse({ ...legacy, planned_on: '2026-10-31' });
    expect(scheduled.planned_on).toBe('2026-10-31'); expect(scheduled.due_at).toBe(legacy.due_at);
    for (const planned_on of ['2026-02-30', 'infinity', '2026-10-31T00:00:00Z', 123]) expect(operationalWorkOrder.safeParse({ ...legacy, planned_on }).success).toBe(false);
    expect(operationalWorkOrder.safeParse({ ...legacy, planned_on: '2026-10-31', unexpected: true }).success).toBe(false);
    expect(workUpdate.safeParse({ planned_on: '2026-10-31' }).success).toBe(false);
  });
  it('rejects empty or duplicate performer declarations and unknown read-model fields', () => {
    expect(performerDeclarationInput.safeParse([]).success).toBe(false);
    const actor = 'c2daf4c7-e68c-4783-87c6-26b009a1169d';
    expect(performerDeclarationInput.safeParse([actor, actor]).success).toBe(false);
    expect(performerDeclarationInput.parse([actor])).toEqual([actor]);
    expect(dashboardResult.safeParse({ counts: {}, unexpected: true }).success).toBe(false);
    expect(assetHistoryResult.safeParse({ items: [], next_cursor: null, private_audit: [] }).success).toBe(false);
  });
  it('rejects administrative and review fields in repair updates', () => {
    expect(workUpdate.safeParse({ note: 'Replaced seal', status: 'completed' }).success).toBe(false);
    expect(workUpdate.safeParse({ note: 'Replaced seal', labor_minutes: 30 }).success).toBe(true);
    expect(workUpdate.safeParse({ labor_minutes: -1 }).success).toBe(false);
    expect(releaseAcknowledgment.safeParse(' ').success).toBe(false);
  });
  it('allows only bounded supported private image metadata', () => {
    expect(imageMetadata.safeParse({ name: 'evidence.png', media_type: 'image/png', size: 12 }).success).toBe(true);
    for (const value of [
      { name: '../evidence.png', media_type: 'image/png', size: 12 },
      { name: 'evidence.pdf', media_type: 'application/pdf', size: 12 },
      { name: 'evidence.png', media_type: 'image/png', size: 5 * 1024 * 1024 + 1 },
    ]) expect(imageMetadata.safeParse(value).success).toBe(false);
  });
  it('rejects MIME spoofing and truncated image structures', () => {
    expect(() => inspectImage(new Uint8Array([0xff, 0xd8, 0xff]), 'image/png')).toThrow('VALIDATION');
    expect(() => inspectImage(new TextEncoder().encode('<svg/>'), 'image/png')).toThrow('VALIDATION');
    expect(() => inspectImage(new Uint8Array(0), 'image/jpeg')).toThrow('VALIDATION');
    const valid = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64'));
    expect(inspectImage(valid, 'image/png')).toEqual({ width: 1, height: 1 });
    expect(() => inspectImage(valid.subarray(0, valid.length - 1), 'image/png')).toThrow('VALIDATION');
  });
});
