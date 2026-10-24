import { describe, expect, it } from 'vitest';
import { maintenanceFields, maintenancePreview, maintenancePlanPage, maintenanceRevisionPage } from './maintenance';

const id = 'c4a27337-9db2-4128-92db-c62b1e578397';
const fields = { asset_id: id, title: 'Monthly inspection', instructions: 'Check belt tension', category: 'routine', cadence: 'month', frequency: 1, anchor_on: '2024-01-31', supervisor_id: id, assignee_ids: [id], checklist: ['Inspect belt'], status: 'active' };

describe('maintenance input boundary', () => {
  it('accepts a complete anchored calendar plan and preserves date-only identity', () => {
    expect(maintenanceFields.parse(fields)).toEqual(fields);
  });
  it.each([
    { frequency: 0 }, { frequency: 1.5 }, { frequency: 366 }, { cadence: 'hour' }, { anchor_on: '2025-02-29' },
    { title: '' }, { instructions: ' ' }, { checklist: [] }, { checklist: [' '] }, { assignee_ids: [] },
    { assignee_ids: [id, id] }, { assignee_ids: Array(31).fill(id) }, { checklist: Array(101).fill('Check') },
    { authorized_by: id }, { timezone: 'UTC' }, { actor_kind: 'system' }, { due_at: '2026-01-01T00:00:00Z' },
    { anchor_on: '0000-01-01' }, { anchor_on: '9999-12-31' },
  ])('rejects invalid cadence, personnel, content or forged authority: %j', (change) => {
    expect(maintenanceFields.safeParse({ ...fields, ...change }).success).toBe(false);
  });
});

describe('maintenance read boundary', () => {
  const preview = { plan_id: null, version: null, evaluated_at: '2026-10-24T05:00:00Z', old_local_date: null, new_local_date: '2026-10-24', protected_through: null,
    timezone: 'Asia/Manila', due_policy: 'local_day_end', first_new: { scheduled_local_date: '2024-01-31', timezone: 'Asia/Manila', due_at: '2024-01-31T16:00:00Z' },
    retained_backlog: [], backlog_has_more: false, personnel_eligible: true };
  it('requires explicit cutoff/zone and bounded retained-backlog data', () => {
    expect(maintenancePreview.parse(preview)).toEqual(preview);
    expect(maintenancePreview.safeParse({ ...preview, timezone: undefined }).success).toBe(false);
    expect(maintenancePreview.safeParse({ ...preview, first_new: { ...preview.first_new, due_at: null } }).success).toBe(false);
    expect(maintenancePreview.safeParse({ ...preview, first_new: { ...preview.first_new, due_at: 'viewer local midnight' } }).success).toBe(false);
    expect(maintenancePreview.safeParse({ ...preview, retained_backlog: Array(101).fill({}) }).success).toBe(false);
  });
  it('rejects overlarge pages and malformed continuation identities', () => {
    expect(maintenancePlanPage.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
    expect(maintenancePlanPage.safeParse({ items: [], next_cursor: 'invalid' }).success).toBe(false);
    expect(maintenancePlanPage.safeParse({ items: Array(101).fill({}), next_cursor: null }).success).toBe(false);
    expect(maintenanceRevisionPage.safeParse({ items: [], next_cursor: 0 }).success).toBe(false);
  });
});
