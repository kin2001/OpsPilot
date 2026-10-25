import { describe, expect, it } from 'vitest';
import { reportRequest, reportResult } from './reporting';

const org = '10000039-0000-4000-8000-000000000001';
describe('bounded reporting contract', () => {
  it('accepts a leap-year half-open 366-day range and defaults to 25 rows', () => {
    expect(reportRequest.parse({ ctx: { organization_id: org }, kind: 'work_orders', range: { from: '2024-01-01', to: '2025-01-01' } }).cursor).toEqual({ page_size: 25 });
  });
  it.each([
    { from: '2024-01-01', to: '2025-01-02' }, { from: '2026-10-25', to: '2026-10-25' },
    { from: '2026-02-30', to: '2026-03-01' }, { from: '0000-01-01', to: '0001-01-01' },
  ])('rejects invalid, empty or excessive range %j', (range) => {
    expect(reportRequest.safeParse({ ctx: { organization_id: org }, kind: 'work_orders', range }).success).toBe(false);
  });
  it('rejects expressions, forged context, and oversized pages', () => {
    for (const change of [{ kind: 'select *' }, { ctx: { organization_id: org, user_id: org } }, { cursor: { page_size: 101 } }]) {
      expect(reportRequest.safeParse({ ctx: { organization_id: org }, kind: 'work_orders', range: { from: '2026-10-01', to: '2026-11-01' }, ...change }).success).toBe(false);
    }
  });
  it('preserves unavailable entered cost as null and rejects fabricated zero coverage', () => {
    const result = { schema_version: 1, kind: 'maintenance_costs', timezone: 'Asia/Manila', currency: 'PHP',
      range: { from: '2026-10-01', to: '2026-11-01' }, from: '2026-09-30T16:00:00Z', to: '2026-10-31T16:00:00Z', generated_at: '2026-10-25T00:00:00Z',
      items: [], next_cursor: null, summary: { label: 'Entered maintenance-cost estimate', entered_estimate: null, coverage: 'unavailable', reason: 'entered_costs_not_recorded' } };
    expect(reportResult.parse(result)).toEqual(result);
    expect(reportResult.safeParse({ ...result, summary: { ...result.summary, entered_estimate: '0.00' } }).success).toBe(false);
  });
});
