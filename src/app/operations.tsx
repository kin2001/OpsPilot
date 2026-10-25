import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { assetHistoryResult, dashboardResult, notificationRecord, settingsResult, teamResult } from '../contracts/operational';
import { domainError } from '../lib/domain-errors';
import type { Json } from '../lib/database.types';
import { markNotificationsRead, saveOrganizationSettings } from './commands';
import { cursorFilter, type RecordCursor } from './record-query';
import { PrivilegedArea } from './auth/security';
import { MemberIdentifier, TeamWorkload } from './team-workload';
import { useWorkspace } from './workspace';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SuccessNotice } from './ui';

function parsedRpc<T extends z.ZodType>(data: Json | null, error: { message: string } | null, schema: T): z.output<T> {
  if (error) throw new Error(domainError(error).code);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}

function dateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readableDuration(seconds: number | null) {
  if (seconds === null) return 'Not enough recorded data';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

const attentionStatuses = ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'] as const;
const attentionRow = z.strictObject({
  id: z.uuid(), number: z.int().positive(), asset_id: z.uuid(), supervisor_id: z.uuid().nullable(), title: z.string(), status: z.enum(attentionStatuses), priority: z.enum(['low', 'normal', 'high', 'critical']), due_at: z.string().nullable(), created_at: z.string(),
});
const attentionAsset = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string() });

function workOrderLabel(number: number) { return `WO-${String(number).padStart(4, '0')}`; }

function AvailabilityChart({ days, timeZone }: { days: z.output<typeof dashboardResult>['daily_availability']; timeZone: string }) {
  const width = 600;
  const height = 220;
  const left = 48;
  const right = width - 12;
  const top = 10;
  const bottom = height - 40;
  const points = days.map((day, index) => {
    const ratio = day.available_assets === null || day.known_assets === 0 ? null : day.available_assets / day.known_assets;
    return {
      date: day.date,
      ratio,
      x: days.length < 2 ? (left + right) / 2 : left + index * (right - left) / (days.length - 1),
      y: ratio === null ? null : top + (1 - ratio) * (bottom - top),
    };
  });
  let path = '';
  let openSegment = false;
  for (const point of points) {
    if (point.y === null) { openSegment = false; continue; }
    path += `${openSegment ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    openSegment = true;
  }
  const ticks = [1, .75, .5, .25, 0];
  return <>
    <svg className="dashboard-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Recorded fleet availability for the last ${points.length} days in ${timeZone}`}>
      {ticks.map((ratio) => {
        const y = top + (1 - ratio) * (bottom - top);
        return <g key={ratio}><line className="chart-grid" x1={left} x2={right} y1={y} y2={y} /><text x="2" y={y + 4}>{Math.round(ratio * 100)}%</text></g>;
      })}
      {points.length > 1 && points.map((point, index) => index > 0 ? <line key={`day-${point.date}`} className="chart-grid" x1={point.x} x2={point.x} y1={top} y2={bottom} /> : null)}
      {path && <path className="chart-line" d={path} />}
      {points.map((point) => <g key={point.date}>
        {point.y !== null && <circle className="chart-point" cx={point.x} cy={point.y} r="5" />}
        <text x={point.x} y={height - 12} textAnchor="middle">{new Date(`${point.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone })}</text>
      </g>)}
    </svg>
    <table className="sr-only"><caption>Recorded daily availability</caption><thead><tr><th>Date</th><th>Available assets</th><th>Known assets</th></tr></thead><tbody>{days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.available_assets ?? 'Unknown'}</td><td>{day.known_assets}</td></tr>)}</tbody></table>
  </>;
}

export function DashboardPage() {
  const { client, user, organization, role } = useWorkspace();
  const today = dateInZone(new Date(), organization.timezone);
  const readableToday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: organization.timezone }).format(new Date());
  const range = useMemo(() => ({ from: addDays(today, -6), to: addDays(today, 1) }), [today]);
  const query = useQuery({
    queryKey: ['operational-dashboard', user.id, organization.id, range.from, range.to],
    queryFn: async ({ signal }) => {
      const result = await client.rpc('get_dashboard', { organization_id: organization.id, range: range as unknown as Json }).abortSignal(signal);
      return parsedRpc(result.data, result.error, dashboardResult);
    },
  });
  const attention = useQuery({
    queryKey: ['dashboard-attention', user.id, organization.id, today],
    enabled: role !== 'technician' && role !== 'inventory',
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      const columns = 'id,number,asset_id,supervisor_id,title,status,priority,due_at,created_at';
      const [blocked, review, due] = await Promise.all([
        client.from('work_orders').select(columns).eq('organization_id', organization.id).eq('status', 'blocked').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50).abortSignal(signal),
        client.from('work_orders').select(columns).eq('organization_id', organization.id).eq('status', 'awaiting_review').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50).abortSignal(signal),
        client.from('work_orders').select(columns).eq('organization_id', organization.id).in('status', [...attentionStatuses]).not('due_at', 'is', null).order('due_at', { ascending: true }).order('id', { ascending: true }).limit(50).abortSignal(signal),
      ]);
      for (const result of [blocked, review, due]) if (result.error) throw new Error(domainError(result.error).code);
      const now = Date.now();
      const overdue = (due.data ?? []).filter((item) => {
        if (!item.due_at) return false;
        const dueTime = Date.parse(item.due_at);
        if (!Number.isFinite(dueTime)) throw new Error('DEPENDENCY_UNAVAILABLE');
        return dueTime < now;
      });
      const unique = new Map<string, z.output<typeof attentionRow>>();
      for (const item of [...(blocked.data ?? []), ...(review.data ?? []), ...overdue]) {
        const parsed = attentionRow.safeParse(item);
        if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
        unique.set(parsed.data.id, parsed.data);
      }
      return [...unique.values()];
    },
  });
  const attentionItems = attention.data?.slice(0, 8) ?? [];
  const attentionAssetIds = [...new Set(attentionItems.map((item) => item.asset_id))];
  const attentionAssets = useQuery({
    queryKey: ['dashboard-attention-assets', user.id, organization.id, attentionAssetIds], enabled: attentionAssetIds.length > 0,
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('id,code,name').eq('organization_id', organization.id).in('id', attentionAssetIds).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = z.array(attentionAsset).max(8).safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const attentionAssetById = new Map((attentionAssets.data ?? []).map((asset) => [asset.id, asset]));
  const planned = useQuery({
    queryKey: ['dashboard-planned-work', user.id, organization.id, today],
    enabled: role !== 'technician' && role !== 'inventory',
    queryFn: async ({ signal }) => {
      const result = await client.from('work_orders').select('id,number,title,status,planned_on').eq('organization_id', organization.id).eq('planned_on', today)
        .in('status', ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review']).order('id', { ascending: true }).limit(50).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = z.array(z.strictObject({ id: z.uuid(), number: z.int().positive(), title: z.string(), status: z.enum(attentionStatuses), planned_on: z.string().nullable() })).max(50).safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const counts = query.data?.counts;
  return <>
    <PageHeader eyebrow="Workspace" title="Operations at a glance" description={readableToday} action={<Link className="button" to="/work-orders?create=1">＋&nbsp; Work order</Link>} />
    {role === 'technician' || role === 'inventory' ? <div className="empty-state"><h2>Dashboard not available for this role</h2><p>Use your assigned work orders and available asset records. This dashboard is limited to operations roles.</p><Link className="button button--secondary" to={role === 'technician' ? '/work-orders' : '/assets'}>Open assigned work</Link></div> : <>
      {query.isPending ? <LoadingNotice label="Loading workspace totals…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Dashboard totals are unavailable. No values are estimated from incomplete history.</ErrorNotice><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry</AppButton></div> : counts && <>
      <div className="dashboard-counts" aria-label="Operational totals">
        <article className="dashboard-count"><strong>{counts.available_assets}<small> of {counts.active_assets}</small></strong><span>Available assets</span></article>
        <article className="dashboard-count"><strong>{counts.active_work_orders}</strong><span>Active work orders</span></article>
        <article className="dashboard-count"><strong>{counts.blocked}</strong><span>Blocked</span></article>
        <article className="dashboard-count"><strong>{counts.pending_approvals}</strong><span>Pending approvals</span></article>
      </div>
      <div className="dashboard-primary-grid">
        <section className="panel dashboard-panel" aria-labelledby="attention-queue-title">
          <div className="record-header"><h2 id="attention-queue-title">Attention queue</h2><Link to="/work-orders">View all work orders →</Link></div>
          {attention.isPending ? <LoadingNotice label="Checking blocked, overdue and submitted work…" /> : attention.isError ? <div><ErrorNotice>Attention items are unavailable. No queue status is inferred when its records cannot be read.</ErrorNotice><AppButton variant="secondary" onClick={() => void attention.refetch()}>Retry attention queue</AppButton></div> : attention.data.length ? <div className="dashboard-table-wrap" role="region" aria-label="Attention queue results" tabIndex={0}><table className="dashboard-table"><caption className="sr-only">Blocked, overdue and pending-review work orders</caption><thead><tr><th>ID</th><th>Problem</th><th>Asset</th><th>Supervisor ID</th><th>Reason</th><th>Status</th></tr></thead><tbody>{attentionItems.map((item) => {
            const reason = item.status === 'blocked' ? 'Blocked work' : item.status === 'awaiting_review' ? 'Pending review' : 'Past due';
            const asset = attentionAssetById.get(item.asset_id);
            return <tr key={item.id}><td><Link to={`/work-orders?workOrder=${encodeURIComponent(item.id)}`}>{workOrderLabel(item.number)}</Link></td><td>{item.title}</td><td>{attentionAssets.isPending ? 'Loading…' : attentionAssets.isError ? 'Asset unavailable' : asset ? `${asset.code} · ${asset.name}` : 'Asset not visible'}</td><td className="monospace" title={item.supervisor_id ?? undefined}>{item.supervisor_id?.slice(0, 8) ?? 'Unassigned'}</td><td>{reason}{item.due_at ? ` · ${new Date(item.due_at).toLocaleDateString(undefined, { timeZone: organization.timezone })}` : ''}</td><td><span className="status-line"><i className={`status-dot status-dot--${item.status}`} aria-hidden="true" />{item.status.replaceAll('_', ' ')}</span></td></tr>;
          })}</tbody></table></div> : <p className="field-hint">No blocked, overdue or submitted work is currently visible.</p>}
        </section>
        <section className="panel dashboard-panel" aria-labelledby="availability-title">
          <div className="record-header"><h2 id="availability-title">Fleet availability</h2><span className="state-badge">Last 7 days</span></div>
          {!query.data.history_complete && <p className="field-hint" role="status">History is incomplete; missing days are shown as unknown.</p>}
          <AvailabilityChart days={query.data.daily_availability} timeZone={query.data.timezone} />
          <p className="footer-note">Current range: {range.from}–{addDays(range.to, -1)} · Completion time {readableDuration(counts.completion_seconds)}.</p>
        </section>
      </div>
      <div className="dashboard-secondary-grid">
        <section className="panel dashboard-panel" aria-labelledby="today-schedule-title">
          <div className="record-header"><h2 id="today-schedule-title">Today's schedule</h2><Link to="/work-orders">View calendar →</Link></div>
          {planned.isPending ? <LoadingNotice label="Checking work planned for today…" /> : planned.isError ? <div><ErrorNotice>Planned work could not be confirmed.</ErrorNotice><AppButton variant="secondary" onClick={() => void planned.refetch()}>Retry schedule</AppButton></div> : planned.data.length ? <ol className="dashboard-schedule">{planned.data.map((item) => { const plannedDate = item.planned_on ?? today; return <li key={item.id}><time dateTime={plannedDate}>{new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: organization.timezone }).format(new Date(`${plannedDate}T12:00:00Z`))}</time><span className="dashboard-schedule-title"><Link to={`/work-orders?workOrder=${encodeURIComponent(item.id)}`}>{item.title}</Link><span>{workOrderLabel(item.number)} · no time recorded</span></span><span className={`state-badge state-badge--${item.status}`}>{item.status.replaceAll('_', ' ')}</span></li>; })}</ol> : <p className="field-hint">No visible work orders have a planned date of today. Work-order records do not store appointment times.</p>}
        </section>
        <section className="panel dashboard-panel" aria-labelledby="daily-brief-title">
          <h2 id="daily-brief-title">Daily brief</h2>
          <ul className="dashboard-brief-list"><li><span className="dashboard-brief-mark" aria-hidden="true">▤</span><span><strong>{counts.active_work_orders} active work orders</strong>; {counts.blocked} blocked and {counts.pending_approvals} awaiting review.</span></li><li><span className="dashboard-brief-mark" aria-hidden="true">◌</span><span><strong>{counts.available_assets} of {counts.active_assets} assets available</strong>.{query.data.history_complete ? '' : ' Historical availability contains gaps.'}</span></li></ul>
          <Link className="button button--secondary" to="/notifications">Open notifications</Link>
        </section>
      </div>
      </>}
    </>}
  </>;
}

const notificationPageSize = 100;
const notificationMaxRows = 500;
const notificationRows = z.array(notificationRecord).max(notificationPageSize);
const notificationWorkOrder = z.strictObject({
  id: z.uuid(), number: z.int().positive(), title: z.string(), description: z.string(), asset_id: z.uuid(),
  status: z.string(), priority: z.string(), planned_on: z.string().nullable(), due_at: z.string().nullable(),
});
const notificationRequest = z.strictObject({
  id: z.uuid(), asset_id: z.uuid(), category: z.string(), description: z.string(), status: z.string(),
  created_at: z.string(), transition_reason: z.string().nullable(),
});
const notificationAsset = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string(), category: z.string(), availability: z.string() });
const notificationWorkOrderEvents = z.array(z.strictObject({ id: z.uuid(), action: z.string(), status: z.string(), created_at: z.string(), actor_id: z.uuid() })).max(100);
const notificationRequestEvents = z.array(z.strictObject({ id: z.uuid(), action: z.string(), status: z.string(), created_at: z.string(), actor_id: z.uuid() })).max(100);
const notificationAssignments = z.array(z.strictObject({ user_id: z.uuid() })).max(100);
const notificationSites = z.array(z.strictObject({ id: z.uuid(), name: z.string() })).max(200);

type NotificationSource =
  | { kind: 'work-order'; record: z.output<typeof notificationWorkOrder> | null; asset: z.output<typeof notificationAsset> | null; events: z.output<typeof notificationWorkOrderEvents>; assignees: z.output<typeof notificationAssignments> }
  | { kind: 'request'; record: z.output<typeof notificationRequest> | null; asset: z.output<typeof notificationAsset> | null; events: z.output<typeof notificationRequestEvents> };

function notificationTarget(item: z.output<typeof notificationRecord>) {
  if (!z.uuid().safeParse(item.source_id).success) return null;
  if (item.category === 'blocked_parts') return `/inventory?workOrder=${encodeURIComponent(item.source_id)}`;
  if (item.category === 'assignment' || ['update_work_order', 'transition_work_order', 'add_work_order_task', 'review_work_order', 'attachment_ready'].includes(item.category)) return `/work-orders?workOrder=${encodeURIComponent(item.source_id)}`;
  if (item.category.startsWith('request.')) return `/requests?request=${encodeURIComponent(item.source_id)}`;
  return null;
}
function notificationSourceKind(item: z.output<typeof notificationRecord>): 'work-order' | 'request' | null {
  if (item.category === 'blocked_parts') return null;
  if (item.category.startsWith('request.')) return 'request';
  return notificationTarget(item) ? 'work-order' : null;
}

export function NotificationsPage() {
  const { client, user, organization } = useWorkspace();
  const queryClient = useQueryClient();
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const retryableNotifications = useRef(new Map<string, z.output<typeof notificationRecord>>());
  const scope = `${user.id}:${organization.id}`;
  const [categoryMemory, setCategoryMemory] = useState<{ scope: string; values: string[] }>({ scope: '', values: [] });
  const requestKeyFor = (id: string) => `${scope}:${id}`;
  const key = ['notifications', user.id, organization.id] as const;
  const query = useInfiniteQuery({
    queryKey: [...key, readFilter, categoryFilter],
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      let notificationsQuery = client.from('notifications').select('*').eq('organization_id', organization.id).eq('recipient_user_id', user.id);
      if (readFilter === 'unread') notificationsQuery = notificationsQuery.is('read_at', null);
      if (readFilter === 'read') notificationsQuery = notificationsQuery.not('read_at', 'is', null);
      if (categoryFilter !== 'all') notificationsQuery = notificationsQuery.eq('category', categoryFilter);
      if (pageParam) notificationsQuery = notificationsQuery.or(cursorFilter(pageParam));
      const result = await notificationsQuery.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(notificationPageSize).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return notificationRows.parse(result.data ?? []);
    },
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.length, 0);
      return lastPage.length === notificationPageSize && loaded < notificationMaxRows ? lastPage.at(-1) ?? undefined : undefined;
    },
  });
  useEffect(() => { setReadFilter('all'); setCategoryFilter('all'); setSelectedId(null); setErrors({}); setSuccess(''); setBusyId(null); }, [scope]);
  const visibleRows = [...new Map([
    ...[...retryableNotifications.current].filter(([requestKey]) => requestKey.startsWith(`${scope}:`)).map(([, item]) => [item.id, item] as const),
    ...(query.data?.pages.flatMap((page) => page) ?? []).map((item) => [item.id, item] as const),
  ]).values()].sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
  const categoryNames = [...new Set(visibleRows.map((item) => item.category))].sort();
  const categorySignature = JSON.stringify(categoryNames);
  useEffect(() => {
    const observed = JSON.parse(categorySignature) as string[];
    setCategoryMemory((current) => {
      const values = [...new Set([...(current.scope === scope ? current.values : []), ...observed])].sort();
      return current.scope === scope && values.length === current.values.length && values.every((value, index) => value === current.values[index])
        ? current
        : { scope, values };
    });
  }, [scope, categorySignature]);
  const categories = categoryMemory.scope === scope ? categoryMemory.values : categoryNames;
  const visibleNotifications = visibleRows.filter((item) => {
    const pending = requests.current.has(requestKeyFor(item.id));
    return (readFilter === 'all' || readFilter === 'unread' && (!item.read_at || pending) || readFilter === 'read' && Boolean(item.read_at))
      && (categoryFilter === 'all' || item.category === categoryFilter);
  });
  const selected = visibleNotifications.find((item) => item.id === selectedId) ?? visibleNotifications[0];
  const sourceKind = selected ? notificationSourceKind(selected) : null;
  const sourceDetails = useQuery<NotificationSource>({
    queryKey: ['notification-source-details', user.id, organization.id, sourceKind, selected?.source_id],
    enabled: Boolean(selected && sourceKind),
    queryFn: async ({ signal }) => {
      const sourceId = selected!.source_id;
      if (sourceKind === 'work-order') {
        const workOrderResult = await client.from('work_orders').select('id,number,title,description,asset_id,status,priority,planned_on,due_at').eq('organization_id', organization.id).eq('id', sourceId).abortSignal(signal).maybeSingle();
        if (workOrderResult.error) throw new Error(domainError(workOrderResult.error).code);
        if (!workOrderResult.data) return { kind: 'work-order', record: null, asset: null, events: [], assignees: [] };
        const record = notificationWorkOrder.parse(workOrderResult.data);
        const [assetResult, eventResult, assignmentResult] = await Promise.all([
          client.from('assets').select('id,code,name,category,availability').eq('organization_id', organization.id).eq('id', record.asset_id).abortSignal(signal).maybeSingle(),
          client.from('work_order_events').select('id,action,status,created_at,actor_id').eq('organization_id', organization.id).eq('work_order_id', sourceId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100).abortSignal(signal),
          client.from('work_order_assignments').select('user_id').eq('organization_id', organization.id).eq('work_order_id', sourceId).is('unassigned_at', null).order('assigned_at', { ascending: false }).limit(100).abortSignal(signal),
        ]);
        for (const result of [assetResult, eventResult, assignmentResult]) if (result.error) throw new Error(domainError(result.error).code);
        return {
          kind: 'work-order', record, asset: assetResult.data ? notificationAsset.parse(assetResult.data) : null,
          events: notificationWorkOrderEvents.parse(eventResult.data ?? []), assignees: notificationAssignments.parse(assignmentResult.data ?? []),
        };
      }
      if (sourceKind === 'request') {
        const requestResult = await client.from('maintenance_requests').select('id,asset_id,category,description,status,created_at,transition_reason').eq('organization_id', organization.id).eq('id', sourceId).abortSignal(signal).maybeSingle();
        if (requestResult.error) throw new Error(domainError(requestResult.error).code);
        if (!requestResult.data) return { kind: 'request', record: null, asset: null, events: [] };
        const record = notificationRequest.parse(requestResult.data);
        const [assetResult, eventResult] = await Promise.all([
          client.from('assets').select('id,code,name,category,availability').eq('organization_id', organization.id).eq('id', record.asset_id).abortSignal(signal).maybeSingle(),
          client.from('request_events').select('id,action,status,created_at,actor_id').eq('organization_id', organization.id).eq('request_id', sourceId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100).abortSignal(signal),
        ]);
        for (const result of [assetResult, eventResult]) if (result.error) throw new Error(domainError(result.error).code);
        return {
          kind: 'request', record, asset: assetResult.data ? notificationAsset.parse(assetResult.data) : null,
          events: notificationRequestEvents.parse(eventResult.data ?? []),
        };
      }
      throw new Error('NOT_FOUND');
    },
  });
  const markRead = async (item: z.output<typeof notificationRecord>) => {
    const { id } = item;
    const requestKey = requestKeyFor(id);
    const requestId = requests.current.get(requestKey) ?? crypto.randomUUID();
    requests.current.set(requestKey, requestId);
    retryableNotifications.current.set(requestKey, item);
    setBusyId(id); setErrors((current) => ({ ...current, [id]: '' })); setSuccess('');
    try {
      await markNotificationsRead(client, organization.id, [id], requestId);
      requests.current.delete(requestKey);
      retryableNotifications.current.delete(requestKey);
      setSuccess('Notification marked as read.');
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (cause) {
      const code = domainError(cause).code;
      setErrors((current) => ({ ...current, [id]: `${domainError(cause).message}${code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' ? ' Retry keeps the same request identity.' : ''}` }));
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED') { requests.current.delete(requestKey); retryableNotifications.current.delete(requestKey); }
    } finally { setBusyId(null); }
  };
  return <>
    <PageHeader eyebrow="Inbox" title="Notifications" description="Events delivered to your signed-in account." />
    {query.isPending ? <LoadingNotice label="Loading your notifications…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Your notifications could not be loaded.</ErrorNotice><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry</AppButton></div> : <>
      {success && <SuccessNotice>{success}</SuccessNotice>}
      <div className="category-tablist notification-category-tabs" role="tablist" aria-label="Notification categories"><button type="button" role="tab" aria-selected={categoryFilter === 'all' && readFilter === 'all'} onClick={() => { setCategoryFilter('all'); setReadFilter('all'); }}>All</button><button type="button" role="tab" aria-selected={categoryFilter === 'all' && readFilter === 'unread'} onClick={() => { setCategoryFilter('all'); setReadFilter('unread'); }}>Unread</button>{categories.map((category) => <button type="button" role="tab" key={category} aria-selected={categoryFilter === category && readFilter === 'all'} onClick={() => { setCategoryFilter(category); setReadFilter('all'); }}>{category.replaceAll('_', ' ')}</button>)}</div>
      <div className="record-workspace notification-workspace" aria-label="Notification inbox">
        <section className="record-picker" aria-label="Your notifications">
          <div className="record-header notification-list-actions"><p className="field-hint">Delivered to your signed-in account</p><AppButton variant="quiet" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh'}</AppButton></div>
          {visibleNotifications.length ? <ol className="record-picker-list">{visibleNotifications.map((item) => <li key={item.id}><button className="notification-select" type="button" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span className={item.read_at ? 'notification-read-spacer' : 'notification-unread-dot'} aria-hidden="true" /><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time><strong>{item.category.replaceAll('_', ' ')}</strong><span className="record-picker-meta">Source {item.source_id ?? 'not recorded'} · {new Date(item.created_at).toLocaleDateString()}</span><span className="sr-only">{item.read_at ? 'Read' : 'Unread'}</span></button></li>)}</ol> : <p className="field-hint">{readFilter !== 'all' || categoryFilter !== 'all' || visibleRows.length ? 'No notifications match these filters.' : 'No notifications have been delivered to this account.'}</p>}
          {query.hasNextPage && <AppButton variant="quiet" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading older notifications…' : 'Load older notifications'}</AppButton>}
          {!query.hasNextPage && (query.data?.pages.reduce((count, page) => count + page.length, 0) ?? 0) >= notificationMaxRows && query.data?.pages.at(-1)?.length === notificationPageSize && <p className="field-hint">Showing at most {notificationMaxRows} matching notifications; use filters to narrow results.</p>}
        </section>
        <section className="record-preview" aria-label="Selected notification" aria-live="polite">
          {selected ? <>
            <div className="record-header notification-event-heading"><div><p className="page-kicker">Delivered event</p><h2>{selected.category.replaceAll('_', ' ')}</h2><time className="notification-event-time" dateTime={selected.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: organization.timezone }).format(new Date(selected.created_at))}</time></div><span className={`state-badge${selected.read_at ? '' : ' state-badge--submitted'}`}>{selected.read_at ? 'Read' : 'Unread'}</span></div>
            <dl className="detail-grid notification-delivery-facts"><div><dt>Received</dt><dd>{new Date(selected.created_at).toLocaleString()}</dd></div><div><dt>Read at</dt><dd>{selected.read_at ? new Date(selected.read_at).toLocaleString() : 'Not read'}</dd></div></dl>
            <details className="notification-identifiers"><summary>Notification, event and source IDs</summary><dl className="detail-grid"><div><dt>Notification ID</dt><dd className="monospace">{selected.id}</dd></div><div><dt>Event ID</dt><dd className="monospace">{selected.event_id}</dd></div><div><dt>Source record ID</dt><dd className="monospace">{selected.source_id}</dd></div></dl></details>
            <section className="notification-source-details" aria-label="Notification source details">
              <div className="record-header"><h3>Current record context</h3>{sourceKind && <span className="field-hint">Current source facts</span>}</div>
              {!sourceKind ? <p className="field-hint">This event has no supported source-record view.</p> : sourceDetails.isPending ? <LoadingNotice label="Checking current source access…" /> : sourceDetails.isError ? <div><ErrorNotice>Current source details are unavailable. Opening the record still checks access again.</ErrorNotice><AppButton variant="secondary" onClick={() => void sourceDetails.refetch()}>Retry source details</AppButton></div> : !sourceDetails.data?.record ? <p className="field-hint">The source record is unavailable under your current workspace access.</p> : sourceDetails.data.kind === 'work-order' ? <>
                <div className="record-header notification-source-heading"><div><p className="page-kicker">WO-{String(sourceDetails.data.record.number).padStart(4, '0')}</p><h4>{sourceDetails.data.record.title}</h4></div><span className={`state-badge state-badge--${sourceDetails.data.record.status}`}>{sourceDetails.data.record.status.replaceAll('_', ' ')}</span></div>
                <dl className="detail-grid"><div><dt>Asset</dt><dd>{sourceDetails.data.asset ? `${sourceDetails.data.asset.code} · ${sourceDetails.data.asset.name}` : 'Asset details unavailable'}</dd></div><div><dt>Priority</dt><dd>{sourceDetails.data.record.priority}</dd></div><div><dt>Planned date</dt><dd>{sourceDetails.data.record.planned_on ?? 'No planned date recorded'}</dd></div><div><dt>Due date</dt><dd>{sourceDetails.data.record.due_at ? new Date(sourceDetails.data.record.due_at).toLocaleDateString(undefined, { timeZone: organization.timezone }) : 'No due date recorded'}</dd></div></dl>
                <p className="record-description">{sourceDetails.data.record.description}</p>
                <details className="notification-assignees"><summary>Active assigned account IDs ({sourceDetails.data.assignees.length})</summary>{sourceDetails.data.assignees.length ? <ul>{sourceDetails.data.assignees.map((assignment) => <li className="monospace" key={assignment.user_id}>{assignment.user_id === user.id ? `You · ${assignment.user_id}` : assignment.user_id}</li>)}</ul> : <p className="field-hint">No active assignments are visible.</p>}</details>
                <details className="notification-events"><summary>Recent recorded work-order events</summary>{sourceDetails.data.events.length ? <><ol>{sourceDetails.data.events.slice(0, 5).map((event) => <li key={event.id}><span>{event.action.replaceAll('_', ' ')} · {event.status.replaceAll('_', ' ')}</span><time dateTime={event.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: organization.timezone }).format(new Date(event.created_at))}</time></li>)}</ol>{sourceDetails.data.events.length > 5 && <p className="field-hint">Showing the latest 5 authorized events.</p>}</> : <p className="field-hint">No additional authorized event rows are visible.</p>}</details>
              </> : <>
                <div className="record-header notification-source-heading"><div><p className="page-kicker">{sourceDetails.data.record.category} request</p><h4>Request current status</h4></div><span className={`state-badge state-badge--${sourceDetails.data.record.status}`}>{sourceDetails.data.record.status.replaceAll('_', ' ')}</span></div>
                <dl className="detail-grid"><div><dt>Asset</dt><dd>{sourceDetails.data.asset ? `${sourceDetails.data.asset.code} · ${sourceDetails.data.asset.name}` : 'Asset details unavailable'}</dd></div><div><dt>Reported</dt><dd>{new Date(sourceDetails.data.record.created_at).toLocaleDateString(undefined, { timeZone: organization.timezone })}</dd></div></dl>
                <p className="record-description">{sourceDetails.data.record.description}</p>
                <details className="notification-events"><summary>Recent recorded request events</summary>{sourceDetails.data.events.length ? <><ol>{sourceDetails.data.events.slice(0, 5).map((event) => <li key={event.id}><span>{event.action.replaceAll('_', ' ')} · {event.status.replaceAll('_', ' ')}</span><time dateTime={event.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: organization.timezone }).format(new Date(event.created_at))}</time></li>)}</ol>{sourceDetails.data.events.length > 5 && <p className="field-hint">Showing the latest 5 authorized events.</p>}</> : <p className="field-hint">No additional authorized event rows are visible.</p>}</details>
              </>}
            </section>
            {errors[selected.id] && <ErrorNotice>{errors[selected.id]}</ErrorNotice>}
            <div className="compact-actions">{notificationTarget(selected) ? <Link className="button button--secondary" to={notificationTarget(selected)!}>{selected.category === 'blocked_parts' ? 'Review linked inventory fulfillment' : 'Open current record'}</Link> : <span className="field-hint">This event has no supported in-app target.</span>}{(!selected.read_at || requests.current.has(requestKeyFor(selected.id))) && <AppButton variant="quiet" disabled={busyId === selected.id} onClick={() => void markRead(selected)}>{busyId === selected.id ? 'Saving…' : requests.current.has(requestKeyFor(selected.id)) ? 'Retry mark as read' : 'Mark as read'}</AppButton>}</div>
          </> : <p className="field-hint">Select a notification to inspect the delivered event.</p>}
        </section>
      </div>
    </>}
  </>;
}

const settingsRow = z.strictObject({ evidence_required: z.boolean(), version: z.number().int().positive() });
const organizationSettingsFields = z.strictObject({ timezone: z.string(), currency: z.string() });
export function OrganizationSettingsPage() {
  const { client, user, organization, refreshMemberships } = useWorkspace();
  const queryClient = useQueryClient();
  const key = ['organization-settings', user.id, organization.id] as const;
  const sites = useQuery({
    queryKey: ['authorized-sites', user.id, organization.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('sites').select('id,name').eq('organization_id', organization.id).order('name', { ascending: true }).order('id', { ascending: true }).limit(200).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return notificationSites.parse(result.data ?? []);
    },
  });
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const [settingsResultRow, organizationResult] = await Promise.all([
        client.from('organization_settings').select('evidence_required,version').eq('organization_id', organization.id).abortSignal(signal).maybeSingle(),
        client.from('organizations').select('timezone,currency').eq('id', organization.id).abortSignal(signal).maybeSingle(),
      ]);
      if (settingsResultRow.error) throw new Error(domainError(settingsResultRow.error).code);
      if (organizationResult.error) throw new Error(domainError(organizationResult.error).code);
      if (!settingsResultRow.data || !organizationResult.data) throw new Error('DEPENDENCY_UNAVAILABLE');
      return { ...settingsRow.parse(settingsResultRow.data), ...organizationSettingsFields.parse(organizationResult.data) };
    },
  });
  const [evidenceRequired, setEvidenceRequired] = useState<boolean | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const intent = useRef<{ id: string; version: number; fields: { evidence_required?: boolean; timezone?: string; currency?: string } } | null>(null);
  const currentEvidence = evidenceRequired ?? query.data?.evidence_required ?? true;
  const currentTimezone = timezone ?? query.data?.timezone ?? organization.timezone;
  const currentCurrency = currency ?? query.data?.currency ?? organization.currency;
  const reload = async () => {
    const result = await query.refetch();
    if (result.data) {
      setEvidenceRequired(result.data.evidence_required); setTimezone(result.data.timezone); setCurrency(result.data.currency);
      intent.current = null; setStale(false); setError('');
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!query.data || stale) return;
    const chosen = intent.current ?? {
      id: crypto.randomUUID(), version: query.data.version,
      fields: { evidence_required: currentEvidence, timezone: currentTimezone.trim(), currency: currentCurrency.trim().toUpperCase() },
    };
    intent.current = chosen; setBusy(true); setError(''); setSuccess('');
    try {
      const result = await saveOrganizationSettings(client, organization.id, chosen.version, chosen.fields, chosen.id);
      const valid = settingsResult.safeParse(result);
      if (!valid.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      intent.current = null; setSuccess('Workspace settings saved.'); setStale(false);
      await queryClient.invalidateQueries({ queryKey: key }); await refreshMemberships();
    } catch (cause) {
      const code = domainError(cause).code;
      setError(domainError(cause).message);
      if (code === 'CONFLICT') {
        setStale(true);
        setError('Settings changed elsewhere. Reload the current values and review them before saving again. Your edits have not been applied.');
        intent.current = null;
      } else if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED') intent.current = null;
    } finally { setBusy(false); }
  };
  return <>
    <PageHeader eyebrow="Workspace administration" title="Organization settings" description="Manage workspace defaults and repair evidence." />
    <nav className="settings-tabs" aria-label="Settings sections"><Link to="/settings" aria-current="page">General</Link><Link to="/team">Members &amp; roles</Link><Link to="/settings#settings-locations">Locations</Link><Link to="/notifications">Notifications</Link><Link to="/settings/security">Account</Link></nav>
    {query.isPending ? <LoadingNotice label="Loading workspace settings…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Workspace settings could not be confirmed.</ErrorNotice><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry</AppButton></div> : <>
      {error && <ErrorNotice>{error}</ErrorNotice>}{success && <SuccessNotice>{success}</SuccessNotice>}
      <PrivilegedArea label="changing workspace settings"><form className="settings-layout" onSubmit={(event) => void save(event)}>
        <section className="panel form-stack settings-form" aria-label="Organization settings form">
          <div className="record-header"><h2>Organization</h2><span className="field-hint">Owner access · AAL2 required</span></div>
          <dl className="settings-organization-name"><div><dt>Organization name</dt><dd>{organization.name}</dd></div></dl>
          <div className="settings-fields"><Field id="organization-timezone" label="Workspace time zone" required maxLength={100} disabled={busy || stale || Boolean(intent.current)} hint="Use a valid IANA time zone, such as Asia/Manila." value={currentTimezone} onChange={(event) => setTimezone(event.target.value)} /><Field id="organization-currency" label="Currency code" required maxLength={3} pattern="[A-Za-z]{3}" disabled={busy || stale || Boolean(intent.current)} hint="Three-letter currency code. No amounts are created by this setting." value={currentCurrency} onChange={(event) => setCurrency(event.target.value)} /></div>
          <label className="setting-toggle" htmlFor="evidence-required"><span><strong>Require repair evidence before submission</strong><span className="field-hint">A repair cannot be sent for review until at least one private image is ready.</span></span><input id="evidence-required" type="checkbox" checked={currentEvidence} disabled={busy || stale || Boolean(intent.current)} onChange={(event) => setEvidenceRequired(event.target.checked)} /></label>
          <p className="info-callout">AI features are disabled by workspace policy.</p>
        </section>
        <aside className="settings-side" aria-label="Workspace and account information">
          <section className="panel settings-locations" id="settings-locations" aria-label="Workspace locations"><div className="record-header"><h2>Locations</h2><span className="field-hint">Authorized site names</span></div>{sites.isPending ? <LoadingNotice label="Loading authorized locations…" /> : sites.isError ? <div><ErrorNotice>Location names could not be loaded.</ErrorNotice><AppButton variant="secondary" onClick={() => void sites.refetch()}>Retry locations</AppButton></div> : sites.data.length ? <><ul className="settings-site-list">{sites.data.map((site) => <li key={site.id}><span className="settings-site-mark" aria-hidden="true">⌖</span><strong>{site.name}</strong></li>)}</ul>{sites.data.length === 200 && <p className="field-hint">Showing the first 200 authorized locations.</p>}</> : <p className="field-hint">No location names are visible to this account.</p>}</section>
          <section className="panel"><h2>Account preferences</h2><p className="field-hint">Manage sign-in security and review the notifications delivered to this account.</p><div className="settings-account-links">
            <Link className="settings-account-link" to="/settings/security"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3 5 6v5c0 4.6 2.8 8.4 7 10 4.2-1.6 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg><span><strong>Account security</strong><small>Review sign-in protection</small></span><span className="settings-account-arrow" aria-hidden="true">→</span></Link>
            <Link className="settings-account-link" to="/notifications"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><span><strong>Notifications</strong><small>Review delivered events</small></span><span className="settings-account-arrow" aria-hidden="true">→</span></Link>
          </div></section>
        </aside>
        <div className="button-row settings-save">{stale ? <AppButton type="button" onClick={() => void reload()}>Reload current settings</AppButton> : <AppButton type="submit" disabled={busy}>{busy ? 'Saving…' : intent.current ? 'Retry with the same request' : 'Save settings'}</AppButton>}</div>
      </form></PrivilegedArea>
    </>}
  </>;
}

export function OperationsTeamPage() {
  const { client, user, organization } = useWorkspace();
  const query = useQuery({
    queryKey: ['operations-team', user.id, organization.id],
    queryFn: async ({ signal }) => {
      const result = await client.rpc('get_team', { organization_id: organization.id }).abortSignal(signal);
      return parsedRpc(result.data, result.error, teamResult);
    },
  });
  return <>
    <PageHeader eyebrow="Workspace" title="Team and workload" description="This roster shows only the role and account IDs exposed to your current workspace role." />
    {query.isPending ? <LoadingNotice label="Loading authorized team roles…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Team roles are unavailable for this account.</ErrorNotice></div> : <>
      <TeamWorkload client={client} userId={user.id} organizationId={organization.id} members={query.data} inactiveCountLabel="Inactive shown" />
          <section className="panel table-panel" aria-labelledby="team-roster-title"><h2 id="team-roster-title">Workspace members</h2><p className="field-hint">Active member rows are complete. Inactive accounts are the bounded history returned to this role (up to 100); the total inactive count is unavailable.</p>{query.data.length ? <div className="compact-table-scroll"><table className="compact-table"><thead><tr><th scope="col">Member ID</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Record version</th></tr></thead><tbody>{query.data.map((member) => <tr key={member.user_id}><td><MemberIdentifier userId={member.user_id} isSelf={member.user_id === user.id} /></td><td>{member.role}</td><td><span className="status-line"><i className={`status-dot status-dot--${member.active ? 'operational' : 'inactive'}`} aria-hidden="true" />{member.active ? 'Active' : 'Inactive'}</span></td><td>{member.version}</td></tr>)}</tbody></table></div> : <p className="field-hint">No team members are visible.</p>}</section>
    </>}
  </>;
}

export async function loadAssetHistory(client: ReturnType<typeof import('./workspace').useWorkspace>['client'], organizationId: string, assetId: string, signal?: AbortSignal) {
  const rpc = client.rpc('get_asset_history', { organization_id: organizationId, asset_id: assetId, cursor: null });
  const result = signal ? await rpc.abortSignal(signal) : await rpc;
  return parsedRpc(result.data, result.error, assetHistoryResult);
}
