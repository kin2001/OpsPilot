import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { domainError } from '../lib/domain-errors';
import type { Database } from '../lib/database.types';
import { LoadingNotice } from './ui';

type TeamMember = { user_id: string; role: string; active: boolean };

const activeStatuses = ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'] as const;
const activeAssignmentRow = z.strictObject({ user_id: z.uuid(), work_order_id: z.uuid() });
const activeWorkOrderRow = z.strictObject({ id: z.uuid(), status: z.enum(activeStatuses) });

export function TeamWorkload({ client, userId, organizationId, members }: {
  client: SupabaseClient<Database>;
  userId: string;
  organizationId: string;
  members: TeamMember[];
}) {
  const workload = useQuery({
    queryKey: ['operations-team-workload', userId, organizationId],
    queryFn: async ({ signal }) => {
      const [assignmentRows, workOrderRows] = await Promise.all([
        client.from('work_order_assignments').select('user_id,work_order_id').eq('organization_id', organizationId).is('unassigned_at', null).order('assigned_at', { ascending: false }).order('id', { ascending: true }).limit(2001).abortSignal(signal),
        client.from('work_orders').select('id,status').eq('organization_id', organizationId).in('status', [...activeStatuses]).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(2001).abortSignal(signal),
      ]);
      if (assignmentRows.error) throw new Error(domainError(assignmentRows.error).code);
      if (workOrderRows.error) throw new Error(domainError(workOrderRows.error).code);
      if ((assignmentRows.data?.length ?? 0) > 2000 || (workOrderRows.data?.length ?? 0) > 2000) throw new Error('DEPENDENCY_UNAVAILABLE');
      const assignments = z.array(activeAssignmentRow).max(2000).safeParse(assignmentRows.data ?? []);
      const workOrders = z.array(activeWorkOrderRow).max(2000).safeParse(workOrderRows.data ?? []);
      if (!assignments.success || !workOrders.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      const activeWorkOrderIds = new Set(workOrders.data.map((item) => item.id));
      const counted = new Set<string>();
      const counts: Record<string, number> = {};
      for (const assignment of assignments.data) {
        if (!activeWorkOrderIds.has(assignment.work_order_id)) continue;
        const key = `${assignment.user_id}:${assignment.work_order_id}`;
        if (counted.has(key)) continue;
        counted.add(key);
        counts[assignment.user_id] = (counts[assignment.user_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  return <section className="panel team-workload" aria-labelledby="team-workload-title">
    <div className="record-header"><div><p className="page-kicker">Current assignments</p><h2 id="team-workload-title">Assigned workload</h2></div></div>
    <p className="field-hint">Counts include assigned work orders in open, scheduled, in-progress, blocked and review states.</p>
    {workload.isPending ? <LoadingNotice label="Counting active assignments…" /> : workload.isError ? <p className="info-callout" role="status">Workload is unknown because the current authorized assignment data could not be read completely.</p> : members.some((member) => member.active) ? <div className="team-workload-grid">{members.filter((member) => member.active).map((member) => <article className="dashboard-count" key={member.user_id}><span>{member.user_id === userId ? 'You' : 'Workspace member'}</span><strong>{workload.data[member.user_id] ?? 0}</strong><small>{member.role}</small><small className="monospace">User ID {member.user_id}</small></article>)}</div> : <p className="field-hint">No active workspace members are visible for workload counts.</p>}
  </section>;
}
