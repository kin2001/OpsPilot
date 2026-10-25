import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildReportCsv } from '../../../src/app/report-export.ts';
import type { Database } from '../../../src/lib/database.types.ts';
import type { ReportFacts } from '../../../src/contracts/reporting.ts';
import { domainError } from '../_shared/domain-errors.ts';
import { reportExportRequest } from '../_shared/report-export.ts';
import { reportResult } from '../_shared/reporting.ts';

const maxRows = 10_000;
const pageSize = 100;
const timeoutMs = 30_000;
const bodyLimit = 8_192;
type Configuration = { apiUrl: string; publishableKey: string; appOrigin: string; fetcher?: typeof fetch; timeoutMs?: number };
type PageReadResult = { ok: true; page: ReportFacts } | { ok: false; response: Response };

function aalFromVerifiedJwt(jwt: string): 'aal1' | 'aal2' | null {
  const encodedPayload = jwt.split('.')[1] ?? '';
  const base64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
  const paddedPayload = base64Payload.padEnd(Math.ceil(base64Payload.length / 4) * 4, '=');
  const binaryPayload = atob(paddedPayload);
  const bytes = Uint8Array.from(binaryPayload, (character) => character.charCodeAt(0));
  const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  const aal = (claims as { aal?: unknown }).aal;
  return aal === 'aal1' || aal === 'aal2' ? aal : null;
}

export async function handleReportExport(request: Request, config: Configuration): Promise<Response> {
  const headers = {
    'Access-Control-Allow-Origin': config.appOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  };
  const error = (cause: unknown, status?: number) => {
    const safe = domainError(cause);
    const statusByCode: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 422, DEPENDENCY_UNAVAILABLE: 503 };
    return Response.json(safe, { status: status ?? statusByCode[safe.code] ?? 503, headers });
  };
  const specialError = (code: 'EXPORT_LIMIT' | 'EXPORT_TIMEOUT' | 'MFA_REQUIRED', message: string, status: number) =>
    Response.json({ code, message, retryable: code === 'EXPORT_TIMEOUT' }, { status, headers });

  if (!config.apiUrl || !config.publishableKey || !config.appOrigin) return error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503);
  if (request.headers.get('origin') && request.headers.get('origin') !== config.appOrigin) return error({ message: 'FORBIDDEN' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return error({ message: 'VALIDATION' }, 405);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) return error({ message: 'UNAUTHENTICATED' }, 401);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return error({ message: 'VALIDATION' }, 422);

  const deadline = AbortSignal.timeout(config.timeoutMs ?? timeoutMs);
  const signal = AbortSignal.any([request.signal, deadline]);
  const timedOut = () => deadline.aborted;
  const timeoutResponse = () => specialError('EXPORT_TIMEOUT', 'This report took too long. Narrow the date range and retry.', 504);

  let input: z.infer<typeof reportExportRequest>;
  try {
    input = reportExportRequest.parse(JSON.parse(new TextDecoder().decode(await readBoundedBody(request, bodyLimit, signal))));
  } catch { return timedOut() ? timeoutResponse() : error({ message: 'VALIDATION' }, 422); }

  const baseFetch = config.fetcher ?? fetch;
  const noStoreFetch: typeof fetch = (resource, init) => baseFetch(resource, {
    ...init,
    cache: 'no-store',
    signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
  });
  let caller: SupabaseClient<Database> | null = null;
  try {
    caller = createClient<Database>(config.apiUrl, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: noStoreFetch, headers: { Authorization: authorization } },
    });
  } catch { return error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503); }
  const readPage = async (cursor: { after?: string; page_size: number }): Promise<PageReadResult> => {
    if (!caller) return { ok: false, response: error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503) };
    const accessToken = authorization.slice(7);
    const verifiedUser = await caller.auth.getUser(accessToken);
    if (timedOut()) return { ok: false, response: timeoutResponse() };
    if (verifiedUser.error) {
      const unauthenticated = verifiedUser.error.status === 401 || ['bad_jwt', 'invalid_jwt'].includes(verifiedUser.error.code ?? '');
      return { ok: false, response: error({ message: unauthenticated ? 'UNAUTHENTICATED' : 'DEPENDENCY_UNAVAILABLE' }, unauthenticated ? 401 : 503) };
    }
    // Auth validated the JWT with the identity provider before these signed claims are read.
    if (aalFromVerifiedJwt(accessToken) !== 'aal2') {
      return { ok: false, response: specialError('MFA_REQUIRED', 'Fresh authenticator verification is required to export this CSV.', 403) };
    }

    const result = await caller.rpc('get_report', {
      ctx: input.ctx,
      kind: input.kind,
      range: input.range,
      cursor,
    }).abortSignal(signal);
    if (timedOut()) return { ok: false, response: timeoutResponse() };
    if (result.error) {
      if (result.error.code === '57014') return { ok: false, response: timeoutResponse() };
      return { ok: false, response: error(result.error) };
    }
    const parsed = reportResult.safeParse(result.data);
    if (!parsed.success || parsed.data.kind !== input.kind || parsed.data.range.from !== input.range.from || parsed.data.range.to !== input.range.to) {
      return { ok: false, response: error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503) };
    }
    if (parsed.data.items.length > cursor.page_size || (parsed.data.items.length === 0 && parsed.data.next_cursor)
      || (parsed.data.next_cursor && parsed.data.next_cursor.page_size !== cursor.page_size)) {
      return { ok: false, response: error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503) };
    }
    return { ok: true, page: parsed.data as ReportFacts };
  };

  const pages: ReportFacts[] = [];
  let after: string | undefined;
  let rowCount = 0;

  try {
    for (let page = 0; page < maxRows / pageSize; page++) {
      const result = await readPage({ page_size: pageSize, ...(after ? { after } : {}) });
      if (!result.ok) return result.response;
      rowCount += result.page.items.length;
      if (rowCount > maxRows) return specialError('EXPORT_LIMIT', 'This report contains more than 10,000 rows. Narrow the date range and retry.', 413);
      pages.push(result.page);
      const next = result.page.next_cursor;
      if (!next) break;
      if (next.after === after || page === maxRows / pageSize - 1) return specialError('EXPORT_LIMIT', 'This report contains more than 10,000 rows. Narrow the date range and retry.', 413);
      after = next.after;
    }
    if (timedOut()) return timeoutResponse();
    const first = pages[0];
    if (!first) return error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503);
    const items: unknown[] = [];
    for (const page of pages) items.push(...page.items);
    const facts = { ...first, items, next_cursor: null } as unknown as ReportFacts;
    const filename = `opspilot-${input.kind}-${input.range.from}-${input.range.to}.csv`;
    const csv = buildReportCsv(facts, input.ctx.organization_id, new Date().toISOString());
    if (timedOut()) return timeoutResponse();
    return new Response(csv, {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
    });
  } catch (cause) {
    if (timedOut()) return timeoutResponse();
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) return error({ message: 'VALIDATION' }, 422);
    return error({ message: 'DEPENDENCY_UNAVAILABLE' }, 503);
  }
}

async function readBoundedBody(request: Request, limit: number, signal: AbortSignal) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('VALIDATION');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('VALIDATION');
  const cancel = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const chunk = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('VALIDATION'); }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
