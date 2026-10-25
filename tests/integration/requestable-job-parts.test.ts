import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeEach, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { getJobParts, listInventoryParts, listRequestableJobParts, requestParts, savePart } from '../../src/app/inventory-client';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
let people: Record<string, { id: string; client: SupabaseClient<Database> }>; let org: string; let otherOrg: string; let job: string;
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Requestable-parts fixture SQL failed; raw output withheld');
}
// Ordinary cases own separate actors, tenants and command quotas.
beforeEach(async () => {
  people = {}; org = randomUUID(); otherOrg = randomUUID(); job = randomUUID(); const asset = randomUUID();
  for (const role of ['owner', 'technician', 'unassigned']) {
    const email = `lookup38-${role}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const client = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull(); people[role] = { id: created.data.user!.id, client };
  }
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${org}','Lookup38','UTC','PHP','${people.owner.id}'),('${otherOrg}','Other lookup38','UTC','PHP','${people.owner.id}');
   insert into public.organization_members(organization_id,user_id,role) values('${org}','${people.owner.id}','owner'),('${otherOrg}','${people.owner.id}','owner'),('${org}','${people.technician.id}','technician'),('${otherOrg}','${people.technician.id}','technician'),('${org}','${people.unassigned.id}','technician');
   insert into public.assets(id,organization_id,code,name,category,created_by) values('${asset}','${org}','L38','Synthetic pump','pump','${people.owner.id}');
   insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('${job}','${org}',1,'${asset}','Lookup job','Synthetic lookup','pump','normal','${people.owner.id}','open','${people.owner.id}');
   insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${org}','${job}','${people.technician.id}');`);
});
it('finds a first part and requests its exact decimal once with the original request ID', async () => {
  const created = await savePart(people.owner.client, org, { code: 'NEW', name: 'New lubricant', unit: 'kg', reorder_threshold: '9.000' }, randomUUID());
  const page = await listRequestableJobParts(people.technician.client, org, job);
  expect(page).toEqual({ items: [{ id: created.id, code: 'NEW', name: 'New lubricant', unit: 'kg' }], next_cursor: null });
  const requestId = randomUUID(); const fields = { work_order_id: job, lines: [{ part_id: page.items[0].id, unit: page.items[0].unit, quantity: '0.100' }] };
  const result = await requestParts(people.technician.client, org, fields, requestId, 1);
  expect(result.parts[0].requested).toBe('0.100');
  expect(await requestParts(people.technician.client, org, fields, requestId, 1)).toEqual(result);
  await expect(requestParts(people.technician.client, org, { ...fields, lines: [{ ...fields.lines[0], quantity: '0.200' }] }, requestId, 1)).rejects.toThrow('CONFLICT');
  await expect(listInventoryParts(people.technician.client, org)).rejects.toThrow('FORBIDDEN');
});
it('paginates active same-tenant identities without duplicates or archived/foreign disclosure', async () => {
  sql(`insert into public.parts(id,organization_id,code,name,unit,created_by) select gen_random_uuid(),'${org}','P'||n,'Synthetic '||n,'each','${people.owner.id}' from generate_series(1,101) n;
   insert into public.parts(organization_id,code,name,unit,created_by,archived_at) values('${org}','OLD','Archived','each','${people.owner.id}',now()),('${otherOrg}','FOREIGN','Other tenant','each','${people.owner.id}',null);`);
  const first = await listRequestableJobParts(people.technician.client, org, job, { page_size: 100 });
  expect(first.items).toHaveLength(100); expect(first.next_cursor).toBe(first.items[99].id);
  const second = await listRequestableJobParts(people.technician.client, org, job, { cursor: first.next_cursor!, page_size: 100 });
  expect(second.items).toHaveLength(1); expect(second.next_cursor).toBeNull();
  const all = [...first.items, ...second.items]; const ids = all.map((p) => p.id);
  expect(ids).toEqual([...ids].sort()); expect(new Set(ids).size).toBe(101);
  expect(all.every((p) => p.code !== 'OLD' && p.code !== 'FOREIGN')).toBe(true);
  expect((await people.technician.client.rpc('list_requestable_job_parts', { organization_id: org, work_order_id: job, page_size: 101 })).error?.message).toBe('VALIDATION');
});
it('denies unassigned, wrong-tenant, role-changed and revoked sessions before another page', async () => {
  await expect(listRequestableJobParts(people.unassigned.client, org, job)).rejects.toThrow('FORBIDDEN');
  await expect(listRequestableJobParts(people.technician.client, otherOrg, job)).rejects.toThrow('FORBIDDEN');
  await expect(listRequestableJobParts(people.owner.client, org, job)).rejects.toThrow('FORBIDDEN');
  sql(`update public.organization_members set role='inventory' where organization_id='${org}' and user_id='${people.technician.id}';`);
  await expect(listRequestableJobParts(people.technician.client, org, job)).rejects.toThrow('FORBIDDEN');
  sql(`update public.organization_members set role='technician',active=false where organization_id='${org}' and user_id='${people.technician.id}';`);
  await expect(listRequestableJobParts(people.technician.client, org, job)).rejects.toThrow('FORBIDDEN');
  sql(`update public.organization_members set active=true where organization_id='${org}' and user_id='${people.technician.id}'; update public.work_order_assignments set unassigned_at=now() where organization_id='${org}' and work_order_id='${job}';`);
  await expect(listRequestableJobParts(people.technician.client, org, job)).rejects.toThrow('FORBIDDEN');
});
it('rechecks archive, unit and job status at command time after a successful lookup', async () => {
  const part = await savePart(people.owner.client, org, { code: 'KG', name: 'Lubricant', unit: 'kg', reorder_threshold: null }, randomUUID());
  expect((await listRequestableJobParts(people.technician.client, org, job)).items[0].id).toBe(part.id);
  const fields = { work_order_id: job, lines: [{ part_id: part.id, unit: 'kg', quantity: '0.100' }] };
  await expect(requestParts(people.technician.client, org, { ...fields, lines: [{ ...fields.lines[0], unit: 'each' }] }, randomUUID(), 1)).rejects.toThrow('VALIDATION');
  await savePart(people.owner.client, org, { id: part.id, code: 'KG', name: 'Lubricant', unit: 'kg', reorder_threshold: null, archived: true }, randomUUID(), part.version);
  expect((await listRequestableJobParts(people.technician.client, org, job)).items).toEqual([]);
  await expect(requestParts(people.technician.client, org, fields, randomUUID(), 1)).rejects.toThrow('INVALID_TRANSITION');
  sql(`update public.work_orders set status='canceled' where organization_id='${org}' and id='${job}';`);
  await expect(requestParts(people.technician.client, org, fields, randomUUID(), 1)).rejects.toThrow('INVALID_TRANSITION');
  expect((await getJobParts(people.technician.client, org, job)).parts).toEqual([]);
});
