import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import type { Database } from '../../src/lib/database.types';
import { getReport } from '../../src/app/report-client';
import { enrollMfa } from './mfa';

const url = process.env.TEST_SUPABASE_URL!;
const anon = process.env.TEST_SUPABASE_ANON_KEY!;
const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, options);

function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated report export fixture failed; raw output withheld');
}

async function exportReport(token: string, organizationId: string, kind: string, range: { from: string; to: string }) {
  return fetch(`${url}/functions/v1/report-export`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ctx: { organization_id: organizationId }, kind, range }),
  });
}

it('denies low assurance, then exports the authorized cursor facts with live role and tenant checks', async () => {
  const organizationId = randomUUID();
  const email = `report-export-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}-Aa9!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  const actor = created.data.user!.id;
  const caller = createClient<Database>(url, anon, options);
  expect((await caller.auth.signInWithPassword({ email, password })).error).toBeNull();
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${organizationId}','Synthetic export workspace','Asia/Manila','PHP','${actor}');
   insert into public.organization_members(organization_id,user_id,role) values('${organizationId}','${actor}','owner');
   insert into public.assets(organization_id,code,name,category,created_by,created_at)
    select '${organizationId}','EXPORT-'||n,case when n=1 then '=SUM(1,2)' else 'Synthetic export asset '||n end,'pump','${actor}','2026-01-01T00:00:00Z' from generate_series(1,26)n;`);

  const range = { from: '2026-03-08', to: '2026-03-09' };
  let session = (await caller.auth.getSession()).data.session!;
  const lowAssurance = await exportReport(session.access_token, organizationId, 'asset_availability', range);
  expect(lowAssurance.status).toBe(403);
  expect(await lowAssurance.json()).toMatchObject({ code: 'MFA_REQUIRED' });

  await enrollMfa(caller);
  session = (await caller.auth.getSession()).data.session!;
  const firstPage = await getReport(caller, organizationId, 'asset_availability', range, { page_size: 100 });
  expect(firstPage.items).toHaveLength(26);
  const exportRequestedAt = Date.now();
  const response = await exportReport(session.access_token, organizationId, 'asset_availability', range);
  const exportResponseAt = Date.now();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/csv');
  expect(response.headers.get('cache-control')).toContain('no-store');
  const csv = await response.text();
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"Timezone","Asia/Manila"');
  expect(csv).toContain('"Currency","PHP"');
  for (const label of ['Report generated at', 'Export generated at']) {
    const timestamp = csv.match(new RegExp(`"${label}","([^"]+)"`))?.[1];
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
    const generatedAt = Date.parse(timestamp!);
    expect(Number.isNaN(generatedAt)).toBe(false);
    expect(generatedAt).toBeGreaterThanOrEqual(exportRequestedAt);
    expect(generatedAt).toBeLessThanOrEqual(exportResponseAt);
  }
  expect(csv).toContain('"\'=SUM(1,2)"');
  const exportedIds = firstPage.items.filter((item) => csv.split('\r\n').some((line) => line.startsWith(`"${item.id}"`)));
  expect(exportedIds).toHaveLength(firstPage.items.length);

  const otherTenant = await exportReport(session.access_token, randomUUID(), 'asset_availability', range);
  expect(otherTenant.status).toBe(403);
  expect(await otherTenant.json()).toMatchObject({ code: 'FORBIDDEN' });

  sql(`update public.organization_members set role='inventory' where organization_id='${organizationId}' and user_id='${actor}';`);
  const deniedRole = await exportReport(session.access_token, organizationId, 'maintenance_costs', range);
  expect(deniedRole.status).toBe(403);
  expect(await deniedRole.json()).toMatchObject({ code: 'FORBIDDEN' });

  sql(`update public.organization_members set role='owner',active=false where organization_id='${organizationId}' and user_id='${actor}';`);
  const revoked = await exportReport(session.access_token, organizationId, 'asset_availability', range);
  expect(revoked.status).toBe(403);
  expect(await revoked.json()).toMatchObject({ code: 'FORBIDDEN' });

  const stale = await exportReport('invalid.expired.token', organizationId, 'asset_availability', range);
  expect(stale.status).toBe(401);
  expect(await stale.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
});
