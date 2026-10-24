import { describe, expect, it } from 'vitest';
import { operationalWorkOrder } from './operational';

const id = 'c4a27337-9db2-4128-92db-c62b1e578397';
const human = {
  id, organization_id: id, number: 1, asset_id: id, source_request_id: null, title: 'Belt', description: 'Inspect', category: 'routine', priority: 'normal',
  due_at: '2026-10-25T00:00:00Z', planned_on: '2026-10-24', supervisor_id: id, status: 'scheduled', blocks_operation: true,
  created_by: id, created_at: '2026-10-24T00:00:00Z', version: 1, repair_revision: 1, submitted_revision: null,
  opened_at: null, completed_at: null, priority_reason: null,
};

describe('maintenance creation provenance', () => {
  it('decodes a generated Scheduled job without inventing a human creator', () => {
    const system = { ...human, blocks_operation: false, created_by: null, creation_actor_kind: 'system', pm_occurrence_id: id };
    expect(operationalWorkOrder.parse(system)).toEqual(system);
  });
  it('preserves legacy human responses and rejects nullable humans or unconstrained system sources', () => {
    expect(operationalWorkOrder.parse(human)).toEqual(human);
    for (const forged of [
      { ...human, created_by: null },
      { ...human, created_by: null, creation_actor_kind: 'human', pm_occurrence_id: null },
      { ...human, creation_actor_kind: 'system', pm_occurrence_id: id },
      { ...human, created_by: null, creation_actor_kind: 'system', pm_occurrence_id: null },
      { ...human, creation_actor_kind: 'human', pm_occurrence_id: id },
    ]) expect(operationalWorkOrder.safeParse(forged).success).toBe(false);
  });
});
