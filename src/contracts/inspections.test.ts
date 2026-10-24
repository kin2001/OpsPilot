import { expect, it } from 'vitest';
import { inspectionTemplateFields, inspectionResults } from './inspections';

const id = '00000032-0000-4000-8000-000000000001';
it('rejects duplicate checklist identities and unbounded templates', () => {
  const item = { id, label: 'Guard fitted', required: true, safety_relevant: true, evidence_required: true };
  expect(inspectionTemplateFields.safeParse({ title: 'Safety', items: [item, item] }).success).toBe(false);
  expect(inspectionTemplateFields.safeParse({ title: 'Safety', items: [item] }).success).toBe(true);
});
it('requires N/A reasons and rejects forged actor fields, duplicate items and duplicate evidence', () => {
  expect(inspectionResults.safeParse([{ item_id: id, outcome: 'not_applicable', evidence_ids: [] }]).success).toBe(false);
  expect(inspectionResults.safeParse([{ item_id: id, outcome: 'not_applicable', reason: 'No guard on this model', remarks: 'Model verified', evidence_ids: [] }]).success).toBe(true);
  expect(inspectionResults.safeParse([{ item_id: id, outcome: 'fail', evidence_ids: [] }]).success).toBe(false);
  const result = { item_id: id, outcome: 'fail', remarks: 'Guard missing', evidence_ids: [] };
  expect(inspectionResults.safeParse([{ ...result, actor_id: id }]).success).toBe(false);
  expect(inspectionResults.safeParse([result, result]).success).toBe(false);
  expect(inspectionResults.safeParse([{ ...result, evidence_ids: [id, id] }]).success).toBe(false);
});
