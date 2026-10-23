import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL; const anon = process.env.TEST_SUPABASE_ANON_KEY; const service = process.env.TEST_SUPABASE_SERVICE_KEY;
const run = process.env.GITHUB_RUN_ID; const attempt = process.env.GITHUB_RUN_ATTEMPT; const container = 'supabase_db_opspilot-t1';
assert(process.env.CI === 'true' && /^\d+$/.test(run ?? '') && /^\d+$/.test(attempt ?? '') && url === 'http://127.0.0.1:54321' && anon && service, 'Actual isolated CI required');
const network = `por23-${run}-${attempt}`;
function execute(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, 'Isolated upgrade command failed; raw output withheld'); return result.stdout;
}
function assertOwned() {
  const inventory = JSON.parse(execute('docker', ['inspect', container]))[0];
  assert.equal(inventory.Config.Labels['com.supabase.cli.project'], 'opspilot-t1'); assert(Object.hasOwn(inventory.NetworkSettings.Networks, network));
  assert.equal(JSON.parse(execute('docker', ['network', 'inspect', network]))[0].Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  for (const bindings of Object.values(inventory.NetworkSettings.Ports)) for (const binding of bindings ?? []) assert(['127.0.0.1', '::1'].includes(binding.HostIp));
}
assertOwned();
function sql(statement) { return execute('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'], statement); }
execute('npm', ['exec', '--no', '--', 'supabase', 'db', 'reset', '--local', '--version', '20261021000100', '--network-id', network]);
assertOwned();
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
assertOwned();
console.log(JSON.stringify({ populated_t1_upgrade: true, retained_receipt_replay: true, frozen_new_response: true, former_assignment_backfill: true, conservative_initial_history: true, genuine_legacy_schedule_replay: true, undated_schedule_denial_atomic: true }));
