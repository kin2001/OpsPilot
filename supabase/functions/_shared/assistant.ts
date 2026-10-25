import { z } from 'zod';
import { reportRange } from './reporting.ts';
export const assistantMode = z.enum(['draft', 'priority', 'operations', 'asset_history', 'daily_brief']);
export const assistantQuery = z.strictObject({
  kind: z.enum(['blocked_work_orders', 'completed_work', 'overdue_work', 'awaiting_parts', 'asset_history', 'daily_metrics', 'recurring_fault_counts']),
  range: reportRange,
  asset_id: z.uuid().optional(),
  category: z.string().trim().min(1).max(100).optional()
}).refine(q => q.kind === 'asset_history' ? q.asset_id !== undefined : q.asset_id === undefined && q.category === undefined);
export const assistantRequest = z.strictObject({
  organization_id: z.uuid(),
  request_id: z.uuid(),
  conversation_id: z.uuid().optional(),
  mode: assistantMode,
  prompt: z.string().trim().min(1).max(4000),
  query: assistantQuery
}).refine(v => (v.mode !== 'asset_history' || v.query.kind === 'asset_history') && (v.mode !== 'daily_brief' || v.query.kind === 'daily_metrics'));
export const draftSuggestion = z.strictObject({
  schema_version: z.literal(1),
  title: z.string().trim().min(1).max(200),
  reported_problem: z.string().trim().min(1).max(4000),
  category: z.string().trim().min(1).max(100),
  suggested_priority: z.enum(['low', 'normal', 'high', 'critical']).nullable(),
  reasoning_summary: z.string().trim().min(1).max(2000),
  asset_candidates: z.array(z.strictObject({
    id: z.uuid(),
    label: z.string().min(1).max(200)
  })).max(50)
});
export const assistantModelOutput = z.strictObject({
  schema_version: z.literal(1),
  mode: assistantMode,
  answer: z.string().trim().min(1).max(8000),
  source_ids: z.array(z.uuid()).max(50),
  draft: draftSuggestion.nullable(),
  uncertainty: z.string().trim().min(1).max(2000)
}).refine(v => v.mode === 'draft' ? v.draft !== null : v.draft === null);
export function validateAssistantOutput(value: unknown, mode: z.infer<typeof assistantMode>, sources: string[], assetIds: string[] = []) {
  const parsed = assistantModelOutput.parse(value);
  if (parsed.mode !== mode || parsed.source_ids.some(id => !sources.includes(id)) || parsed.draft?.asset_candidates.some(a => !assetIds.includes(a.id))) throw new Error('AI_INVALID_RESPONSE');
  return parsed;
}
export const assistantSource = z.strictObject({
  id: z.uuid(),
  asset_id: z.uuid(),
  label: z.string().max(200),
  status: z.string(),
  category: z.string().max(100),
  note: z.string().max(4000),
  occurred_at: z.string().nullable()
});
export const assistantFacts = z.strictObject({
  schema_version: z.literal(1),
  retrieved_at: z.string(),
  range: reportRange,
  sources: z.array(assistantSource).max(50),
  facts: z.strictObject({
    scope: z.enum(['current_authorized_work', 'retrieved_source_sample']),
    matching_work_orders: z.int().nonnegative(),
    completed: z.int().nonnegative(),
    blocked: z.int().nonnegative(),
    overdue: z.int().nonnegative(),
    recurring_fault_counts: z.array(z.strictObject({
      asset_id: z.uuid(),
      category: z.string().max(100),
      recorded_work_orders: z.int().nonnegative()
    })).max(50)
  }),
  truncated: z.boolean(),
  role: z.enum(['owner', 'manager', 'supervisor', 'technician', 'inventory'])
});
export const assistantResult = z.strictObject({
  ...assistantModelOutput.shape,
  run_id: z.uuid(),
  conversation_id: z.uuid(),
  retrieval: assistantFacts.omit({
    role: true
  }),
  provider: z.strictObject({
    name: z.literal('gemini'),
    model: z.string().min(1).max(200),
    response_id: z.string().max(200).nullable()
  }),
  confirmation: z.strictObject({
    allowed: z.boolean(),
    command: z.literal('create_work_order'),
    request_id: z.uuid(),
    requires_human_review: z.literal(true)
  })
});
export const assistantConversation = z.strictObject({
  id: z.uuid(),
  created_at: z.string()
});
export const assistantMessage = z.discriminatedUnion('role', [z.strictObject({
  id: z.uuid(),
  created_at: z.string(),
  role: z.literal('user'),
  prompt: z.string().max(4000),
  result: z.null()
}), z.strictObject({
  id: z.uuid(),
  created_at: z.string(),
  role: z.literal('assistant'),
  prompt: z.null(),
  result: assistantResult
})]);
export type AssistantRequest = z.infer<typeof assistantRequest>;
export type AssistantResult = z.infer<typeof assistantResult>;
export type AssistantFacts = z.infer<typeof assistantFacts>;
