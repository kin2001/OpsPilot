import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import type { Database } from '../../src/lib/database.types';
import { getReport } from '../../src/app/report-client';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, options);
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated report fixture SQL failed; raw output withheld');
}
it('round-trips all six fact envelopes through Auth/RPC and rechecks revocation on continuation', async () => {
  // This service case owns a new identity/tenant; pgTAP owns the independent known-answer data.
  const org = randomUUID(); const actorEmail = `reports39-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
  const created = await admin.auth.admin.createUser({ email: actorEmail, password, email_confirm: true }); expect(created.error).toBeNull();
  const actor = created.data.user!.id;
  const caller = createClient<Database>(url, anon, options);
  expect((await caller.auth.signInWithPassword({ email: actorEmail, password })).error).toBeNull();
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${org}','Synthetic reports39','America/New_York','USD','${actor}');
   insert into public.organization_members(organization_id,user_id,role) values('${org}','${actor}','owner');
   insert into public.assets(organization_id,code,name,category,created_by,created_at)
    select '${org}','R39-'||n,'Synthetic report asset','pump','${actor}','2026-01-01T00:00:00Z' from generate_series(1,26)n;`);
  const range = { from: '2026-03-08', to: '2026-03-09' };
  for (const kind of ['work_orders', 'asset_availability', 'pm_compliance', 'technician_assignments', 'parts_consumption', 'maintenance_costs'] as const) {
    const result = await getReport(caller, org, kind, range);
    expect(result.kind).toBe(kind); expect(result.currency).toBe('USD');
    expect(Date.parse(result.to) - Date.parse(result.from)).toBe(23 * 3600000);
    if (result.kind === 'asset_availability') {
      expect(result.items).toHaveLength(25); expect(result.next_cursor).not.toBeNull();
      expect(result.summary.downtime_seconds).toBeNull(); expect(result.summary.history_complete).toBe(false);
      const next = await getReport(caller, org, kind, range, result.next_cursor!);
      expect(next.items).toHaveLength(1); expect(next.items[0]!.id).not.toBe(result.items[24]!.id); expect(next.next_cursor).toBeNull();
    }
    if (result.kind === 'maintenance_costs') expect(result.summary.entered_estimate).toBeNull();
  }
  await expect(getReport(caller, org, 'work_orders', { from: '2024-01-01', to: '2025-01-02' })).rejects.toThrow();
  const raw = await caller.rpc('get_report', { ctx: { organization_id: org }, kind: 'work_orders', range: { from: '2024-01-01', to: '2025-01-02' } });
  expect(raw.error?.message).toBe('VALIDATION');
  const anonymous = createClient<Database>(url, anon, options);
  expect((await anonymous.rpc('get_report', { ctx: { organization_id: org }, kind: 'work_orders', range })).error).not.toBeNull();
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${actor}';`);
  await expect(getReport(caller, org, 'asset_availability', range)).rejects.toThrow('FORBIDDEN');
});
