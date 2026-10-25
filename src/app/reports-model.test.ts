import { expect, it } from 'vitest';
import type { ReportFacts } from '../contracts/reporting';
import { reportChart } from './reports-model';

function workReport(): ReportFacts {
  return {
    schema_version: 1, kind: 'work_orders', timezone: 'Asia/Manila', currency: 'PHP',
    range: { from: '2026-10-01', to: '2026-10-03' }, from: '2026-09-30T16:00:00Z', to: '2026-10-02T16:00:00Z', generated_at: '2026-10-25T00:00:00Z',
    next_cursor: null, items: [],
    summary: { active_work_orders: 2, blocked: 1, pending_approvals: 0, overdue: 0, completed: 3, completion_sample_size: 2, completion_seconds: 3600,
      daily_completed: [{ date: '2026-10-01', completed: 1 }, { date: '2026-10-02', completed: 2 }], recurring_faults: [], recurring_faults_has_more: false },
  };
}

it('provides a text equivalent for workspace-local completed work orders', () => {
  expect(reportChart(workReport())).toMatchObject({
    title: 'Completed work orders by day',
    rows: [{ label: '2026-10-01', value: 1 }, { label: '2026-10-02', value: 2 }],
  });
});

it('does not invent a chart value for unavailable maintenance costs', () => {
  const facts: ReportFacts = {
    schema_version: 1, kind: 'maintenance_costs', timezone: 'Asia/Manila', currency: 'PHP',
    range: { from: '2026-10-01', to: '2026-10-02' }, from: '2026-09-30T16:00:00Z', to: '2026-10-01T16:00:00Z', generated_at: '2026-10-25T00:00:00Z',
    next_cursor: null, items: [], summary: { label: 'Entered maintenance-cost estimate', entered_estimate: null, coverage: 'unavailable', reason: 'entered_costs_not_recorded' },
  };
  expect(reportChart(facts)).toBeNull();
});

it('makes incomplete asset history visible as unknown instead of a zero bar', () => {
  const facts: ReportFacts = {
    schema_version: 1, kind: 'asset_availability', timezone: 'UTC', currency: 'USD', range: { from: '2026-10-01', to: '2026-10-02' },
    from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z', generated_at: '2026-10-25T00:00:00Z', next_cursor: null,
    items: [{ id: '10000000-0000-4000-8000-000000000001', code: 'P-1', name: 'Pump', history_complete: false, downtime_seconds: null, known_downtime_seconds: 0 }],
    summary: { history_complete: false, downtime_seconds: null, known_downtime_seconds: 0 },
  };
  expect(reportChart(facts)).toMatchObject({ rows: [{ label: 'P-1', value: null, note: 'History incomplete' }] });
});
