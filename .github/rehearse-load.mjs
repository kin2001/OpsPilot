import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function bind(database, info, network) {
  assert.equal(database.Name, '/supabase_db_opspilot-t1');
  assert.equal(database.Config.Labels['com.supabase.cli.project'], 'opspilot-t1');
  assert(Object.hasOwn(database.NetworkSettings.Networks, network));
  assert.equal(info.Name, network);
  assert.equal(info.Options['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
  for (const bindings of Object.values(database.NetworkSettings.Ports)) for (const item of bindings ?? []) assert(['127.0.0.1', '::1'].includes(item.HostIp));
  assert(/^[a-f0-9]{64}$/.test(database.Id)); return database.Id;
}
function p95(samples) {
  assert(samples.length >= 20 && samples.every((n) => Number.isFinite(n) && n >= 0));
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
}
if (process.argv[2] === '--self-test') {
  assert.equal(p95(Array.from({ length: 20 }, (_, i) => i + 1)), 19);
  assert.throws(() => p95([]));
  const network = 'synthetic-job'; const db = { Id: 'a'.repeat(64), Name: '/supabase_db_opspilot-t1', Config: { Labels: { 'com.supabase.cli.project': 'opspilot-t1' } }, NetworkSettings: { Networks: { [network]: {} }, Ports: { db: [{ HostIp: '127.0.0.1' }] } } };
  const info = { Name: network, Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' } };
  assert.equal(bind(db, info, network), db.Id);
  assert.throws(() => bind(db, info, 'other-job'));
  assert.throws(() => bind({ ...db, Id: 'unknown' }, info, network));
  assert.throws(() => bind({ ...db, NetworkSettings: { ...db.NetworkSettings, Ports: { db: [{ HostIp: '0.0.0.0' }] } } }, info, network));
  console.log('Load binding and percentile self-check passed'); process.exit(0);
}
const url = process.env.TEST_SUPABASE_URL; const anon = process.env.TEST_SUPABASE_ANON_KEY; const service = process.env.TEST_SUPABASE_SERVICE_KEY;
assert(process.env.CI === 'true' && /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') && /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? ''), 'Actual isolated CI job required');
assert(url === 'http://127.0.0.1:54321' && anon && service, 'Unexpected load target');
const network = `por23-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
function execute(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'Isolated load fixture failed; raw output withheld'); return result.stdout;
}
const container = bind(JSON.parse(execute(['inspect', 'supabase_db_opspilot-t1']))[0], JSON.parse(execute(['network', 'inspect', network]))[0], network);
function sql(statement) { return execute(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], statement).trim(); }
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error' }) } };
const admin = createClient(url, service, options); const tenants = []; const readers = [];
for (let t = 0; t < 3; t++) {
  const org = randomUUID(); const people = [];
  for (let n = 0; n < 30; n++) {
    const email = `load28b-${randomUUID()}@example.test`; const password = `Synthetic-${randomUUID()}-Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(created.error, null);
    const person = { id: created.data.user.id };
    if (n < (t === 0 ? 4 : 3)) {
      person.client = createClient(url, anon, options);
      assert.equal((await person.client.auth.signInWithPassword({ email, password })).error, null);
      readers.push({ org, ...person });
    }
    people.push(person);
  }
  const owner = people[0];
  sql(`begin;
   insert into public.organizations(id,name,timezone,currency,created_by) values('${org}','Synthetic bounded load','Asia/Manila','PHP','${owner.id}');
   insert into public.organization_members(organization_id,user_id,role) values ${people.map((p) => `('${org}','${p.id}','owner')`).join(',')};
   insert into public.assets(organization_id,code,name,category,created_by)
    select '${org}','LOAD-'||n,'Synthetic load asset','pump','${owner.id}' from generate_series(1,500)n;
   insert into public.work_orders(organization_id,number,asset_id,title,description,category,priority,supervisor_id,created_by,status)
    select '${org}',n,(select id from public.assets where organization_id='${org}' order by id limit 1),'Synthetic load work','Synthetic bounded fixture','pump','normal','${owner.id}','${owner.id}','draft' from generate_series(1,10000)n;
   insert into public.work_order_events(organization_id,work_order_id,actor_id,request_id,action,status,repair_revision)
    select '${org}',w.id,'${owner.id}',gen_random_uuid(),'create_work_order','draft',1 from public.work_orders w cross join generate_series(1,10)n where w.organization_id='${org}';
   commit;`);
  const asset = JSON.parse(sql(`select row_to_json(a) from public.assets a where organization_id='${org}' order by id limit 1;`));
  assert.equal(sql(`select jsonb_build_array((select count(*) from public.organization_members where organization_id='${org}'),(select count(*) from public.assets where organization_id='${org}'),(select count(*) from public.work_orders where organization_id='${org}'),(select count(*) from public.work_order_events where organization_id='${org}'));`), '[30, 500, 10000, 100000]');
  tenants.push({ org, owner, asset });
}
const lists = []; const details = []; const commands = [];
await Promise.all(readers.map(async ({ org, client }) => {
  const tenant = tenants.find((item) => item.org === org);
  for (let n = 0; n < 10; n++) {
    let started = performance.now();
    const page = await client.from('work_orders').select('*').eq('organization_id', org).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(25);
    lists.push(performance.now() - started); assert.equal(page.error, null); assert.equal(page.data.length, 25); assert(page.data.every((row) => row.organization_id === org));
    started = performance.now();
    const detail = await client.from('assets').select('*').eq('organization_id', org).eq('id', tenant.asset.id).single();
    details.push(performance.now() - started); assert.equal(detail.error, null); assert.equal(detail.data.id, tenant.asset.id);
  }
}));
const { org, owner, asset } = tenants[0];
const args = { ctx: { organization_id: org, request_id: randomUUID(), expected_version: asset.version }, asset_id: asset.id, fields: { code: asset.code, name: 'Synthetic contention update', category: asset.category } };
const replayed = await Promise.all(Array.from({ length: 20 }, async () => {
  const start = performance.now(); const response = await owner.client.rpc('save_asset', args); commands.push(performance.now() - start);
  assert.equal(response.error, null); return response.data;
}));
assert(replayed.every((row) => JSON.stringify(row) === JSON.stringify(replayed[0])));
const race = await Promise.all(Array.from({ length: 20 }, async () => {
  const start = performance.now(); const response = await owner.client.rpc('save_asset', { ...args, ctx: { ...args.ctx, request_id: randomUUID(), expected_version: asset.version + 1 }, fields: { ...args.fields, name: 'Synthetic next version' } });
  commands.push(performance.now() - start); return response.error?.message ?? 'committed';
}));
assert.equal(race.filter((result) => result === 'committed').length, 1); assert.equal(race.filter((result) => result === 'CONFLICT').length, 19);
assert.equal(sql(`select count(*) from private.command_receipts where organization_id='${org}' and action='save_asset';`), '2');
const leaked = await owner.client.from('assets').select('id').eq('organization_id', tenants[1].org).limit(25); assert.equal(leaked.error, null); assert.deepEqual(leaked.data, []);
const denied = await owner.client.rpc('save_asset', { ...args, ctx: { organization_id: tenants[1].org, request_id: randomUUID() } }); assert.equal(denied.error?.message, 'FORBIDDEN');
sql(`update public.organization_members set active=false where organization_id='${org}' and user_id='${owner.id}';`);
assert.equal((await owner.client.rpc('save_asset', args)).error?.message, 'FORBIDDEN');
assert.deepEqual((await owner.client.from('assets').select('id').eq('organization_id', org).limit(25)).data, []);
const measured = { list_p95_ms: p95(lists), detail_p95_ms: p95(details), command_p95_ms: p95(commands) };
console.log(JSON.stringify({ lab: 'job-owned-loopback-after-recovery', organizations: 3, members_each: 30, assets_each: 500, work_orders_each: 10000, events_each: 100000, concurrent_readers: readers.length, contenders: 20, samples: { list: lists.length, detail: details.length, command: commands.length }, ...measured, replay_and_conflict_integrity: true, wrong_tenant_and_revocation_denied: true, boundary: 'Synthetic Linux runner; no hosted entitlement or field performance evidence' }));
assert(measured.list_p95_ms <= 1500 && measured.detail_p95_ms <= 1500, 'Approved lab read p95 exceeded');
assert(measured.command_p95_ms <= 2000, 'Approved lab command p95 exceeded');
