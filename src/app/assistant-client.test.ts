import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import type { Database } from '../lib/database.types';
import { askAssistant } from './assistant-client';
const id = '10000000-0000-4000-8000-000000000001';
const request = { organization_id: id, request_id: id, mode: 'operations' as const, prompt: 'Synthetic manual input', query: { kind: 'blocked_work_orders' as const, range: { from: '2026-10-01', to: '2026-10-02' } } };
function client(response: () => Response) {
  let calls = 0;
  return { value: createClient<Database>('http://fixture', 'synthetic-anon', { auth: { persistSession: false }, global: { fetch: async () => { calls++; return response(); } } }), calls: () => calls };
}
it('validates bounded input before invoking and preserves the caller input on failure', async () => {
  const fixture = client(() => Response.json({ code: 'AI_DISABLED' }, { status: 503 }));
  await expect(askAssistant(fixture.value, request)).rejects.toThrow('AI_DISABLED');
  expect(request.prompt).toBe('Synthetic manual input');
  await expect(askAssistant(fixture.value, { ...request, prompt: 'x'.repeat(4001) })).rejects.toThrow();
  expect(fixture.calls()).toBe(1);
});
it('never relays arbitrary provider error text to the UI', async () => {
  const fixture = client(() => Response.json({ code: 'secret-provider-value', message: 'Raw private provider prompt' }, { status: 500 }));
  await expect(askAssistant(fixture.value, request)).rejects.toThrow('AI_UNAVAILABLE');
});
