import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { assistantConversation, assistantMessage, assistantRequest, assistantResult, validateAssistantOutput, type AssistantRequest } from '../contracts/assistant';
export async function askAssistant(client: SupabaseClient<Database>, input: AssistantRequest, signal?: AbortSignal) {
  const request = assistantRequest.parse(input);
  const {
    data,
    error
  } = await client.functions.invoke('assistant', {
    body: request,
    signal
  });
  if (error) {
    let code = 'AI_UNAVAILABLE';
    if ('context' in error && error.context instanceof Response) {
      try {
        const safe = z.object({
          code: z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'AI_DISABLED', 'AI_BUSY', 'AI_QUOTA', 'AI_REQUEST_REUSED', 'AI_HISTORY_LIMIT', 'AI_TIMEOUT', 'AI_UNAVAILABLE'])
        }).safeParse(await error.context.json());
        if (safe.success) code = safe.data.code;
      } catch {/* Unknown response bodies never reach the UI. */}
    }
    throw new Error(code);
  }
  const parsed = assistantResult.safeParse(data);
  if (!parsed.success) throw new Error('AI_UNAVAILABLE');
  const result = parsed.data;
  if (result.mode !== request.mode || result.confirmation.request_id !== request.request_id || result.retrieval.range.from !== request.query.range.from || result.retrieval.range.to !== request.query.range.to) throw new Error('AI_UNAVAILABLE');
  const {
    run_id: _run,
    conversation_id: _conversation,
    retrieval,
    provider: _provider,
    confirmation: _confirmation,
    ...output
  } = result;
  try {
    validateAssistantOutput(output, request.mode, retrieval.sources.map(source => source.id), retrieval.sources.map(source => source.asset_id));
  } catch {
    throw new Error('AI_UNAVAILABLE');
  }
  return result;
}
export async function listAssistantConversations(client: SupabaseClient<Database>, organizationId: string, after?: string) {
  const {
    data,
    error
  } = await client.rpc('assistant_history', {
    organization_id: z.uuid().parse(organizationId),
    after_id: after ? z.uuid().parse(after) : undefined
  });
  if (error) throw new Error('AI_UNAVAILABLE');
  return z.strictObject({
    items: z.array(assistantConversation).max(25),
    next_cursor: z.uuid().nullable()
  }).parse(data);
}
export async function getAssistantMessages(client: SupabaseClient<Database>, organizationId: string, conversationId: string, after?: string) {
  const {
    data,
    error
  } = await client.rpc('assistant_history', {
    organization_id: z.uuid().parse(organizationId),
    conversation_id: z.uuid().parse(conversationId),
    after_id: after ? z.uuid().parse(after) : undefined
  });
  if (error) throw new Error('AI_UNAVAILABLE');
  return z.strictObject({
    items: z.array(assistantMessage).max(25),
    next_cursor: z.uuid().nullable()
  }).parse(data);
}
export async function deleteAssistantConversation(client: SupabaseClient<Database>, organizationId: string, conversationId: string) {
  const {
    error
  } = await client.rpc('assistant_delete', {
    organization_id: z.uuid().parse(organizationId),
    conversation_id: z.uuid().parse(conversationId)
  });
  if (error) throw new Error('AI_UNAVAILABLE');
}
