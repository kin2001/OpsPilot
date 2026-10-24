import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeEach, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { savePart, saveStockLocation, receiveStock, adjustStock, listInventoryParts, listStockLocations, listInventoryBalances, listInventoryMovements } from '../../src/app/inventory-client';
import type { Database } from '../../src/lib/database.types';
import { enrollMfa } from './mfa';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
type Person = { id: string; client: SupabaseClient<Database> };
let people: Record<string, Person>; let org: string; let otherOrg: string; let part: string; let location: string;
const ctx = (request = randomUUID()) => ({ organization_id: org, request_id: request });
const fields = (quantity = '0.100') => ({ part_id: part, location_id: location, quantity, unit: 'kg' });
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated inventory fixture SQL failed; raw output withheld');
  return result.stdout.trim();
}
async function balance() { return (await listInventoryBalances(people.inventory.client, org, { part_id: part, location_id: location })).items[0]; }
function reconciles() {
  return sql(`select not exists(select 1 from public.inventory_balances b where b.organization_id='${org}' and (b.on_hand<0 or b.reserved<0 or b.available<>b.on_hand-b.reserved or b.on_hand<>coalesce((select sum(case when m.direction='in' then m.quantity else -m.quantity end) from public.inventory_movements m where m.organization_id=b.organization_id and m.part_id=b.part_id and m.location_id=b.location_id),0)));`);
}
// Ordinary cases own identities/tenants/quota. Deliberate contention and retry cases share only their own fixture.
beforeEach(async () => {
  people = {}; org = randomUUID(); otherOrg = randomUUID();
  for (const name of ['owner', 'inventory', 'manager', 'supervisor', 'technician', 'outsider']) {
    const email = `inventory35-${name}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const client = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    if (name !== 'inventory') await enrollMfa(client);
    people[name] = { id: created.data.user!.id, client };
  }
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${org}','Synthetic inventory35','UTC','PHP','${people.owner.id}'),('${otherOrg}','Other inventory35','UTC','PHP','${people.outsider.id}');
   insert into public.organization_members(organization_id,user_id,role) values('${org}','${people.owner.id}','owner'),('${org}','${people.inventory.id}','inventory'),('${org}','${people.manager.id}','manager'),('${org}','${people.supervisor.id}','supervisor'),('${org}','${people.technician.id}','technician'),('${otherOrg}','${people.outsider.id}','owner');`);
  part = (await savePart(people.owner.client, org, { code: 'KG', name: 'Synthetic lubricant', unit: 'kg', reorder_threshold: '0.100' }, randomUUID())).id;
  location = (await saveStockLocation(people.inventory.client, org, { code: 'A1', name: 'Synthetic shelf' }, randomUUID())).id;
});

it('receives exact decimals, acknowledges once under concurrent retries and preserves durable payload conflicts', async () => {
  const request = randomUUID(); const f = fields();
  const receipts = await Promise.all(Array.from({ length: 20 }, () => receiveStock(people.inventory.client, org, f, request)));
  expect(new Set(receipts.map((row) => row.id)).size).toBe(1);
  await receiveStock(people.inventory.client, org, fields('0.200'), randomUUID());
  expect(await balance()).toMatchObject({ on_hand: '0.300', reserved: '0.000', available: '0.300' });
  await expect(receiveStock(people.inventory.client, org, fields('0.101'), request)).rejects.toThrow('CONFLICT');
  expect((await listInventoryMovements(people.inventory.client, org)).items).toHaveLength(2);
  expect(reconciles()).toBe('t');
});
it('serializes 20 independent adjustment sessions without overdrawing the final ten milliunits', async () => {
  await receiveStock(people.owner.client, org, fields('0.010'), randomUUID());
  const admissions = await Promise.all(Array.from({ length: 20 }, async () => {
    // Distinct transport/client instances, each holding the same authorized synthetic AAL2 identity.
    const token = (await people.owner.client.auth.getSession()).data.session!.access_token;
    const client = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const response = await client.rpc('adjust_stock', { ctx: ctx(), fields: { ...fields('0.001'), direction: 'out', reason: 'Synthetic independent physical count' } });
    return response.error?.message ?? 'committed';
  }));
  expect(admissions.filter((value) => value === 'committed')).toHaveLength(10);
  expect(admissions.filter((value) => value === 'CONFLICT')).toHaveLength(10);
  expect(await balance()).toMatchObject({ on_hand: '0.000', reserved: '0.000', available: '0.000' });
  expect((await listInventoryMovements(people.owner.client, org)).items).toHaveLength(11);
  expect(reconciles()).toBe('t');
});
it('requires AAL2 and a reason for linked immutable full compensation, with revocation checked before replay', async () => {
  const receipt = await receiveStock(people.inventory.client, org, fields(), randomUUID());
  const f = { ...fields(), direction: 'out' as const, reason: 'Reverse mistaken receipt', correction_of: receipt.id };
  await expect(adjustStock(people.inventory.client, org, f, randomUUID())).rejects.toThrow('FORBIDDEN');
  await enrollMfa(people.inventory.client);
  const request = randomUUID(); const corrected = await adjustStock(people.inventory.client, org, f, request);
  expect(corrected).toMatchObject({ correction_of: receipt.id, quantity: '0.100', direction: 'out' });
  expect(await adjustStock(people.inventory.client, org, f, request)).toEqual(corrected);
  await expect(adjustStock(people.inventory.client, org, f, randomUUID())).rejects.toThrow('CONFLICT');
  await expect(adjustStock(people.inventory.client, org, { ...f, quantity: '0.001' }, randomUUID())).rejects.toThrow('VALIDATION');
  expect(await balance()).toMatchObject({ on_hand: '0.000', available: '0.000' });
  expect(reconciles()).toBe('t');
  sql(`update public.organization_members set role='manager' where organization_id='${org}' and user_id='${people.inventory.id}';`);
  await expect(adjustStock(people.inventory.client, org, f, request)).rejects.toThrow('FORBIDDEN');
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.inventory.id}';`);
  await expect(listInventoryParts(people.inventory.client, org)).rejects.toThrow('FORBIDDEN');
});
it('enforces role, tenant, unit, precision and API table boundaries without exposing unlinked inventory to technicians', async () => {
  for (const name of ['manager', 'supervisor', 'technician', 'outsider']) await expect(receiveStock(people[name].client, org, fields(), randomUUID())).rejects.toThrow('FORBIDDEN');
  for (const name of ['technician', 'outsider']) await expect(listInventoryParts(people[name].client, org)).rejects.toThrow('FORBIDDEN');
  expect((await listInventoryParts(people.manager.client, org)).items).toHaveLength(1);
  expect((await listStockLocations(people.supervisor.client, org)).items).toHaveLength(1);
  const otherLocation = (await saveStockLocation(people.outsider.client, otherOrg, { code: 'B1', name: 'Other shelf' }, randomUUID())).id;
  await expect(receiveStock(people.owner.client, org, { ...fields(), location_id: otherLocation }, randomUUID())).rejects.toThrow('NOT_FOUND');
  await expect(listInventoryMovements(people.owner.client, org, { location_id: otherLocation })).rejects.toThrow('NOT_FOUND');
  for (const quantity of [0.1, '0.0001', '-1', '1e1', '100000000000', null]) {
    expect((await people.owner.client.rpc('receive_stock', { ctx: ctx(), fields: { ...fields(), quantity } })).error?.message).toBe('VALIDATION');
  }
  await expect(receiveStock(people.owner.client, org, { ...fields(), unit: 'litre' }, randomUUID())).rejects.toThrow('VALIDATION');
  expect((await people.owner.client.rpc('adjust_stock', { ctx: ctx(), fields: { ...fields(), direction: 'in', reason: '\t\n\u00a0\ufeff' } })).error?.message).toBe('VALIDATION');
  for (const table of ['parts', 'stock_locations', 'inventory_balances', 'inventory_movements'] as const) {
    expect((await people.owner.client.from(table).select('*').limit(1)).error?.code).toBe('42501');
    expect((await admin.from(table).select('*').limit(1)).error?.code).toBe('42501');
  }
  expect((await admin.rpc('receive_stock', { ctx: ctx(), fields: fields() })).error?.code).toBe('42501');
});
it('keeps unit history fixed, enforces stale versions, and pages movements without duplicates or silent overflow', async () => {
  const updated = await savePart(people.owner.client, org, { id: part, code: 'KG', name: 'Revised name', unit: 'kg', reorder_threshold: null }, randomUUID(), 1);
  expect(updated.version).toBe(2);
  await expect(savePart(people.owner.client, org, { id: part, code: 'KG', name: 'Stale', unit: 'kg', reorder_threshold: null }, randomUUID(), 1)).rejects.toThrow('CONFLICT');
  for (let i = 0; i < 3; i++) await receiveStock(people.owner.client, org, fields('0.001'), randomUUID());
  await expect(savePart(people.owner.client, org, { id: part, code: 'KG', name: 'Changed unit', unit: 'litre', reorder_threshold: null }, randomUUID(), 2)).rejects.toThrow('INVALID_TRANSITION');
  const ids: string[] = []; let cursor: string | undefined;
  do {
    const page = await listInventoryMovements(people.owner.client, org, { page_size: 1, cursor }); ids.push(...page.items.map((row) => row.id)); cursor = page.next_cursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(3);
  await receiveStock(people.owner.client, org, fields('99999999999.996'), randomUUID());
  expect((await balance()).on_hand).toBe('99999999999.999');
  await expect(receiveStock(people.owner.client, org, fields('0.001'), randomUUID())).rejects.toThrow('VALIDATION');
  expect((await balance()).on_hand).toBe('99999999999.999');
  expect(reconciles()).toBe('t');
});
