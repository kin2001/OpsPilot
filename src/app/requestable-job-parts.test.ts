import { expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { listRequestableJobParts } from './inventory-client';
import { requestableJobPartPage } from '../contracts/inventory';

const org = '10000038-0000-4000-8000-000000000001';
const job = '30000038-0000-4000-8000-000000000001';
const part = { id: '40000038-0000-4000-8000-000000000001', code: 'KG', name: 'Lubricant', unit: 'kg' };
function fixture(body: unknown, status = 200) {
  const sent: unknown[] = [];
  const client = createClient<Database>('http://127.0.0.1:54321', 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toMatch(/\/rpc\/list_requestable_job_parts$/);
    sent.push(await request.json());
    return Response.json(body, { status });
  } } });
  return { client, sent };
}
it('returns only requestable identities and scopes every page to the job', async () => {
  const page = { items: [part], next_cursor: part.id };
  const f = fixture(page);
  expect(await listRequestableJobParts(f.client, org, job)).toEqual(page);
  await listRequestableJobParts(f.client, org, job, { cursor: part.id, page_size: 1 });
  expect(f.sent).toEqual([{ organization_id: org, work_order_id: job, page_size: 25 }, { organization_id: org, work_order_id: job, cursor: part.id, page_size: 1 }]);
});
it('rejects malformed identity, cursor and page limits before transport', () => {
  const f = fixture({});
  for (const paging of [{ page_size: 0 }, { page_size: 101 }, { cursor: 'bad' }]) expect(() => listRequestableJobParts(f.client, org, job, paging)).toThrow();
  expect(() => listRequestableJobParts(f.client, org, 'bad')).toThrow();
  expect(f.sent).toEqual([]);
});
it('fails closed on disclosure, malformed pages and authorization errors', async () => {
  for (const body of [{ items: [{ ...part, reorder_threshold: '1' }], next_cursor: null }, { items: [part], next_cursor: 'bad' }, { items: Array(101).fill(part), next_cursor: null }]) {
    expect(requestableJobPartPage.safeParse(body).success).toBe(false);
    await expect(listRequestableJobParts(fixture(body).client, org, job)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  }
  await expect(listRequestableJobParts(fixture({ message: 'FORBIDDEN', code: 'P0001' }, 400).client, org, job)).rejects.toThrow('FORBIDDEN');
});
