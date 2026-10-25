import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// Same bounded read-only health gate as the restore rehearsal; never retry user creation.
async function waitForAuth(check, pause) {
  const deadline = performance.now() + 30000;
  for (let attempt = 0; attempt < 20 && performance.now() < deadline; attempt++) {
    try { if (await check(Math.max(1, Math.ceil(deadline - performance.now()))) && performance.now() <= deadline) return; } catch { /* A starting service may refuse connections. */ }
    if (attempt < 19 && performance.now() < deadline) await pause(Math.min(500, Math.max(1, Math.ceil(deadline - performance.now()))));
  }
  assert.fail('Auth readiness failed within the bounded upgrade window');
}
function assertServiceBinding(inventory, networkInfo, network, serviceName) {
  assert.equal(inventory.Name, `/${serviceName}`);
  assert.equal(inventory.Config.Labels['com.supabase.cli.project'], 'opspilot-t1');
  assert(Object.hasOwn(inventory.NetworkSettings.Networks, network));
  assert.equal(networkInfo.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  for (const bindings of Object.values(inventory.NetworkSettings.Ports)) for (const binding of bindings ?? []) assert(['127.0.0.1', '::1'].includes(binding.HostIp));
  assert(/^[a-f0-9]{64}$/.test(inventory.Id), 'Immutable service identity unavailable');
  return inventory.Id;
}
function commandFailureStates(logs) {
  return [...new Set([...logs.matchAll(/opspilot_command_failure action=[a-z_]+ state=([A-Z0-9]{5})\b/g)].map((match) => ['55000', '42702', '42703', '42P01', '42501', '23502', '23503', '23514', 'XX000'].includes(match[1]) ? match[1] : 'other'))];
}
if (process.argv[2] === '--readiness-self-test') {
  const sensitive = 'synthetic-secret-DO-NOT-PRINT';
  assert.deepEqual(commandFailureStates(`opspilot_command_failure action=save_part state=55000 ${sensitive}\nopspilot_command_failure action=save_part state=55000\nopspilot_command_failure action=save_part state=ABCDE`), ['55000', 'other']);
  assert.deepEqual(commandFailureStates(sensitive), []);
  let probes = 0; let pauses = 0;
  await waitForAuth(async () => { probes++; if (probes === 1) throw new Error('Synthetic refusal'); return probes === 3; }, async () => { pauses++; });
  assert.equal(probes, 3); assert.equal(pauses, 2);
  probes = 0; pauses = 0;
  await assert.rejects(waitForAuth(async () => { probes++; return false; }, async () => { pauses++; }), /Auth readiness failed/);
  assert.equal(probes, 20); assert.equal(pauses, 19);
  const owned = { Id: 'a'.repeat(64), Name: '/supabase_auth_opspilot-t1', Config: { Labels: { 'com.supabase.cli.project': 'opspilot-t1' } }, NetworkSettings: { Networks: { 'synthetic-job': {} }, Ports: {} } };
  const bound = { Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' } };
  assert.equal(assertServiceBinding(owned, bound, 'synthetic-job', 'supabase_auth_opspilot-t1'), owned.Id);
  probes = 0;
  await assert.rejects(async () => { assertServiceBinding(owned, bound, 'wrong-job', 'supabase_auth_opspilot-t1'); await waitForAuth(async () => { probes++; return true; }, async () => {}); });
  assert.equal(probes, 0);
  assert.throws(() => assertServiceBinding({ ...owned, NetworkSettings: { ...owned.NetworkSettings, Ports: { '9999/tcp': [{ HostIp: '0.0.0.0' }] } } }, bound, 'synthetic-job', 'supabase_auth_opspilot-t1'));
  console.log(JSON.stringify({ auth_readiness_self_test: true, transient_refusal: true, bounded_failure: true, wrong_binding_no_probe: true }));
  process.exit(0);
}
const url = process.env.TEST_SUPABASE_URL; const anon = process.env.TEST_SUPABASE_ANON_KEY; const service = process.env.TEST_SUPABASE_SERVICE_KEY;
const run = process.env.GITHUB_RUN_ID; const attempt = process.env.GITHUB_RUN_ATTEMPT; const container = 'supabase_db_opspilot-t1';
assert(process.env.CI === 'true' && /^\d+$/.test(run ?? '') && /^\d+$/.test(attempt ?? '') && url === 'http://127.0.0.1:54321' && anon && service, 'Actual isolated CI required');
const network = `por23-${run}-${attempt}`;
function execute(command, args, input, timeout) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout });
  assert.equal(result.status, 0, 'Isolated upgrade command failed; raw output withheld'); return result.stdout;
}
function assertOwned(serviceName = container) {
  const inventory = JSON.parse(execute('docker', ['inspect', serviceName], undefined, 10000))[0];
  const networkInfo = JSON.parse(execute('docker', ['network', 'inspect', network], undefined, 10000))[0];
  return assertServiceBinding(inventory, networkInfo, network, serviceName);
}
async function requireAuthReady() {
  const authContainer = assertOwned('supabase_auth_opspilot-t1');
  await waitForAuth(async (remaining) => (await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.min(2000, remaining)) })).ok, (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  assert.equal(assertOwned('supabase_auth_opspilot-t1'), authContainer, 'Auth container changed during readiness');
}
assertOwned();
function sql(statement) { return execute('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'], statement); }
execute('npm', ['exec', '--no', '--', 'supabase', 'db', 'reset', '--local', '--version', '20261021000100', '--network-id', network]);
assertOwned();
await requireAuthReady();
// Upgrade only this positively verified stack; the normal clean reset follows this rehearsal.
assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='assets' and column_name='availability';").trim(), '0');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, options); const caller = createClient(url, anon, options);
const email = `upgrade-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(user.error, null);
const actor = user.data.user.id; assert.equal((await caller.auth.signInWithPassword({ email, password })).error, null);
sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values('${actor}','${email}',1);`);
const created = await caller.rpc('create_organization', { name: 'Populated T1 upgrade', timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() }); assert.equal(created.error, null);
const org = created.data.data.id; const request = randomUUID(); const ctx = { organization_id: org, request_id: request };
const fields = { code: randomUUID(), name: 'Retained T1 asset', category: 'pump' };
const assetArgs = { ctx, asset_id: null, fields }; const asset = await caller.rpc('save_asset', assetArgs); assert.equal(asset.error, null);
const job = await caller.rpc('create_work_order', { ctx: { ...ctx, request_id: randomUUID() }, asset_id: asset.data.data.id, fields: { title: 'Retained draft', description: 'Synthetic upgrade', category: 'pump', priority: 'normal' } }); assert.equal(job.error, null);
const assigned = await caller.rpc('assign_work_order', { ctx: { ...ctx, request_id: randomUUID(), expected_version: 1 }, id: job.data.data.id, user_ids: [actor] }); assert.equal(assigned.error, null);
sql(`update public.work_order_assignments set unassigned_at=now() where organization_id='${org}' and work_order_id='${job.data.data.id}';`);
assertOwned();
execute('npm', ['exec', '--no', '--', 'supabase', 'migration', 'up', '--local', '--network-id', network]);
assertOwned();
sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='opspilot-maintenance';");
assert.deepEqual((await caller.rpc('save_asset', assetArgs)).data, asset.data);
const fresh = await caller.rpc('save_asset', { ...assetArgs, ctx: { ...ctx, request_id: randomUUID(), expected_version: 1 }, asset_id: asset.data.data.id, fields: { name: 'Edited after additive migration' } }); assert.equal(fresh.error, null);
assert.deepEqual(Object.keys(fresh.data.data).sort(), Object.keys(asset.data.data).sort());
assert.equal(sql(`select count(*) from public.work_order_participants where organization_id='${org}' and work_order_id='${job.data.data.id}' and user_id='${actor}' and source='assignment_backfill';`).trim(), '1');
assert.equal(sql(`select availability from public.assets where id='${asset.data.data.id}';`).trim(), 'out_of_service');
assert.equal(sql(`select count(*) from public.audit_logs where entity_id='${asset.data.data.id}' and action='asset.availability_changed' and changes->>'provenance'='migration_availability_unverified' and changes->'prior_status'='null'::jsonb;`).trim(), '1');
assert.equal(sql(`select count(*) from public.asset_releases where organization_id='${org}';`).trim(), '0');
// Create a genuine receipt on the last schema that allowed scheduling without a planned date.
assertOwned();
execute('npm', ['exec', '--no', '--', 'supabase', 'db', 'reset', '--local', '--version', '20261023000100', '--network-id', network]);
assertOwned();
await requireAuthReady();
const legacyAdmin = createClient(url, service, options); const legacyCaller = createClient(url, anon, options);
const legacyEmail = `schedule-upgrade-${randomUUID()}@example.test`; const legacyPassword = `Synthetic-${randomUUID()}-Aa9!`;
const legacyUser = await legacyAdmin.auth.admin.createUser({ email: legacyEmail, password: legacyPassword, email_confirm: true }); assert.equal(legacyUser.error, null);
const legacyActor = legacyUser.data.user.id;
assert.equal((await legacyCaller.auth.signInWithPassword({ email: legacyEmail, password: legacyPassword })).error, null);
sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values('${legacyActor}','${legacyEmail}',1);`);
const legacyCreated = await legacyCaller.rpc('create_organization', { name: 'Scheduling upgrade', timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() }); assert.equal(legacyCreated.error, null);
const legacyOrg = legacyCreated.data.data.id;
const legacyCtx = (version) => ({ organization_id: legacyOrg, request_id: randomUUID(), ...(version ? { expected_version: version } : {}) });
const legacyAsset = await legacyCaller.rpc('save_asset', { ctx: legacyCtx(), asset_id: null, fields: { code: randomUUID(), name: 'Scheduling fixture', category: 'pump' } }); assert.equal(legacyAsset.error, null);
const legacyJob = await legacyCaller.rpc('create_work_order', { ctx: legacyCtx(), asset_id: legacyAsset.data.data.id, fields: { title: 'Legacy schedule', description: 'Synthetic upgrade', category: 'pump', priority: 'normal' } }); assert.equal(legacyJob.error, null);
const legacyOpen = await legacyCaller.rpc('transition_work_order', { ctx: legacyCtx(legacyJob.data.version), id: legacyJob.data.data.id, target: 'open', reason: null }); assert.equal(legacyOpen.error, null);
const legacyArgs = { ctx: legacyCtx(legacyOpen.data.version), id: legacyJob.data.data.id, target: 'scheduled', reason: null };
const legacyScheduled = await legacyCaller.rpc('transition_work_order', legacyArgs); assert.equal(legacyScheduled.error, null);
assert.equal(Object.hasOwn(legacyScheduled.data.data, 'planned_on'), false);
assertOwned();
execute('npm', ['exec', '--no', '--', 'supabase', 'migration', 'up', '--local', '--network-id', network]);
assertOwned();
sql("select cron.alter_job(jobid,active:=false) from cron.job where jobname='opspilot-maintenance';");
assert.equal(sql(`select planned_on is null from public.work_orders where id='${legacyJob.data.data.id}';`).trim(), 't');
const schedulingState = () => sql(`select md5(string_agg(fact::text,'|' order by fact::text)) from (${[
  'public.assets', 'public.work_orders', 'public.work_order_events', 'public.work_order_participants', 'public.asset_holds', 'public.notifications', 'public.audit_logs', 'private.command_receipts',
].map((table) => `select jsonb_build_object('table','${table}','data',to_jsonb(t)) as fact from ${table} t where organization_id='${legacyOrg}'`).join(' union all ')}) facts;`).trim();
const beforeLegacyReplay = schedulingState();
const legacyReplay = await legacyCaller.rpc('transition_work_order', legacyArgs); assert.equal(legacyReplay.error, null);
assert.deepEqual(legacyReplay.data, legacyScheduled.data); assert.equal(schedulingState(), beforeLegacyReplay);
const reopened = await legacyCaller.rpc('transition_work_order', { ctx: legacyCtx(legacyScheduled.data.version), id: legacyJob.data.data.id, target: 'open', reason: null }); assert.equal(reopened.error, null);
const beforeUndated = schedulingState();
const replayAfterReopen = await legacyCaller.rpc('transition_work_order', legacyArgs); assert.equal(replayAfterReopen.error, null);
assert.deepEqual(replayAfterReopen.data, legacyScheduled.data); assert.equal(schedulingState(), beforeUndated);
const undated = await legacyCaller.rpc('transition_work_order', { ...legacyArgs, ctx: legacyCtx(reopened.data.version) });
assert.equal(undated.error?.message, 'VALIDATION'); assert.equal(schedulingState(), beforeUndated);
// The populated pre-PM upgrade also exposes the bounded plan API without rewriting old work or receipts.
const planFields = { asset_id: legacyAsset.data.data.id, title: 'Synthetic upgraded plan', instructions: 'Preserved plan instructions', category: 'routine', cadence: 'month', frequency: 1, anchor_on: '2024-01-31', supervisor_id: legacyActor, assignee_ids: [legacyActor], checklist: ['Inspect belt'], status: 'active' };
const preview = await legacyCaller.rpc('preview_maintenance_plan', { organization_id: legacyOrg, fields: planFields }); assert.equal(preview.error, null);
assert.equal(preview.data.first_new.scheduled_local_date, '2024-01-31'); assert.equal(schedulingState(), beforeUndated);
const planArgs = { ctx: legacyCtx(), fields: planFields };
const plan = await legacyCaller.rpc('save_maintenance_plan', planArgs); assert.equal(plan.error, null);
assert.deepEqual((await legacyCaller.rpc('save_maintenance_plan', planArgs)).data, plan.data);
const revisions = await legacyCaller.rpc('list_maintenance_revisions', { organization_id: legacyOrg, plan_id: plan.data.data.id, page_size: 1 }); assert.equal(revisions.error, null);
assert.equal(revisions.data.items[0].segment.next_ordinal, 0); assert.equal(revisions.data.items[0].revision.author_id, legacyActor);
assert.deepEqual((await legacyCaller.rpc('transition_work_order', legacyArgs)).data, legacyScheduled.data);
assert.equal(sql(`select count(*) from public.work_orders where organization_id='${legacyOrg}';`).trim(), '1');
const generated = JSON.parse(sql("select private.generate_due_maintenance('2026-10-24 12:00Z');"));
assert(generated.generated >= 1);
const occurrence = JSON.parse(sql(`select to_jsonb(o) from public.maintenance_occurrences o where plan_id='${plan.data.data.id}';`));
assert.equal(occurrence.scheduled_local_date, '2024-01-31');
assert.equal(sql(`select creation_actor_kind||':'||(created_by is null)::text||':'||blocks_operation::text from public.work_orders where id='${occurrence.work_order_id}';`).trim(), 'system:true:false');
assert.deepEqual((await legacyCaller.rpc('transition_work_order', legacyArgs)).data, legacyScheduled.data);
assert.deepEqual((await legacyCaller.rpc('save_maintenance_plan', planArgs)).data, plan.data);
assert.equal(sql(`select count(*) from public.maintenance_occurrences where plan_id='${plan.data.data.id}';`).trim(), '1');
const inspectionItem = randomUUID();
const inspectionTemplate = await legacyCaller.rpc('publish_inspection_template', { ctx: legacyCtx(), fields: { title: 'Upgraded inspection', items: [{ id: inspectionItem, label: 'Guard fitted', required: true, safety_relevant: true, evidence_required: false }] } }); assert.equal(inspectionTemplate.error, null);
const inspectionAssignment = await legacyCaller.rpc('assign_inspection', { ctx: legacyCtx(), asset_id: legacyAsset.data.data.id, template_revision_id: inspectionTemplate.data.data.current_revision_id, inspector_id: legacyActor }); assert.equal(inspectionAssignment.error, null);
const inspectionArgs = { ctx: legacyCtx(), assignment_id: inspectionAssignment.data.data.id, template_revision_id: inspectionAssignment.data.data.template_revision_id, results: [{ item_id: inspectionItem, outcome: 'fail', remarks: 'Synthetic upgrade safety failure', evidence_ids: [] }] };
const inspectionSubmitted = await legacyCaller.rpc('submit_inspection', inspectionArgs); assert.equal(inspectionSubmitted.error, null);
assert.deepEqual((await legacyCaller.rpc('submit_inspection', inspectionArgs)).data, inspectionSubmitted.data);
assert.equal(sql(`select count(*) from public.inspection_failure_episodes e join public.asset_holds h on h.organization_id=e.organization_id and h.id=e.hold_id join public.maintenance_requests r on r.organization_id=e.organization_id and r.id=e.corrective_request_id where e.assignment_id='${inspectionAssignment.data.data.id}' and h.source_id=e.id and h.released_at is null and r.status='submitted';`).trim(), '1');
// Populate the actual pre-correction schema, then forward-upgrade immutable facts and old receipts.
assertOwned();
execute('npm', ['exec', '--no', '--', 'supabase', 'db', 'reset', '--local', '--version', '20261024000300', '--network-id', network]);
assertOwned(); await requireAuthReady();
const correctionAdmin = createClient(url, service, options); const correctionCaller = createClient(url, anon, options);
const correctionEmail = `correction-upgrade-${randomUUID()}@example.test`; const correctionPassword = `Synthetic-${randomUUID()}-Aa9!`;
const correctionUser = await correctionAdmin.auth.admin.createUser({ email: correctionEmail, password: correctionPassword, email_confirm: true }); assert.equal(correctionUser.error, null);
const correctionActor = correctionUser.data.user.id;
assert.equal((await correctionCaller.auth.signInWithPassword({ email: correctionEmail, password: correctionPassword })).error, null);
sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values('${correctionActor}','${correctionEmail}',1);`);
const correctionOrg = await correctionCaller.rpc('create_organization', { name: 'Correction upgrade', timezone: 'UTC', currency: 'PHP', request_id: randomUUID() }); assert.equal(correctionOrg.error, null);
const correctionCtx = (version) => ({ organization_id: correctionOrg.data.data.id, request_id: randomUUID(), ...(version ? { expected_version: version } : {}) });
const correctionAsset = await correctionCaller.rpc('save_asset', { ctx: correctionCtx(), asset_id: null, fields: { code: randomUUID(), name: 'Correction upgrade', category: 'pump' } }); assert.equal(correctionAsset.error, null);
const correctionItem = randomUUID();
const correctionTemplate = await correctionCaller.rpc('publish_inspection_template', { ctx: correctionCtx(), fields: { title: 'Pre-correction template', items: [{ id: correctionItem, label: 'Guard', required: true, safety_relevant: true, evidence_required: false }] } }); assert.equal(correctionTemplate.error, null);
const correctionAssignment = await correctionCaller.rpc('assign_inspection', { ctx: correctionCtx(), asset_id: correctionAsset.data.data.id, template_revision_id: correctionTemplate.data.data.current_revision_id, inspector_id: correctionActor }); assert.equal(correctionAssignment.error, null);
const oldSubmissionArgs = { ctx: correctionCtx(), assignment_id: correctionAssignment.data.data.id, template_revision_id: correctionAssignment.data.data.template_revision_id, results: [{ item_id: correctionItem, outcome: 'fail', remarks: 'Synthetic pre-correction failure', evidence_ids: [] }] };
const oldSubmission = await correctionCaller.rpc('submit_inspection', oldSubmissionArgs); assert.equal(oldSubmission.error, null);
assert.equal(Object.hasOwn(oldSubmission.data.data, 'supersedes_id'), false);
assertOwned(); execute('npm', ['exec', '--no', '--', 'supabase', 'migration', 'up', '--local', '--network-id', network]); assertOwned();
assert.deepEqual((await correctionCaller.rpc('submit_inspection', oldSubmissionArgs)).data, oldSubmission.data);
const correction = await correctionCaller.rpc('correct_inspection', { ctx: correctionCtx(1), assignment_id: correctionAssignment.data.data.id, template_revision_id: correctionAssignment.data.data.template_revision_id, supersedes_id: oldSubmission.data.data.id, correction_reason: 'Synthetic forward upgrade recheck', results: oldSubmissionArgs.results }); assert.equal(correction.error, null);
const correctionRead = await correctionCaller.rpc('get_inspection', { organization_id: correctionOrg.data.data.id, assignment_id: correctionAssignment.data.data.id }); assert.equal(correctionRead.error, null);
assert.equal(correctionRead.data.history.length, 2); assert.equal(correctionRead.data.episodes.length, 1); assert.equal(correctionRead.data.episode_links.length, 2);
assert.equal(correctionRead.data.history[0].supersedes_id, null); assert.equal(correctionRead.data.submission.supersedes_id, oldSubmission.data.data.id);
// Inventory is additive to the populated pre-inventory tenant; old inspection receipts remain unchanged.
assert.equal((await correctionCaller.rpc('list_inventory_parts', { organization_id: correctionOrg.data.data.id })).data.items.length, 0);
const stockPart = await correctionCaller.rpc('save_part', { ctx: correctionCtx(), fields: { code: 'UP35', name: 'Upgraded stock', unit: 'kg', reorder_threshold: '0.001' } });
if (stockPart.error) {
  assertOwned();
  const logs = spawnSync('docker', ['logs', '--tail', '100', container], { encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
  console.error(JSON.stringify({ upgrade_stock_diagnostic: { collection_complete: logs.status === 0, sqlstates: commandFailureStates(`${logs.stdout ?? ''}\n${logs.stderr ?? ''}`) } }));
}
assert.equal(stockPart.error, null);
assert.equal(stockPart.data.data.archived_at, null);
const stockLocation = await correctionCaller.rpc('save_stock_location', { ctx: correctionCtx(), fields: { code: 'UP35', name: 'Upgraded shelf' } }); assert.equal(stockLocation.error, null);
const stockArgs = { ctx: correctionCtx(), fields: { part_id: stockPart.data.data.id, location_id: stockLocation.data.data.id, quantity: '0.001', unit: 'kg' } };
const stockReceipt = await correctionCaller.rpc('receive_stock', stockArgs); assert.equal(stockReceipt.error, null);
assert.deepEqual((await correctionCaller.rpc('receive_stock', stockArgs)).data, stockReceipt.data);
const upgradedBalances = await correctionCaller.rpc('list_inventory_balances', { organization_id: correctionOrg.data.data.id }); assert.equal(upgradedBalances.error, null);
assert.equal(upgradedBalances.data.items[0].on_hand, '0.001'); assert.equal(upgradedBalances.data.items[0].available, '0.001');
assert.deepEqual((await correctionCaller.rpc('submit_inspection', oldSubmissionArgs)).data, oldSubmission.data);
assertOwned();
// Populate the accepted 26A schema before applying job allocations; retain its receipt exactly.
execute('npm', ['exec', '--no', '--', 'supabase', 'db', 'reset', '--local', '--version', '20261024000500', '--network-id', network]);
assertOwned(); await requireAuthReady();
const jobAdmin = createClient(url, service, options); const jobOwner = createClient(url, anon, options); const jobTechnician = createClient(url, anon, options);
const jobPeople = [];
for (const [role, client] of [['owner', jobOwner], ['technician', jobTechnician]]) {
  const email = `job-upgrade-${role}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
  const user = await jobAdmin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(user.error, null);
  assert.equal((await client.auth.signInWithPassword({ email, password })).error, null); jobPeople.push(user.data.user.id);
}
const jobOrg = randomUUID(); const jobAsset = randomUUID(); const jobId = randomUUID();
sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${jobOrg}','Populated 26A upgrade','UTC','PHP','${jobPeople[0]}');
 insert into public.organization_members(organization_id,user_id,role) values('${jobOrg}','${jobPeople[0]}','owner'),('${jobOrg}','${jobPeople[1]}','technician');
 insert into public.assets(id,organization_id,code,name,category,created_by) values('${jobAsset}','${jobOrg}','UP36','Synthetic pump','pump','${jobPeople[0]}');
 insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('${jobId}','${jobOrg}',1,'${jobAsset}','Synthetic job','Populated job','pump','normal','${jobPeople[0]}','open','${jobPeople[0]}');
 insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${jobOrg}','${jobId}','${jobPeople[1]}');`);
const jobCtx = (version) => ({ organization_id: jobOrg, request_id: randomUUID(), ...(version ? { expected_version: version } : {}) });
const jobPart = await jobOwner.rpc('save_part', { ctx: jobCtx(), fields: { code: 'UP36', name: 'Retained 26A stock', unit: 'kg', reorder_threshold: null } }); assert.equal(jobPart.error, null);
const jobLocation = await jobOwner.rpc('save_stock_location', { ctx: jobCtx(), fields: { code: 'UP36', name: 'Retained shelf' } }); assert.equal(jobLocation.error, null);
const oldStockArgs = { ctx: jobCtx(), fields: { part_id: jobPart.data.data.id, location_id: jobLocation.data.data.id, quantity: '0.300', unit: 'kg' } };
const oldStock = await jobOwner.rpc('receive_stock', oldStockArgs); assert.equal(oldStock.error, null);
const oldStockRows = await jobOwner.rpc('list_inventory_movements', { organization_id: jobOrg }); assert.equal(oldStockRows.error, null);
assertOwned(); execute('npm', ['exec', '--no', '--', 'supabase', 'migration', 'up', '--local', '--network-id', network]); assertOwned();
assert.deepEqual((await jobOwner.rpc('receive_stock', oldStockArgs)).data, oldStock.data);
assert.deepEqual((await jobOwner.rpc('list_inventory_movements', { organization_id: jobOrg })).data, oldStockRows.data);
const parts = await jobTechnician.rpc('request_parts', { ctx: jobCtx(1), fields: { work_order_id: jobId, lines: [{ part_id: jobPart.data.data.id, quantity: '0.200', unit: 'kg' }] } }); assert.equal(parts.error, null);
const allocation = await jobOwner.rpc('reserve_parts', { ctx: jobCtx(parts.data.version), fields: { work_order_id: jobId, lines: [{ part_id: jobPart.data.data.id, location_id: jobLocation.data.data.id, quantity: '0.200', unit: 'kg' }] } }); assert.equal(allocation.error, null);
assert.equal(allocation.data.data.parts[0].reserved, '0.200'); assert.equal(allocation.data.data.reconciliation_state, 'consistent');
console.log(JSON.stringify({ populated_t1_upgrade: true, retained_receipt_replay: true, frozen_new_response: true, former_assignment_backfill: true, conservative_initial_history: true, genuine_legacy_schedule_replay: true, undated_schedule_denial_atomic: true, populated_plan_upgrade: true, additive_inventory_exact_receipts: true }));

// Populated 26B facts and original receipts survive the additive guardrail migration.
{
// Populate the accepted 26A schema before applying job allocations; retain its receipt exactly.
execute('npm', ['exec', '--no', '--', 'supabase', 'db', 'reset', '--local', '--version', '20261024000600', '--network-id', network]);
assertOwned(); await requireAuthReady();
const jobAdmin = createClient(url, service, options); const jobOwner = createClient(url, anon, options); const jobTechnician = createClient(url, anon, options);
const jobPeople = [];
for (const [role, client] of [['owner', jobOwner], ['technician', jobTechnician]]) {
  const email = `job-upgrade-${role}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
  const user = await jobAdmin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(user.error, null);
  assert.equal((await client.auth.signInWithPassword({ email, password })).error, null); jobPeople.push(user.data.user.id);
}
const jobOrg = randomUUID(); const jobAsset = randomUUID(); const jobId = randomUUID();
sql(`insert into public.organizations(id,name,timezone,currency,created_by) values('${jobOrg}','Populated 26B upgrade','UTC','PHP','${jobPeople[0]}');
 insert into public.organization_members(organization_id,user_id,role) values('${jobOrg}','${jobPeople[0]}','owner'),('${jobOrg}','${jobPeople[1]}','technician');
 insert into public.assets(id,organization_id,code,name,category,created_by) values('${jobAsset}','${jobOrg}','UP36','Synthetic pump','pump','${jobPeople[0]}');
 insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,status,created_by) values('${jobId}','${jobOrg}',1,'${jobAsset}','Synthetic job','Populated job','pump','normal','${jobPeople[0]}','open','${jobPeople[0]}');
 insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${jobOrg}','${jobId}','${jobPeople[1]}');`);
const jobCtx = (version) => ({ organization_id: jobOrg, request_id: randomUUID(), ...(version ? { expected_version: version } : {}) });
const jobPart = await jobOwner.rpc('save_part', { ctx: jobCtx(), fields: { code: 'UP36', name: 'Retained 26B stock', unit: 'kg', reorder_threshold: '0.300' } }); assert.equal(jobPart.error, null);
const jobLocation = await jobOwner.rpc('save_stock_location', { ctx: jobCtx(), fields: { code: 'UP36', name: 'Retained shelf' } }); assert.equal(jobLocation.error, null);
const oldStockArgs = { ctx: jobCtx(), fields: { part_id: jobPart.data.data.id, location_id: jobLocation.data.data.id, quantity: '0.300', unit: 'kg' } };
const oldStock = await jobOwner.rpc('receive_stock', oldStockArgs); assert.equal(oldStock.error, null);
const oldStockRows = await jobOwner.rpc('list_inventory_movements', { organization_id: jobOrg }); assert.equal(oldStockRows.error, null);
const demandArgs={ctx:jobCtx(1),fields:{work_order_id:jobId,lines:[{part_id:jobPart.data.data.id,quantity:'0.200',unit:'kg'}]}};
const demand=await jobTechnician.rpc('request_parts',demandArgs);assert.equal(demand.error,null);
const allocationArgs={ctx:jobCtx(demand.data.version),fields:{work_order_id:jobId,lines:[{...demandArgs.fields.lines[0],location_id:jobLocation.data.data.id}]}};
const allocation=await jobOwner.rpc('reserve_parts',allocationArgs);assert.equal(allocation.error,null);
const issueArgs={ctx:jobCtx(allocation.data.version),fields:{work_order_id:jobId,lines:[{reservation_id:allocation.data.data.reservations[0].id,quantity:'0.100',unit:'kg'}]}};
const issued=await jobOwner.rpc('issue_reserved_stock',issueArgs);assert.equal(issued.error,null);
const before=await jobOwner.rpc('get_job_parts',{organization_id:jobOrg,work_order_id:jobId});assert.equal(before.error,null);
assertOwned();execute('npm',['exec','--no','--','supabase','migration','up','--local','--network-id',network]);assertOwned();
assert.deepEqual((await jobOwner.rpc('receive_stock',oldStockArgs)).data,oldStock.data);
assert.deepEqual((await jobOwner.rpc('reserve_parts',allocationArgs)).data,allocation.data);
assert.deepEqual((await jobOwner.rpc('issue_reserved_stock',issueArgs)).data,issued.data);
assert.deepEqual((await jobOwner.rpc('get_job_parts',{organization_id:jobOrg,work_order_id:jobId})).data,before.data);
assert.equal(sql(`select count(*) from public.notifications where organization_id='${jobOrg}' and category='low_stock';`).trim(),'0');
assert.equal(sql(`select is_low from private.stock_low_state where organization_id='${jobOrg}';`).trim(),'t');
console.log(JSON.stringify({populated_26b_guardrail_upgrade:true,original_receipts_and_job_projection_retained:true}));
}
