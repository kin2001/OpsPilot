import { expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { publishInspectionTemplate, submitInspection, listInspectionAssignments, listInspectionTemplates, listInspectionRevisions, getInspection } from './inspection-client';
const id = '00000032-0000-4000-8000-000000000001';
const org = '10000032-0000-4000-8000-000000000001';
const requestId = '30000032-0000-4000-8000-000000000001';
const results = [{ item_id: id, outcome: 'fail' as const, remarks: 'Guard missing', evidence_ids: [id] }];
function fixture(body: unknown, status = 200) {
  const sent: { url: string; body: unknown }[] = [];
  const client = createClient<Database>('http://127.0.0.1:54321', 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const request = new Request(input, init); sent.push({ url: request.url, body: await request.json() }); return Response.json(body, { status });
  } } });
  return { client, sent };
}
it('sends pinned revision/results and preserves the caller retry identity without actor claims', async () => {
  const submission = { id, organization_id: org, assignment_id: id, template_revision_id: id, inspector_id: id, submitted_at: '2026-10-24T00:00:00Z', results, version: 1 };
  const f = fixture({ data: submission, version: 1, request_id: requestId });
  expect(await submitInspection(f.client, org, id, id, results, requestId)).toEqual(submission);
  expect(f.sent).toEqual([{ url: 'http://127.0.0.1:54321/rest/v1/rpc/submit_inspection', body: { ctx: { organization_id: org, request_id: requestId }, assignment_id: id, template_revision_id: id, results } }]);
});
it('fails closed for uncertain acknowledgement and preserves server conflict', async () => {
  const f = fixture({ data: {}, version: 1, request_id: id });
  await expect(submitInspection(f.client, org, id, id, results, requestId)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  const conflict = fixture({ message: 'CONFLICT', code: 'P0001' }, 400);
  await expect(submitInspection(conflict.client, org, id, id, results, requestId)).rejects.toThrow('CONFLICT');
});
it('rejects invalid writes and bounds reads before transport', () => {
  const f = fixture({});
  expect(() => publishInspectionTemplate(f.client, org, { id, title: 'Safety', items: [] }, requestId)).toThrow();
  expect(() => submitInspection(f.client, org, id, id, [{ item_id: id, outcome: 'not_applicable', evidence_ids: [] }], requestId)).toThrow();
  expect(() => listInspectionAssignments(f.client, org, { page_size: 101 })).toThrow();
  expect(() => listInspectionRevisions(f.client, org, id, { cursor: 0 })).toThrow();
  expect(f.sent).toEqual([]);
});
it('uses separate bounded reads and rejects malformed detail', async () => {
  const f = fixture({ items: [], next_cursor: null });
  await listInspectionAssignments(f.client, org, { cursor: id, page_size: 1 });
  await listInspectionTemplates(f.client, org);
  await listInspectionRevisions(f.client, org, id);
  expect(f.sent.map((r) => r.body)).toEqual([{ organization_id: org, cursor: id, page_size: 1 }, { organization_id: org, page_size: 25 }, { organization_id: org, template_id: id, page_size: 25 }]);
  await expect(getInspection(f.client, org, id)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
