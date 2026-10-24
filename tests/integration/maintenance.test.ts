import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { saveAsset } from '../../src/app/commands';
import { listMaintenancePlans, listMaintenanceRevisions, listMaintenanceAgenda, listMaintenanceBacklog, previewMaintenancePlan, saveMaintenancePlan } from '../../src/app/maintenance-client';
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
function concurrentSql(statement: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { timeout: 20000 });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.resume(); child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error('Concurrent isolated maintenance SQL failed; raw output withheld')));
    child.stdin.end(statement);
  });
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
  it('runs under the real native Cron owner while browser/service roles are denied; overlap and retries retain one job', async () => {
    const plan = await saveMaintenancePlan(people.owner.client, org, fields, randomUUID());
    expect((await people.owner.client.schema('public').rpc('generate_due_maintenance' as never)).error).not.toBeNull();
    expect(sql("select has_function_privilege('service_role','private.generate_due_maintenance(timestamptz)','execute');")).toBe('f');
    const jobId = Number(sql("select jobid from cron.job where jobname='opspilot-maintenance' and username='postgres' and command='select private.generate_due_maintenance();';"));
    expect(Number.isSafeInteger(jobId) && jobId > 0).toBe(true);
    try {
      sql(`select cron.alter_job(${jobId},schedule:='1 seconds',active:=true);`);
      await expect.poll(() => sql(`select count(*) from public.maintenance_occurrences where plan_id='${plan.id}';`), { timeout: 12000, interval: 250 }).toBe('1');
    } finally { sql(`select cron.alter_job(${jobId},schedule:='5 * * * *',active:=false);`); }
    await expect.poll(() => sql(`select count(*) from cron.job_run_details where jobid=${jobId} and status='succeeded';`), { timeout: 5000, interval: 100 }).not.toBe('0');
    await Promise.all([concurrentSql('select private.generate_due_maintenance();'), concurrentSql('select private.generate_due_maintenance();')]);
    const agenda = await listMaintenanceAgenda(people.owner.client, org, { from_on: '2024-01-01', to_on: '2024-12-31' });
    expect(agenda.items).toHaveLength(1); expect(agenda.items[0]).toMatchObject({ scheduled_local_date: '2024-01-31', due_at: '2024-02-01T05:00:00+00:00', work_status: 'scheduled', blocks_operation: false });
    expect(sql(`select count(*) from public.notifications where source_id='${agenda.items[0].work_order_id}' and category='assignment';`)).toBe('1');
    await expect(listMaintenanceAgenda(people.outsider.client, org, { from_on: '2024-01-01', to_on: '2024-12-31' })).rejects.toThrow('FORBIDDEN');
  });
  it('retains invalid-person backlog, then generates historic content under explicitly replaced current personnel', async () => {
    const plan = await saveMaintenancePlan(people.owner.client, org, fields, randomUUID());
    expect((await admin.auth.admin.updateUserById(people.tech.id, { ban_duration: '24h' })).error).toBeNull();
    sql('select private.generate_due_maintenance();');
    expect((await listMaintenanceBacklog(people.owner.client, org, plan.id)).generation_blocked).toBe('person_ineligible');
    expect((await listMaintenanceRevisions(people.owner.client, org, plan.id)).items[0].segment.next_ordinal).toBe(0);
    const revised = await saveMaintenancePlan(people.owner.client, org, { ...fields, id: plan.id, instructions: 'New content', supervisor_id: people.replacement.id, assignee_ids: [people.replacement.id] }, randomUUID(), plan.version);
    sql('select private.generate_due_maintenance();');
    const agenda = await listMaintenanceAgenda(people.owner.client, org, { from_on: '2024-01-01', to_on: '2024-12-31' });
    expect(agenda.items[0]).toMatchObject({ revision_id: plan.current_revision_id, authorized_by: people.owner.id, supervisor_id: people.replacement.id, assignee_ids: [people.replacement.id] });
    expect(revised.current_revision_id).not.toBe(plan.current_revision_id);
    const result = await people.replacement.client.from('work_orders').select('*').eq('id', agenda.items[0].work_order_id).single();
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ description: 'Original belt instructions', created_by: null, creation_actor_kind: 'system' });
    const cursorBefore = (await listMaintenanceRevisions(people.owner.client, org, plan.id)).items[0].segment.next_ordinal;
    sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.owner.id}'; select private.generate_due_maintenance();`);
    expect(sql(`select generation_blocked from public.maintenance_plans where id='${plan.id}';`)).toBe('person_ineligible');
    expect(sql(`select next_ordinal from public.maintenance_segments where revision_id='${plan.current_revision_id}';`)).toBe(String(cursorBefore));
  });
  it('serializes overlapping new generation and competing Start/release without an Operational blocking job', async () => {
    const plan = await saveMaintenancePlan(people.owner.client, org, fields, randomUUID());
    await Promise.all([concurrentSql('select private.generate_due_maintenance();'), concurrentSql('select private.generate_due_maintenance();')]);
    expect(sql(`select count(*) from public.maintenance_occurrences where plan_id='${plan.id}';`)).toBe('1');
    const agenda = await listMaintenanceAgenda(people.owner.client, org, { from_on: '2024-01-01', to_on: '2024-12-31' }); const id = agenda.items[0].work_order_id;
    sql(`update public.assets set availability='operational' where id='${fields.asset_id}';`);
    const version = Number(sql(`select version from public.assets where id='${fields.asset_id}';`));
    const [start, release] = await Promise.all([
      people.tech.client.rpc('transition_work_order', { ctx: ctx(1), id, target: 'in_progress' }),
      people.replacement.client.rpc('release_asset', { ctx: ctx(version), asset_id: fields.asset_id, acknowledgment: 'Synthetic competing release' }),
    ]);
    expect(start.error).toBeNull(); expect([undefined, 'CONFLICT', 'INVALID_TRANSITION']).toContain(release.error?.message);
    expect(sql(`select availability from public.assets where id='${fields.asset_id}';`)).toBe('under_maintenance');
    expect(sql(`select count(*) from public.asset_holds where work_order_id='${id}' and released_at is null;`)).toBe('1');
    expect(sql(`select blocks_operation from public.work_orders where id='${id}';`)).toBe('t');
  });
  it('makes assigned human Start blocking, retains ordinary performer/review gates and separately releases after completion', async () => {
    const plan = await saveMaintenancePlan(people.owner.client, org, fields, randomUUID()); sql('select private.generate_due_maintenance();');
    const agenda = await listMaintenanceAgenda(people.owner.client, org, { from_on: '2024-01-01', to_on: '2024-12-31' }); const id = agenda.items[0].work_order_id;
    sql(`update public.assets set availability='operational' where id='${fields.asset_id}'; update public.organization_settings set evidence_required=false where organization_id='${org}';`);
    const command = async (client: SupabaseClient<Database>, name: string, payload: Record<string, unknown>, version: number) => {
      const result = await client.rpc(name as never, { ctx: ctx(version), id, ...payload } as never); expect(result.error).toBeNull(); return result.data as unknown as { data: { version: number } };
    };
    const rescheduled = await command(people.owner.client, 'schedule_work_order', { planned_on: '2026-11-01' }, 1);
    expect(sql(`select availability from public.assets where id='${fields.asset_id}';`)).toBe('operational');
    expect((await people.owner.client.rpc('update_work_order', { ctx: ctx(rescheduled.data.version), id, allowed_fields: { due_at: null } })).error?.message).toBe('VALIDATION');
    const started = await command(people.tech.client, 'transition_work_order', { target: 'in_progress' }, rescheduled.data.version);
    expect(sql(`select blocks_operation::text||':'||status from public.work_orders where id='${id}';`)).toBe('true:in_progress');
    expect(sql(`select count(*) from public.asset_holds where work_order_id='${id}' and released_at is null;`)).toBe('1');
    const declared = await command(people.tech.client, 'declare_work_order_performers', { user_ids: [people.tech.id] }, started.data.version);
    const task = sql(`select id from public.work_order_tasks where work_order_id='${id}';`);
    const checked = await command(people.tech.client, 'update_work_order', { allowed_fields: { task_id: task, task_completed: true } }, declared.data.version);
    const submitted = await command(people.tech.client, 'submit_work_order', { acknowledgment: 'Synthetic work performed' }, checked.data.version);
    expect((await people.tech.client.rpc('review_work_order', { ctx: ctx(submitted.data.version), id, decision: 'approved', reason: 'Self review denied' })).error?.message).toBe('FORBIDDEN');
    await command(people.replacement.client, 'review_work_order', { decision: 'approved', reason: 'Independent synthetic review' }, submitted.data.version);
    expect(sql(`select availability from public.assets where id='${fields.asset_id}';`)).toBe('pending_release');
    const version = Number(sql(`select version from public.assets where id='${fields.asset_id}';`));
    expect((await people.replacement.client.rpc('release_asset', { ctx: ctx(version), asset_id: fields.asset_id, acknowledgment: 'Separate release' })).error).toBeNull();
    expect(sql(`select availability from public.assets where id='${fields.asset_id}';`)).toBe('operational');
    expect(sql(`select count(*) from public.maintenance_occurrences where plan_id='${plan.id}';`)).toBe('1');
  });
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
