import type { ReportFacts } from '../contracts/reporting';

export type ReportChart = { title: string; description: string; unit: 'count' | 'seconds'; rows: { label: string; value: number | null; note?: string }[] };

export function reportChart(facts: ReportFacts): ReportChart | null {
  switch (facts.kind) {
    case 'work_orders': return {
      title: 'Completed work orders by day',
      description: `Approved work orders in ${facts.timezone}; dates use the workspace time zone.`,
      unit: 'count',
      rows: facts.summary.daily_completed.map((day) => ({ label: day.date, value: day.completed })),
    };
    case 'asset_availability': return {
      title: 'Recorded downtime by asset',
      description: 'Known downtime is shown for this table page. Incomplete history remains unknown.',
      unit: 'seconds',
      rows: facts.items.map((asset) => ({ label: asset.code, value: asset.history_complete ? asset.downtime_seconds : null, note: asset.history_complete ? undefined : 'History incomplete' })),
    };
    case 'pm_compliance': return {
      title: 'Generated occurrence outcomes',
      description: 'Counts cover generated preventive-maintenance occurrences; unknown outcomes stay separate.',
      unit: 'count',
      rows: [
        { label: 'Eligible', value: facts.summary.eligible },
        { label: 'Completed on time', value: facts.summary.completed_on_time },
        { label: 'Unknown completion', value: facts.summary.unknown_completions },
      ],
    };
    case 'technician_assignments': return {
      title: 'Active assignments by member',
      description: 'Current assigned jobs for the members on this table page; this is workload context, not a score.',
      unit: 'count',
      rows: facts.items.map((member) => ({ label: member.id, value: member.active_jobs, note: member.role })),
    };
    case 'parts_consumption': return {
      title: 'Recorded movements by type',
      description: 'Movement counts on this table page. Net quantities remain in the source rows.',
      unit: 'count',
      rows: [
        { label: 'Issues', value: facts.items.filter((movement) => movement.kind === 'issue').length },
        { label: 'Returns', value: facts.items.filter((movement) => movement.kind === 'return').length },
      ],
    };
    case 'maintenance_costs': return null;
  }
}
