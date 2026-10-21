import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY;
const service = process.env.TEST_SUPABASE_SERVICE_KEY;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('Real isolated loopback Supabase configuration is required; mocks and hosted targets are rejected.');
}
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const people: Record<string, { id: string; email: string; client: SupabaseClient }> = {};
const organizations: Record<string, string> = {};
const context = (organization_id: string) => ({ organization_id, request_id: randomUUID() });
function sql(statement: string) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_opspilot-t1', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: statement, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Isolated database fixture operation failed; raw output withheld.');
}
function failure(error: { message: string } | null, code: string) {
  expect(error?.message).toBe(code);
}
function safeUrl(value: string) {
  try { return new URL(value); } catch { throw new Error('Synthetic email contained an invalid URL; link withheld.'); }
}
async function invitation(email: string) {
  const result = await people.ownerA.client.rpc('create_organization_invitation', { ctx: context(organizations.a), email, role: 'technician' });
  expect(result.error === null).toBe(true);
  const data = result.data.data as { id: string; token: string; expires_at: string };
  expect(typeof data.token).toBe('string');
  const remaining = Date.parse(data.expires_at) - Date.now();
  expect(remaining > 7 * 86400000 - 60000 && remaining <= 7 * 86400000).toBe(true);
  return data;
}

beforeAll(async () => {
  for (const name of ['ownerA', 'ownerB', 'tech', 'outsider', 'unconfirmed']) {
    const email = `${name.toLowerCase()}-${randomUUID()}@example.test`;
    const password = `${randomUUID()}Aa9!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error === null).toBe(true);
    const id = created.data.user!.id;
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    {
      const signed = await client.auth.signInWithPassword({ email, password });
      expect(signed.error === null).toBe(true);
    }
    people[name] = { id, email, client };
  }
  sql(`update auth.users set email_confirmed_at=null where id='${people.unconfirmed.id}';`);
  for (const [label, name] of [['a', 'ownerA'], ['b', 'ownerB']]) {
    const user = people[name];
    sql(`insert into private.pilot_onboarding_allowlist(user_id,email,allowed_organization_count) values ('${user.id}','${user.email}',1);`);
    const created = await user.client.rpc('create_organization', { name: `Synthetic ${label}`, timezone: 'Asia/Manila', currency: 'PHP', request_id: randomUUID() });
    expect(created.error === null).toBe(true);
    organizations[label] = created.data.data.id;
  }
  sql(`insert into public.organization_members(organization_id,user_id,role) values ('${organizations.b}','${people.ownerA.id}','manager');`);
});

describe('real Auth/RPC/RLS trust boundaries', () => {
  it('requires authentication and a server-managed verified bootstrap allowance', async () => {
    const publicClient = createClient(url, anon, { auth: { persistSession: false } });
    failure((await publicClient.rpc('create_organization', { name: 'Denied', timezone: 'UTC', currency: 'PHP', request_id: randomUUID() })).error, 'UNAUTHENTICATED');
    failure((await people.outsider.client.rpc('create_organization', { name: 'Denied', timezone: 'UTC', currency: 'PHP', request_id: randomUUID() })).error, 'FORBIDDEN');
    failure((await people.ownerA.client.rpc('create_organization', { name: 'Excess', timezone: 'UTC', currency: 'PHP', request_id: randomUUID() })).error, 'FORBIDDEN');
    const direct = await people.outsider.client.from('organizations').insert({ name: 'Forged', timezone: 'UTC', currency: 'PHP' });
    expect(direct.error !== null).toBe(true);
    expect((await people.outsider.client.from('organizations').select('id')).data?.length).toBe(0);
  });
  it('requires owner authority and current verified matching email for invitation acceptance', async () => {
    failure((await people.outsider.client.rpc('create_organization_invitation', { ctx: context(organizations.a), email: people.tech.email, role: 'technician' })).error, 'FORBIDDEN');
    failure((await people.ownerA.client.rpc('create_organization_invitation', { ctx: context(organizations.a), email: people.tech.email, role: 'owner' })).error, 'VALIDATION');
    const pending = await invitation(people.unconfirmed.email);
    failure((await people.unconfirmed.client.rpc('accept_organization_invitation', { token: pending.token, request_id: randomUUID() })).error, 'FORBIDDEN');
    const invite = await invitation(people.tech.email);
    failure((await people.outsider.client.rpc('accept_organization_invitation', { token: invite.token, request_id: randomUUID() })).error, 'FORBIDDEN');
    const request_id = randomUUID();
    const accepted = await people.tech.client.rpc('accept_organization_invitation', { token: invite.token, request_id });
    expect(accepted.error === null).toBe(true);
    expect(accepted.data.data.role).toBe('technician');
    expect((await people.tech.client.rpc('accept_organization_invitation', { token: invite.token, request_id })).error === null).toBe(true);
    failure((await people.tech.client.rpc('create_organization_invitation', { ctx: context(organizations.a), email: people.outsider.email, role: 'owner' })).error, 'FORBIDDEN');
    const direct = await people.tech.client.from('organization_members').update({ role: 'owner' }).eq('user_id', people.tech.id);
    expect(direct.error !== null).toBe(true);
  });
  it('rejects expired, revoked and no-longer-authorized invitations', async () => {
    const expired = await invitation(people.outsider.email);
    sql(`update public.organization_invitations set expires_at=now()-interval '1 second' where id='${expired.id}';`);
    failure((await people.outsider.client.rpc('accept_organization_invitation', { token: expired.token, request_id: randomUUID() })).error, 'FORBIDDEN');
    const revoked = await invitation(people.outsider.email);
    const revokedResult = await people.ownerA.client.rpc('revoke_organization_invitation', { ctx: context(organizations.a), invitation_id: revoked.id });
    expect(revokedResult.error === null).toBe(true);
    failure((await people.outsider.client.rpc('accept_organization_invitation', { token: revoked.token, request_id: randomUUID() })).error, 'FORBIDDEN');
    const noInviter = await invitation(people.outsider.email);
    sql(`insert into public.organization_members(organization_id,user_id,role,active) values ('${organizations.a}','${people.outsider.id}','owner',true);`);
    sql(`update public.organization_members set active=false where organization_id='${organizations.a}' and user_id='${people.ownerA.id}';`);
    failure((await people.outsider.client.rpc('accept_organization_invitation', { token: noInviter.token, request_id: randomUUID() })).error, 'FORBIDDEN');
    sql(`update public.organization_members set active=true where organization_id='${organizations.a}' and user_id='${people.ownerA.id}'; delete from public.organization_members where organization_id='${organizations.a}' and user_id='${people.outsider.id}';`);
  });
  it('isolates tenant assets and protects writes, conversion identity and final owner', async () => {
    const fields = { code: 'PUMP-01', name: 'Synthetic pump', category: 'pump' };
    const ctx = context(organizations.a);
    const asset = await people.ownerA.client.rpc('save_asset', { ctx, asset_id: null, fields });
    expect(asset.error === null).toBe(true);
    const assetId = asset.data.data.id;
    const otherTenant = await people.ownerA.client.rpc('save_asset', { ctx: { ...ctx, organization_id: organizations.b }, asset_id: null, fields });
    expect(otherTenant.error === null && otherTenant.data.data.id !== assetId).toBe(true);
    const requestLookup = await people.tech.client.rpc('lookup_request_asset', { organization_id: organizations.a, asset_code: 'PUMP-01', asset_id: null });
    expect(requestLookup.error === null && requestLookup.data.length === 1).toBe(true);
    expect(Object.keys(requestLookup.data[0]).sort()).toEqual(['code', 'id', 'name']);
    expect((await people.tech.client.from('assets').select('id')).data?.length).toBe(0);
    failure((await people.tech.client.rpc('lookup_request_asset', { organization_id: organizations.a, asset_code: null, asset_id: null })).error, 'VALIDATION');
    failure((await people.tech.client.rpc('lookup_request_asset', { organization_id: organizations.a, asset_code: 'PUMP', asset_id: null })).error, 'NOT_FOUND');
    failure((await people.ownerB.client.rpc('lookup_request_asset', { organization_id: organizations.b, asset_code: null, asset_id: assetId })).error, 'NOT_FOUND');
    const duplicate = await people.ownerA.client.rpc('save_asset', { ctx, asset_id: null, fields });
    expect(duplicate.data.data.id === assetId).toBe(true);
    const contenders = await Promise.all(Array.from({ length: 20 }, () => people.ownerA.client.rpc('save_asset', { ctx, asset_id: null, fields })));
    expect(contenders.every((result) => !result.error && result.data.data.id === assetId)).toBe(true);
    failure((await people.ownerA.client.rpc('save_asset', { ctx, asset_id: null, fields: { ...fields, name: 'Changed replay' } })).error, 'CONFLICT');
    const inviteRequest = randomUUID();
    const invitePayload = { email: people.outsider.email, role: 'technician' };
    const inviteA = await people.ownerA.client.rpc('create_organization_invitation', { ctx: { organization_id: organizations.a, request_id: inviteRequest }, ...invitePayload });
    sql(`update public.organization_members set role='owner' where organization_id='${organizations.b}' and user_id='${people.ownerA.id}';`);
    const inviteB = await people.ownerA.client.rpc('create_organization_invitation', { ctx: { organization_id: organizations.b, request_id: inviteRequest }, ...invitePayload });
    sql(`update public.organization_members set role='manager' where organization_id='${organizations.b}' and user_id='${people.ownerA.id}';`);
    expect(inviteA.error === null && inviteB.error === null && inviteA.data.data.token !== inviteB.data.data.token).toBe(true);
    expect((await people.ownerB.client.from('assets').select('id').eq('id', assetId)).data?.length).toBe(0);
    const bucket = `synthetic-${randomUUID()}`;
    expect((await admin.storage.createBucket(bucket, { public: false })).error === null).toBe(true);
    expect((await admin.storage.from(bucket).upload('private.txt', 'synthetic fixture')).error === null).toBe(true);
    expect((await people.ownerB.client.storage.from(bucket).download('private.txt')).error !== null).toBe(true);
    expect((await people.tech.client.storage.from(bucket).upload('forged.txt', 'synthetic fixture')).error !== null).toBe(true);
    const privilegedCrossReference = await admin.from('maintenance_requests').insert({ organization_id: organizations.b, asset_id: assetId, reporter_id: people.ownerB.id, description: 'Invalid cross-tenant reference', category: 'pump' });
    expect(privilegedCrossReference.error?.code).toBe('23503');
    failure((await people.ownerB.client.rpc('save_request', { ctx: context(organizations.b), id: null, asset_id: assetId, description: 'Cross tenant', category: 'pump' })).error, 'NOT_FOUND');
    failure((await people.tech.client.rpc('save_asset', { ctx: context(organizations.a), asset_id: null, fields })).error, 'FORBIDDEN');
    const request = await people.tech.client.rpc('save_request', { ctx: context(organizations.a), id: null, asset_id: assetId, description: 'Leak observed', category: 'pump' });
    expect(request.error === null).toBe(true);
    const requestId = request.data.data.id;
    expect((await people.tech.client.rpc('submit_request', { ctx: context(organizations.a), id: requestId })).error === null).toBe(true);
    const [converted, raced] = await Promise.all([0, 1].map(() => people.ownerA.client.rpc('convert_request', { ctx: context(organizations.a), id: requestId, work_order_fields: { title: 'Inspect leak', priority: 'normal' } })));
    expect(converted.error === null).toBe(true);
    expect(raced.error === null && raced.data.data.id === converted.data.data.id).toBe(true);
    const second = await people.ownerA.client.rpc('convert_request', { ctx: context(organizations.a), id: requestId, work_order_fields: { title: 'Inspect leak', priority: 'normal' } });
    expect(converted.data.data.id === second.data.data.id).toBe(true);
    expect(converted.data.data.status).toBe('draft');
    const manual = await people.ownerA.client.rpc('create_work_order', { ctx: context(organizations.a), asset_id: assetId, fields: { title: 'Manual inspection', description: 'Inspect pump', category: 'pump', priority: 'normal' } });
    expect(manual.error === null && manual.data.data.status === 'draft').toBe(true);
    const assigned = await people.ownerA.client.rpc('assign_work_order', { ctx: { ...context(organizations.a), expected_version: 1 }, id: manual.data.data.id, user_ids: [people.tech.id] });
    expect(assigned.error === null).toBe(true);
    expect((await people.tech.client.from('work_orders').select('id').eq('id', manual.data.data.id)).data?.length).toBe(1);
    failure((await people.tech.client.rpc('assign_work_order', { ctx: { ...context(organizations.a), expected_version: 2 }, id: manual.data.data.id, user_ids: [people.tech.id] })).error, 'FORBIDDEN');
    failure((await people.ownerA.client.rpc('assign_work_order', { ctx: { ...context(organizations.a), expected_version: 2 }, id: manual.data.data.id, user_ids: [people.ownerB.id] })).error, 'VALIDATION');
    const returned = await people.tech.client.rpc('save_request', { ctx: context(organizations.a), id: null, asset_id: assetId, description: 'Needs details', category: 'pump' });
    expect(returned.error === null).toBe(true);
    const returnedId = returned.data.data.id;
    expect((await people.tech.client.rpc('submit_request', { ctx: context(organizations.a), id: returnedId })).error === null).toBe(true);
    expect((await people.ownerA.client.rpc('triage_request', { ctx: context(organizations.a), id: returnedId, decision: 'returned', reason: 'Describe location' })).error === null).toBe(true);
    expect((await people.tech.client.rpc('withdraw_request', { ctx: context(organizations.a), id: returnedId, reason: 'Duplicate report' })).error === null).toBe(true);
    const history = await people.tech.client.from('request_events').select('status,reason').eq('request_id', returnedId).order('created_at');
    expect(history.error === null && history.data?.some((event) => event.reason === 'Describe location') && history.data?.some((event) => event.status === 'withdrawn')).toBe(true);
    failure((await people.tech.client.rpc('submit_request', { ctx: context(organizations.a), id: returnedId })).error, 'INVALID_TRANSITION');
    failure((await people.ownerA.client.rpc('set_organization_member', { ctx: context(organizations.a), user_id: people.ownerA.id, role: 'technician', active: true })).error, 'CONFLICT');
    expect((await people.ownerA.client.rpc('set_organization_member', { ctx: context(organizations.a), user_id: people.tech.id, role: 'technician', active: false })).error === null).toBe(true);
    expect((await people.tech.client.from('assets').select('id')).data?.length).toBe(0);
    failure((await people.tech.client.rpc('lookup_request_asset', { organization_id: organizations.a, asset_code: null, asset_id: assetId })).error, 'FORBIDDEN');
    failure((await people.tech.client.rpc('save_request', { ctx: context(organizations.a), id: null, asset_id: assetId, description: 'Revoked', category: 'pump' })).error, 'FORBIDDEN');
  });
  it('sends recipient-owned Auth links through local mail and still requires explicit membership acceptance', async () => {
    const session = await people.ownerB.client.auth.getSession();
    for (const email of [people.outsider.email, `new-${randomUUID()}@example.test`]) {
      const response = await fetch(`${url}/functions/v1/organization-invite`, {
        method: 'POST', headers: { authorization: `Bearer ${session.data.session!.access_token}`, 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' },
        body: JSON.stringify({ ctx: context(organizations.b), email, role: 'technician' }),
      });
      expect(response.status === 200).toBe(true);
      const body = await response.json();
      expect(!JSON.stringify(body).includes('token') && !JSON.stringify(body).includes('http')).toBe(true);
      let contents = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        const inbox = await (await fetch('http://127.0.0.1:54324/api/v1/messages')).json();
        const message = inbox.messages?.find((entry: { ID: string; To: { Address: string }[] }) => entry.To.some((to) => to.Address === email));
        if (message) {
          const mail = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)).json();
          contents = String(mail.HTML ?? '') + String(mail.Text ?? '');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const match = contents.match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/);
      expect(Boolean(match)).toBe(true);
      const verification = safeUrl(match![0].replaceAll('&amp;', '&'));
      expect(verification.origin === url && verification.pathname === '/auth/v1/verify').toBe(true);
      const verified = await fetch(verification, { redirect: 'manual' });
      const location = verified.headers.get('location');
      expect(Boolean(location)).toBe(true);
      const target = safeUrl(location!);
      expect(target.origin === 'http://127.0.0.1:5173' && target.pathname === '/invite').toBe(true);
      const token = target.searchParams.get('invitation');
      expect(Boolean(token && /^[a-f0-9]{64}$/.test(token))).toBe(true);
      const credentials = new URLSearchParams(target.hash.slice(1));
      const recipient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const signed = await recipient.auth.setSession({ access_token: credentials.get('access_token') ?? '', refresh_token: credentials.get('refresh_token') ?? '' });
      expect(signed.error === null && signed.data.user?.email === email).toBe(true);
      expect((await recipient.from('organization_members').select('user_id').eq('organization_id', organizations.b)).data?.length).toBe(0);
      const accepted = await recipient.rpc('accept_organization_invitation', { token, request_id: randomUUID() });
      expect(accepted.error === null && accepted.data.data.role === 'technician').toBe(true);
    }
  });
  it('transfers ownership only through the explicit current-owner command', async () => {
    failure((await people.outsider.client.rpc('transfer_organization_ownership', { ctx: context(organizations.b), new_owner_id: people.outsider.id })).error, 'FORBIDDEN');
    const transferred = await people.ownerB.client.rpc('transfer_organization_ownership', { ctx: context(organizations.b), new_owner_id: people.outsider.id });
    expect(transferred.error === null && transferred.data.data.role === 'owner').toBe(true);
    failure((await people.ownerB.client.rpc('set_organization_member', { ctx: context(organizations.b), user_id: people.outsider.id, role: 'technician', active: true })).error, 'FORBIDDEN');
    failure((await people.outsider.client.rpc('set_organization_member', { ctx: context(organizations.b), user_id: people.outsider.id, role: 'owner', active: false })).error, 'CONFLICT');
  });
});
