import { expect, it } from 'vitest';
import type { ReportFacts } from '../contracts/reporting';
import { buildReportCsv, reportTable } from './report-export';

function workReport(category: string): ReportFacts {
  return {
    schema_version: 1,
    kind: 'work_orders',
    timezone: 'Asia/Manila',
    currency: 'PHP',
    range: { from: '2026-10-01', to: '2026-10-02' },
    from: '2026-09-30T16:00:00Z',
    to: '2026-10-01T16:00:00Z',
    generated_at: '2026-10-25T00:00:00Z',
    next_cursor: null,
    items: [{ id: '10000000-0000-4000-8000-000000000001', number: 42, asset_id: '10000000-0000-4000-8000-000000000002', category, status: 'completed', opened_at: '2026-10-01T01:00:00Z', approved_at: '2026-10-01T02:00:00Z', completion_seconds: 3600 }],
    summary: { active_work_orders: 0, blocked: 0, pending_approvals: 0, overdue: 0, completed: 1, completion_sample_size: 1, completion_seconds: 3600,
      daily_completed: [{ date: '2026-10-01', completed: 1 }], recurring_faults: [], recurring_faults_has_more: false },
  };
}

it('includes report metadata and preserves quoted, multiline Unicode source text', () => {
  const csv = buildReportCsv(workReport('pump, "north"\nrévision'), '10000000-0000-4000-8000-000000000003', '2026-10-25T00:01:00Z');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"Timezone","Asia/Manila"');
  expect(csv).toContain('"Currency","PHP"');
  expect(csv).toContain('"Report generated at","2026-10-25T00:00:00Z"');
  expect(csv).toContain('"pump, ""north""\nrévision"');
});

it.each(['=1+1', '+SUM(1,2)', '-1+cmd', '@SUM(A1:A2)', ' \t=HYPERLINK("https://example.test","open")', '\u00a0=1+1', '\ufeff=1+1'])('neutralizes spreadsheet formulas beginning with %j', (value) => {
  const csv = buildReportCsv(workReport(value), '10000000-0000-4000-8000-000000000003', '2026-10-25T00:01:00Z');
  expect(csv).toContain(`"'${value.replaceAll('"', '""')}"`);
});

it('keeps unavailable maintenance-cost facts explicitly unknown', () => {
  const facts: ReportFacts = {
    schema_version: 1, kind: 'maintenance_costs', timezone: 'Asia/Manila', currency: 'PHP',
    range: { from: '2026-10-01', to: '2026-10-02' }, from: '2026-09-30T16:00:00Z', to: '2026-10-01T16:00:00Z',
    generated_at: '2026-10-25T00:00:00Z', next_cursor: null, items: [],
    summary: { label: 'Entered maintenance-cost estimate', entered_estimate: null, coverage: 'unavailable', reason: 'entered_costs_not_recorded' },
  };
  const csv = buildReportCsv(facts, '10000000-0000-4000-8000-000000000003', '2026-10-25T00:01:00Z');
  expect(csv).toContain('"Definition","Entered maintenance costs are unavailable because this workspace does not record cost entries.');
  expect(csv).toContain('""entered_estimate"":null');
  expect(csv).toContain('"entered_costs_not_recorded"');
});

it('exports the defined source rows for availability, generated PM, assignment, and parts reports', () => {
  const common = { schema_version: 1 as const, timezone: 'Asia/Manila', currency: 'PHP', range: { from: '2026-10-01', to: '2026-10-02' },
    from: '2026-09-30T16:00:00Z', to: '2026-10-01T16:00:00Z', generated_at: '2026-10-25T00:00:00Z', next_cursor: null };
  const asset: ReportFacts = { ...common, kind: 'asset_availability', items: [{ id: '10000000-0000-4000-8000-000000000001', code: 'P-1', name: 'Pump', history_complete: false, downtime_seconds: null, known_downtime_seconds: 3600 }], summary: { history_complete: false, downtime_seconds: null, known_downtime_seconds: 3600 } };
  const pm: ReportFacts = { ...common, kind: 'pm_compliance', items: [{ id: '10000000-0000-4000-8000-000000000001', work_order_id: '10000000-0000-4000-8000-000000000002', scheduled_local_date: '2026-10-01', timezone: 'Asia/Manila', due_at: '2026-10-01T15:59:59Z', approved_at: null, status: 'scheduled', canceled_reason: null, eligible: true, on_time: null }], summary: { coverage: 'generated_occurrences', eligible: 1, completed_on_time: 0, completion_sample_size: 0, unknown_completions: 1, on_time_rate: null } };
  const assignment: ReportFacts = { ...common, kind: 'technician_assignments', items: [{ id: '10000000-0000-4000-8000-000000000001', role: 'technician', active: true, active_jobs: 2 }], summary: { assigned_active_jobs: 2 } };
  const part: ReportFacts = { ...common, kind: 'parts_consumption', items: [{ id: '10000000-0000-4000-8000-000000000001', work_order_id: '10000000-0000-4000-8000-000000000002', part_id: '10000000-0000-4000-8000-000000000003', location_id: '10000000-0000-4000-8000-000000000004', unit: 'each', kind: 'return', quantity: '1.250', net_quantity: '-1.250', occurred_at: '2026-10-01T03:00:00Z' }], summary: { movement_count: 1, quantity_policy: 'net_by_part_and_unit' } };
  expect(reportTable(asset).rows[0]).toEqual(['10000000-0000-4000-8000-000000000001', 'P-1', 'Pump', false, null, 3600]);
  expect(reportTable(pm).rows[0]).toContain(null);
  expect(reportTable(assignment).rows[0]).toContain(2);
  expect(reportTable(part).rows[0]).toContain('-1.250');
});
