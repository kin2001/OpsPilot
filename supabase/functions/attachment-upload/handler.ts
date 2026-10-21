import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { commandContext } from '../_shared/core.ts';
import { attachmentRecord, imageMetadata, inspectImage } from '../_shared/operational.ts';
import { domainError } from '../_shared/domain-errors.ts';

type Configuration = { apiUrl: string; publishableKey: string; serviceKey: string; appOrigin: string };
const reservation = z.union([
  z.strictObject({ ctx: commandContext, id: z.uuid(), ...imageMetadata.shape }),
  z.strictObject({ ctx: commandContext, parent_type: z.enum(['asset', 'request']), parent_id: z.uuid(), ...imageMetadata.shape }),
]);
const reference = z.strictObject({ organization_id: z.uuid(), attachment_id: z.uuid() });
export async function handleAttachment(request: Request, config: Configuration): Promise<Response> {
  const headers = { 'Access-Control-Allow-Origin': config.appOrigin, 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, PUT, GET, OPTIONS', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", Vary: 'Origin' };
  const error = (cause: unknown, requestId?: string) => {
    const safe = domainError(cause, requestId);
    return Response.json(safe, { status: { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409, INVALID_TRANSITION: 409, RATE_LIMITED: 429, DEPENDENCY_UNAVAILABLE: 503, INSUFFICIENT_STOCK: 409 }[safe.code], headers });
  };
  if (request.headers.get('origin') && request.headers.get('origin') !== config.appOrigin) return error({ message: 'FORBIDDEN' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['POST', 'PUT', 'GET'].includes(request.method)) return error({ message: 'VALIDATION' });
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) return error({ message: 'UNAUTHENTICATED' });
  let requestId: string | undefined;
  try {
    const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: noStoreFetch } };
    const caller = createClient(config.apiUrl, config.publishableKey, { ...options, global: { ...options.global, headers: { Authorization: authorization } } });
    const identity = await caller.auth.getUser(authorization.slice(7));
    if (identity.error || !identity.data.user) return error({ message: 'UNAUTHENTICATED' });
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return error({ message: 'VALIDATION' });
      const bytes = await boundedBody(request, 8192);
      const input = reservation.parse(JSON.parse(new TextDecoder().decode(bytes)));
      imageMetadata.parse({ name: input.name, media_type: input.media_type, size: input.size });
      requestId = input.ctx.request_id;
      const result = await caller.rpc('id' in input ? 'reserve_attachment' : 'reserve_record_attachment', input);
      if (result.error) return error(result.error, requestId);
      const record = attachmentRecord.parse(result.data.data);
      if (result.data.request_id !== requestId) return error({ message: 'DEPENDENCY_UNAVAILABLE' }, requestId);
      return Response.json({ ...result.data, data: record }, { headers });
    }
    const url = new URL(request.url);
    const input = reference.parse(Object.fromEntries(url.searchParams));
    const found = await caller.rpc('attachment_access', input);
    if (found.error) return error(found.error);
    const record = attachmentRecord.parse(found.data);
    if (request.method === 'GET') {
      if (record.status !== 'ready') return error({ message: 'NOT_FOUND' });
      const downloaded = await caller.storage.from('repair-evidence').download(record.object_key);
      if (downloaded.error || !downloaded.data) return error({ message: 'NOT_FOUND' });
      return new Response(downloaded.data, { headers: { ...headers, 'Content-Type': record.media_type, 'Content-Disposition': `attachment; filename="${encodeURIComponent(record.name)}"` } });
    }
    if (record.uploader_id !== identity.data.user.id) return error({ message: 'FORBIDDEN' });
    if (request.headers.get('content-type')?.split(';')[0] !== record.media_type) return error({ message: 'VALIDATION' });
    const bytes = await boundedBody(request, 5 * 1024 * 1024);
    if (bytes.byteLength !== record.size) return error({ message: 'VALIDATION' });
    const dimensions = inspectImage(bytes, record.media_type);
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    const checksum = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    const service = createClient(config.apiUrl, config.serviceKey, options);
    if (record.status === 'ready') {
      if (record.checksum !== checksum) return error({ message: 'CONFLICT' });
    } else {
      const stored = await service.storage.from('repair-evidence').upload(record.object_key, bytes, { contentType: record.media_type, cacheControl: '0', upsert: false });
      if (stored.error) {
        // A prior uncertain upload may exist; compare its bytes before finalizing the same reservation.
        const previous = await service.storage.from('repair-evidence').download(record.object_key);
        if (previous.error || !previous.data) return error({ message: 'DEPENDENCY_UNAVAILABLE' });
        const previousDigest = await crypto.subtle.digest('SHA-256', await previous.data.arrayBuffer());
        if (Array.from(new Uint8Array(previousDigest), (value) => value.toString(16).padStart(2, '0')).join('') !== checksum) return error({ message: 'CONFLICT' });
      }
    }
    const finalized = await service.rpc('finalize_attachment', { ...input, actor_id: identity.data.user.id, checksum, ...dimensions });
    if (finalized.error) return error(finalized.error);
    return Response.json(attachmentRecord.parse(finalized.data), { headers });
  } catch (cause) {
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) return error({ message: 'VALIDATION' }, requestId);
    return error(cause instanceof Error && cause.message === 'VALIDATION' ? cause : { message: 'DEPENDENCY_UNAVAILABLE' }, requestId);
  }
}

async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('VALIDATION');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('VALIDATION');
  let length = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const item = await reader.read(); if (item.done) break;
    length += item.value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('VALIDATION'); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
