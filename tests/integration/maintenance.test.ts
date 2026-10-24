import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { saveAsset } from '../../src/app/commands';
import { listMaintenancePlans, listMaintenanceRevisions, previewMaintenancePlan, saveMaintenancePlan } from '../../src/app/maintenance-client';
import type { MaintenanceFields } from '../../src/contracts/maintenance';
import { enrollMfa } from './mfa';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
type Person = { id: string; client: SupabaseClient<Database> };
let people: Record<string, Person>; let org: string; let otherOrg: string; let fields: MaintenanceFields;
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated maintenance fixture SQL failed; raw output withheld');
  return result.stdout.trim();
}
function snapshot() {
  return sql(`select md5(string_agg(fact::text,'|' order by fact::text)) from (${[
    'public.maintenance_plans', 'public.maintenance_plan_revisions', 'public.maintenance_segments', 'public.audit_logs', 'private.command_receipts',
  ].map((table) => `select jsonb_build_object('table','${table}','row',to_jsonb(t)) fact from ${table} t where organization_id='${org}'`).join(' union all ')}) facts;`);
}
const ctx = (version?: number, request_id = randomUUID()) => ({ organization_id: org, request_id, ...(version ? { expected_version: version } : {}) });

// Separate ordinary scenarios own their users/tenant/records/quotas; races and replay deliberately share only within a scenario.
beforeEach(async () => {
  people = {}; org = randomUUID(); otherOrg = randomUUID();
  for (const name of ['owner', 'tech', 'replacement', 'outsider']) {
    const email = `pm29-${name}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const client = createClient<Database>(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull(); await enrollMfa(client);
    people[name] = { id: created.data.user!.id, client };
  }
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values
   ('${org}','Synthetic PM29','America/New_York','PHP','${people.owner.id}'),('${otherOrg}','Synthetic other PM29','UTC','PHP','${people.outsider.id}');
   insert into public.organization_members(organization_id,user_id,role) values
   ('${org}','${people.owner.id}','owner'),('${org}','${people.tech.id}','technician'),('${org}','${people.replacement.id}','supervisor'),('${otherOrg}','${people.outsider.id}','owner');`);
  const asset = await saveAsset(people.owner.client, org, { code: randomUUID(), name: 'Synthetic PM29 asset', category: 'pump' }, randomUUID());
  fields = { asset_id: asset.id, title: 'Synthetic monthly belt check', instructions: 'Original belt instructions', category: 'routine', cadence: 'month', frequency: 1, anchor_on: '2024-01-31', supervisor_id: people.owner.id, assignee_ids: [people.tech.id], checklist: ['Inspect belt tension'], status: 'active' };
});

describe('real maintenance command/read boundaries', () => {
  it('previews, saves and revises without consuming protected dates; retries retain immutable history and receipts', async () => {
    const before = snapshot(); const preview = await previewMaintenancePlan(people.owner.client, org, fields);
    expect(preview.first_new).toEqual({ scheduled_local_date: '2024-01-31', timezone: 'America/New_York', due_at: '2024-02-01T05:00:00+00:00' });
    expect(preview.protected_through).toBeNull(); expect(snapshot()).toBe(before);
    const requestId = randomUUID(); const saved = await saveMaintenancePlan(people.owner.client, org, fields, requestId);
    const firstState = snapshot(); expect(await saveMaintenancePlan(people.owner.client, org, fields, requestId)).toEqual(saved); expect(snapshot()).toBe(firstState);
    await expect(saveMaintenancePlan(people.owner.client, org, { ...fields, title: 'Changed retry' }, requestId)).rejects.toThrow('CONFLICT'); expect(snapshot()).toBe(firstState);
    const original = (await listMaintenanceRevisions(people.owner.client, org, saved.id)).items[0]!.revision;
    const editedFields = { ...fields, id: saved.id, cadence: 'week' as const, instructions: 'New instructions' };
    const editedPreview = await previewMaintenancePlan(people.owner.client, org, editedFields);
    expect(editedPreview.retained_backlog[0]).toMatchObject({ revision_id: original.id, author_id: people.owner.id, next_on: '2024-01-31', next_ordinal: 0, timezone: 'America/New_York' });
    expect(editedPreview.first_new.scheduled_local_date > editedPreview.protected_through!).toBe(true);
    const edited = await saveMaintenancePlan(people.owner.client, org, editedFields, randomUUID(), saved.version);
    const revisedState = snapshot(); await expect(saveMaintenancePlan(people.owner.client, org, editedFields, randomUUID(), saved.version)).rejects.toThrow('CONFLICT'); expect(snapshot()).toBe(revisedState);
    const history = await listMaintenanceRevisions(people.owner.client, org, saved.id, { page_size: 1 });
    expect(history.items[0]!.revision).toEqual(original); expect(history.items[0]!.segment.next_ordinal).toBe(0); expect(history.next_cursor).toBe(1);
    const secondPage = await listMaintenanceRevisions(people.owner.client, org, saved.id, { cursor: history.next_cursor!, page_size: 1 });
    expect(secondPage.items[0]!.revision.id).toBe(edited.current_revision_id); expect(secondPage.next_cursor).toBeNull();
    const preserved = history.items[0]!.segment;
    await saveMaintenancePlan(people.owner.client, org, { ...editedFields, status: 'archived' }, randomUUID(), edited.version);
    const archived = await listMaintenanceRevisions(people.owner.client, org, saved.id);
    expect(archived.items[0]!.revision).toEqual(original); expect(archived.items[0]!.segment).toEqual(preserved);
  });
  it('denies wrong role/tenant, direct reads/writes and privileged replay after revocation', async () => {
    const requestId = randomUUID(); const saved = await saveMaintenancePlan(people.owner.client, org, fields, requestId);
    expect((await listMaintenancePlans(people.tech.client, org)).items.map((p) => p.id)).toEqual([saved.id]);
    const state = snapshot();
    await expect(previewMaintenancePlan(people.tech.client, org, fields)).rejects.toThrow('FORBIDDEN');
    await expect(saveMaintenancePlan(people.tech.client, org, fields, randomUUID())).rejects.toThrow('FORBIDDEN');
    await expect(listMaintenancePlans(people.outsider.client, org)).rejects.toThrow('FORBIDDEN');
    await expect(listMaintenanceRevisions(people.outsider.client, otherOrg, saved.id)).rejects.toThrow('NOT_FOUND');
    expect((await people.owner.client.from('maintenance_plans' as never).select('*')).error).not.toBeNull();
    expect((await people.owner.client.from('maintenance_plan_revisions' as never).insert({} as never)).error).not.toBeNull();
    expect(snapshot()).toBe(state);
    sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.owner.id}';`);
    await expect(saveMaintenancePlan(people.owner.client, org, fields, requestId)).rejects.toThrow('FORBIDDEN');
    expect(snapshot()).toBe(state);
    expect((await admin.auth.admin.updateUserById(people.tech.id, { ban_duration: '24h' })).error).toBeNull();
    await expect(listMaintenancePlans(people.tech.client, org)).rejects.toThrow('FORBIDDEN');
  });
  it('serializes duplicate requests and competing versions without extra revisions or lost cursors', async () => {
    const requestId = randomUUID();
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => saveMaintenancePlan(people.owner.client, org, fields, requestId)));
    expect(new Set(duplicates.map((p) => p.id)).size).toBe(1);
    const id = duplicates[0]!.id;
    const edits = await Promise.all([1, 2].map((n) => people.owner.client.rpc('save_maintenance_plan', { ctx: ctx(1), fields: { ...fields, id, title: `Competing edit ${n}` } })));
    expect(edits.filter((r) => r.error === null)).toHaveLength(1); expect(edits.find((r) => r.error)?.error?.message).toBe('CONFLICT');
    const history = await listMaintenanceRevisions(people.owner.client, org, id);
    expect(history.items).toHaveLength(2); expect(history.items[0]!.segment.next_ordinal).toBe(0); expect(history.items[0]!.revision.title).toBe(fields.title);
  });
  it('reauthorizes protected backlog with valid current replacement while preserving its old content/author/zone/cursor', async () => {
    const saved = await saveMaintenancePlan(people.owner.client, org, fields, randomUUID());
    const original = (await listMaintenanceRevisions(people.owner.client, org, saved.id)).items[0]!.revision;
    const edit = { ...fields, id: saved.id };
    await saveMaintenancePlan(people.owner.client, org, edit, randomUUID(), 1);
    const protectedBefore = (await listMaintenanceRevisions(people.owner.client, org, saved.id)).items[0]!.segment;
    sql(`update public.organization_members set active=false where organization_id='${org}' and user_id in ('${people.tech.id}','${people.owner.id}');`);
    expect(sql(`select private.maintenance_current_people_eligible('${org}','${saved.id}');`)).toBe('f');
    const beforeDenied = snapshot(); await expect(saveMaintenancePlan(people.replacement.client, org, edit, randomUUID(), 2)).rejects.toThrow('VALIDATION'); expect(snapshot()).toBe(beforeDenied);
    const replacement = { ...edit, supervisor_id: people.replacement.id, assignee_ids: [people.replacement.id], instructions: 'Current future instructions' };
    const result = await saveMaintenancePlan(people.replacement.client, org, replacement, randomUUID(), 2);
    expect(result.authorized_by).toBe(people.replacement.id);
    expect(sql(`select private.maintenance_current_people_eligible('${org}','${saved.id}');`)).toBe('t');
    const history = await listMaintenanceRevisions(people.replacement.client, org, saved.id);
    expect(history.items[0]!.revision).toEqual(original); expect(history.items[0]!.segment).toEqual(protectedBefore);
    expect(history.items[2]!.revision.assignee_ids).toEqual([people.replacement.id]);
    await expect(listMaintenanceRevisions(people.tech.client, org, saved.id)).rejects.toThrow('FORBIDDEN');
  });
  it('bounds plan pages and rejects forged/malformed payloads atomically at the SQL boundary', async () => {
    for (let n = 0; n < 3; n++) await saveMaintenancePlan(people.owner.client, org, { ...fields, title: `Plan ${n}` }, randomUUID());
    const page = await listMaintenancePlans(people.owner.client, org, { page_size: 2 }); expect(page.items).toHaveLength(2); expect(page.next_cursor).toBe(page.items[1]!.id);
    const next = await listMaintenancePlans(people.owner.client, org, { page_size: 2, cursor: page.next_cursor! }); expect(next.items).toHaveLength(1); expect(next.next_cursor).toBeNull();
    expect(new Set([...page.items, ...next.items].map((p) => p.id)).size).toBe(3);
    const before = snapshot();
    for (const patch of [{ cadence: 'hour' }, { frequency: 0 }, { frequency: 1.5 }, { anchor_on: '2025-02-29' }, { assignee_ids: [people.tech.id, people.tech.id] }, { author_id: people.outsider.id }, { checklist: [] }, { asset_id: randomUUID() }, { assignee_ids: [people.outsider.id] }]) {
      const r = await people.owner.client.rpc('save_maintenance_plan', { ctx: ctx(), fields: { ...fields, ...patch } });
      expect(['VALIDATION', 'NOT_FOUND']).toContain(r.error?.message); expect(snapshot()).toBe(before);
    }
    expect((await people.owner.client.rpc('list_maintenance_plans', { organization_id: org, page_size: 101 })).error?.message).toBe('VALIDATION');
    sql(`update public.assets set archived_at=now() where organization_id='${org}' and id='${fields.asset_id}';`);
    const inactive = snapshot();
    await expect(saveMaintenancePlan(people.owner.client, org, fields, randomUUID())).rejects.toThrow('INVALID_TRANSITION'); expect(snapshot()).toBe(inactive);
  });
  it('preserves committed retry results at the shared tenant budget and rejects new saves without effects', async () => {
    const requestId = randomUUID(); const saved = await saveMaintenancePlan(people.owner.client, org, fields, requestId);
    sql(`insert into private.command_receipts(actor_id,request_id,organization_id,action,payload_hash,result)
     select '${people.replacement.id}',gen_random_uuid(),'${org}','synthetic_budget','synthetic', '{}'::jsonb
     from generate_series(1,5000-(select count(*)::integer from private.command_receipts where organization_id='${org}' and created_at>=date_trunc('day',now())));`);
    const before = snapshot(); expect(await saveMaintenancePlan(people.owner.client, org, fields, requestId)).toEqual(saved);
    await expect(saveMaintenancePlan(people.owner.client, org, fields, randomUUID())).rejects.toThrow('RATE_LIMITED'); expect(snapshot()).toBe(before);
  });
});
