import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeEach, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { savePart, saveStockLocation, receiveStock, adjustStock, listInventoryBalances, listInventoryMovements, requestParts, reserveParts, releaseReservation, issueReservedStock, returnStock, getJobParts } from '../../src/app/inventory-client';
import { enrollMfa } from './mfa';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
let people: Record<string, { id: string; client: SupabaseClient<Database> }>; let org: string; let otherOrg: string; let job: string; let part: string; let location: string;
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Job-parts fixture SQL failed; raw output withheld'); return result.stdout.trim();
}
const lines = (quantity = '1.000') => ({ work_order_id: job, lines: [{ part_id: part, quantity, unit: 'kg' }] });
const reserved = (quantity = '1.000') => ({ work_order_id: job, lines: [{ part_id: part, location_id: location, quantity, unit: 'kg' }] });
const movement = (id: string, quantity = '1.000') => ({ work_order_id: job, lines: [{ reservation_id: id, quantity, unit: 'kg' }] });
async function read() { return getJobParts(people.inventory.client, org, job); }
async function balance() { return (await listInventoryBalances(people.inventory.client, org)).items[0]; }
async function requested(quantity = '1.000') { return requestParts(people.technician.client, org, lines(quantity), randomUUID(), (await read()).version); }
async function reserve(quantity = '1.000') { return reserveParts(people.manager.client, org, reserved(quantity), randomUUID(), (await read()).version); }
// Every ordinary scenario owns its actors, quota and tenant; deliberate races share only this scenario.
beforeEach(async () => {
  people = {}; org = randomUUID(); otherOrg = randomUUID(); job = randomUUID(); const asset = randomUUID();
  for (const role of ['owner', 'inventory', 'manager', 'supervisor', 'technician', 'outsider']) {
    const email = `job36-${role}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const client = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull(); people[role] = { id: created.data.user!.id, client };
  }
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${org}','Synthetic job36','UTC','PHP','${people.owner.id}'),('${otherOrg}','Other job36','UTC','PHP','${people.outsider.id}');
   insert into public.organization_members(organization_id,user_id,role) values ${['owner', 'inventory', 'manager', 'supervisor', 'technician'].map((role) => `('${org}','${people[role].id}','${role}')`).join(',')},('${otherOrg}','${people.outsider.id}','owner');
   insert into public.assets(id,organization_id,code,name,category,created_by) values('${asset}','${org}','P36','Synthetic pump','pump','${people.owner.id}');
   insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('${job}','${org}',1,'${asset}','Synthetic job','Synthetic job parts','pump','normal','${people.supervisor.id}','open','${people.owner.id}');
   insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${org}','${job}','${people.technician.id}');`);
  part = (await savePart(people.owner.client, org, { code: 'KG', name: 'Synthetic part', unit: 'kg', reorder_threshold: null }, randomUUID())).id;
  location = (await saveStockLocation(people.owner.client, org, { code: 'L1', name: 'Synthetic shelf' }, randomUUID())).id;
  await receiveStock(people.owner.client, org, { ...reserved('10.000').lines[0] }, randomUUID());
});
it('posts partial issues once after lost replies, bounds net returns and preserves cancellation history', async () => {
  await requested('5.000'); let state = await reserve('5.000'); const id = state.reservations[0].id;
  const request = randomUUID(); const version = state.version;
  state = await issueReservedStock(people.inventory.client, org, movement(id, '2.000'), request, version);
  expect(await issueReservedStock(people.inventory.client, org, movement(id, '2.000'), request, version)).toEqual(state);
  await expect(issueReservedStock(people.inventory.client, org, movement(id, '1.000'), request, version)).rejects.toThrow('CONFLICT');
  expect(await balance()).toMatchObject({ on_hand: '8.000', reserved: '3.000', available: '5.000' });
  const canceled = await people.manager.client.rpc('transition_work_order', { ctx: { organization_id: org, request_id: randomUUID(), expected_version: state.version }, id: job, target: 'canceled', reason: 'Unused allocation released' }); expect(canceled.error).toBeNull();
  state = await read(); expect(state.reservations[0]).toMatchObject({ reserved: '0.000', issued: '2.000', released: '3.000' });
  const returnRequest = randomUUID(); const returnVersion = state.version;
  state = await returnStock(people.owner.client, org, movement(id), returnRequest, returnVersion);
  expect(await returnStock(people.owner.client, org, movement(id), returnRequest, returnVersion)).toEqual(state);
  await expect(returnStock(people.owner.client, org, movement(id, '1.001'), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  expect(await balance()).toMatchObject({ on_hand: '9.000', reserved: '0.000', available: '9.000' });
  expect(state.reconciliation_state).toBe('consistent');
  expect((await listInventoryMovements(people.owner.client, org)).items.filter((m) => m.kind === 'issue')).toHaveLength(1);
});
it('rolls back all lines, rejects duplicates, exact-precision violations and stale new commands', async () => {
  let state = await requested('5.000');
  const other = (await savePart(people.owner.client, org, { code: 'P2', name: 'Second part', unit: 'kg', reorder_threshold: null }, randomUUID())).id;
  await expect(reserveParts(people.manager.client, org, { work_order_id: job, lines: [...reserved().lines, { part_id: other, location_id: location, quantity: '1', unit: 'kg' }] }, randomUUID(), state.version)).rejects.toThrow('NOT_FOUND');
  expect(await balance()).toMatchObject({ reserved: '0.000', on_hand: '10.000' }); expect((await read()).version).toBe(state.version);
  for (const quantity of ['0.0001', 1, '0', '1e1']) {
    expect((await people.technician.client.rpc('request_parts', { ctx: { organization_id: org, request_id: randomUUID(), expected_version: state.version }, fields: { work_order_id: job, lines: [{ part_id: part, quantity, unit: 'kg' }] } })).error?.message).toBe('VALIDATION');
  }
  expect((await people.technician.client.rpc('request_parts', { ctx: { organization_id: org, request_id: randomUUID(), expected_version: state.version }, fields: { work_order_id: job, lines: [lines().lines[0], lines().lines[0]] } })).error?.message).toBe('VALIDATION');
  const old = state.version; state = await reserve('2.000');
  await expect(releaseReservation(people.manager.client, org, movement(state.reservations[0].id), randomUUID(), old)).rejects.toThrow('CONFLICT');
  state = await releaseReservation(people.supervisor.client, org, movement(state.reservations[0].id), randomUUID(), state.version);
  await expect(issueReservedStock(people.owner.client, org, movement(state.reservations[0].id, '1.001'), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
});
it('checks current role, tenant and assignment before receipts and keeps minimal job reads private', async () => {
  const request = randomUUID(); await requestParts(people.technician.client, org, lines(), request, 1);
  for (const role of ['owner', 'manager', 'inventory', 'supervisor', 'outsider']) await expect(requestParts(people[role].client, org, lines(), randomUUID(), 2)).rejects.toThrow('FORBIDDEN');
  await expect(reserveParts(people.technician.client, org, reserved(), randomUUID(), 2)).rejects.toThrow('FORBIDDEN');
  let state = await reserve();
  for (const role of ['manager', 'supervisor', 'technician', 'outsider']) await expect(issueReservedStock(people[role].client, org, movement(state.reservations[0].id), randomUUID(), state.version)).rejects.toThrow('FORBIDDEN');
  await expect(getJobParts(people.outsider.client, org, job)).rejects.toThrow('FORBIDDEN');
  await expect(getJobParts(people.technician.client, otherOrg, job)).rejects.toThrow('FORBIDDEN');
  expect(Object.keys(await read()).sort()).toEqual(['id', 'number', 'parts', 'reconciliation_state', 'reservations', 'status', 'version']);
  sql(`update public.work_order_assignments set unassigned_at=now() where work_order_id='${job}';`);
  await expect(requestParts(people.technician.client, org, lines(), request, 1)).rejects.toThrow('FORBIDDEN');
  const post = randomUUID(); const version = state.version; state = await issueReservedStock(people.inventory.client, org, movement(state.reservations[0].id), post, version);
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.inventory.id}';`);
  await expect(issueReservedStock(people.inventory.client, org, movement(state.reservations[0].id), post, version)).rejects.toThrow('FORBIDDEN');
  for (const table of ['work_order_parts', 'stock_reservations', 'job_stock_movements'] as const) {
    expect((await admin.from(table).select('*').limit(1)).error?.code).toBe('42501');
    expect((await people.owner.client.from(table).select('*').limit(1)).error?.code).toBe('42501');
  }
});
it('admits twenty competing jobs without overdraw and keeps independent expected-version semantics', async () => {
  const jobs = [job, ...Array.from({ length: 19 }, () => randomUUID())];
  sql(jobs.slice(1).map((id, index) => `insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) select '${id}',organization_id,${index + 2},asset_id,title,description,category,priority,supervisor_id,status,created_by from public.work_orders where id='${job}';insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${org}','${id}','${people.technician.id}');`).join('\n'));
  for (const id of jobs) await requestParts(people.technician.client, org, { ...lines(), work_order_id: id }, randomUUID(), 1);
  const results = await Promise.allSettled(jobs.map((id) => reserveParts(people.manager.client, org, { ...reserved(), work_order_id: id }, randomUUID(), 2)));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
  for (const result of results) if (result.status === 'rejected') expect(result.reason.message).toBe('CONFLICT');
  expect(await balance()).toMatchObject({ on_hand: '10.000', reserved: '10.000', available: '0.000' });
  expect((await read()).reconciliation_state).toBe('consistent');
  const winner = results.find((result) => result.status === 'fulfilled');
  expect(winner?.status).toBe('fulfilled');
  if (winner?.status !== 'fulfilled') throw new Error('Missing admitted job');
  const allocation = winner.value;
  const posted = await Promise.allSettled(Array.from({ length: 20 }, () => issueReservedStock(people.inventory.client, org, { work_order_id: allocation.id, lines: [{ reservation_id: allocation.reservations[0].id, quantity: '1.000', unit: 'kg' }] }, randomUUID(), allocation.version)));
  expect(posted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  for (const result of posted) if (result.status === 'rejected') expect(result.reason.message).toBe('CONFLICT');
  expect(await balance()).toMatchObject({ on_hand: '9.000', reserved: '9.000', available: '0.000' });
});
it('keeps two-line physical issue identity atomic and never consumes again when reviewed work reopens', async () => {
  await requested('2.000');
  const second = await saveStockLocation(people.owner.client, org, { code: 'L2', name: 'Second shelf' }, randomUUID());
  await receiveStock(people.owner.client, org, { ...reserved().lines[0], location_id: second.id }, randomUUID());
  let state = await reserveParts(people.manager.client, org, { work_order_id: job, lines: [reserved().lines[0], { ...reserved().lines[0], location_id: second.id }] }, randomUUID(), 2);
  const fields = { work_order_id: job, lines: state.reservations.map((r) => ({ reservation_id: r.id, quantity: '1.000', unit: 'kg' })) };
  const request = randomUUID(); const version = state.version;
  state = await issueReservedStock(people.owner.client, org, fields, request, version);
  expect(await issueReservedStock(people.owner.client, org, fields, request, version)).toEqual(state);
  expect(sql(`select count(*) from public.inventory_movements where organization_id='${org}' and request_id='${request}';`)).toBe('2');
  const originalStock = (await listInventoryBalances(people.owner.client, org)).items;
  const ctx = (expected_version: number) => ({ organization_id: org, request_id: randomUUID(), expected_version });
  sql(`update public.organization_settings set evidence_required=false where organization_id='${org}';`);
  const started = await people.technician.client.rpc('transition_work_order', { ctx: ctx(state.version), id: job, target: 'in_progress' }); expect(started.error).toBeNull();
  const declared = await people.technician.client.rpc('declare_work_order_performers', { ctx: ctx(Number((started.data as { version: number }).version)), id: job, user_ids: [people.technician.id] }); expect(declared.error).toBeNull();
  const submitted = await people.technician.client.rpc('submit_work_order', { ctx: ctx(Number((declared.data as { version: number }).version)), id: job, acknowledgment: 'All actual repair performers declared' }); expect(submitted.error).toBeNull();
  await enrollMfa(people.supervisor.client);
  const reviewed = await people.supervisor.client.rpc('review_work_order', { ctx: ctx(Number((submitted.data as { version: number }).version)), id: job, decision: 'approved', reason: 'Synthetic independent review' }); expect(reviewed.error).toBeNull();
  const reopened = await people.manager.client.rpc('transition_work_order', { ctx: ctx(Number((reviewed.data as { version: number }).version)), id: job, target: 'in_progress', reason: 'Synthetic further repair' }); expect(reopened.error).toBeNull();
  expect((await listInventoryBalances(people.owner.client, org)).items).toEqual(originalStock);
  expect((await read()).parts[0]).toMatchObject({ issued: '2.000', reserved: '0.000', returned: '0.000' });
  expect(sql(`select count(*) from public.job_stock_movements where organization_id='${org}';`)).toBe('2');
});
it('routes job movement reversals through net-issued returns while preserving legacy AAL2 receipt compensation', async () => {
  await requested(); let state = await reserve(); const id = state.reservations[0].id;
  state = await issueReservedStock(people.owner.client, org, movement(id), randomUUID(), state.version);
  const issue = (await listInventoryMovements(people.owner.client, org)).items.find((row) => row.kind === 'issue')!;
  await enrollMfa(people.owner.client);
  const correction = { ...reserved().lines[0], direction: 'in' as const, reason: 'Attempted issue reversal through wrong command', correction_of: issue.id };
  await expect(adjustStock(people.owner.client, org, correction, randomUUID())).rejects.toThrow('INVALID_TRANSITION');
  expect(await balance()).toMatchObject({ on_hand: '9.000', reserved: '0.000' });
  const returnRequest = randomUUID(); const returnVersion = state.version;
  state = await returnStock(people.owner.client, org, movement(id), returnRequest, returnVersion);
  expect(await returnStock(people.owner.client, org, movement(id), returnRequest, returnVersion)).toEqual(state);
  await expect(returnStock(people.owner.client, org, movement(id), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  const rows = (await listInventoryMovements(people.owner.client, org)).items;
  const returned = rows.find((row) => row.kind === 'return')!;
  await expect(adjustStock(people.owner.client, org, { ...correction, direction: 'out', correction_of: returned.id }, randomUUID())).rejects.toThrow('INVALID_TRANSITION');
  expect(await balance()).toMatchObject({ on_hand: '10.000', reserved: '0.000' });
  const receipt = rows.find((row) => row.kind === 'receipt')!;
  const receiptFields = { ...correction, direction: 'out' as const, quantity: '10.000', correction_of: receipt.id }; const receiptRequest = randomUUID();
  const compensated = await adjustStock(people.owner.client, org, receiptFields, receiptRequest);
  expect(await adjustStock(people.owner.client, org, receiptFields, receiptRequest)).toEqual(compensated);
  expect(await balance()).toMatchObject({ on_hand: '0.000', reserved: '0.000' });
  const adjustmentFields = { ...receiptFields, direction: 'in' as const, correction_of: compensated.id }; const adjustmentRequest = randomUUID();
  const restored = await adjustStock(people.owner.client, org, adjustmentFields, adjustmentRequest);
  expect(await adjustStock(people.owner.client, org, adjustmentFields, adjustmentRequest)).toEqual(restored);
  expect(await balance()).toMatchObject({ on_hand: '10.000', reserved: '0.000' });
  expect((await read()).reconciliation_state).toBe('consistent');
});

it('rejects UUID identity duplicates at every direct RPC boundary before resolving lines', async () => {
  const lower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const upper = lower.toUpperCase();
  const line = { part_id: lower, quantity: '1.000', unit: 'kg' }; const allocation = { ...line, location_id: lower };
  const reservation = { reservation_id: lower, quantity: '1.000', unit: 'kg' }; const before = await read();
  const cases: { command: 'request_parts' | 'reserve_parts' | 'release_reservation' | 'issue_reserved_stock' | 'return_stock'; role: string; lines: Record<string, string>[] }[] = [
    { command: 'request_parts', role: 'technician', lines: [line, { ...line, part_id: upper }] },
    { command: 'reserve_parts', role: 'manager', lines: [allocation, { ...allocation, part_id: upper }] },
    { command: 'reserve_parts', role: 'manager', lines: [allocation, { ...allocation, location_id: upper }] },
    ...(['release_reservation', 'issue_reserved_stock', 'return_stock'] as const).map((command) => ({ command, role: 'inventory', lines: [reservation, { ...reservation, reservation_id: upper }] })),
  ];
  for (const scenario of cases) {
    const result = await people[scenario.role].client.rpc(scenario.command, { ctx: { organization_id: org, request_id: randomUUID(), expected_version: before.version }, fields: { work_order_id: job, lines: scenario.lines } });
    expect(result.error?.message).toBe('VALIDATION');
  }
  expect(await read()).toEqual(before);
  expect(await balance()).toMatchObject({ on_hand: '10.000', reserved: '0.000' });
});

it('records explicit shortage blocks, notifies inventory, and requires coordinator resume after receipt and issue', async () => {
  const ctx = (version: number) => ({ organization_id: org, request_id: randomUUID(), expected_version: version });
  let state = await requested('12.000');
  let result = await people.technician.client.rpc('transition_work_order', { ctx: ctx(state.version), id: job, target: 'in_progress' }); expect(result.error).toBeNull();
  state = await read();
  const blockArgs = { ctx: ctx(state.version), id: job, target: 'blocked', reason: 'Awaiting requested parts' };
  const blocked = await people.technician.client.rpc('transition_work_order', blockArgs); expect(blocked.error).toBeNull();
  expect((await people.technician.client.rpc('transition_work_order', blockArgs)).data).toEqual(blocked.data);
  const notices = await people.inventory.client.from('notifications').select('*').eq('organization_id', org).eq('category', 'blocked_parts');
  expect(notices.error).toBeNull(); expect(notices.data).toHaveLength(1); expect(notices.data![0].source_id).toBe(job);
  expect(sql(`select changes#>>'{parts_shortages,0,shortage}' from public.work_order_events where organization_id='${org}' and status='blocked';`)).toBe('12.000');
  state = await read();
  expect((await people.manager.client.rpc('transition_work_order', { ctx: ctx(state.version), id: job, target: 'in_progress', reason: 'Too soon' })).error?.message).toBe('INVALID_TRANSITION');
  await receiveStock(people.inventory.client, org, { ...reserved('2.000').lines[0] }, randomUUID());
  expect((await read()).status).toBe('blocked');
  state = await reserve('12.000');
  state = await issueReservedStock(people.inventory.client, org, movement(state.reservations[0].id, '12.000'), randomUUID(), state.version);
  expect(state.status).toBe('blocked'); expect(state.parts[0].shortage).toBe('0.000');
  expect((await people.technician.client.rpc('transition_work_order', { ctx: ctx(state.version), id: job, target: 'in_progress', reason: 'Cannot authorize own resume' })).error?.message).toBe('FORBIDDEN');
  result = await people.manager.client.rpc('transition_work_order', { ctx: ctx(state.version), id: job, target: 'in_progress', reason: 'Parts physically issued; resume authorized' }); expect(result.error).toBeNull();
  expect((await read()).status).toBe('in_progress');
  expect(sql(`select count(*) from public.asset_releases where organization_id='${org}';`)).toBe('0');
  sql(`update public.organization_settings set evidence_required=false where organization_id='${org}';`);
  const declared = await people.technician.client.rpc('declare_work_order_performers', { ctx: ctx((await read()).version), id: job, user_ids: [people.technician.id, people.manager.id] }); expect(declared.error).toBeNull();
  const submitted = await people.technician.client.rpc('submit_work_order', { ctx: ctx((await read()).version), id: job, acknowledgment: 'All actual synthetic performers recorded' }); expect(submitted.error).toBeNull();
  await enrollMfa(people.supervisor.client);
  const reviewed = await people.supervisor.client.rpc('review_work_order', { ctx: ctx((await read()).version), id: job, decision: 'approved', reason: 'Independent synthetic review' }); expect(reviewed.error).toBeNull();
  expect((await read()).status).toBe('completed');
  expect(sql(`select count(*) from public.asset_releases where organization_id='${org}';`)).toBe('0');
  await enrollMfa(people.owner.client);
  const assetId = sql(`select asset_id from public.work_orders where id='${job}';`);
  const assetVersion = Number(sql(`select version from public.assets where id='${assetId}';`));
  const released = await people.owner.client.rpc('release_asset', { ctx: { organization_id: org, request_id: randomUUID(), expected_version: assetVersion }, asset_id: assetId, acknowledgment: 'Independent synthetic release checks complete' }); expect(released.error).toBeNull();
  expect(sql(`select availability from public.assets where id='${assetId}';`)).toBe('operational');
});

it('deduplicates exact threshold crossings per location and recipient until restocked above', async () => {
  await savePart(people.owner.client, org, { id: part, code: 'KG', name: 'Synthetic part', unit: 'kg', reorder_threshold: '9.000' }, randomUUID(), 1);
  const second = await saveStockLocation(people.owner.client, org, { code: 'LOW2', name: 'Independent location' }, randomUUID());
  const receiptArgs = { part_id: part, location_id: second.id, quantity: '9.000', unit: 'kg' }; const request = randomUUID();
  await receiveStock(people.owner.client, org, receiptArgs, request);
  await receiveStock(people.owner.client, org, receiptArgs, request);
  const count = () => sql(`select count(*) from public.notifications where organization_id='${org}' and category='low_stock';`);
  expect(count()).toBe('4');
  await requested('2.000'); let state = await reserve('1.000');
  expect(count()).toBe('8'); // Equality at the first shelf is another independent crossing.
  state = await issueReservedStock(people.inventory.client, org, movement(state.reservations[0].id), randomUUID(), state.version);
  expect(count()).toBe('8');
  await receiveStock(people.owner.client, org, { ...receiptArgs, location_id: location, quantity: '1.000' }, randomUUID());
  expect(count()).toBe('8');
  await reserve('1.000'); expect(count()).toBe('12');
  const ownerRows = await people.owner.client.from('notifications').select('*').eq('organization_id', org).eq('category', 'low_stock');
  expect(ownerRows.data).toHaveLength(3);
  expect(new Set(ownerRows.data!.map((row) => row.event_id)).size).toBe(3);
  expect((await people.technician.client.from('notifications').select('*').eq('organization_id', org).eq('category', 'low_stock')).data).toEqual([]);
  expect((await people.outsider.client.from('notifications').select('*').eq('organization_id', org)).data).toEqual([]);
  expect((await admin.schema('public').from('inventory_balances').select('*')).error?.code).toBe('42501');
});

it('blocks affected stock/cancellation on authoritative discrepancies but preserves authorized receipts and unaffected locations', async () => {
  await requested('4.000'); let state = await reserve('2.000'); const reservation = state.reservations[0].id;
  const request = randomUUID(); const version = state.version;
  state = await issueReservedStock(people.inventory.client, org, movement(reservation), request, version);
  sql(`update public.inventory_balances set on_hand=on_hand+1 where organization_id='${org}' and location_id='${location}';`);
  expect((await read()).reconciliation_state).toBe('discrepancy');
  expect(await issueReservedStock(people.inventory.client, org, movement(reservation), request, version)).toEqual(state);
  await expect(issueReservedStock(people.inventory.client, org, movement(reservation), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  await expect(returnStock(people.owner.client, org, movement(reservation), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  await expect(releaseReservation(people.manager.client, org, movement(reservation), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  await expect(reserveParts(people.manager.client, org, reserved(), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  await expect(receiveStock(people.owner.client, org, reserved().lines[0], randomUUID())).rejects.toThrow('CONFLICT');
  await enrollMfa(people.owner.client);
  await expect(adjustStock(people.owner.client, org, { ...reserved().lines[0], direction: 'out', reason: 'Cannot mask discrepancy' }, randomUUID())).rejects.toThrow('CONFLICT');
  const canceled = await people.manager.client.rpc('transition_work_order', { ctx: { organization_id: org, request_id: randomUUID(), expected_version: state.version }, id: job, target: 'canceled', reason: 'Cannot lose allocations' }); expect(canceled.error?.message).toBe('CONFLICT');
  expect((await read()).version).toBe(state.version);
  const other = await saveStockLocation(people.owner.client, org, { code: 'GOOD', name: 'Unaffected shelf' }, randomUUID());
  await receiveStock(people.owner.client, org, { ...reserved().lines[0], location_id: other.id }, randomUUID());
  sql(`update public.inventory_balances set on_hand=on_hand-1 where organization_id='${org}' and location_id='${location}';`);
  expect((await read()).reconciliation_state).toBe('consistent');
  // A cached issued total can disagree even when balance and reserved totals match.
  sql(`update public.stock_reservations set issued=issued+0.100,released=released-0 where id='${reservation}';update public.inventory_balances set reserved=reserved-0.100 where organization_id='${org}' and location_id='${location}';`);
  expect((await read()).reconciliation_state).toBe('discrepancy');
  await expect(returnStock(people.owner.client, org, movement(reservation), randomUUID(), state.version)).rejects.toThrow('CONFLICT');
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.inventory.id}';`);
  await expect(issueReservedStock(people.inventory.client, org, movement(reservation), request, version)).rejects.toThrow('FORBIDDEN');
});


it('allows explicit coordinator resume with reserved but unissued demand under the frozen shortage formula', async () => {
  await requested('1.000');
  const transition = async (target: string, reason?: string) => people.manager.client.rpc('transition_work_order', { ctx: { organization_id: org, request_id: randomUUID(), expected_version: (await read()).version }, id: job, target, reason });
  expect((await transition('in_progress')).error).toBeNull();
  expect((await transition('blocked', 'Awaiting allocation')).error).toBeNull();
  await reserve();
  expect((await read()).parts[0]).toMatchObject({ reserved: '1.000', issued: '0.000', shortage: '0.000' });
  expect((await transition('in_progress', 'Allocation available; explicit coordinator decision')).error).toBeNull();
  expect((await read()).parts[0].issued).toBe('0.000');
});

it('does not rearm a low cycle by archive, threshold disable or threshold edits without stock recovery', async () => {
  let version = 1;
  const edit = async (threshold: string | null, archived = false) => {
    await savePart(people.owner.client, org, { id: part, code: 'KG', name: 'Synthetic part', unit: 'kg', reorder_threshold: threshold, archived }, randomUUID(), version);
    version++;
  };
  const count = () => sql(`select count(*) from public.notifications where organization_id='${org}' and category='low_stock';`);
  await edit('10.000'); expect(count()).toBe('4');
  await edit('10.000', true); await edit('10.000'); expect(count()).toBe('4');
  await edit(null); await edit('10.000'); expect(count()).toBe('4');
  await edit('9.000'); await edit('10.000'); expect(count()).toBe('4');
  await receiveStock(people.owner.client, org, reserved().lines[0], randomUUID());
  await requested(); await reserve(); expect(count()).toBe('8');
  await edit(null);
  await receiveStock(people.owner.client, org, reserved().lines[0], randomUUID());
  await edit('10.000'); expect(count()).toBe('8');
  await requested(); await reserve(); expect(count()).toBe('12');
});
