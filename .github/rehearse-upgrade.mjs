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
execute('npm', ['exec', '--no', '--', 'supabase', 'migration', 'up', '--local', '--network-id', network]);
assert.deepEqual((await caller.rpc('save_asset', assetArgs)).data, asset.data);
const fresh = await caller.rpc('save_asset', { ...assetArgs, ctx: { ...ctx, request_id: randomUUID(), expected_version: 1 }, asset_id: asset.data.data.id, fields: { name: 'Edited after additive migration' } }); assert.equal(fresh.error, null);
assert.deepEqual(Object.keys(fresh.data.data).sort(), Object.keys(asset.data.data).sort());
assert.equal(sql(`select count(*) from public.work_order_participants where organization_id='${org}' and work_order_id='${job.data.data.id}' and user_id='${actor}' and source='assignment_backfill';`).trim(), '1');
assert.equal(sql(`select availability from public.assets where id='${asset.data.data.id}';`).trim(), 'out_of_service');
assert.equal(sql(`select count(*) from public.audit_logs where entity_id='${asset.data.data.id}' and action='asset.availability_changed' and changes->>'provenance'='migration_availability_unverified' and changes->'prior_status'='null'::jsonb;`).trim(), '1');
assert.equal(sql(`select count(*) from public.asset_releases where organization_id='${org}';`).trim(), '0');
console.log(JSON.stringify({ populated_t1_upgrade: true, retained_receipt_replay: true, frozen_new_response: true, former_assignment_backfill: true, conservative_initial_history: true }));
