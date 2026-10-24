import { expect, it } from 'vitest';
import { inspectionCorrection, inspectionSubmission } from './inspections';
const id = '00000033-0000-4000-8000-000000000001';
const fields = { assignment_id: id, template_revision_id: id, supersedes_id: id, correction_reason: 'Rechecked guard', results: [{ item_id: id, outcome: 'pass', evidence_ids: [] }] };
it('requires explicit correction lineage and reason and forbids forged authors', () => {
  expect(inspectionCorrection.safeParse(fields).success).toBe(true);
  for (const changed of [{ supersedes_id: undefined }, { correction_reason: ' ' }, { inspector_id: id }, { results: [{ item_id: id, outcome: 'fail', evidence_ids: [] }] }]) {
    expect(inspectionCorrection.safeParse({ ...fields, ...changed }).success).toBe(false);
  }
});
it('parses immutable correction author and predecessor without accepting a reasonless correction', () => {
  const row = { id, organization_id: id, assignment_id: id, template_revision_id: id, inspector_id: id, submitted_at: '2026-10-24T00:00:00Z', results: fields.results, version: 2, supersedes_id: id, correction_reason: 'Rechecked guard' };
  expect(inspectionSubmission.safeParse(row).success).toBe(true);
  expect(inspectionSubmission.safeParse({ ...row, correction_reason: null }).success).toBe(false);
});
