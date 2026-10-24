import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { domainError } from '../lib/domain-errors';
import type { Database } from '../lib/database.types';
import { readBoundedRows } from './record-query';
import { LoadingNotice } from './ui';

type TeamMember = { user_id: string; role: string; active: boolean };

export function MemberIdentifier({ userId, isSelf = false }: { userId: string; isSelf?: boolean }) {
  return <details className="member-id-details">
    <summary title={userId} aria-label={`${isSelf ? 'Current account. ' : ''}${userId}`}>
      <span aria-hidden="true">{isSelf ? 'You · ' : ''}{userId.slice(0, 8)}…</span>
    </summary>
    <code>{userId}</code>
  </details>;
}

const activeStatuses = ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'] as const;
const workloadPageSize = 100;
const workloadLimit = 2000;
const activeAssignmentRow = z.strictObject({ id: z.uuid(), user_id: z.uuid(), work_order_id: z.uuid() });
const activeWorkOrderRow = z.strictObject({ id: z.uuid(), number: z.number().int().positive(), title: z.string(), status: z.enum(activeStatuses) });

export function TeamWorkload({ client, userId, organizationId, members, pendingInvitations = null, inactiveCountLabel = 'Inactive members' }: {
  client: SupabaseClient<Database>;
  userId: string;
  organizationId: string;
  members: TeamMember[];
  pendingInvitations?: number | null;
  inactiveCountLabel?: string;
}) {
  const workload = useQuery({
    queryKey: ['operations-team-workload', userId, organizationId],
    queryFn: async ({ signal }) => {
      const [assignmentRows, workOrderRows] = await Promise.all([
        readBoundedRows(async (cursor) => {
          let query = client.from('work_order_assignments').select('id,user_id,work_order_id').eq('organization_id', organizationId).is('unassigned_at', null).order('id', { ascending: true }).limit(workloadPageSize);
          if (cursor) query = query.gt('id', cursor);
          const result = await query.abortSignal(signal);
          if (result.error) throw new Error(domainError(result.error).code);
          const page = z.array(activeAssignmentRow).max(workloadPageSize).safeParse(result.data ?? []);
          if (!page.success) throw new Error('DEPENDENCY_UNAVAILABLE');
          return page.data;
        }, workloadPageSize, workloadLimit),
        readBoundedRows(async (cursor) => {
          let query = client.from('work_orders').select('id,number,title,status').eq('organization_id', organizationId).in('status', [...activeStatuses]).order('id', { ascending: true }).limit(workloadPageSize);
          if (cursor) query = query.gt('id', cursor);
          const result = await query.abortSignal(signal);
          if (result.error) throw new Error(domainError(result.error).code);
          const page = z.array(activeWorkOrderRow).max(workloadPageSize).safeParse(result.data ?? []);
          if (!page.success) throw new Error('DEPENDENCY_UNAVAILABLE');
          return page.data;
        }, workloadPageSize, workloadLimit),
      ]);
      const assignments = z.array(activeAssignmentRow).max(workloadLimit).safeParse(assignmentRows);
      const workOrders = z.array(activeWorkOrderRow).max(workloadLimit).safeParse(workOrderRows);
      if (!assignments.success || !workOrders.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      const activeWorkOrders = new Map(workOrders.data.map((item) => [item.id, item]));
      const counted = new Set<string>();
      const counts: Record<string, number> = {};
      const currentAssignments: { id: string; user_id: string; number: number; title: string; status: typeof activeStatuses[number] }[] = [];
      for (const assignment of assignments.data) {
        const workOrder = activeWorkOrders.get(assignment.work_order_id);
        if (!workOrder) continue;
        const key = `${assignment.user_id}:${assignment.work_order_id}`;
        if (counted.has(key)) continue;
        counted.add(key);
        counts[assignment.user_id] = (counts[assignment.user_id] ?? 0) + 1;
        currentAssignments.push({ id: assignment.work_order_id, user_id: assignment.user_id, number: workOrder.number, title: workOrder.title, status: workOrder.status });
      }
      return { counts, assignments: currentAssignments };
    },
  });
  const activeMembers = members.filter((member) => member.active);
  const topMembers = [...activeMembers]
    .sort((left, right) => (workload.data?.counts[right.user_id] ?? 0) - (workload.data?.counts[left.user_id] ?? 0))
    .slice(0, 4);
  const visibleAssignments = workload.data?.assignments.slice(0, 5) ?? [];

  return <section className="team-workload" aria-label="Assigned workload">
    {workload.isPending ? <LoadingNotice label="Counting active assignments…" /> : workload.isError ? <p className="info-callout" role="status">Workload is unknown because the current authorized assignment data could not be read completely.</p> : <>
      <section className="team-metrics" aria-label="Team totals">
        <div className="team-metric"><strong>{members.length}</strong><span>Visible members</span></div>
        <div className="team-metric"><strong>{Object.values(workload.data.counts).reduce((total, count) => total + count, 0)}</strong><span>Active jobs</span></div>
        <div className="team-metric"><strong>{members.filter((member) => !member.active).length}</strong><span>{inactiveCountLabel}</span></div>
        <div className="team-metric"><strong>{pendingInvitations ?? '—'}</strong><span>{pendingInvitations === null ? 'Invites unavailable' : 'Pending invites'}</span></div>
      </section>
      <div className="team-overview-grid">
        <section className="panel table-panel" aria-labelledby="team-workload-title">
          <h2 id="team-workload-title">Technician workload</h2>
          <p className="field-hint">Counts include active work orders in open, scheduled, in-progress, blocked and review states.</p>
          {activeMembers.length ? <><div className="compact-table-scroll"><table className="compact-table"><caption className="sr-only">Active work orders assigned to the four members with the highest current counts</caption><thead><tr><th scope="col">Member ID</th><th scope="col">Role</th><th scope="col">Active jobs</th><th scope="col">Status</th></tr></thead><tbody>{topMembers.map((member) => <tr key={member.user_id}><td><MemberIdentifier userId={member.user_id} isSelf={member.user_id === userId} /></td><td>{member.role}</td><td>{workload.data.counts[member.user_id] ?? 0}</td><td><span className="status-line"><i className="status-dot status-dot--operational" aria-hidden="true" />Active</span></td></tr>)}</tbody></table></div>{activeMembers.length > topMembers.length && <><p className="team-table-note">Top {topMembers.length} of {activeMembers.length} active members by current assignment count.</p><details className="team-workload-remainder"><summary>View workload for all {activeMembers.length} active members</summary><div className="compact-table-scroll"><table className="compact-table"><caption className="sr-only">All active member workload counts from current authorized assignments</caption><thead><tr><th scope="col">Member ID</th><th scope="col">Role</th><th scope="col">Active jobs</th><th scope="col">Status</th></tr></thead><tbody>{activeMembers.map((member) => <tr key={member.user_id}><td><MemberIdentifier userId={member.user_id} isSelf={member.user_id === userId} /></td><td>{member.role}</td><td>{workload.data.counts[member.user_id] ?? 0}</td><td><span className="status-line"><i className="status-dot status-dot--operational" aria-hidden="true" />Active</span></td></tr>)}</tbody></table></div></details></>}</> : <p className="field-hint">No active workspace members are visible for workload counts.</p>}
        </section>
        <section className="panel table-panel" aria-labelledby="team-assignment-title">
          <div className="record-header"><h2 id="team-assignment-title">Current assignments</h2><Link to="/work-orders">View work orders →</Link></div>
          {workload.data.assignments.length ? <><div className="compact-table-scroll"><table className="compact-table"><caption className="sr-only">First five of all currently assigned active work orders; use the disclosure below to view the complete list</caption><thead><tr><th scope="col">ID</th><th scope="col">Problem</th><th scope="col">Assigned to</th><th scope="col">Status</th></tr></thead><tbody>{visibleAssignments.map((assignment) => <tr key={`${assignment.user_id}:${assignment.id}`}><td><Link className="work-order-number" to={`/work-orders?workOrder=${encodeURIComponent(assignment.id)}`}>WO-{String(assignment.number).padStart(4, '0')}</Link></td><td>{assignment.title}</td><td><MemberIdentifier userId={assignment.user_id} isSelf={assignment.user_id === userId} /></td><td><span className="status-line"><i className={`status-dot status-dot--${assignment.status}`} aria-hidden="true" />{assignment.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div>{workload.data.assignments.length > visibleAssignments.length && <><p className="team-table-note">Showing the first {visibleAssignments.length} of {workload.data.assignments.length} currently assigned active work orders.</p><details className="team-assignment-remainder"><summary>View all {workload.data.assignments.length} active assignments</summary><div className="compact-table-scroll"><table className="compact-table"><caption className="sr-only">All active assignments currently visible to this workspace account</caption><thead><tr><th scope="col">ID</th><th scope="col">Problem</th><th scope="col">Assigned to</th><th scope="col">Status</th></tr></thead><tbody>{workload.data.assignments.map((assignment) => <tr key={`${assignment.user_id}:${assignment.id}`}><td><Link className="work-order-number" to={`/work-orders?workOrder=${encodeURIComponent(assignment.id)}`}>WO-{String(assignment.number).padStart(4, '0')}</Link></td><td>{assignment.title}</td><td><MemberIdentifier userId={assignment.user_id} isSelf={assignment.user_id === userId} /></td><td><span className="status-line"><i className={`status-dot status-dot--${assignment.status}`} aria-hidden="true" />{assignment.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div></details></>}</> : <p className="field-hint">No active work orders are currently assigned to visible members.</p>}
        </section>
      </div>
    </>}
  </section>;
}
