import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { getReport } from './report-client';
import type { Database } from '../lib/database.types';

const org = '10000039-0000-4000-8000-000000000001';
const range = { from: '2026-10-01', to: '2026-10-02' };
const facts = { schema_version: 1, kind: 'maintenance_costs', timezone: 'Asia/Manila', currency: 'PHP', range,
  from: '2026-09-30T16:00:00Z', to: '2026-10-01T16:00:00Z', generated_at: '2026-10-25T00:00:00Z', next_cursor: null, items: [],
  summary: { label: 'Entered maintenance-cost estimate', entered_estimate: null, coverage: 'unavailable', reason: 'entered_costs_not_recorded' } };
function client(data: unknown, status = 200) {
  // The external transport is synthetic; actual Supabase serialization and report decoding run.
  return createClient<Database>('http://127.0.0.1:54321', 'synthetic-anon-key', { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) } });
}
it('returns validated allowlisted cost facts without replacing unknown with zero', async () => {
  expect(await getReport(client(facts), org, 'maintenance_costs', range)).toEqual(facts);
});
it('refuses extra retrieved fields, wrong kind, and mismatched range', async () => {
  for (const data of [{ ...facts, secret: 'untrusted' }, { ...facts, kind: 'work_orders' }, { ...facts, range: { ...range, to: '2026-10-03' } }]) {
    await expect(getReport(client(data), org, 'maintenance_costs', range)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
  }
});
it('preserves denied and expired-session errors from the server', async () => {
  for (const code of ['FORBIDDEN', 'UNAUTHENTICATED']) {
    await expect(getReport(client({ code: 'P0001', message: code }, 403), org, 'maintenance_costs', range)).rejects.toThrow(code);
  }
});
