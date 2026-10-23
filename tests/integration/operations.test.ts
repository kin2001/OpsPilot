import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { enrollMfa } from './mfa';
import { commandResult, saveAsset, convertRequest } from '../../src/app/commands';
import { operationalWorkOrder, dashboardResult, assetHistoryResult, workOrderTask, workOrderEvent, workOrderReview, notificationRecord, performerDeclaration, submissionAttestation } from '../../src/contracts/operational';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
type Person = { id: string; email: string; password: string; client: SupabaseClient };
const people: Record<string, Person> = {}; let org: string; let otherOrg: string;
const ctx = (version?: number, request = randomUUID()) => ({ organization_id: org, request_id: request, ...(version ? { expected_version: version } : {}) });
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated fixture SQL failed; raw output withheld');
}
async function command(person: string, name: string, args: Record<string, unknown>) {
  const result = await people[person].client.rpc(name, args); expect(result.error, `${name} domain failure`).toBeNull();
  expect(result.data.request_id).toBe((args.ctx as { request_id: string }).request_id); return result.data.data;
}
async function asset() {
  return (await saveAsset(people.owner.client, org, { code: randomUUID(), name: 'Synthetic pump', category: 'pump' }, randomUUID())).id;
}
async function assetRow(id: string) {
  const result = await people.owner.client.from('assets').select('*').eq('organization_id', org).eq('id', id).single(); expect(result.error).toBeNull(); return result.data!;
}
async function job(assetId: string) {
  return command('owner', 'create_work_order', { ctx: ctx(), asset_id: assetId, fields: { title: 'Repair pump', description: 'Synthetic leak', category: 'pump', priority: 'normal' } });
}
async function transition(person: string, work: { id: string; version: number }, target: string) {
  if (target === 'scheduled') return command(person, 'schedule_work_order', { ctx: ctx(work.version), id: work.id, planned_on: '2026-10-31', reason: 'Synthetic recorded reason' });
  if (target === 'awaiting_review') {
    const declared = await command(person, 'declare_work_order_performers', { ctx: ctx(work.version), id: work.id, user_ids: [people[person].id] });
    return command(person, 'submit_work_order', { ctx: ctx(declared.version), id: work.id, acknowledgment: 'I have declared everyone who performed this repair.' });
  }
  return command(person, 'transition_work_order', { ctx: ctx(work.version), id: work.id, target, reason: 'Synthetic recorded reason' });
}
async function review(work: { id: string; version: number }, decision = 'approved') {
  return command('reviewer', 'review_work_order', { ctx: ctx(work.version), id: work.id, decision, reason: 'Synthetic coordinator review' });
}
// Ordinary scenarios own their identities and quotas; retries/races within a scenario still share them.
beforeEach(async () => {
  for (const name of ['owner', 'reviewer', 'performer', 'outsider']) {
    const email = `t2-${name}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull(); await enrollMfa(client);
    people[name] = { id: created.data.user!.id, email, password, client };
  }
  for (const name of ['owner', 'outsider']) {
    const person = people[name]; sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values('${person.id}','${person.email}',1);`);
    const result = await person.client.rpc('create_organization', { name: `Synthetic T2 ${name}`, timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() }); expect(result.error).toBeNull();
    if (name === 'owner') org = result.data.data.id; else otherOrg = result.data.data.id;
  }
  sql(`insert into public.organization_members(organization_id,user_id,role) values('${org}','${people.reviewer.id}','supervisor'),('${org}','${people.performer.id}','technician');`);
  await command('owner', 'save_organization_settings', { ctx: ctx(1), fields: { evidence_required: false } });
});

describe('real T2 operational authorization and safety', { concurrent: false }, () => {
  it('requires a separate planned calendar date with atomic scheduling and durable replay', async () => {
    const assetId = await asset(); let work = await job(assetId);
    expect(Object.hasOwn(work, 'planned_on')).toBe(false);
    const due = '2026-11-05T01:00:00+00:00';
    work = await command('owner', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { due_at: due } });
    const adminEvent = await people.owner.client.from('work_order_events').select('*').eq('work_order_id', work.id).eq('action', 'update_work_order').single();
    expect(adminEvent.error).toBeNull(); expect(workOrderEvent.parse(adminEvent.data).changes.before?.planned_on).toBeNull();
    work = await transition('reviewer', work, 'open');
    async function snapshot() {
      const state: Record<string, unknown> = { asset: await assetRow(assetId) };
      for (const table of ['work_orders', 'work_order_events', 'work_order_participants', 'asset_holds', 'notifications', 'audit_logs']) {
        const column = table === 'work_orders' ? 'id' : table === 'notifications' ? 'source_id' : table === 'audit_logs' ? 'entity_id' : 'work_order_id';
        const rows = await admin.from(table).select('*').eq('organization_id', org).eq(column, work.id);
        expect(rows.error).toBeNull(); state[table] = rows.data;
      }
      return state;
    }
    async function denied(name: string, values: Record<string, unknown>, person = 'reviewer', code?: string) {
      const before = await snapshot(); const request = ctx(work.version);
      const result = await people[person].client.rpc(name, { ctx: request, id: work.id, ...values });
      expect(result.error).not.toBeNull(); if (code) expect(result.error?.message).toBe(code);
      expect(await snapshot()).toEqual(before);
      sql(`do $$ begin if exists(select 1 from private.command_receipts where organization_id='${org}' and actor_id='${people[person].id}' and request_id='${request.request_id}') then raise exception 'Denied scheduling recorded a receipt'; end if; end $$;`);
    }
    await denied('transition_work_order', { target: 'scheduled', reason: null }, 'reviewer', 'VALIDATION');
    for (const planned_on of [null, 'infinity', '-infinity', '2026-02-30', 'invalid']) await denied('schedule_work_order', { planned_on, reason: null });
    const args = { ctx: ctx(work.version), id: work.id, planned_on: '2026-10-31', reason: null };
    const scheduled = await people.reviewer.client.rpc('schedule_work_order', args); expect(scheduled.error).toBeNull();
    work = scheduled.data.data; operationalWorkOrder.parse(work);
    expect(work.planned_on).toBe(args.planned_on); expect(work.due_at).toBe(due);
    expect(work.version).toBe(args.ctx.expected_version! + 1);
    const material = work.repair_revision;
    work = await transition('reviewer', work, 'open'); expect(work.planned_on).toBe(args.planned_on);
    const beforeReplay = await snapshot(); const replay = await people.reviewer.client.rpc('schedule_work_order', args);
    expect(replay.error).toBeNull(); expect(replay.data).toEqual(scheduled.data); expect(await snapshot()).toEqual(beforeReplay);
    expect((await people.reviewer.client.rpc('schedule_work_order', { ...args, planned_on: '2026-11-01' })).error?.message).toBe('CONFLICT');
    // A retained prior date cannot make the old undated API schedule again.
    await denied('transition_work_order', { target: 'scheduled', reason: null }, 'reviewer', 'VALIDATION');
    await denied('schedule_work_order', { planned_on: '2026-11-01', reason: null }, 'outsider', 'FORBIDDEN');
    sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.reviewer.id}';`);
    try { await denied('schedule_work_order', { planned_on: '2026-11-01', reason: null }, 'reviewer', 'FORBIDDEN'); }
    finally { sql(`update public.organization_members set active=true where organization_id='${org}' and user_id='${people.reviewer.id}';`); }
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    await denied('schedule_work_order', { planned_on: '2026-11-01', reason: null }, 'performer', 'FORBIDDEN');
    work = await transition('performer', work, 'in_progress'); work = await transition('performer', work, 'blocked');
    await denied('schedule_work_order', { planned_on: '2026-11-01', reason: null }, 'reviewer', 'VALIDATION');
    await denied('transition_work_order', { target: 'scheduled', reason: 'Resolved' }, 'reviewer', 'VALIDATION');
    work = await command('reviewer', 'schedule_work_order', { ctx: ctx(work.version), id: work.id, planned_on: '2026-11-01', reason: 'Resolved supply issue' });
    expect(work.planned_on).toBe('2026-11-01'); expect(work.repair_revision).toBe(material); expect(work.due_at).toBe(due);
    const event = await people.reviewer.client.from('work_order_events').select('*').eq('work_order_id', work.id).eq('status', 'scheduled').order('created_at', { ascending: false }).limit(1).single();
    expect(event.error).toBeNull(); const scheduledEvent = workOrderEvent.parse(event.data);
    expect(scheduledEvent.changes).toMatchObject({ prior_planned_on: '2026-10-31', planned_on: '2026-11-01' });
    expect(scheduledEvent.note).toBe('Resolved supply issue');
    work = await transition('reviewer', work, 'open');
    const attempts = await Promise.all(['2026-11-02', '2026-11-03'].map((planned_on) => people.reviewer.client.rpc('schedule_work_order', { ctx: ctx(work.version), id: work.id, planned_on, reason: null })));
    expect(attempts.filter((result) => result.error === null)).toHaveLength(1);
    expect(attempts.filter((result) => result.error?.message === 'CONFLICT')).toHaveLength(1);
  });
  it('requires a current eligible assignment before starts and resumes without changing denied work or successful receipts', async () => {
    const assetId = await asset(); let work = await job(assetId);
    work = await transition('owner', work, 'open');
    async function snapshot() {
      const state: Record<string, unknown> = { asset: await assetRow(assetId) };
      for (const table of ['work_orders', 'work_order_events', 'work_order_participants', 'asset_holds', 'notifications', 'audit_logs']) {
        const column = table === 'work_orders' ? 'id' : table === 'notifications' ? 'source_id' : table === 'audit_logs' ? 'entity_id' : 'work_order_id';
        const rows = await admin.from(table).select('*').eq('organization_id', org).eq(column, work.id);
        expect(rows.error).toBeNull(); state[table] = rows.data;
      }
      return state;
    }
    async function denied() {
      const before = await snapshot(); const request = ctx(work.version);
      expect((await people.owner.client.rpc('transition_work_order', { ctx: request, id: work.id, target: 'in_progress', reason: 'Synthetic start' })).error?.message).toBe('INVALID_TRANSITION');
      expect(await snapshot()).toEqual(before);
      sql(`do $$ begin if exists(select 1 from private.command_receipts where organization_id='${org}' and actor_id='${people.owner.id}' and request_id='${request.request_id}') then raise exception 'Denied start recorded a receipt'; end if; end $$;`);
    }
    await denied();
    work = await transition('owner', work, 'scheduled'); await denied();
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [] }); await denied();
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    for (const [change, restore] of [
      ["active=false", "active=true"], ["role='inventory'", "role='technician'"],
    ]) {
      sql(`update public.organization_members set ${change} where organization_id='${org}' and user_id='${people.performer.id}';`);
      try { await denied(); } finally { sql(`update public.organization_members set ${restore} where organization_id='${org}' and user_id='${people.performer.id}';`); }
    }
    sql(`update auth.users set banned_until=now()+interval '1 hour' where id='${people.performer.id}';`);
    try { await denied(); } finally { sql(`update auth.users set banned_until=null where id='${people.performer.id}';`); }
    sql(`update auth.users set email_confirmed_at=null where id='${people.performer.id}';`);
    try { await denied(); } finally { sql(`update auth.users set email_confirmed_at=now() where id='${people.performer.id}';`); }
    sql(`update auth.users set deleted_at=now() where id='${people.performer.id}';`);
    try { await denied(); } finally { sql(`update auth.users set deleted_at=null where id='${people.performer.id}';`); }
    const beforeWrongTenant = await snapshot();
    expect((await people.outsider.client.rpc('transition_work_order', { ctx: { ...ctx(work.version), organization_id: otherOrg }, id: work.id, target: 'in_progress', reason: 'Wrong tenant' })).error?.message).toBe('FORBIDDEN');
    expect(await snapshot()).toEqual(beforeWrongTenant);
    const args = { ctx: ctx(work.version), id: work.id, target: 'in_progress', reason: 'Synthetic start' };
    const started = await people.owner.client.rpc('transition_work_order', args); expect(started.error).toBeNull(); work = started.data.data;
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [] });
    const beforeReplay = await snapshot(); const replay = await people.owner.client.rpc('transition_work_order', args);
    expect(replay.error).toBeNull(); expect(replay.data).toEqual(started.data); expect(await snapshot()).toEqual(beforeReplay);
    work = await transition('owner', work, 'blocked'); await denied();
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    expect((await people.performer.client.rpc('transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'in_progress', reason: 'Cannot resume' })).error?.message).toBe('FORBIDDEN');
    work = await transition('owner', work, 'in_progress'); expect(work.status).toBe('in_progress');
  });
  it('keeps strict T1 responses and recorded receipts compatible after additive columns', async () => {
    const requestId = randomUUID(); const fields = { code: randomUUID(), name: 'Legacy shape', category: 'pump' };
    const first = await saveAsset(people.owner.client, org, fields, requestId);
    expect(Object.hasOwn(first, 'availability')).toBe(false); expect(await saveAsset(people.owner.client, org, fields, requestId)).toEqual(first);
    const request = await command('performer', 'save_request', { ctx: ctx(), id: null, asset_id: first.id, description: 'Synthetic report', category: 'pump' });
    await command('performer', 'submit_request', { ctx: ctx(), id: request.id });
    const converted = await convertRequest(people.owner.client, org, request.id, { title: 'Legacy conversion', priority: 'normal' }, randomUUID());
    expect(Object.hasOwn(converted, 'repair_revision')).toBe(false); expect(Object.hasOwn(converted, 'planned_on')).toBe(false); expect((await assetRow(first.id)).availability).toBe('out_of_service');
  });
  it('retains former participants and separates rejection, correction, completion and release', async () => {
    const assetId = await asset(); let work = await job(assetId);
    work = await command('owner', 'add_work_order_task', { ctx: ctx(work.version), id: work.id, label: 'Inspect seal', required: true });
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    work = await transition('owner', work, 'open'); work = await transition('performer', work, 'in_progress');
    const tasks = await people.performer.client.from('work_order_tasks').select('id').eq('work_order_id', work.id);
    work = await command('performer', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { note: 'Replaced seal', labor_minutes: 30, task_id: tasks.data![0].id, task_completed: true } });
    const material = work.repair_revision; work = await transition('performer', work, 'awaiting_review'); work = await review(work, 'returned');
    expect((await assetRow(assetId)).availability).toBe('under_maintenance');
    work = await command('performer', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { note: 'Corrected alignment' } }); expect(work.repair_revision).toBeGreaterThan(material);
    work = await transition('performer', work, 'awaiting_review'); work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [] });
    sql(`update public.organization_members set role='supervisor' where organization_id='${org}' and user_id='${people.performer.id}';`);
    expect((await people.performer.client.rpc('review_work_order', { ctx: ctx(work.version), id: work.id, decision: 'approved', reason: 'Former participant' })).error?.message).toBe('FORBIDDEN');
    work = await review(work); expect(work.status).toBe('completed'); expect((await assetRow(assetId)).availability).toBe('pending_release');
    const recordedReviews = await people.owner.client.from('work_order_reviews').select('*').eq('work_order_id', work.id);
    expect(recordedReviews.data).toHaveLength(2); recordedReviews.data!.forEach((row) => workOrderReview.parse(row));
    const current = await assetRow(assetId);
    expect((await people.performer.client.rpc('release_asset', { ctx: ctx(current.version), asset_id: assetId, acknowledgment: 'Cannot self release' })).error?.message).toBe('FORBIDDEN');
    await command('reviewer', 'release_asset', { ctx: ctx(current.version), asset_id: assetId, acknowledgment: 'Synthetic procedure acknowledged' }); expect((await assetRow(assetId)).availability).toBe('operational');
    const beforeReopen = work;
    expect((await people.reviewer.client.rpc('transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'in_progress', reason: 'Reopen requires assignment' })).error?.message).toBe('INVALID_TRANSITION');
    expect((await people.owner.client.from('work_orders').select('*').eq('id', work.id).single()).data).toEqual(beforeReopen);
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    work = await transition('reviewer', work, 'in_progress'); expect((await assetRow(assetId)).availability).toBe('under_maintenance'); expect(work.completed_at).toBeNull();
    sql(`update public.organization_members set role='technician' where organization_id='${org}' and user_id='${people.performer.id}';`);
  });
  it('canceling an unaccepted draft preserves a prior release and creates no hold', async () => {
    const assetId = await asset(); await command('reviewer', 'release_asset', { ctx: ctx((await assetRow(assetId)).version), asset_id: assetId, acknowledgment: 'Initial synthetic acknowledgment' });
    await transition('owner', await job(assetId), 'canceled'); expect((await assetRow(assetId)).availability).toBe('operational');
    expect((await people.owner.client.from('asset_holds').select('id').eq('asset_id', assetId)).data).toEqual([]);
  });
  it('separates administrative concurrency from material repair changes and requires Critical reasons', async () => {
    const assetId = await asset(); let work = await job(assetId);
    work = await command('owner', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { title: 'Updated requested repair' } });
    const material = work.repair_revision;
    work = await command('owner', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { priority: 'high', due_at: '2026-10-30T01:00:00Z', supervisor_id: people.reviewer.id } });
    expect(work.repair_revision).toBe(material);
    expect((await people.owner.client.rpc('update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { priority: 'critical' } })).error?.message).toBe('VALIDATION');
    work = await command('owner', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { priority: 'critical', priority_reason: 'Synthetic immediate escalation' } });
    expect(work.priority_reason).toBe('Synthetic immediate escalation');
    expect((await people.owner.client.rpc('create_work_order', { ctx: ctx(), asset_id: assetId, fields: { title: 'Missing reason', description: 'Synthetic', category: 'pump', priority: 'critical' } })).error?.message).toBe('VALIDATION');
    const reading = await command('owner', 'record_meter_reading', { ctx: ctx(), asset_id: assetId, kind: 'hours', value: 100, observed_at: '2026-10-21T00:00:00Z' });
    const correction = await command('owner', 'correct_meter_reading', { ctx: ctx(), id: reading.id, value: 10, reason: 'Transcription correction' });
    expect(correction.correction_of).toBe(reading.id); expect(correction.value).toBe(10);
    expect((await people.owner.client.from('asset_meter_readings').select('id').eq('asset_id', assetId)).data).toHaveLength(2);
  });
  it('serializes new blocking work versus release and preserves cancellation and archive safety', async () => {
    const assetId = await asset(); const work = await job(assetId); const version = (await assetRow(assetId)).version;
    const attempts = await Promise.all([
      people.reviewer.client.rpc('release_asset', { ctx: ctx(version), asset_id: assetId, acknowledgment: 'Race release' }),
      people.owner.client.rpc('transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'open', reason: null }),
    ]);
    expect(attempts[1].error).toBeNull(); expect((await assetRow(assetId)).availability).not.toBe('operational'); await transition('owner', attempts[1].data.data, 'canceled');
    const current = await assetRow(assetId);
    expect((await people.reviewer.client.rpc('release_asset', { ctx: ctx(current.version), asset_id: assetId, acknowledgment: 'Cannot bypass cancellation' })).error?.message).toBe('INVALID_TRANSITION');
    const saved = await command('owner', 'save_asset', { ctx: ctx(current.version), asset_id: assetId, fields: { archived: true } });
    expect((await people.reviewer.client.rpc('release_asset', { ctx: ctx(saved.version), asset_id: assetId, acknowledgment: 'Archived' })).error?.message).toBe('INVALID_TRANSITION');
    await command('owner', 'save_asset', { ctx: ctx(saved.version), asset_id: assetId, fields: { archived: false } }); expect((await assetRow(assetId)).availability).toBe('out_of_service');
  });
  it('rejects downgraded privileged replay and wrong tenant; note retries commit once', async () => {
    const settings = await people.owner.client.from('organization_settings').select('*').eq('organization_id', org).single();
    const request = ctx(settings.data!.version); const fields = { evidence_required: false }; await command('owner', 'save_organization_settings', { ctx: request, fields });
    const downgraded = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); await downgraded.auth.signInWithPassword({ email: people.owner.email, password: people.owner.password });
    expect((await downgraded.rpc('save_organization_settings', { ctx: request, fields })).error?.message).toBe('FORBIDDEN');
    expect((await people.outsider.client.rpc('get_dashboard', { organization_id: org, range: { from: '2026-10-01', to: '2026-10-22' } })).error?.message).toBe('FORBIDDEN');
    expect((await people.owner.client.rpc('get_team', { organization_id: otherOrg })).error?.message).toBe('FORBIDDEN');
    let work = await job(await asset());
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.owner.id] });
    work = await transition('owner', work, 'open'); work = await transition('owner', work, 'in_progress');
    const args = { ctx: ctx(work.version), id: work.id, allowed_fields: { note: 'Durable single note' } };
    const results = await Promise.all(Array.from({ length: 10 }, () => people.owner.client.rpc('update_work_order', args)));
    expect(results.every((result) => !result.error)).toBe(true); expect(new Set(results.map((result) => result.data.version)).size).toBe(1);
    expect((await people.owner.client.rpc('update_work_order', { ...args, allowed_fields: { note: 'Changed replay' } })).error?.message).toBe('CONFLICT');
    expect((await people.owner.client.rpc('update_work_order', { ...args, ctx: ctx(work.version) })).error?.message).toBe('CONFLICT');
    commandResult(results[0].data, operationalWorkOrder, args.ctx.request_id);
  });
  it('checks private bytes, ready metadata, parent identity and revoked downloads', async () => {
    const assetId = await asset(); let work = await job(assetId); work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    work = await transition('owner', work, 'open'); work = await transition('performer', work, 'in_progress');
    const session = (await people.performer.client.auth.getSession()).data.session!;
    const headers = { Authorization: `Bearer ${session.access_token}`, apikey: anon, Origin: 'http://127.0.0.1:5173' };
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
    const endpoint = `${url}/functions/v1/attachment-upload`;
    const reserved = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ctx: ctx(), id: work.id, name: 'seal.png', media_type: 'image/png', size: bytes.length }) });
    expect(reserved.status).toBe(200); const record = (await reserved.json()).data;
    expect((await people.performer.client.from('attachments').select('*').eq('id', record.id)).data).toEqual([]);
    expect((await people.performer.client.storage.from('repair-evidence').upload(record.object_key, bytes, { contentType: 'image/png' })).error).not.toBeNull();
    const target = `${endpoint}?organization_id=${org}&attachment_id=${record.id}`;
    expect((await fetch(target, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: Buffer.alloc(bytes.length, 65) })).status).toBe(422);
    const upload = await fetch(target, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: bytes }); expect(upload.status).toBe(200);
    expect((await upload.json()).checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect((await fetch(target, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: bytes })).status).toBe(200);
    expect((await people.performer.client.storage.from('repair-evidence').createSignedUrl(record.object_key, 60)).error).not.toBeNull();
    const bulkSigning = await people.performer.client.storage.from('repair-evidence').createSignedUrls([record.object_key], 60);
    if (bulkSigning.error) {
      expect(bulkSigning.data).toBeNull();
    } else {
      expect(bulkSigning.data).toHaveLength(1);
      expect(bulkSigning.data.map((item) => item.path)).toEqual([record.object_key]);
      for (const item of bulkSigning.data) {
        expect(typeof item.error).toBe('string');
        expect(item.error?.trim().length).toBeGreaterThan(0);
        expect(item.signedURL).toBeNull();
        expect(item.signedUrl).toBeNull();
      }
    }
    const publicUrl = people.performer.client.storage.from('repair-evidence').getPublicUrl(record.object_key).data.publicUrl;
    expect((await fetch(publicUrl, { cache: 'no-store' })).ok).toBe(false);
    const downloaded = await fetch(target, { headers }); expect(downloaded.status).toBe(200);
    expect(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect((await fetch(`${endpoint}?organization_id=${otherOrg}&attachment_id=${record.id}`, { headers })).status).toBe(404);
    sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.performer.id}';`);
    expect((await fetch(target, { headers, cache: 'no-store' })).status).toBe(404); expect((await people.performer.client.storage.from('repair-evidence').download(record.object_key)).error).not.toBeNull();
    sql(`update public.organization_members set active=true where organization_id='${org}' and user_id='${people.performer.id}';`);
  });
  it('supports asset images and reporter request evidence with parent-specific write authority', async () => {
    const assetId = await asset();
    const request = await command('performer', 'save_request', { ctx: ctx(), id: null, asset_id: assetId, description: 'Reporter evidence', category: 'pump' });
    const own = await command('performer', 'reserve_record_attachment', { ctx: ctx(), parent_type: 'request', parent_id: request.id, name: 'request.png', media_type: 'image/png', size: 68 });
    expect(own.request_id).toBe(request.id); expect(own.work_order_id).toBeNull();
    expect((await people.performer.client.rpc('reserve_record_attachment', { ctx: ctx(), parent_type: 'asset', parent_id: assetId, name: 'asset.png', media_type: 'image/png', size: 68 })).error?.message).toBe('FORBIDDEN');
    const image = await command('owner', 'reserve_record_attachment', { ctx: ctx(), parent_type: 'asset', parent_id: assetId, name: 'asset.png', media_type: 'image/png', size: 68 });
    expect(image.asset_id).toBe(assetId);
    expect((await people.outsider.client.rpc('attachment_access', { organization_id: org, attachment_id: own.id })).error?.message).toBe('NOT_FOUND');
  });
  it('requires immutable same-tenant performer declarations and a revision-bound completeness acknowledgment', async () => {
    const assetId = await asset(); let work = await job(assetId);
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    work = await transition('owner', work, 'open'); work = await transition('performer', work, 'in_progress');
    expect((await people.performer.client.rpc('transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'awaiting_review', reason: null })).error?.message).toBe('INVALID_TRANSITION');
    expect((await people.performer.client.rpc('declare_work_order_performers', { ctx: ctx(work.version), id: work.id, user_ids: [] })).error?.message).toBe('VALIDATION');
    expect((await people.performer.client.rpc('declare_work_order_performers', { ctx: ctx(work.version), id: work.id, user_ids: [people.outsider.id] })).error?.message).toBe('VALIDATION');
    expect((await people.performer.client.rpc('declare_work_order_performers', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id, people.performer.id] })).error?.message).toBe('VALIDATION');
    const args = { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] };
    work = await command('performer', 'declare_work_order_performers', args);
    expect(await command('performer', 'declare_work_order_performers', args)).toEqual(work);
    expect((await people.performer.client.rpc('declare_work_order_performers', { ...args, user_ids: [people.owner.id] })).error?.message).toBe('CONFLICT');
    expect((await people.reviewer.client.rpc('submit_work_order', { ctx: ctx(work.version), id: work.id, acknowledgment: 'I was not declared' })).error?.message).toBe('INVALID_TRANSITION');
    const submitted = await command('performer', 'submit_work_order', { ctx: ctx(work.version), id: work.id, acknowledgment: 'All physical performers have been declared.' });
    const attestations = await people.owner.client.from('work_order_submission_attestations').select('*').eq('work_order_id', work.id);
    expect(attestations.data).toHaveLength(1); const attestation = submissionAttestation.parse(attestations.data![0]);
    expect(attestation.repair_revision).toBe(submitted.repair_revision); expect(attestation.performer_ids).toEqual([people.performer.id]);
    work = await review(submitted, 'returned');
    work = await command('performer', 'update_work_order', { ctx: ctx(work.version), id: work.id, allowed_fields: { note: 'New material correction' } });
    expect(work.repair_revision).toBeGreaterThan(attestation.repair_revision);
    const nextSubmission = await command('performer', 'submit_work_order', { ctx: ctx(work.version), id: work.id, acknowledgment: 'All performers still declared after correction.' });
    const nextAttestations = await people.owner.client.from('work_order_submission_attestations').select('*').eq('work_order_id', work.id);
    expect(nextAttestations.data).toHaveLength(2); expect(nextAttestations.data!.some((row) => submissionAttestation.parse(row).repair_revision === nextSubmission.repair_revision)).toBe(true);
    work = await review(nextSubmission, 'returned');
    sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.performer.id}';`);
    const declarations = await people.owner.client.from('work_order_performer_declarations').select('*').eq('work_order_id', work.id);
    expect(performerDeclaration.parse(declarations.data![0]).user_id).toBe(people.performer.id);
    expect((await people.owner.client.rpc('declare_work_order_performers', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] })).error?.message).toBe('VALIDATION');
    sql(`update public.organization_members set active=true where organization_id='${org}' and user_id='${people.performer.id}';`);
  });
  it('returns strict scoped asset history and row models without exposing owner audit or unrelated jobs', async () => {
    const assetId = await asset(); let work = await job(assetId);
    work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.performer.id] });
    await command('owner', 'add_work_order_task', { ctx: ctx(work.version), id: work.id, label: 'History fixture task', required: false });
    const current = await people.owner.client.from('work_orders').select('*').eq('id', work.id).single(); work = await transition('owner', current.data, 'open');
    const unrelated = await job(assetId); await transition('owner', unrelated, 'open');
    const history = assetHistoryResult.parse((await people.reviewer.client.rpc('get_asset_history', { organization_id: org, asset_id: assetId })).data);
    expect(history.items.length).toBeGreaterThan(0);
    expect((await people.reviewer.client.from('audit_logs').select('id').eq('entity_id', assetId)).data).toEqual([]);
    const limited = assetHistoryResult.parse((await people.performer.client.rpc('get_asset_history', { organization_id: org, asset_id: assetId })).data);
    expect(limited.items.every((item) => item.work_order_id === work.id)).toBe(true);
    expect((await people.outsider.client.rpc('get_asset_history', { organization_id: org, asset_id: assetId })).error?.message).toBe('FORBIDDEN');
    dashboardResult.parse((await people.reviewer.client.rpc('get_dashboard', { organization_id: org, range: { from: '2026-10-01', to: '2026-10-22' } })).data);
    for (const [table, schema] of [['work_order_tasks', workOrderTask], ['work_order_events', workOrderEvent], ['work_order_reviews', workOrderReview]] as const) {
      const rows = await people.owner.client.from(table).select('*').eq('work_order_id', work.id); expect(rows.error).toBeNull(); rows.data!.forEach((row) => schema.parse(row));
    }
    const inbox = await people.performer.client.from('notifications').select('*').eq('organization_id', org).limit(100); expect(inbox.error).toBeNull(); expect(inbox.data!.length).toBeGreaterThan(0); inbox.data!.forEach((row) => notificationRecord.parse(row));
  });
});
