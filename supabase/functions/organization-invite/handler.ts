import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { commandContext, invitationRole } from '../_shared/core.ts';
import { domainError } from '../_shared/domain-errors.ts';

const inputSchema = z.strictObject({ ctx: commandContext, email: z.email().max(254), role: invitationRole });
type Configuration = { apiUrl: string; publishableKey: string; appOrigin: string; emailEnabled: boolean };
export async function handleInvitation(request: Request, config: Configuration): Promise<Response> {
  const headers = { 'Access-Control-Allow-Origin': config.appOrigin, 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
  const error = (code: string, status: number, request_id?: string) => Response.json({ ...domainError({ message: code }, request_id) }, { status, headers });
  if (request.headers.get('origin') && request.headers.get('origin') !== config.appOrigin) return error('FORBIDDEN', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return error('VALIDATION', 405);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) return error('UNAUTHENTICATED', 401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return error('VALIDATION', 422);
  let input: z.infer<typeof inputSchema>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return error('VALIDATION', 422);
    let length = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 8192) { await reader.cancel(); return error('VALIDATION', 422); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    input = inputSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return error('VALIDATION', 422); }
  const requestId = input.ctx.request_id;
  if (!config.emailEnabled) return error('DEPENDENCY_UNAVAILABLE', 503, requestId);
  try {
    const origin = new URL(config.appOrigin);
    if (origin.origin !== config.appOrigin || (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname))) return error('DEPENDENCY_UNAVAILABLE', 503, requestId);
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const caller = createClient(config.apiUrl, config.publishableKey, { ...options, global: { headers: { Authorization: authorization } } });
    const identity = await caller.auth.getUser(authorization.slice(7));
    if (identity.error || !identity.data.user) return error('UNAUTHENTICATED', 401, requestId);
    const created = await caller.rpc('create_organization_invitation', input);
    if (created.error) {
      const safe = domainError(created.error, requestId);
      const status = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_TRANSITION: 409, VALIDATION: 422, RATE_LIMITED: 429, INSUFFICIENT_STOCK: 409, DEPENDENCY_UNAVAILABLE: 503 }[safe.code];
      return Response.json(safe, { status, headers });
    }
    const invitation = created.data.data;
    if (typeof invitation.token !== 'string' || !/^[a-f0-9]{64}$/.test(invitation.token)) return error('DEPENDENCY_UNAVAILABLE', 503, requestId);
    // Use the recipient's Auth email flow, never the signed-in owner's session.
    const recipient = createClient(config.apiUrl, config.publishableKey, options);
    const sent = await recipient.auth.signInWithOtp({ email: input.email, options: { shouldCreateUser: true, emailRedirectTo: `${config.appOrigin}/invite?invitation=${invitation.token}` } });
    if (sent.error) return error('DEPENDENCY_UNAVAILABLE', 503, requestId);
    return Response.json({ data: { id: invitation.id, email: invitation.email, role: invitation.role, expires_at: invitation.expires_at, delivery: 'requested' }, version: created.data.version, request_id: requestId }, { headers });
  } catch { return error('DEPENDENCY_UNAVAILABLE', 503, requestId); }
}
