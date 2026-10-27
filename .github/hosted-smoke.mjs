import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, renameSync, existsSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = 'lhlizmdhxjspnxadtzsm';
const organization = 'woyvnmwsxtjesyvdvfkp';
const origin = 'https://opspilot.artkincarreon.site';
let activeReceipt;
let receiptPath;
function mark(stage) {
  activeReceipt.stage = stage;
  const temporary = `${receiptPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(activeReceipt, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, receiptPath);
}

export function assertHostedTarget(env) {
  assert.equal(env.OPSPILOT_PROJECT_REF, project);
  assert.equal(env.OPSPILOT_ORGANIZATION_ID, organization);
  assert.equal(env.SUPABASE_URL, `https://${project}.supabase.co`);
  assert.equal(env.PGHOST, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(env.PGPORT, '5432');
  assert.equal(env.PGUSER, `postgres.${project}`);
  assert.equal(env.PGDATABASE, 'postgres');
  assert.equal(env.PGSSLMODE, 'verify-full');
}

async function main() {
  assertHostedTarget(process.env);
  for (const name of ['OPSPILOT_MANAGEMENT_TOKEN', 'OPSPILOT_ANON_KEY', 'OPSPILOT_SERVICE_ROLE_KEY', 'PGPASSWORD', 'PGSSLROOTCERT']) assert(process.env[name], 'Dedicated protected runtime credential required');
  const url = process.env.SUPABASE_URL;
  const anon = process.env.OPSPILOT_ANON_KEY;
  const service = process.env.OPSPILOT_SERVICE_ROLE_KEY;
  async function management(path) {
    const response = await fetch(`https://api.supabase.com/v1/${path}`, { headers: { Authorization: `Bearer ${process.env.OPSPILOT_MANAGEMENT_TOKEN}` } });
    assert(response.ok, 'Dedicated account verification failed; no fallback');
    return response.json();
  }
  const organizations = await management('organizations');
  assert(organizations.length === 1 && organizations[0].id === organization, 'Exact dedicated organization required');
  const projects = await management('projects');
  const source = projects.find((item) => item.id === project);
  assert(source?.organization_id === organization && source.name === 'opspilot' && source.region === 'ap-southeast-1' && source.status === 'ACTIVE_HEALTHY', 'Bound healthy Singapore backend required');
  const { createClient } = await import('@supabase/supabase-js');
  const { enrollMfa } = await import('../tests/integration/mfa.ts');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, service, options);
  const publicClient = createClient(url, anon, options);
  const people = {};
  const orgs = {};
  const checks = [];
  const run = randomUUID();
  receiptPath = process.env.OPSPILOT_SMOKE_RECEIPT;
  assert(receiptPath && isAbsolute(receiptPath) && !existsSync(receiptPath) && !existsSync(`${receiptPath}.tmp`), 'A new protected smoke receipt is required; reconcile earlier runs before retry');
  assert(lstatSync(dirname(receiptPath)).isDirectory() && !lstatSync(dirname(receiptPath)).isSymbolicLink(), 'Protected receipt directory required');
  activeReceipt = { run_id: run, status: 'running', stage: 'before_first_mutation', project, organization, users: [], organizations: [], attachments: [], request_ids: [], checks };
  writeFileSync(receiptPath, JSON.stringify(activeReceipt, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const requestId = () => { const id = randomUUID(); activeReceipt.request_ids.push(id); mark(activeReceipt.stage); return id; };
  const ctx = (organization_id, expected_version, request_id = requestId()) => ({ organization_id, request_id, ...(expected_version === undefined ? {} : { expected_version }) });
  const success = async (promise) => { const result = await promise; assert.equal(result.error, null, 'Hosted command failed; response withheld'); return result.data; };
  const denied = async (promise, code) => { const result = await promise; assert.equal(result.error?.message, code, 'Hosted denial did not match contract'); };
  function fixture(sql) {
    mark('targeted_synthetic_fixture');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGCONNECT_TIMEOUT'].includes(key)));
    const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { input: sql, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, 'Owned synthetic fixture operation failed; raw SQL output withheld');
  }
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  await denied(publicClient.rpc('create_organization', { name: 'Denied synthetic organization', timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() }), 'UNAUTHENTICATED');
  checks.push('anonymous_command_denied');
  for (const name of ['owner', 'other', 'technician', 'inventory', 'outsider']) {
    const email = `opspilot-smoke-${name}-${run}@example.test`;
    const password = `Synthetic-${randomUUID()}-Aa9!`;
    mark(`create_synthetic_user_${name}`);
    const created = await success(admin.auth.admin.createUser({ email, password, email_confirm: true }));
    assert(created.user?.id && /^[a-f0-9-]{36}$/.test(created.user.id), 'Synthetic account identity missing');
    const client = createClient(url, anon, options);
    activeReceipt.users.push({ name, id: created.user.id, email });
    mark(`sign_in_synthetic_user_${name}`);
    await success(client.auth.signInWithPassword({ email, password }));
    people[name] = { id: created.user.id, email, client };
    if (name === 'owner') {
      fixture(`INSERT INTO private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) VALUES (${quote(created.user.id)},${quote(email)},1);`);
      mark('create_allowlisted_owner_organization_before_mfa');
      const bootstrapped = await success(client.rpc('create_organization', { name: `Synthetic hosted smoke owner ${run}`, timezone: 'Asia/Manila', currency: 'PHP', request_id: requestId() }));
      orgs.owner = bootstrapped.data.id;
      assert(/^[a-f0-9-]{36}$/.test(orgs.owner), 'Synthetic owner organization identity missing');
      activeReceipt.organizations.push({ name: 'owner', id: orgs.owner });
      mark('aal1_privileged_membership_denial');
      await denied(client.rpc('create_organization_invitation', { ctx: ctx(orgs.owner), email: `opspilot-smoke-aal1-${run}@example.test`, role: 'technician' }), 'FORBIDDEN');
      checks.push('aal1_privileged_membership_command_denied');
    }
    mark(`native_mfa_${name}`);
    await enrollMfa(client);
    mark(`native_mfa_verified_${name}`);
  }
  for (const name of ['owner', 'other']) {
    if (orgs[name]) continue;
    const person = people[name];
    if (name !== 'owner') fixture(`INSERT INTO private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) VALUES (${quote(person.id)},${quote(person.email)},1);`);
    mark(`create_synthetic_organization_${name}`);
    const result = await success(person.client.rpc('create_organization', { name: `Synthetic hosted smoke ${name} ${run}`, timezone: 'Asia/Manila', currency: 'PHP', request_id: requestId() }));
    orgs[name] = result.data.id;
    assert(/^[a-f0-9-]{36}$/.test(orgs[name]), 'Synthetic organization identity missing');
    activeReceipt.organizations.push({ name, id: orgs[name] });
    mark(`synthetic_organization_created_${name}`);
  }
  fixture(`INSERT INTO public.organization_members(organization_id,user_id,role) VALUES (${quote(orgs.owner)},${quote(people.technician.id)},'technician'),(${quote(orgs.owner)},${quote(people.inventory.id)},'inventory');`);
  checks.push('native_mfa_and_two_tenants');
  mark('asset_receipts_and_role_boundaries');
  await denied(people.outsider.client.rpc('create_organization', { name: 'Denied without allowance', timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() }), 'FORBIDDEN');
  const request = ctx(orgs.owner);
  const args = { ctx: request, asset_id: null, fields: { code: `SMOKE-${run}`, name: 'Synthetic hosted pump', category: 'pump' } };
  const created = await success(people.owner.client.rpc('save_asset', args));
  const replay = await success(people.owner.client.rpc('save_asset', args));
  assert.deepEqual(replay, created, 'Durable request replay differs');
  await denied(people.owner.client.rpc('save_asset', { ...args, fields: { ...args.fields, name: 'Changed replay' } }), 'CONFLICT');
  const asset = created.data;
  const changed = await success(people.owner.client.rpc('save_asset', { ctx: ctx(orgs.owner, asset.version), asset_id: asset.id, fields: { name: 'Recorded hosted smoke update' } }));
  assert(changed.version > created.version, 'Recorded version did not advance');
  await denied(people.owner.client.rpc('save_asset', { ctx: ctx(orgs.owner, asset.version), asset_id: asset.id, fields: { name: 'Stale update' } }), 'CONFLICT');
  checks.push('receipt_replay_conflict_and_stale_version');
  for (const name of ['other', 'outsider']) {
    const rows = await success(people[name].client.from('assets').select('id').eq('id', asset.id));
    assert.equal(rows.length, 0, 'Cross-tenant or outsider asset leaked');
    await denied(people[name].client.rpc('save_asset', { ctx: ctx(orgs.owner), asset_id: null, fields: { code: randomUUID(), name: 'Denied', category: 'pump' } }), 'FORBIDDEN');
  }
  const forged = await people.owner.client.from('assets').insert({ organization_id: orgs.owner, code: randomUUID(), name: 'Direct write denied', category: 'pump', created_by: people.owner.id });
  assert(forged.error, 'Direct table write unexpectedly allowed');
  checks.push('tenant_rpc_rls_and_direct_write_denials');
  const invitation = await success(people.owner.client.rpc('create_organization_invitation', { ctx: ctx(orgs.owner), email: people.outsider.email, role: 'technician' }));
  await denied(people.other.client.rpc('accept_organization_invitation', { token: invitation.data.token, request_id: randomUUID() }), 'FORBIDDEN');
  checks.push('invitation_recipient_binding');
  mark('private_evidence_round_trip');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhGQAAAAASUVORK5CYII=', 'base64');
  const token = (await people.owner.client.auth.getSession()).data.session.access_token;
  const headers = { Authorization: `Bearer ${token}`, apikey: anon, Origin: origin };
  const endpoint = `${url}/functions/v1/attachment-upload`;
  const reservation = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ctx: ctx(orgs.owner), parent_type: 'asset', parent_id: asset.id, name: 'synthetic-smoke.png', media_type: 'image/png', size: image.length }) });
  assert.equal(reservation.status, 200, 'Hosted evidence reservation failed');
  const attachment = (await reservation.json()).data;
  activeReceipt.attachments.push({ id: attachment.id, object_key: attachment.object_key });
  mark('private_evidence_upload');
  const target = `${endpoint}?organization_id=${orgs.owner}&attachment_id=${attachment.id}`;
  const uploaded = await fetch(target, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: image });
  assert.equal(uploaded.status, 200, 'Hosted validated evidence upload failed');
  const downloaded = await success(people.owner.client.storage.from('repair-evidence').download(attachment.object_key));
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), image, 'Hosted private evidence bytes differ');
  assert((await people.owner.client.storage.from('repair-evidence').createSignedUrl(attachment.object_key, 60)).error, 'Bearer evidence link unexpectedly allowed');
  checks.push('validated_private_evidence_bytes_and_signed_link_denial');
  mark('technician_own_request_visibility');
  const reported = await success(people.technician.client.rpc('save_request', { ctx: ctx(orgs.owner), id: null, asset_id: asset.id, description: 'Synthetic technician-owned request for visibility', category: 'pump' }));
  assert(reported.data.id, 'Technician own-request fixture failed');
  const before = await success(people.technician.client.from('assets').select('id').eq('id', asset.id));
  assert.equal(before.length, 1, 'Technician fixture cannot read its tenant');
  fixture(`UPDATE public.organization_members SET active=false WHERE organization_id=${quote(orgs.owner)} AND user_id=${quote(people.technician.id)};`);
  const after = await success(people.technician.client.from('assets').select('id').eq('id', asset.id));
  assert.equal(after.length, 0, 'Retained JWT bypassed current membership revocation');
  checks.push('retained_jwt_revocation');
  activeReceipt.status = 'PASS';
  mark('complete');
  console.log(JSON.stringify({ status: 'PASS', checks, synthetic_users_created: 5, synthetic_organizations_created: 2, synthetic_evidence_objects_created: 1, retained_for_recovery_rehearsal: true, scope: 'Authenticated hosted smoke; no SMTP delivery, private admission or full recovery acceptance' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    if (activeReceipt) { activeReceipt.status = 'failed_or_uncertain'; try { mark(activeReceipt.stage); } catch { /* Retain the last durable pending stage on receipt failure. */ } }
    console.error('Hosted smoke stopped; raw identity, token, SQL and service errors withheld. Reconcile the protected run receipt and retained synthetic fixtures before retry.'); process.exitCode = 1;
  });
}
