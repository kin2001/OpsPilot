import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { beforeEach, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { correctInspection, publishInspectionTemplate, assignInspection, submitInspection, getInspection, listInspectionAssignments } from '../../src/app/inspection-client';
import { enrollMfa } from './mfa';

const url = process.env.TEST_SUPABASE_URL!; const anon = process.env.TEST_SUPABASE_ANON_KEY!; const service = process.env.TEST_SUPABASE_SERVICE_KEY!;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Job-owned loopback services required');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
type Person = { id: string; client: SupabaseClient };
let people: Record<string, Person>; let org: string; let asset: string; let item: string;
const ctx = (version?: number, request = randomUUID()) => ({ organization_id: org, request_id: request, ...(version ? { expected_version: version } : {}) });
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated inspection fixture SQL failed; raw output withheld');
  return result.stdout.trim();
}
function concurrentSql(statement: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { timeout: 20000 });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.resume(); child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error('Concurrent inspection SQL failed; raw output withheld'))); child.stdin.end(statement);
  });
}
async function command(person: string, name: string, args: Record<string, unknown>) {
  const result = await people[person].client.rpc(name, args); expect(result.error, `${name} domain failure`).toBeNull(); return result.data.data;
}
async function version() { return Number(sql(`select version from public.assets where id='${asset}';`)); }
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
async function upload(person: string, parent: { assignment_id: string } | { id: string }) {
  const token = (await people[person].client.auth.getSession()).data.session!.access_token;
  const headers = { Authorization: `Bearer ${token}`, apikey: anon };
  const reserved = await fetch(`${url}/functions/v1/attachment-upload`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ctx: ctx(), ...parent, name: 'evidence.png', media_type: 'image/png', size: bytes.length }) });
  expect(reserved.status).toBe(200); const record = (await reserved.json()).data;
  const uploaded = await fetch(`${url}/functions/v1/attachment-upload?organization_id=${org}&attachment_id=${record.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: bytes });
  expect(uploaded.status).toBe(200); return await uploaded.json();
}
async function assigned(evidence_required = true, safety_relevant = true) {
  const template = await publishInspectionTemplate(people.owner.client, org, { title: 'Synthetic guard inspection', items: [{ id: item, label: 'Guard fitted', required: true, safety_relevant, evidence_required }] }, randomUUID());
  const assignment = await assignInspection(people.owner.client, org, { asset_id: asset, template_revision_id: template.current_revision_id, inspector_id: people.inspector.id }, randomUUID());
  return { template, assignment };
}
// Every ordinary test has independent identities, tenant, asset and quota; deliberate races/retries share a fixture.
beforeEach(async () => {
  people = {}; org = randomUUID(); asset = randomUUID(); item = randomUUID();
  for (const name of ['owner', 'inspector', 'repairer', 'reviewer', 'outsider']) {
    const email = `inspection32-${name}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull(); await enrollMfa(client);
    people[name] = { id: created.data.user!.id, client };
  }
  sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${org}','Synthetic inspections32','UTC','PHP','${people.owner.id}');
   insert into public.organization_members(organization_id,user_id,role) values('${org}','${people.owner.id}','owner'),('${org}','${people.inspector.id}','technician'),('${org}','${people.repairer.id}','technician'),('${org}','${people.reviewer.id}','supervisor');
   insert into public.assets(id,organization_id,code,name,category,created_by) values('${asset}','${org}','INS32','Synthetic guard','pump','${people.owner.id}');`);
});

it('pins published content, validates SQL input and atomically retries one immutable failed episode with private evidence', async () => {
  const { template, assignment } = await assigned();
  await publishInspectionTemplate(people.owner.client, org, { id: template.id, title: 'Future checklist', items: [{ id: item, label: 'New guard rule', required: true, safety_relevant: true, evidence_required: false }] }, randomUUID(), template.version);
  const invalid = (results: unknown) => people.inspector.client.rpc('submit_inspection', { ctx: ctx(), assignment_id: assignment.id, template_revision_id: assignment.template_revision_id, results });
  expect((await invalid([])).error?.message).toBe('VALIDATION');
  expect((await invalid([{ item_id: item, outcome: 'not_applicable', remarks: 'Not fitted', evidence_ids: [] }])).error?.message).toBe('VALIDATION');
  expect((await invalid([{ item_id: item, outcome: 'fail', evidence_ids: [] }])).error?.message).toBe('VALIDATION');
  expect((await invalid([{ item_id: item, outcome: 'fail', remarks: 'Missing', evidence_ids: [] }])).error?.message).toBe('VALIDATION');
  const evidence = await upload('inspector', { assignment_id: assignment.id });
  expect((await people.repairer.client.storage.from('repair-evidence').download(evidence.object_key)).error).not.toBeNull();
  expect((await people.inspector.client.storage.from('repair-evidence').download(evidence.object_key)).error).toBeNull();
  const results = [{ item_id: item, outcome: 'fail' as const, remarks: 'Guard absent', evidence_ids: [evidence.id] }]; const request = randomUUID();
  const submissions = await Promise.all([submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, request), submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, request)]);
  expect(submissions[0]).toEqual(submissions[1]);
  const detail = await getInspection(people.inspector.client, org, assignment.id);
  expect(detail.revision.title).toBe('Synthetic guard inspection'); expect(detail.revision.items[0].label).toBe('Guard fitted'); expect(detail.episodes).toHaveLength(1);
  expect(detail.submission?.inspector_id).toBe(people.inspector.id);
  expect(sql(`select status from public.maintenance_requests where id='${detail.episodes[0].corrective_request_id}';`)).toBe('submitted');
  expect(sql(`select count(*) from public.work_orders where organization_id='${org}';`)).toBe('0');
  await expect(submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, [{ ...results[0], remarks: 'Changed retry' }], request)).rejects.toThrow('CONFLICT');
  await expect(submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, randomUUID())).rejects.toThrow('CONFLICT');
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.inspector.id}';`);
  await expect(submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, request)).rejects.toThrow('FORBIDDEN');
  await expect(getInspection(people.inspector.client, org, assignment.id)).rejects.toThrow('FORBIDDEN');
  expect((await people.inspector.client.storage.from('repair-evidence').download(evidence.object_key)).error).not.toBeNull();
  const token = (await people.inspector.client.auth.getSession()).data.session!.access_token;
  expect((await fetch(`${url}/functions/v1/attachment-upload?organization_id=${org}&attachment_id=${evidence.id}`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } })).status).toBe(404);
});
it('denies wrong tenant, wrong inspector, stale pinned revision and revoked inspector role', async () => {
  const { assignment } = await assigned(false);
  await expect(getInspection(people.outsider.client, org, assignment.id)).rejects.toThrow('FORBIDDEN');
  await expect(listInspectionAssignments(people.outsider.client, org)).rejects.toThrow('FORBIDDEN');
  const results = [{ item_id: item, outcome: 'pass' as const, evidence_ids: [] }];
  await expect(submitInspection(people.owner.client, org, assignment.id, assignment.template_revision_id, results, randomUUID())).rejects.toThrow('FORBIDDEN');
  await expect(submitInspection(people.inspector.client, org, assignment.id, randomUUID(), results, randomUUID())).rejects.toThrow('CONFLICT');
  sql(`update public.organization_members set role='inventory' where organization_id='${org}' and user_id='${people.inspector.id}';`);
  await expect(submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, randomUUID())).rejects.toThrow('FORBIDDEN');
});
it('accepts justified N/A and creates a request without a hold for non-safety failures', async () => {
  const { assignment } = await assigned(false, false);
  await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, [{ item_id: item, outcome: 'not_applicable', reason: 'Not on this model', remarks: 'Model plate verified', evidence_ids: [] }], randomUUID());
  expect((await getInspection(people.inspector.client, org, assignment.id)).episodes).toEqual([]);
  const next = await assigned(false, false);
  await submitInspection(people.inspector.client, org, next.assignment.id, next.assignment.template_revision_id, [{ item_id: item, outcome: 'fail', remarks: 'Paint missing', evidence_ids: [] }], randomUUID());
  const detail = await getInspection(people.owner.client, org, next.assignment.id); expect(detail.episodes).toHaveLength(1); expect(detail.episodes[0].hold_id).toBeNull();
});
it('safety failure on an already archived asset still creates an unresolved hold', async () => {
  const { assignment } = await assigned(false);
  sql(`update public.assets set archived_at=now(),availability='operational' where id='${asset}';`);
  await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, [{ item_id: item, outcome: 'fail', remarks: 'Unsafe archived guard', evidence_ids: [] }], randomUUID());
  expect(sql(`select availability from public.assets where id='${asset}';`)).toBe('out_of_service');
  expect(sql(`select count(*) from public.asset_holds where organization_id='${org}' and resolved_at is null and released_at is null;`)).toBe('1');
});
it('racing release and a fresh safety failure cannot leave Operational in either lock order', async () => {
  const { assignment } = await assigned(false);
  for (const first of ['failure', 'release']) {
    const a = first === 'failure' ? assignment : (await assigned(false)).assignment;
    if (first === 'release') {
      const detail = await getInspection(people.owner.client, org, assignment.id);
      await command('owner', 'resolve_asset_hold', { ctx: ctx(await version()), hold_id: detail.episodes[0].hold_id, disposition: 'withdrawn_with_reason', reason: 'Synthetic acknowledged disposition' });
    }
    const fail = `select set_config('request.jwt.claim.sub','${people.inspector.id}',true); select public.submit_inspection('${JSON.stringify(ctx())}'::jsonb,'${a.id}','${a.template_revision_id}','${JSON.stringify([{ item_id: item, outcome: 'fail', remarks: 'Fresh unsafe condition', evidence_ids: [] }])}'::jsonb);`;
    const release = `select set_config('request.jwt.claim.sub','${people.reviewer.id}',true); select set_config('request.jwt.claims','{"aal":"aal2"}',true); do $guard$ begin perform public.release_asset('${JSON.stringify(ctx(await version()))}'::jsonb,'${asset}','Synthetic release race'); exception when others then if SQLERRM not in ('CONFLICT','INVALID_TRANSITION') then raise; end if; end $guard$;`;
    const leading = concurrentSql(`begin; select 1 from public.organizations where id='${org}' for update; select pg_advisory_xact_lock(320032); select pg_sleep(3); ${first === 'failure' ? fail : release} commit;`);
    // Observe the held advisory marker before issuing the waiter; no timing-only race assertion.
    await expect.poll(() => sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=320032 and granted);"), { timeout: 5000, interval: 30 }).toBe('t');
    const waiterName = `por32-${org}-${first}`;
    const waiting = concurrentSql(`set application_name='${waiterName}'; begin; ${first === 'failure' ? release : fail} commit;`);
    await expect.poll(() => sql(`select exists(select 1 from pg_stat_activity where application_name='${waiterName}' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0);`), { timeout: 5000, interval: 30 }).toBe('t');
    await Promise.all([leading, waiting]);
    expect(sql(`select availability from public.assets where id='${asset}';`)).toBe('out_of_service');
  }
});
it('requires explicit conversion, real repair evidence, independent review, hold disposition and a separate eligible release', async () => {
  const { assignment } = await assigned(false);
  await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, [{ item_id: item, outcome: 'fail', remarks: 'Guard missing', evidence_ids: [] }], randomUUID());
  const episode = (await getInspection(people.owner.client, org, assignment.id)).episodes[0];
  let work = await command('owner', 'convert_request', { ctx: ctx(), id: episode.corrective_request_id, work_order_fields: { title: 'Fit guard', priority: 'normal' } });
  work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.repairer.id] });
  work = await command('owner', 'transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'open', reason: 'Repair approved' });
  work = await command('repairer', 'transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'in_progress', reason: 'Fitting guard' });
  expect((await people.owner.client.rpc('resolve_asset_hold', { ctx: ctx(await version()), hold_id: episode.hold_id, disposition: 'repaired', reason: 'Premature' })).error?.message).toBe('INVALID_TRANSITION');
  await upload('repairer', { id: work.id });
  work = (await people.owner.client.from('work_orders').select('*').eq('id', work.id).single()).data;
  work = await command('repairer', 'declare_work_order_performers', { ctx: ctx(work.version), id: work.id, user_ids: [people.repairer.id] });
  work = await command('repairer', 'submit_work_order', { ctx: ctx(work.version), id: work.id, acknowledgment: 'All actual repair performers declared' });
  sql(`update public.organization_members set role='supervisor' where organization_id='${org}' and user_id='${people.repairer.id}';`);
  expect((await people.repairer.client.rpc('review_work_order', { ctx: ctx(work.version), id: work.id, decision: 'approved', reason: 'Cannot review own work' })).error?.message).toBe('FORBIDDEN');
  work = await command('reviewer', 'review_work_order', { ctx: ctx(work.version), id: work.id, decision: 'approved', reason: 'Guard and evidence checked' }); expect(work.status).toBe('completed');
  expect((await people.reviewer.client.rpc('release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'Inspection hold unresolved' })).error?.message).toBe('INVALID_TRANSITION');
  await command('owner', 'resolve_asset_hold', { ctx: ctx(await version()), hold_id: episode.hold_id, disposition: 'repaired', reason: 'Independent repair review confirmed' });
  expect((await people.repairer.client.rpc('release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'Cannot self release' })).error?.message).toBe('FORBIDDEN');
  await command('reviewer', 'release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'Separate synthetic safety procedure confirmed' });
  expect(sql(`select availability from public.assets where id='${asset}';`)).toBe('operational');
  // Exclusion is current unreleased scope, not a lifetime performer ban.
  await command('repairer', 'release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'No current remedy scope remains' });
  const priorSubmission = (await getInspection(people.inspector.client, org, assignment.id)).submission!;
  const corrected = await correctInspection(people.inspector.client, org, { assignment_id: assignment.id, template_revision_id: assignment.template_revision_id, supersedes_id: priorSubmission.id, correction_reason: 'New observed failure after release', results: [{ item_id: item, outcome: 'fail', remarks: 'Guard missing again', evidence_ids: [] }] }, randomUUID(), priorSubmission.version);
  expect(corrected.version).toBe(2);
  const renewed = await getInspection(people.owner.client, org, assignment.id);
  expect(renewed.episodes).toHaveLength(2);
  expect(renewed.holds.find((h) => h.id === episode.hold_id)?.released_at).not.toBeNull();
  expect(renewed.holds.filter((h) => h.released_at === null && h.resolved_at === null)).toHaveLength(1);
  expect(sql(`select status from public.work_orders where id='${work.id}';`)).toBe('completed');
  expect(sql(`select availability from public.assets where id='${asset}';`)).toBe('out_of_service');

});

it('delivers inspection notifications once to current eligible recipients and enforces read ownership after revocation', async () => {
  const inactive = randomUUID(); const banned = randomUUID(); const otherOrg = randomUUID();
  for (const id of [inactive, banned]) {
    expect((await admin.auth.admin.createUser({ id, email: `inspection32-recipient-${id}@example.test`, email_confirm: true })).error).toBeNull();
  }
  expect((await admin.auth.admin.updateUserById(banned, { ban_duration: '24h' })).error).toBeNull();
  sql(`insert into public.organization_members(organization_id,user_id,role,active) values('${org}','${inactive}','manager',false),('${org}','${banned}','manager',true);
   update public.organization_members set role='inventory' where organization_id='${org}' and user_id='${people.repairer.id}';
   insert into public.organizations(id,name,timezone,currency,created_by) values('${otherOrg}','Other notification tenant','UTC','PHP','${people.outsider.id}');
   insert into public.organization_members(organization_id,user_id,role) values('${otherOrg}','${people.outsider.id}','owner');`);
  const template = await publishInspectionTemplate(people.owner.client, org, { title: 'Recipient inspection', items: [{ id: item, label: 'Guard fitted', required: true, safety_relevant: true, evidence_required: false }] }, randomUUID());
  const fields = { asset_id: asset, template_revision_id: template.current_revision_id, inspector_id: people.inspector.id };
  const assignmentRequest = randomUUID();
  const assignments = await Promise.all([assignInspection(people.owner.client, org, fields, assignmentRequest), assignInspection(people.owner.client, org, fields, assignmentRequest)]);
  expect(assignments[0]).toEqual(assignments[1]);
  const assignment = assignments[0];
  expect(await assignInspection(people.owner.client, org, fields, assignmentRequest)).toEqual(assignment);
  const facts = () => JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('organization_id',organization_id,'recipient_user_id',recipient_user_id,'event_id',event_id,'category',category,'source_id',source_id) order by category,recipient_user_id),'[]') from public.notifications where source_id='${assignment.id}';`));
  const assignmentFact = { organization_id: org, recipient_user_id: people.inspector.id, event_id: assignment.id, category: 'inspection_assignment', source_id: assignment.id };
  expect(facts()).toEqual([assignmentFact]);
  const results = [{ item_id: item, outcome: 'fail' as const, remarks: 'Guard missing', evidence_ids: [] }]; const request = randomUUID();
  const submitted = await Promise.all([submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, request), submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, request)]);
  expect(submitted[0]).toEqual(submitted[1]);
  expect(await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, request)).toEqual(submitted[0]);
  const episodes = (await getInspection(people.owner.client, org, assignment.id)).episodes; expect(episodes).toHaveLength(1);
  const failureFacts = [people.owner.id, people.reviewer.id].sort().map((recipient_user_id) => ({ organization_id: org, recipient_user_id, event_id: episodes[0].id, category: 'inspection_failure', source_id: assignment.id }));
  // Exact whole-source facts also exclude unrelated, inactive, wrong-role and banned recipients in either tenant.
  expect(facts()).toEqual([assignmentFact, ...failureFacts]);
  const notifications = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('id',id,'recipient_user_id',recipient_user_id)) from public.notifications where source_id='${assignment.id}';`)) as { id: string; recipient_user_id: string }[];
  const ids = notifications.map((n) => n.id);
  for (const name of ['owner', 'reviewer', 'inspector', 'repairer', 'outsider']) {
    const response = await people[name].client.from('notifications').select('id,recipient_user_id,organization_id').eq('source_id', assignment.id);
    expect(response.error).toBeNull();
    expect(response.data).toEqual(notifications.filter((n) => n.recipient_user_id === people[name].id).map((n) => ({ ...n, organization_id: org })));
  }
  const ownerNotification = notifications.find((n) => n.recipient_user_id === people.owner.id)!;
  const inspectorNotification = notifications.find((n) => n.recipient_user_id === people.inspector.id)!;
  const readRecipients = () => JSON.parse(sql(`select coalesce(jsonb_agg(recipient_user_id order by recipient_user_id),'[]') from public.notifications where source_id='${assignment.id}' and read_at is not null;`));
  await command('owner', 'mark_notifications_read', { ctx: ctx(), ids: ids.filter((id) => id !== ownerNotification.id) });
  expect(readRecipients()).toEqual([]);
  await command('owner', 'mark_notifications_read', { ctx: ctx(), ids });
  expect(readRecipients()).toEqual([people.owner.id]);
  await command('inspector', 'mark_notifications_read', { ctx: ctx(), ids });
  expect(readRecipients()).toEqual([people.owner.id, people.inspector.id].sort());
  await command('reviewer', 'mark_notifications_read', { ctx: ctx(), ids });
  expect(readRecipients()).toEqual([people.owner.id, people.inspector.id, people.reviewer.id].sort());
  expect((await people.outsider.client.rpc('mark_notifications_read', { ctx: ctx(), ids })).error?.message).toBe('FORBIDDEN');
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.inspector.id}';`);
  const revokedRead = await people.inspector.client.from('notifications').select('id').eq('id', inspectorNotification.id);
  expect(revokedRead.error).toBeNull(); expect(revokedRead.data).toEqual([]);
  expect((await people.inspector.client.rpc('mark_notifications_read', { ctx: ctx(), ids: [inspectorNotification.id] })).error?.message).toBe('FORBIDDEN');
  await expect(getInspection(people.inspector.client, org, assignment.id)).rejects.toThrow('FORBIDDEN');
});

it('serializes distinct correction identities, preserves immutable facts and separately disposes closed paths', async () => {
  const { assignment } = await assigned(false);
  const failed = [{ item_id: item, outcome: 'fail' as const, remarks: 'Missing guard', evidence_ids: [] }];
  const initial = await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, failed, randomUUID());
  const fields = { assignment_id: assignment.id, template_revision_id: assignment.template_revision_id, supersedes_id: initial.id, correction_reason: 'Rechecked in person', results: failed };
  await expect(correctInspection(people.owner.client, org, fields, randomUUID(), 1)).rejects.toThrow('FORBIDDEN');
  await expect(correctInspection(people.outsider.client, org, fields, randomUUID(), 1)).rejects.toThrow('FORBIDDEN');
  await expect(correctInspection(people.inspector.client, org, { ...fields, template_revision_id: randomUUID() }, randomUUID(), 1)).rejects.toThrow('CONFLICT');
  const attempts = await Promise.allSettled([correctInspection(people.inspector.client, org, fields, randomUUID(), 1), correctInspection(people.inspector.client, org, fields, randomUUID(), 1)]);
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.message)).toEqual(['CONFLICT']);
  let detail = await getInspection(people.inspector.client, org, assignment.id);
  expect(detail.history.map((h) => h.version)).toEqual([1, 2]); expect(detail.episodes).toHaveLength(1);
  expect(detail.history[0]).toEqual(initial);
  expect(detail.episode_links.map((l) => l.episode_id)).toEqual([detail.episodes[0].id, detail.episodes[0].id]);
  let current = detail.submission!;
  const pass = await correctInspection(people.inspector.client, org, { ...fields, supersedes_id: current.id, results: [{ item_id: item, outcome: 'pass', evidence_ids: [] }] }, randomUUID(), current.version);
  expect((await getInspection(people.inspector.client, org, assignment.id)).holds[0].resolved_at).toBeNull();
  current = pass;
  for (const state of ['rejected', 'withdrawn'] as const) {
    detail = await getInspection(people.inspector.client, org, assignment.id);
    const prior = detail.episodes.find((e) => !detail.episodes.some((child) => child.predecessor_id === e.id))!;
    if (state === 'rejected') await command('owner', 'triage_request', { ctx: ctx(), id: prior.corrective_request_id, decision: state, reason: 'Synthetic terminal rejection' });
    else await command('inspector', 'withdraw_request', { ctx: ctx(), id: prior.corrective_request_id, reason: 'Synthetic terminal withdrawal' });
    const request = randomUUID(); const next = { ...fields, supersedes_id: current.id };
    const outcomes = await Promise.all([correctInspection(people.inspector.client, org, next, request, current.version), correctInspection(people.inspector.client, org, next, request, current.version)]);
    expect(outcomes[0]).toEqual(outcomes[1]);
    await expect(correctInspection(people.inspector.client, org, { ...next, correction_reason: 'Changed identity payload' }, request, current.version)).rejects.toThrow('CONFLICT');
    current = outcomes[0];
    detail = await getInspection(people.inspector.client, org, assignment.id);
    expect(detail.episodes.find((e) => e.predecessor_id === prior.id)?.corrective_request_id).not.toBe(prior.corrective_request_id);
    expect(detail.holds.every((h) => h.resolved_at === null && h.released_at === null)).toBe(true);
    expect(sql(`select status from public.maintenance_requests where id='${prior.corrective_request_id}';`)).toBe(state);
  }
  expect(detail.episodes).toHaveLength(3); expect(detail.holds).toHaveLength(3);
  const evidence = await upload('inspector', { assignment_id: assignment.id });
  const finalFields = { ...fields, supersedes_id: current.id, results: [{ ...failed[0], evidence_ids: [evidence.id] }] };
  const request = randomUUID();
  const final = await correctInspection(people.inspector.client, org, finalFields, request, current.version);
  expect(final.inspector_id).toBe(people.inspector.id);
  sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${people.inspector.id}';`);
  await expect(correctInspection(people.inspector.client, org, finalFields, request, current.version)).rejects.toThrow('FORBIDDEN');
  expect((await people.inspector.client.storage.from('repair-evidence').download(evidence.object_key)).error).not.toBeNull();
});
it('reuses Converted active work and creates a fresh episode after canceled work without reopening it', async () => {
  const { assignment } = await assigned(false);
  const results = [{ item_id: item, outcome: 'fail' as const, remarks: 'Missing guard', evidence_ids: [] }];
  let current = await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, randomUUID());
  const prior = (await getInspection(people.owner.client, org, assignment.id)).episodes[0];
  const work = await command('owner', 'convert_request', { ctx: ctx(), id: prior.corrective_request_id, work_order_fields: { title: 'Fit guard', priority: 'normal' } });
  const fields = () => ({ assignment_id: assignment.id, template_revision_id: assignment.template_revision_id, supersedes_id: current.id, correction_reason: 'Guard still missing', results });
  current = await correctInspection(people.inspector.client, org, fields(), randomUUID(), current.version);
  expect((await getInspection(people.owner.client, org, assignment.id)).episodes).toHaveLength(1);
  await command('owner', 'transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'canceled', reason: 'Synthetic cancellation' });
  current = await correctInspection(people.inspector.client, org, fields(), randomUUID(), current.version);
  const detail = await getInspection(people.owner.client, org, assignment.id);
  expect(detail.episodes).toHaveLength(2); expect(detail.episodes.find((e) => e.id !== prior.id)?.predecessor_id).toBe(prior.id);
  expect(detail.holds.filter((h) => h.resolved_at === null)).toHaveLength(2);
  expect(sql(`select status from public.work_orders where id='${work.id}';`)).toBe('canceled');
});

it.each([false, true])('renews a safety hold without duplicating an active request after disposition (released=%s)', async (released) => {
  const { assignment } = await assigned(false);
  const results = [{ item_id: item, outcome: 'fail' as const, remarks: 'Guard still missing', evidence_ids: [] }];
  const initial = await submitInspection(people.inspector.client, org, assignment.id, assignment.template_revision_id, results, randomUUID());
  const episode = (await getInspection(people.owner.client, org, assignment.id)).episodes[0];
  await command('owner', 'resolve_asset_hold', { ctx: ctx(await version()), hold_id: episode.hold_id, disposition: 'withdrawn_with_reason', reason: 'Synthetic prior observation disposition' });
  if (released) await command('reviewer', 'release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'Synthetic independent release' });
  const prior = (await getInspection(people.owner.client, org, assignment.id)).holds[0];
  const request = randomUUID();
  const fields = { assignment_id: assignment.id, template_revision_id: assignment.template_revision_id, supersedes_id: initial.id, correction_reason: 'Fresh unsafe observation', results };
  const corrected = await Promise.all([correctInspection(people.inspector.client, org, fields, request, 1), correctInspection(people.inspector.client, org, fields, request, 1)]);
  expect(corrected[0]).toEqual(corrected[1]);
  const detail = await getInspection(people.owner.client, org, assignment.id);
  expect(detail.episodes).toEqual([episode]);
  expect(detail.holds).toHaveLength(2);
  expect(detail.holds.find((h) => h.id === prior.id)).toEqual(prior);
  const renewed = detail.holds.find((h) => h.id !== prior.id)!;
  expect(renewed.source_id).toBe(episode.id); expect(renewed.resolved_at).toBeNull(); expect(renewed.released_at).toBeNull();
  expect(sql(`select count(*) from public.maintenance_requests where organization_id='${org}';`)).toBe('1');
  expect(sql(`select status from public.maintenance_requests where id='${episode.corrective_request_id}';`)).toBe('submitted');
  expect(sql(`select availability from public.assets where id='${asset}';`)).toBe('out_of_service');
  expect((await people.reviewer.client.rpc('release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'Cannot bypass renewed failure' })).error?.message).toBe('INVALID_TRANSITION');
  let work = await command('owner', 'convert_request', { ctx: ctx(), id: episode.corrective_request_id, work_order_fields: { title: 'Repair renewed guard', priority: 'normal' } });
  work = await command('owner', 'assign_work_order', { ctx: ctx(work.version), id: work.id, user_ids: [people.repairer.id] });
  expect((await people.owner.client.rpc('resolve_asset_hold', { ctx: ctx(await version()), hold_id: renewed.id, disposition: 'repaired', reason: 'Active remedy cannot be bypassed' })).error?.message).toBe('INVALID_TRANSITION');
  work = await command('owner', 'transition_work_order', { ctx: ctx(work.version), id: work.id, target: 'canceled', reason: 'Synthetic terminal cancellation' });
  await command('owner', 'resolve_asset_hold', { ctx: ctx(await version()), hold_id: renewed.id, disposition: 'withdrawn_with_reason', reason: 'Separate renewed disposition' });
  sql(`update public.organization_members set role='supervisor' where organization_id='${org}' and user_id='${people.repairer.id}';`);
  expect((await people.repairer.client.rpc('release_asset', { ctx: ctx(await version()), asset_id: asset, acknowledgment: 'Former renewed remedy participant' })).error?.message).toBe('FORBIDDEN');
});
