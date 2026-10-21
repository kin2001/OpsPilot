import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { reconcileAttachments } from './reconcile-attachments.mjs';

function recoveryDiagnostic(stderr, input = '') {
  const match = String(stderr).match(/(?:psql:<stdin>:(\d+):\s*)?(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?=\s|$)/);
  const line = match?.[1] ? Number(match[1]) : null;
  const statements = String(input).split('\n').slice(0, line ?? 0).reverse();
  const ddl = statements.map((value) => value.match(/^\s*(CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?(TABLE|FUNCTION|SCHEMA|EXTENSION|TYPE|POLICY|TRIGGER|SEQUENCE|PUBLICATION|VIEW|INDEX|DOMAIN|AGGREGATE|OPERATOR|COLLATION)\b/))
    .find(Boolean);
  return { recovery_command_failed: true, sqlstate: match?.[2] ?? null, input_line: line, preceding_ddl: ddl ? `${ddl[1]} ${ddl[2]}` : null };
}
if (process.argv[2] === '--diagnostics-self-test') {
  const secret = 'synthetic-secret-DO-NOT-PRINT';
  const diagnostic = recoveryDiagnostic(`psql:<stdin>:2: ERROR: 42501\nDETAIL: ${secret}`, `DROP TABLE public.fixture;\n${secret}`);
  assert.deepEqual(diagnostic, { recovery_command_failed: true, sqlstate: '42501', input_line: 2, preceding_ddl: 'DROP TABLE' });
  assert(!JSON.stringify(diagnostic).includes(secret));
  assert.deepEqual(recoveryDiagnostic(`ERROR: ${secret}`), { recovery_command_failed: true, sqlstate: null, input_line: null, preceding_ddl: null });
  console.log('Recovery SQLSTATE-only diagnostic self-check passed'); process.exit(0);
}
const started = performance.now();
const url = process.env.TEST_SUPABASE_URL; const anon = process.env.TEST_SUPABASE_ANON_KEY; const service = process.env.TEST_SUPABASE_SERVICE_KEY;
const run = process.env.GITHUB_RUN_ID; const attempt = process.env.GITHUB_RUN_ATTEMPT;
assert(process.env.CI === 'true' && /^\d+$/.test(run ?? '') && /^\d+$/.test(attempt ?? ''), 'Recovery requires an actual isolated CI job');
assert(url === 'http://127.0.0.1:54321' && anon && service, 'Unexpected recovery target');
const network = `por23-${run}-${attempt}`; const container = 'supabase_db_opspilot-t1';
function execute(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 && args.includes('psql')) console.error(JSON.stringify(recoveryDiagnostic(result.stderr, input)));
  assert.equal(result.status, 0, 'Job-owned recovery command failed; output withheld'); return result.stdout;
}
const inventory = JSON.parse(execute(['inspect', container]));
assert.equal(inventory.length, 1);
assert.equal(inventory[0].Config.Labels['com.supabase.cli.project'], 'opspilot-t1');
assert(Object.hasOwn(inventory[0].NetworkSettings.Networks, network));
const networkInfo = JSON.parse(execute(['network', 'inspect', network]))[0];
assert.equal(networkInfo.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
for (const bindings of Object.values(inventory[0].NetworkSettings.Ports)) for (const binding of bindings ?? []) assert(['127.0.0.1', '::1'].includes(binding.HostIp));
function sql(statement) { return execute(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-v', 'SHOW_CONTEXT=never', '-v', 'ECHO=none', '-q', '-At', '--file=-'], statement); }
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } };
const admin = createClient(url, service, options); const owner = createClient(url, anon, options); const revoked = createClient(url, anon, options);
const people = [];
for (const [name, client] of [['owner', owner], ['revoked', revoked]]) {
  const email = `recovery-${name}-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(created.error, null);
  assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
  people.push({ id: created.data.user.id, email, password });
}
sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values('${people[0].id}','${people[0].email}',1);`);
const organization = await owner.rpc('create_organization', { name: 'Synthetic recovery rehearsal', timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() }); assert.equal(organization.error, null);
const org = organization.data.data.id; const requestId = randomUUID();
const fields = { code: randomUUID(), name: 'Recovery checksum asset', category: 'pump' };
const args = { ctx: { organization_id: org, request_id: requestId }, asset_id: null, fields };
const committed = await owner.rpc('save_asset', args); assert.equal(committed.error, null);
const asset = committed.data.data.id; const job = randomUUID();
sql(`insert into public.organization_members(organization_id,user_id,role) values('${org}','${people[1].id}','technician');
insert into public.work_orders(id,organization_id,number,asset_id,title,description,category,priority,supervisor_id,created_by,status) values('${job}','${org}',1,'${asset}','Synthetic restore work','Synthetic evidence','pump','normal','${people[0].id}','${people[0].id}','in_progress');
insert into public.work_order_assignments(organization_id,work_order_id,user_id) values('${org}','${job}','${people[1].id}');`);
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
const reserved = await owner.rpc('reserve_attachment', { ctx: { organization_id: org, request_id: randomUUID() }, id: job, name: 'restore.png', media_type: 'image/png', size: bytes.length }); assert.equal(reserved.error, null);
const item = reserved.data.data;
const token = (await owner.auth.getSession()).data.session.access_token;
const uploaded = await fetch(`${url}/functions/v1/attachment-upload?organization_id=${org}&attachment_id=${item.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'image/png' }, body: bytes }); assert.equal(uploaded.status, 200);
assert.equal((await revoked.storage.from('repair-evidence').download(item.object_key)).error, null);

// Snapshot bytes, Auth, schema/data, receipts and non-secret source configuration. Nothing is written as a dump/artifact.
const owners = () => sql("select md5(string_agg(n.nspname||'.'||c.relname||':'||c.relowner::text||':'||coalesce(c.relacl::text,''),'|' order by n.nspname,c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind in ('r','v','m','S');").trim();
const ownerChecksum = owners();
const authConfig = await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon }, cache: 'no-store' })).json();
// Restore in the same cluster with its existing provider roles: retain owners and ACLs.
const dump = execute(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--clean', '--if-exists']);
assert(dump.length > 1000);
const objectSnapshot = [];
const metadata = await admin.from('attachments').select('id,object_key,media_type,checksum').eq('status', 'ready').limit(100);
assert.equal(metadata.error, null); assert(metadata.data.length < 100, 'Rehearsal fixture exceeded bounded snapshot');
for (const row of metadata.data) {
  const downloaded = await admin.storage.from('repair-evidence').download(row.object_key); assert.equal(downloaded.error, null);
  const value = Buffer.from(await downloaded.data.arrayBuffer()); assert.equal(createHash('sha256').update(value).digest('hex'), row.checksum);
  objectSnapshot.push({ ...row, bytes: value });
}
const config = readFileSync('supabase/config.toml'); const configChecksum = createHash('sha256').update(config).digest('hex');
const checkpoint = performance.now();
// Retain revocation outside the backup and reapply it before opening restored access.
const revokedUser = people[1].id;
sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${revokedUser}'; update public.assets set name='Synthetic deliberate loss' where id='${asset}';`);
assert.equal((await admin.storage.from('repair-evidence').remove([item.object_key])).error, null);
const restoreStarted = performance.now();
sql(dump);
assert.equal(owners(), ownerChecksum, 'Provider relation ownership/ACLs changed during restore');
sql(`update public.organization_members set active=false,version=version+1 where organization_id='${org}' and user_id='${revokedUser}';`);
for (const row of objectSnapshot) {
  assert.equal((await admin.storage.from('repair-evidence').upload(row.object_key, row.bytes, { contentType: row.media_type, cacheControl: '0', upsert: true })).error, null);
  const restored = await owner.storage.from('repair-evidence').download(row.object_key);
  // Other tenants' evidence is checked through service role, never broaden owner permission.
  const checked = restored.error ? await admin.storage.from('repair-evidence').download(row.object_key) : restored;
  assert.equal(checked.error, null); assert.equal(createHash('sha256').update(Buffer.from(await checked.data.arrayBuffer())).digest('hex'), row.checksum);
}
const configCopy = '.cache/recovery-config.toml';
try { writeFileSync(configCopy, 'Synthetic deliberate configuration loss'); writeFileSync(configCopy, config); assert.equal(createHash('sha256').update(readFileSync(configCopy)).digest('hex'), configChecksum); } finally { rmSync(configCopy, { force: true }); }
assert.equal(createHash('sha256').update(readFileSync('supabase/config.toml')).digest('hex'), configChecksum);
assert.deepEqual(await (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon }, cache: 'no-store' })).json(), authConfig);
const fresh = createClient(url, anon, options);
assert.equal((await fresh.auth.signInWithPassword({ email: people[0].email, password: people[0].password })).error, null);
assert.equal((await fresh.auth.refreshSession()).error, null);
const currentDownload = await fresh.storage.from('repair-evidence').download(item.object_key); assert.equal(currentDownload.error, null);
assert.equal(createHash('sha256').update(Buffer.from(await currentDownload.data.arrayBuffer())).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
assert.deepEqual((await owner.rpc('save_asset', args)).data, committed.data);
assert.equal((await owner.from('assets').select('name').eq('id', asset).single()).data.name, fields.name);
assert.equal((await admin.auth.admin.getUserById(people[0].id)).data.user.email, people[0].email);
assert.notEqual((await revoked.storage.from('repair-evidence').download(item.object_key)).error, null);
assert.deepEqual((await revoked.from('work_orders').select('id').eq('id', job)).data, []);
const stale = await owner.rpc('reserve_attachment', { ctx: { organization_id: org, request_id: randomUUID() }, id: job, name: 'orphan.png', media_type: 'image/png', size: bytes.length }); assert.equal(stale.error, null);
sql(`update public.attachments set created_at=now()-interval '25 hours' where id='${stale.data.data.id}';`);
await reconcileAttachments(admin);
assert.equal((await admin.from('attachments').select('status,cleanup_completed_at').eq('id', stale.data.data.id).single()).data.status, 'rejected');
assert.equal((await admin.from('attachments').select('status').eq('id', item.id).single()).data.status, 'ready');
console.log(JSON.stringify({ rehearsal: 'synthetic-job-owned-loopback', database_auth_receipts_restored: true, source_configuration_checksum: configChecksum, storage_objects_verified: objectSnapshot.length, current_revocation_reconciled: true, snapshot_to_incident_ms: Math.round(restoreStarted - checkpoint), observed_rpo_ms: 0, observed_rto_ms: Math.round(performance.now() - restoreStarted), total_ms: Math.round(performance.now() - started), boundary: 'RPO zero for pre-checkpoint fixture facts; no private/hosted or business acceptance' }));
