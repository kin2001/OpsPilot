import type { ReportFacts, ReportKind } from '../contracts/reporting.ts';

export type ReportMetric = { label: string; description: string; value: number | string | boolean | null; format: 'count' | 'seconds' | 'percent' | 'text' };
export type ReportTable = { columns: string[]; rows: (string | number | boolean | null)[][] };

export const reportDefinitions: Record<ReportKind, { label: string; description: string; source: string }> = {
  work_orders: {
    label: 'Work orders',
    description: 'Latest valid approval for the current repair revision defines completion. Turnaround uses recorded open-to-approval duration; active, blocked, pending-approval, and overdue counts reflect current work-order status.',
    source: 'Current work orders and their latest valid approval records.',
  },
  asset_availability: {
    label: 'Asset availability',
    description: 'Downtime comes from recorded availability-change events in the selected workspace-local period. Incomplete event history stays unknown; known downtime is shown separately.',
    source: 'Immutable recorded asset availability-change events.',
  },
  pm_compliance: {
    label: 'Preventive maintenance',
    description: 'Compliance covers generated preventive-maintenance occurrences only. Occurrences without a known completion stay in the unknown-completions count.',
    source: 'Generated maintenance occurrences and their linked work-order approvals.',
  },
  technician_assignments: {
    label: 'Technician assignments',
    description: 'Assigned active jobs reflect current assignments to active workspace members; this is workload context, not a performance score.',
    source: 'Current active workspace membership and work-order assignments.',
  },
  parts_consumption: {
    label: 'Parts consumption',
    description: 'Recorded issues and returns are reported as net quantity by part and unit. Quantities retain the stored three-decimal precision.',
    source: 'Inventory issue and return movements linked to work orders.',
  },
  maintenance_costs: {
    label: 'Maintenance costs',
    description: 'Entered maintenance costs are unavailable because this workspace does not record cost entries. No rates or cost values are inferred.',
    source: 'No entered maintenance-cost records are available.',
  },
};

export function reportMetrics(facts: ReportFacts): ReportMetric[] {
  switch (facts.kind) {
    case 'work_orders': return [
      { label: 'Active work orders', description: 'Current open, scheduled, in-progress, blocked, or awaiting-review work.', value: facts.summary.active_work_orders, format: 'count' },
      { label: 'Completed work orders', description: 'Approved during this date range.', value: facts.summary.completed, format: 'count' },
      { label: 'Average turnaround', description: `${facts.summary.completion_sample_size} completed work orders with a recorded duration.`, value: facts.summary.completion_seconds, format: 'seconds' },
      { label: 'Blocked work orders', description: 'Current work with a recorded blocking dependency.', value: facts.summary.blocked, format: 'count' },
      { label: 'Pending approvals', description: 'Current work awaiting review.', value: facts.summary.pending_approvals, format: 'count' },
      { label: 'Overdue work orders', description: 'Active work with a due date before now.', value: facts.summary.overdue, format: 'count' },
    ];
    case 'asset_availability': return [
      { label: 'Recorded downtime', description: facts.summary.history_complete ? 'History is complete for the selected range.' : 'Incomplete history keeps the full downtime total unknown.', value: facts.summary.downtime_seconds, format: 'seconds' },
      { label: 'Known downtime', description: 'Recorded unavailable intervals only.', value: facts.summary.known_downtime_seconds, format: 'seconds' },
      { label: 'History coverage', description: 'Whether all relevant availability history is known.', value: facts.summary.history_complete ? 'Complete' : 'Incomplete', format: 'text' },
    ];
    case 'pm_compliance': return [
      { label: 'Eligible occurrences', description: 'Generated occurrences eligible for compliance measurement.', value: facts.summary.eligible, format: 'count' },
      { label: 'Completed on time', description: 'Eligible occurrences approved by their due time.', value: facts.summary.completed_on_time, format: 'count' },
      { label: 'On-time rate', description: `${facts.summary.completion_sample_size} completed occurrences in the sample.`, value: facts.summary.on_time_rate, format: 'percent' },
      { label: 'Unknown completions', description: 'Generated occurrences without a known completion outcome.', value: facts.summary.unknown_completions, format: 'count' },
    ];
    case 'technician_assignments': return [
      { label: 'Assigned active jobs', description: 'Current active assignments across active workspace members.', value: facts.summary.assigned_active_jobs, format: 'count' },
    ];
    case 'parts_consumption': return [
      { label: 'Recorded movements', description: 'Issues and returns in the selected period.', value: facts.summary.movement_count, format: 'count' },
    ];
    case 'maintenance_costs': return [
      { label: 'Entered maintenance costs', description: 'No cost-entry records exist in this report source.', value: facts.summary.entered_estimate, format: 'text' },
    ];
  }
}

export function reportTable(facts: ReportFacts): ReportTable {
  switch (facts.kind) {
    case 'work_orders': return { columns: ['Work order ID', 'Number', 'Asset ID', 'Category', 'Status', 'Opened at', 'Approved at', 'Completion seconds'], rows: facts.items.map((row) => [row.id, row.number, row.asset_id, row.category, row.status, row.opened_at, row.approved_at, row.completion_seconds]) };
    case 'asset_availability': return { columns: ['Asset ID', 'Asset code', 'Asset name', 'History complete', 'Downtime seconds', 'Known downtime seconds'], rows: facts.items.map((row) => [row.id, row.code, row.name, row.history_complete, row.downtime_seconds, row.known_downtime_seconds]) };
    case 'pm_compliance': return { columns: ['Occurrence ID', 'Work order ID', 'Scheduled local date', 'Timezone', 'Due at', 'Approved at', 'Status', 'Canceled reason', 'Eligible', 'Completed on time'], rows: facts.items.map((row) => [row.id, row.work_order_id, row.scheduled_local_date, row.timezone, row.due_at, row.approved_at, row.status, row.canceled_reason, row.eligible, row.on_time]) };
    case 'technician_assignments': return { columns: ['Member ID', 'Role', 'Active', 'Active jobs'], rows: facts.items.map((row) => [row.id, row.role, row.active, row.active_jobs]) };
    case 'parts_consumption': return { columns: ['Movement ID', 'Work order ID', 'Part ID', 'Location ID', 'Unit', 'Movement type', 'Quantity', 'Net quantity', 'Occurred at'], rows: facts.items.map((row) => [row.id, row.work_order_id, row.part_id, row.location_id, row.unit, row.kind, row.quantity, row.net_quantity, row.occurred_at]) };
    case 'maintenance_costs': return { columns: [], rows: [] };
  }
}

function csvCell(value: unknown) {
  const text = value == null ? 'Not recorded' : String(value);
  const formula = /^[\p{White_Space}\uFEFF]*[=+\-@]/u.test(text) && !/^-\d+(?:\.\d+)?$/u.test(text);
  return `"${(formula ? `'${text}` : text).replaceAll('"', '""')}"`;
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(',');
}

export function buildReportCsv(facts: ReportFacts, organizationId: string, exportedAt: string) {
  const definition = reportDefinitions[facts.kind];
  const table = reportTable(facts);
  const rows = [
    ['Report', definition.label],
    ['Definition', definition.description],
    ['Source', definition.source],
    ['Organization ID', organizationId],
    ['Range from (inclusive)', facts.range.from],
    ['Range to (exclusive)', facts.range.to],
    ['Timezone', facts.timezone],
    ['Currency', facts.currency],
    ['Report generated at', facts.generated_at],
    ['Export generated at', exportedAt],
    ['Page consistency', 'Source rows are read from current facts by cursor; pages are not snapshot-isolated.'],
    ['Summary facts', JSON.stringify(facts.summary)],
  ];
  return `\uFEFF${[
    ...rows.map(csvRow),
    ...(table.columns.length ? ['', csvRow(table.columns), ...table.rows.map(csvRow)] : []),
  ].join('\r\n')}\r\n`;
}
