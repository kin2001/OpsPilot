import { expect, it } from 'vitest';
import type { ReportFacts } from '../contracts/reporting';
import { handleReportExport } from '../../supabase/functions/report-export/handler';

const organizationId = '10000000-0000-4000-8000-000000000010';
const range = { from: '2026-10-01', to: '2026-10-02' };
const input = { ctx: { organization_id: organizationId }, kind: 'work_orders', range };

function uuid(value: number) {
  return `10000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function workReport(ids: number[], nextAfter: number | null): ReportFacts {
  return {
    schema_version: 1, kind: 'work_orders', timezone: 'Asia/Manila', currency: 'PHP', range,
    from: '2026-09-30T16:00:00Z', to: '2026-10-01T16:00:00Z', generated_at: '2026-10-25T00:00:00Z',
    next_cursor: nextAfter === null ? null : { after: uuid(nextAfter), page_size: 100 },
    items: ids.map((id) => ({ id: uuid(id), number: id, asset_id: uuid(99), category: `repair ${id}`, status: 'completed', opened_at: '2026-10-01T01:00:00Z', approved_at: '2026-10-01T02:00:00Z', completion_seconds: 3600 })),
    summary: { active_work_orders: 0, blocked: 0, pending_approvals: 0, overdue: 0, completed: ids.length, completion_sample_size: ids.length, completion_seconds: 3600,
      daily_completed: [{ date: '2026-10-01', completed: ids.length }], recurring_faults: [], recurring_faults_has_more: false },
  };
}

function token(aal: 'aal1' | 'aal2' = 'aal2', expired = false) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uuid(50), role: 'authenticated', aud: 'authenticated', aal, iat: now, exp: expired ? now - 10 : now + 3600 })}.c2lnbmF0dXJl`;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(report: (page: number) => Response | ReportFacts | Promise<Response | ReportFacts>, options: { expired?: boolean; timeoutMs?: number; authStatus?: number; authCode?: string } = {}) {
  let authCalls = 0;
  let reportCalls = 0;
  const fetcher: typeof fetch = async (resource) => {
    const url = resource instanceof Request ? new URL(resource.url) : resource instanceof URL ? resource : new URL(String(resource), 'http://fixture');
    if (url.pathname === '/auth/v1/user') {
      authCalls++;
      if (options.expired) return json({ message: 'expired token' }, 401);
      if (options.authStatus) return json({ message: 'auth service unavailable', ...(options.authCode ? { error_code: options.authCode } : {}) }, options.authStatus);
      return json({ id: uuid(50), aud: 'authenticated', role: 'authenticated', factors: [{ id: uuid(51), factor_type: 'totp', status: 'verified' }] });
    }
    if (url.pathname === '/rest/v1/rpc/get_report') {
      reportCalls++;
      const result = await report(reportCalls);
      return result instanceof Response ? result : json(result);
    }
    return json({ message: 'unhandled fixture request' }, 404);
  };
  const callWithToken = (accessToken: string) => handleReportExport(new Request('http://127.0.0.1:54321/functions/v1/report-export', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }), { apiUrl: 'http://127.0.0.1:54321', publishableKey: 'synthetic-anon-key', appOrigin: 'http://127.0.0.1:5173', fetcher, timeoutMs: options.timeoutMs });
  const call = (aal: 'aal1' | 'aal2' = 'aal2') => callWithToken(token(aal, options.expired));
  return { call, callWithToken, authCalls: () => authCalls, reportCalls: () => reportCalls };
}

it('requires AAL2 before any report facts are read', async () => {
  const service = harness(() => workReport([1], null));
  const response = await service.call('aal1');
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'MFA_REQUIRED' });
  expect(service.reportCalls()).toBe(0);
});

it('rechecks the caller and workspace scope for every page and returns no partial CSV on denial', async () => {
  const service = harness((page) => page === 1 ? workReport([1], 1) : json({ code: 'P0001', message: 'FORBIDDEN' }, 400));
  const response = await service.call();
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' });
  expect(service.authCalls()).toBe(2);
  expect(service.reportCalls()).toBe(2);
});

it('rejects an expired session before reading report facts', async () => {
  const service = harness(() => workReport([1], null), { expired: true });
  const response = await service.call();
  expect(response.status).toBe(401);
  expect(service.reportCalls()).toBe(0);
  expect(service.authCalls()).toBe(1);
});

it.each(['invalid.expired.token', 'not-a-jwt', '@@@.e30.signature'])('rejects malformed JWT %j as unauthenticated without trusting its claims', async (malformedToken) => {
  const service = harness(() => workReport([1], null), { authStatus: 401 });
  const response = await service.callWithToken(malformedToken);
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(service.authCalls()).toBe(1);
  expect(service.reportCalls()).toBe(0);
});

it('maps Auth invalid_jwt errors to unauthenticated even when returned with status 400', async () => {
  const service = harness(() => workReport([1], null), { authStatus: 400, authCode: 'invalid_jwt' });
  const response = await service.callWithToken('@@@.e30.signature');
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(service.authCalls()).toBe(1);
  expect(service.reportCalls()).toBe(0);
});

it('keeps Auth service failures classified as dependency errors', async () => {
  const service = harness(() => workReport([1], null), { authStatus: 503 });
  const response = await service.call();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  expect(service.authCalls()).toBe(1);
  expect(service.reportCalls()).toBe(0);
});

it('rejects reports over 10,000 rows without returning a partial file', async () => {
  const service = harness((page) => {
    const start = (page - 1) * 100 + 1;
    return workReport(Array.from({ length: 100 }, (_, index) => start + index), page * 100);
  });
  const response = await service.call();
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ code: 'EXPORT_LIMIT' });
  expect(service.reportCalls()).toBe(100);
});

it('exports exactly 10,000 source rows at the configured boundary', async () => {
  const service = harness((page) => {
    const start = (page - 1) * 100 + 1;
    return workReport(Array.from({ length: 100 }, (_, index) => start + index), page === 100 ? null : page * 100);
  });
  const response = await service.call();
  expect(response.status).toBe(200);
  const csv = await response.text();
  expect(csv).toContain('"Work order ID","Number"');
  expect(csv).toContain(`"${uuid(10_000)}","10000"`);
  expect(service.reportCalls()).toBe(100);
});

it('fails a slow export with a recoverable timeout response', async () => {
  const fetcher: typeof fetch = async (resource, init) => {
    if (new URL(resource instanceof Request ? resource.url : String(resource)).pathname === '/auth/v1/user') return json({ id: uuid(50), aud: 'authenticated', role: 'authenticated', factors: [] });
    return new Promise((_, reject) => {
      const signal = init?.signal;
      const fail = () => reject(new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    });
  };
  const service = await handleReportExport(new Request('http://127.0.0.1:54321/functions/v1/report-export', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:5173', Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }), { apiUrl: 'http://127.0.0.1:54321', publishableKey: 'synthetic-anon-key', appOrigin: 'http://127.0.0.1:5173', fetcher, timeoutMs: 100 });
  expect(service.status).toBe(504);
  expect(await service.json()).toMatchObject({ code: 'EXPORT_TIMEOUT' });
});
