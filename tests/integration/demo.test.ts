import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { enrollMfa } from './mfa';
import { demoTarget } from '../../demo/isolation';

const url = demoTarget(process.env.TEST_SUPABASE_URL ?? '');
const admin = createClient(url, process.env.TEST_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const fixture = JSON.parse(readFileSync(new URL('../../demo/fixtures.json', import.meta.url), 'utf8'));

function sql(input: string, database = 'postgres') {
  return spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt'], { input, encoding: 'utf8' });
}

it('executes the exact empty-instance bootstrap atomically and refuses missing confirmation, extra identities and existing workspaces', () => {
  // Only this guard needs an empty database; keep the full native journey on the migrated job-owned service below.
  const database = `demo_bootstrap_${randomUUID().replaceAll('-', '')}`;
  const bootstrap = readFileSync(new URL('../../demo/bootstrap.sql', import.meta.url), 'utf8');
  expect(sql(`create database ${database};`).status).toBe(0);
  try {
    expect(sql(`create schema auth; create schema private;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table public.organizations(id uuid primary key);
      create table private.pilot_onboarding_allowlist(user_id uuid primary key references auth.users(id),email text,allowed_organization_count integer);
      insert into auth.users values
      ('00000000-0000-4000-8000-000000000001','demo-owner@example.test',now()),
      ('00000000-0000-4000-8000-000000000002','demo-tech@example.test',now()),
      ('00000000-0000-4000-8000-000000000003','demo-other@example.test',null);`, database).status).toBe(0);
    expect(sql(bootstrap, database).status).not.toBe(0);
    expect(sql('select count(*) from private.pilot_onboarding_allowlist;', database).stdout.trim()).toBe('0');
    expect(sql("update auth.users set email_confirmed_at=now();", database).status).toBe(0);
    expect(sql(bootstrap, database).status).toBe(0);
    expect(sql(bootstrap, database).status).toBe(0);
    expect(sql('select email,allowed_organization_count from private.pilot_onboarding_allowlist order by email;', database).stdout.trim().split('\n')).toEqual(['demo-other@example.test|1', 'demo-owner@example.test|1']);
    expect(sql("insert into auth.users values('00000000-0000-4000-8000-000000000004',null,now());", database).status).toBe(0);
    expect(sql(bootstrap, database).status).not.toBe(0);
    expect(sql("delete from auth.users where email is null; insert into public.organizations values('00000000-0000-4000-8000-000000000005');", database).status).toBe(0);
    expect(sql(bootstrap, database).status).not.toBe(0);
    expect(sql('select count(*) from private.pilot_onboarding_allowlist;', database).stdout.trim()).toBe('2');
  } finally {
    expect(sql(`drop database ${database};`).status).toBe(0);
  }
});

it('reproduces fixture inputs with native Auth/MFA/commands and denies the other tenant and role', async () => {
  // Ordinary CI identities are unique; the manual recipe's fixed emails belong only in its empty dedicated stack.
  const people = [];
  for (const account of fixture.accounts) {
    const email = account.email.replace('@', `-${randomUUID()}@`);
    const password = `${randomUUID()}Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    await enrollMfa(client);
    people.push({ id: created.data.user!.id, email, client });
  }
  const [owner, tech, other] = people;
  const organizations = [];
  for (const [index, person] of [[0, owner], [2, other]] as const) {
    expect(sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values('${person!.id}','${person!.email}',1);`).status).toBe(0);
    const result = await person!.client.rpc('create_organization', { name: fixture.accounts[index].workspace, timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() });
    expect(result.error).toBeNull();
    organizations.push(result.data.data.id as string);
  }
  const organization_id = organizations[0]!;
  // Native invitation is already covered by core journeys; membership setup here scopes the fixture's technician.
  expect(sql(`insert into public.organization_members(organization_id,user_id,role) values('${organization_id}','${tech!.id}','technician');`).status).toBe(0);
  const ctx = () => ({ organization_id, request_id: randomUUID() });
  const saved = await owner!.client.rpc('save_asset', { ctx: ctx(), asset_id: null, fields: fixture.asset });
  expect(saved.error).toBeNull();
  const asset_id = saved.data.data.id;
  const request = await tech!.client.rpc('save_request', { ctx: ctx(), id: null, asset_id, ...fixture.request });
  expect(request.error).toBeNull();
  expect((await tech!.client.rpc('submit_request', { ctx: ctx(), id: request.data.data.id })).error).toBeNull();
  const conversion = { ctx: ctx(), id: request.data.data.id, work_order_fields: { title: fixture.work_order.title, priority: fixture.work_order.priority } };
  const converted = await owner!.client.rpc('convert_request', conversion);
  expect(converted.error).toBeNull();
  expect(converted.data.data.status).toBe('draft');
  expect((await owner!.client.rpc('convert_request', conversion)).data).toEqual(converted.data);
  expect((await other!.client.from('assets').select('id').eq('id', asset_id)).data).toEqual([]);
  expect((await other!.client.rpc('save_request', { ctx: { organization_id: organizations[1], request_id: randomUUID() }, id: null, asset_id, ...fixture.request })).error?.message).toBe('NOT_FOUND');
  expect((await tech!.client.rpc('save_asset', { ctx: ctx(), asset_id: null, fields: { ...fixture.asset, code: 'DEMO-DENIED' } })).error?.message).toBe('FORBIDDEN');
});

it('refuses the bootstrap SQL on a populated instance without granting allowances', () => {
  const before = sql('select count(*) from private.pilot_onboarding_allowlist;');
  expect(before.status).toBe(0);
  const attempt = sql(readFileSync(new URL('../../demo/bootstrap.sql', import.meta.url), 'utf8'));
  expect(attempt.status).not.toBe(0);
  const after = sql('select count(*) from private.pilot_onboarding_allowlist;');
  expect(after.status).toBe(0);
  expect(after.stdout).toBe(before.stdout);
});
