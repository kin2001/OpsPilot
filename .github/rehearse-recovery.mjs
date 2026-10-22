import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { reconcileAttachments } from './reconcile-attachments.mjs';

function canonicalPermissions(rows) {
  return rows.map((row) => ({
    key: JSON.stringify([row.schema, row.name, row.kind]), schema: row.schema, owner: row.owner,
    grants: [...new Set((row.grants ?? row.defaults).map((tuple) => JSON.stringify(tuple)))].sort(),
  })).sort((left, right) => left.key.localeCompare(right.key));
}
function permissionDifferences(before, after) {
  const old = new Map(before.map((row) => [row.key, row])); const current = new Map(after.map((row) => [row.key, row]));
  return ['public', 'private', 'auth', 'storage'].map((schema) => {
    const counts = { schema, objects_added: 0, objects_removed: 0, owners_changed: 0, grants_added: 0, grants_removed: 0 };
    for (const row of before.filter((item) => item.schema === schema)) {
      const next = current.get(row.key);
      if (!next) { counts.objects_removed++; counts.grants_removed += row.grants.length; continue; }
      if (row.owner !== next.owner) counts.owners_changed++;
      counts.grants_added += next.grants.filter((grant) => !row.grants.includes(grant)).length;
      counts.grants_removed += row.grants.filter((grant) => !next.grants.includes(grant)).length;
    }
    for (const row of after.filter((item) => item.schema === schema && !old.has(item.key))) { counts.objects_added++; counts.grants_added += row.grants.length; }
    return counts;
  });
}
function assertPermissionsEqual(before, after) {
  assert(JSON.stringify(before) === JSON.stringify(after), 'Provider object owner or canonical ACL changed during restore; raw metadata withheld');
}
function assertRestoreBinding(inventory, networkInfo, network) {
  assert.equal(inventory.length, 1, 'Expected exactly one job-owned database');
  const database = inventory[0];
  assert.equal(database.Config.Labels['com.supabase.cli.project'], 'opspilot-t1');
  assert(Object.hasOwn(database.NetworkSettings.Networks, network), 'Job network binding missing');
  assert.equal(networkInfo.Name, network);
  assert.equal(networkInfo.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  for (const bindings of Object.values(database.NetworkSettings.Ports)) for (const binding of bindings ?? []) assert(['127.0.0.1', '::1'].includes(binding.HostIp));
}
function assertRestoreAuthority(inventory, networkInfo, network, identity) {
  assertRestoreBinding(inventory, networkInfo, network);
  assert.deepEqual(identity, { expected_identity: true, superuser: true }, 'Existing local provider administrator unavailable');
}
function recoveryDiagnostic(stderr, input = '') {
  const match = String(stderr).match(/(?:psql:<stdin>:(\d+):\s*)?(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?=[:\s]|$)([^\r\n]*)/);
  const line = match?.[1] ? Number(match[1]) : null;
  const failedLine = line === null ? '' : String(input).split('\n')[line - 1] ?? '';
  const primaryError = match?.[3] ?? '';
  const category = /must be owner/i.test(primaryError) ? 'must-owner'
    : /permission denied to set parameter/i.test(primaryError) ? 'denied-setparameter'
      : /must be (?:a )?superuser|superuser (?:is )?required|only superusers/i.test(primaryError) ? 'superuser-only'
        : /permission denied (?:to set|for) role|must be (?:a )?member of role|cannot set role/i.test(primaryError) ? 'denied-role'
          : /permission denied for (?:table|schema|relation|sequence)/i.test(primaryError) ? 'denied-table-schema' : 'other';
  // psql's location can be the final line of a multiline statement; retain no SQL in the result.
  const priorLines = String(input).split('\n').slice(0, line ?? 0);
  const statementLines = [];
  for (let index = priorLines.length - 1; index >= 0; index--) {
    const value = priorLines[index];
    if (index < priorLines.length - 1 && /;\s*$/.test(value)) break;
    if (!/^\s*--/.test(value)) statementLines.unshift(value);
  }
  const statement = statementLines.join('\n').trim();
  const statementClass = statement.match(/^(CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?(EVENT\s+TRIGGER|DEFAULT\s+PRIVILEGES|FOREIGN\s+DATA\s+WRAPPER|FOREIGN\s+TABLE|TABLE|FUNCTION|SCHEMA|EXTENSION|TYPE|POLICY|TRIGGER|SEQUENCE|PUBLICATION|VIEW|INDEX|DOMAIN|AGGREGATE|OPERATOR|COLLATION)\b/i);
  // Emit fixed header vocabulary only: never copy an arbitrary SQL identifier or value.
  const setting = failedLine.match(/^SET\s+(statement_timeout|lock_timeout|idle_in_transaction_session_timeout|transaction_timeout|client_encoding|standard_conforming_strings|check_function_bodies|xmloption|client_min_messages|escape_string_warning|row_security|default_tablespace|default_table_access_method)\s*=/i);
  const fixedStatement = setting ? 'SET' : /^SELECT pg_catalog\.set_config\('search_path',/.test(failedLine) ? 'SELECT search_path configuration' : null;
  const statements = String(input).split('\n').slice(0, line ?? 0).reverse();
  const ddl = statements.map((value) => value.match(/^\s*(CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?(TABLE|FUNCTION|SCHEMA|EXTENSION|TYPE|POLICY|TRIGGER|SEQUENCE|PUBLICATION|VIEW|INDEX|DOMAIN|AGGREGATE|OPERATOR|COLLATION)\b/))
    .find(Boolean);
  return { recovery_command_failed: true, sqlstate: match?.[2] ?? null, input_line: line, preceding_ddl: ddl ? `${ddl[1]} ${ddl[2]}` : null, failed_statement: statementClass ? `${statementClass[1]} ${statementClass[2]}`.replace(/\s+/g, ' ').toUpperCase() : fixedStatement, parameter: setting?.[1]?.toLowerCase() ?? null, category };
}
if (process.argv[2] === '--diagnostics-self-test') {
  const base = { schema: 'public', name: 'synthetic_relation', kind: 'r', owner: 10, defaults: [[10, 10, 'SELECT', false], [10, 10, 'UPDATE', false]], grants: null };
  const original = canonicalPermissions([base]);
  assertPermissionsEqual(original, canonicalPermissions([{ ...base, grants: [...base.defaults].reverse() }]));
  for (const changed of [
    { ...base, owner: 11 },
    { ...base, grants: [[11, 10, 'SELECT', false], base.defaults[1]] },
    { ...base, grants: [[10, 11, 'SELECT', false], base.defaults[1]] },
    { ...base, grants: [[10, 10, 'SELECT', true], base.defaults[1]] },
    { ...base, name: 'different_relation' },
    { ...base, kind: 'function' },
  ]) assert.throws(() => assertPermissionsEqual(original, canonicalPermissions([changed])));
  assert.throws(() => assertPermissionsEqual(original, canonicalPermissions([])));
  assert.equal(permissionDifferences(original, canonicalPermissions([{ ...base, owner: 11 }]))[0].owners_changed, 1);
  const defaultPolicy = { schema: 'public', name: '10', kind: 'f', owner: 10, grants: [[10, 20, 'EXECUTE', false]] };
  const expectedDefaults = canonicalPermissions([defaultPolicy]);
  assert.throws(() => assertPermissionsEqual(expectedDefaults, canonicalPermissions([{ ...defaultPolicy, schema: 'global' }])));
  assert.throws(() => assertPermissionsEqual(expectedDefaults, canonicalPermissions([{ ...defaultPolicy, kind: 'r' }])));
  const secret = 'synthetic-secret-DO-NOT-PRINT';
  const diagnostic = recoveryDiagnostic(`psql:<stdin>:2: ERROR: 42501\nDETAIL: ${secret}`, `DROP TABLE public.fixture;\n${secret}`);
  assert.deepEqual(diagnostic, { recovery_command_failed: true, sqlstate: '42501', input_line: 2, preceding_ddl: 'DROP TABLE', failed_statement: null, parameter: null, category: 'other' });
  assert(!JSON.stringify(diagnostic).includes(secret));
  assert.deepEqual(recoveryDiagnostic(`ERROR: ${secret}`), { recovery_command_failed: true, sqlstate: null, input_line: null, preceding_ddl: null, failed_statement: null, parameter: null, category: 'other' });
  const header = recoveryDiagnostic(`psql:<stdin>:1: ERROR: 42501`, `SET transaction_timeout = '${secret}';`);
  assert.equal(header.failed_statement, 'SET'); assert.equal(header.parameter, 'transaction_timeout'); assert(!JSON.stringify(header).includes(secret));
  assert.equal(recoveryDiagnostic('psql:<stdin>:1: ERROR: 42501', `SET ${secret} = 0;`).parameter, null);
  const event = recoveryDiagnostic(`psql:<stdin>:3: ERROR: 42501: must be owner of event trigger ${secret}\nCONTEXT: ${secret}`, `-- comment\nDROP EVENT TRIGGER\nIF EXISTS ${secret};`);
  assert.equal(event.failed_statement, 'DROP EVENT TRIGGER'); assert.equal(event.category, 'must-owner'); assert(!JSON.stringify(event).includes(secret));
  for (const [message, expected] of [['permission denied to set parameter', 'denied-setparameter'], ['must be superuser', 'superuser-only'], ['must be member of role', 'denied-role'], ['permission denied for schema', 'denied-table-schema']]) {
    assert.equal(recoveryDiagnostic(`ERROR: 42501: ${message} ${secret}`).category, expected);
  }
  const owned = [{ Config: { Labels: { 'com.supabase.cli.project': 'opspilot-t1' } }, NetworkSettings: { Networks: { 'synthetic-job': {} }, Ports: { db: [{ HostIp: '127.0.0.1' }] } } }];
  const bound = { Name: 'synthetic-job', Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' } };
  assertRestoreAuthority(owned, bound, 'synthetic-job', { expected_identity: true, superuser: true });
  assert.throws(() => assertRestoreAuthority(owned, bound, 'synthetic-job', { expected_identity: true, superuser: false }));
  assert.throws(() => assertRestoreAuthority(owned, bound, 'missing-job', { expected_identity: true, superuser: true }));
  assert.throws(() => assertRestoreAuthority(owned, bound, 'synthetic-job', { expected_identity: false, superuser: true }));
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
function sql(statement, operator = 'postgres') {
  assert(['postgres', 'supabase_admin'].includes(operator));
  return execute(['exec', '-i', container, 'psql', '-X', '-U', operator, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-v', 'SHOW_CONTEXT=never', '-v', 'ECHO=none', '-q', '-At', '--file=-'], statement);
}
const providerFlags = JSON.parse(sql("select json_build_object('server_version_num',current_setting('server_version_num')::integer,'postgres_superuser',(select rolsuper from pg_roles where rolname='postgres'),'postgres_login',(select rolcanlogin from pg_roles where rolname='postgres'),'provider_admin_superuser',(select rolsuper from pg_roles where rolname='supabase_admin'),'provider_admin_login',(select rolcanlogin from pg_roles where rolname='supabase_admin'));"));
assert(Number.isInteger(providerFlags.server_version_num));
for (const flag of ['postgres_superuser', 'postgres_login', 'provider_admin_superuser', 'provider_admin_login']) assert(providerFlags[flag] === null || typeof providerFlags[flag] === 'boolean');
const dumpVersion = execute(['exec', container, 'pg_dump', '--version']).match(/\b(\d+(?:\.\d+){0,2})\b/)?.[1];
assert(dumpVersion, 'Native dump version unavailable');
console.log(JSON.stringify({ recovery_provider_flags: providerFlags, pg_dump_version: dumpVersion }));
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
const permissions = () => canonicalPermissions(JSON.parse(sql(`
 SET search_path=pg_catalog;
 with objects as (
  select n.nspname as schema,c.relname::text as name,c.relkind::text as kind,c.relowner as owner,c.relacl as acl,
   case when c.relkind='S' then 's'::"char" else 'r'::"char" end as default_kind
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','v','m','S')
  union all
  select n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','function',p.proowner,p.proacl,'f'::"char"
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  union all
  select n.nspname,jsonb_build_array(c.relname,a.attname)::text,'column',c.relowner,a.attacl,null::"char"
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where a.attnum>0 and not a.attisdropped and a.attacl is not null
 )
 select coalesce(jsonb_agg(jsonb_build_object('schema',o.schema,'name',o.name,'kind',o.kind,'owner',o.owner,
 'grants',(select coalesce(jsonb_agg(tuple order by tuple),'[]'::jsonb) from (select distinct jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) tuple from aclexplode(coalesce(o.acl,acldefault(o.default_kind,o.owner))) a) grants)
 ) order by o.schema,o.name,o.kind),'[]'::jsonb)
 from objects o where o.schema in ('public','private','auth','storage');
 `)));
const defaultPermissions = () => canonicalPermissions(JSON.parse(sql(`
 select coalesce(jsonb_agg(jsonb_build_object('schema',coalesce(n.nspname,'global'),'name',d.defaclrole::text,'kind',d.defaclobjtype,'owner',d.defaclrole,
 'grants',(select coalesce(jsonb_agg(tuple order by tuple),'[]'::jsonb) from (select distinct jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) tuple from aclexplode(d.defaclacl) a) grants)
 ) order by d.defaclrole,n.nspname,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace;
 `)));
const ownerChecksum = owners();
const originalPermissions = permissions(); const originalDefaults = defaultPermissions();
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
// Full provider DDL needs the existing local operator, never an application role or a hosted grant.
const restoreInventory = JSON.parse(execute(['inspect', container]));
const restoreNetwork = JSON.parse(execute(['network', 'inspect', network]))[0];
assertRestoreBinding(restoreInventory, restoreNetwork, network);
const restoreIdentity = JSON.parse(sql("select json_build_object('expected_identity',current_user='supabase_admin','superuser',(select rolsuper from pg_roles where rolname=current_user));", 'supabase_admin'));
assertRestoreAuthority(restoreInventory, restoreNetwork, network, restoreIdentity);
// Suppress only the restore operator's extra public API defaults; the dump restores the original future-grant policy.
sql(`BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
${dump}
COMMIT;`, 'supabase_admin');
const restoredRawChecksum = owners(); const restoredPermissions = permissions(); const restoredDefaults = defaultPermissions();
const canonicalHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
console.log(JSON.stringify({ recovery_permission_comparison: permissionDifferences(originalPermissions, restoredPermissions), default_acl_restored: JSON.stringify(originalDefaults) === JSON.stringify(restoredDefaults), original_canonical_sha256: canonicalHash(originalPermissions), restored_canonical_sha256: canonicalHash(restoredPermissions), original_raw_fingerprint: ownerChecksum, restored_raw_fingerprint: restoredRawChecksum, representation_only: ownerChecksum !== restoredRawChecksum && JSON.stringify(originalPermissions) === JSON.stringify(restoredPermissions) }));
assertPermissionsEqual(originalPermissions, restoredPermissions);
assertPermissionsEqual(originalDefaults, restoredDefaults);
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
