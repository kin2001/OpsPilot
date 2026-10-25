import { expect, it } from 'vitest';
import { assistantRequest, assistantModelOutput, validateAssistantOutput } from './assistant';
const id = '10000000-0000-4000-8000-000000000001';
const input = {
  organization_id: id,
  request_id: id,
  mode: 'operations',
  prompt: 'Synthetic blocked jobs',
  query: {
    kind: 'blocked_work_orders',
    range: {
      from: '2026-10-01',
      to: '2026-10-02'
    }
  }
};
const output = {
  schema_version: 1,
  mode: 'operations',
  answer: 'Review the cited blocked work.',
  source_ids: [id],
  draft: null,
  uncertainty: 'Only retrieved records are represented.'
};
it('rejects arbitrary tools, oversized prompts, missing ranges and overlong ranges', () => {
  expect(assistantRequest.safeParse(input).success).toBe(true);
  for (const change of [{
    prompt: 'x'.repeat(4001)
  }, {
    query: {
      kind: 'sql',
      sql: 'select *'
    }
  }, {
    query: {
      kind: 'asset_history',
      asset_id: id
    }
  }, {
    query: {
      kind: 'completed_work',
      range: {
        from: '2025-01-01',
        to: '2027-01-01'
      }
    }
  }]) expect(assistantRequest.safeParse({
    ...input,
    ...change
  }).success).toBe(false);
});
it('rejects unknown sources, guessed draft assets, mode switches and model totals', () => {
  expect(validateAssistantOutput(output, 'operations', [id])).toEqual(output);
  expect(() => validateAssistantOutput(output, 'operations', [])).toThrow();
  expect(() => validateAssistantOutput({
    ...output,
    mode: 'draft'
  }, 'operations', [id])).toThrow();
  expect(assistantModelOutput.safeParse({
    ...output,
    total: 9
  }).success).toBe(false);
  expect(() => validateAssistantOutput({
    ...output,
    mode: 'draft',
    draft: {
      schema_version: 1,
      title: 'Fix',
      reported_problem: 'Synthetic',
      category: 'pump',
      suggested_priority: null,
      reasoning_summary: 'Needs human review',
      asset_candidates: [{
        id: '10000000-0000-4000-8000-000000000002',
        label: 'Guess'
      }]
    }
  }, 'draft', [id])).toThrow();
});
it('keeps user and assistant history messages distinct', async () => {
  const {
    assistantMessage
  } = await import('./assistant');
  const user = {
    id,
    created_at: '2026-10-25T00:00:00Z',
    role: 'user',
    prompt: 'Synthetic input',
    result: null
  };
  expect(assistantMessage.safeParse(user).success).toBe(true);
  expect(assistantMessage.safeParse({
    ...user,
    role: 'assistant'
  }).success).toBe(false);
  expect(assistantMessage.safeParse({
    ...user,
    result: output
  }).success).toBe(false);
});
