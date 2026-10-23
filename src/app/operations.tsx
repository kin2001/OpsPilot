import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { assetHistoryResult, dashboardResult, notificationRecord, settingsResult, teamResult } from '../contracts/operational';
import { domainError } from '../lib/domain-errors';
import type { Json } from '../lib/database.types';
import { markNotificationsRead, saveOrganizationSettings } from './commands';
import { PrivilegedArea } from './auth/security';
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

export function DashboardPage() {
  const { client, user, organization, role } = useWorkspace();
  const today = dateInZone(new Date(), organization.timezone);
  const range = useMemo(() => ({ from: addDays(today, -6), to: addDays(today, 1) }), [today]);
  const query = useQuery({
    queryKey: ['operational-dashboard', user.id, organization.id, range.from, range.to],
    queryFn: async ({ signal }) => {
      const result = await client.rpc('get_dashboard', { organization_id: organization.id, range: range as unknown as Json }).abortSignal(signal);
      return parsedRpc(result.data, result.error, dashboardResult);
    },
  });
  const counts = query.data?.counts;
  return <>
    <PageHeader eyebrow="Workspace" title="Overview" description={`Operational activity recorded for ${range.from} through ${addDays(range.to, -1)} in ${organization.timezone}.`} />
    {role === 'technician' || role === 'inventory' ? <div className="empty-state"><h2>Dashboard not available for this role</h2><p>Use your assigned work orders and available asset records. This dashboard is limited to operations roles.</p><Link className="button button--secondary" to={role === 'technician' ? '/work-orders' : '/assets'}>Open assigned work</Link></div> : query.isPending ? <LoadingNotice label="Loading workspace totals…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Dashboard totals are unavailable. No values are estimated from incomplete history.</ErrorNotice><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry</AppButton></div> : counts && <>
      <div className="dashboard-counts" aria-label="Operational totals">
        <article className="dashboard-count"><span>Available assets</span><strong>{counts.available_assets} <small>of {counts.active_assets}</small></strong></article>
        <article className="dashboard-count"><span>Active work orders</span><strong>{counts.active_work_orders}</strong></article>
        <article className="dashboard-count"><span>Blocked</span><strong>{counts.blocked}</strong></article>
        <article className="dashboard-count"><span>Pending approvals</span><strong>{counts.pending_approvals}</strong></article>
        <article className="dashboard-count"><span>Overdue</span><strong>{counts.overdue}</strong></article>
        <article className="dashboard-count"><span>Completed in range</span><strong>{counts.completed}</strong></article>
      </div>
      <section className="panel dashboard-panel" aria-labelledby="availability-title">
        <div className="record-header"><div><p className="page-kicker">Last seven days</p><h2 id="availability-title">Recorded asset availability</h2></div><span className="state-badge">{query.data.history_complete ? 'History complete' : 'History incomplete'}</span></div>
        {!query.data.history_complete && <p className="info-callout" role="status">Some earlier availability history is missing. Days with incomplete data are shown as unknown.</p>}
        <div className="availability-strip" aria-label={`Daily availability history in ${query.data.timezone}`}>
          {query.data.daily_availability.map((day) => {
            const ratio = day.available_assets === null || day.known_assets === 0 ? null : day.available_assets / day.known_assets;
            return <div className="availability-day" key={day.date}>
              <div className="availability-track" aria-hidden="true"><span className={ratio === null ? 'availability-bar availability-bar--unknown' : 'availability-bar'} style={{ height: ratio === null ? '100%' : `${Math.max(8, ratio * 100)}%` }} /></div>
              <strong>{day.available_assets === null ? 'Unknown' : `${day.available_assets} / ${day.known_assets}`}</strong>
              <span>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', timeZone: query.data!.timezone })}</span>
            </div>;
          })}
        </div>
        <p className="footer-note">Completion time: {readableDuration(counts.completion_seconds)}{counts.completion_sample_size ? ` from ${counts.completion_sample_size} recorded repairs` : ''}. Recorded downtime: {query.data.downtime_seconds === null ? 'unknown' : readableDuration(query.data.downtime_seconds)}.</p>
      </section>
      <div className="flow-grid dashboard-links">
        <Link className="flow-card" to="/work-orders"><span className="nav-icon" aria-hidden="true">▤</span><strong>Work orders</strong><span>Assign work, record repair activity and review submitted repairs.</span></Link>
        <Link className="flow-card" to="/assets"><span className="nav-icon" aria-hidden="true">◇</span><strong>Assets</strong><span>Check recorded availability, active holds and history.</span></Link>
        <Link className="flow-card" to="/notifications"><span className="nav-icon" aria-hidden="true">◉</span><strong>Notifications</strong><span>Open work items addressed to your signed-in account.</span></Link>
      </div>
    </>}
  </>;
}

const notificationRows = z.array(notificationRecord).max(500);
function notificationTarget(item: z.output<typeof notificationRecord>) {
  if (item.category === 'assignment' || ['update_work_order', 'transition_work_order', 'add_work_order_task', 'review_work_order', 'attachment_ready'].includes(item.category)) return `/work-orders?workOrder=${encodeURIComponent(item.source_id)}`;
  if (item.category.startsWith('request.')) return `/requests?request=${encodeURIComponent(item.source_id)}`;
  return null;
}

export function NotificationsPage() {
  const { client, user, organization } = useWorkspace();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  const key = ['notifications', user.id, organization.id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const result = await client.from('notifications').select('*').eq('organization_id', organization.id).eq('recipient_user_id', user.id).order('created_at', { ascending: false }).limit(200).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return notificationRows.parse(result.data ?? []);
    },
  });
  const markRead = async (id: string) => {
    const requestId = requests.current.get(id) ?? crypto.randomUUID();
    requests.current.set(id, requestId);
    setBusyId(id); setErrors((current) => ({ ...current, [id]: '' }));
    try {
      await markNotificationsRead(client, organization.id, [id], requestId);
      requests.current.delete(id);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (cause) {
      const code = domainError(cause).code;
      setErrors((current) => ({ ...current, [id]: `${domainError(cause).message}${code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' ? ' Retry keeps the same request identity.' : ''}` }));
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED') requests.current.delete(id);
    } finally { setBusyId(null); }
  };
  return <>
    <PageHeader eyebrow="Inbox" title="Notifications" description="These records are delivered to your signed-in account. Opening a target still checks your current workspace access." />
    {query.isPending ? <LoadingNotice label="Loading your notifications…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Your notifications could not be loaded.</ErrorNotice><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry</AppButton></div> : !query.data.length ? <div className="empty-state"><h2>You’re all caught up</h2><p>New assignments and work updates addressed to your account will appear here.</p></div> : <section className="record-list" aria-label="Notifications">
      {query.data.map((item) => {
        const target = notificationTarget(item);
        return <article className="record-card notification-card" key={item.id}>
          <div className="record-header"><h2>{item.category.replaceAll('_', ' ')}</h2><span className={`state-badge${item.read_at ? '' : ' state-badge--submitted'}`}>{item.read_at ? 'Read' : 'Unread'}</span></div>
          <p className="field-hint">Received {new Date(item.created_at).toLocaleString()}</p>
          {errors[item.id] && <ErrorNotice>{errors[item.id]}</ErrorNotice>}
          <div className="compact-actions">
            {target ? <Link className="button button--secondary" to={target}>Open current record</Link> : <span className="field-hint">This update has no supported in-app target.</span>}
            {!item.read_at && <AppButton variant="quiet" disabled={busyId === item.id} onClick={() => void markRead(item.id)}>{busyId === item.id ? 'Saving…' : requests.current.has(item.id) ? 'Retry mark as read' : 'Mark as read'}</AppButton>}
          </div>
        </article>;
      })}
    </section>}
  </>;
}

const settingsRow = z.strictObject({ evidence_required: z.boolean(), version: z.number().int().positive() });
const organizationSettingsFields = z.strictObject({ timezone: z.string(), currency: z.string() });
export function OrganizationSettingsPage() {
  const { client, user, organization, refreshMemberships } = useWorkspace();
  const queryClient = useQueryClient();
  const key = ['organization-settings', user.id, organization.id] as const;
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
    <PageHeader eyebrow="Workspace administration" title="Settings" description="Set the workspace time zone, currency and repair evidence requirement. Changes require an AAL2 session." />
    {query.isPending ? <LoadingNotice label="Loading workspace settings…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Workspace settings could not be confirmed.</ErrorNotice><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry</AppButton></div> : <>
      {error && <ErrorNotice>{error}</ErrorNotice>}{success && <SuccessNotice>{success}</SuccessNotice>}
      <PrivilegedArea label="changing workspace settings"><form className="panel form-stack settings-form" onSubmit={(event) => void save(event)}>
        <label className="setting-toggle" htmlFor="evidence-required"><span><strong>Require repair evidence before submission</strong><span className="field-hint">A repair cannot be sent for review until at least one private image is ready.</span></span><input id="evidence-required" type="checkbox" checked={currentEvidence} disabled={busy || stale || Boolean(intent.current)} onChange={(event) => setEvidenceRequired(event.target.checked)} /></label>
        <div className="form-row"><Field id="organization-timezone" label="Workspace time zone" required maxLength={100} disabled={busy || stale || Boolean(intent.current)} hint="Use a valid IANA time zone, such as Asia/Manila." value={currentTimezone} onChange={(event) => setTimezone(event.target.value)} /><Field id="organization-currency" label="Currency code" required maxLength={3} pattern="[A-Za-z]{3}" disabled={busy || stale || Boolean(intent.current)} hint="Three-letter currency code. No amounts are created by this setting." value={currentCurrency} onChange={(event) => setCurrency(event.target.value)} /></div>
        <p className="info-callout">AI features are disabled by workspace policy.</p>
        <div className="button-row">{stale ? <AppButton type="button" onClick={() => void reload()}>Reload current settings</AppButton> : <AppButton type="submit" disabled={busy}>{busy ? 'Saving…' : intent.current ? 'Retry with the same request' : 'Save settings'}</AppButton>}</div>
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
    <PageHeader eyebrow="Workspace" title="Team" description="This active roster includes only the role and account IDs the operations contract exposes." />
    {query.isPending ? <LoadingNotice label="Loading authorized team roles…" /> : query.isError ? <div className="empty-state"><ErrorNotice>Team roles are unavailable for this account.</ErrorNotice></div> : <section className="record-list" aria-label="Active workspace roles">
      {query.data.map((member) => <article className="record-card" key={member.user_id}><div className="record-header"><h2>{member.user_id === user.id ? 'You' : 'Workspace member'}</h2><span className={`state-badge${member.active ? ' state-badge--converted' : ''}`}>{member.active ? 'Active' : 'Inactive'}</span></div><p className="record-meta">User ID <span className="monospace">{member.user_id}</span> · Role {member.role} · Version {member.version}</p></article>)}
      {query.data.length === 0 && <p className="field-hint">No team members are visible.</p>}
    </section>}
  </>;
}

export async function loadAssetHistory(client: ReturnType<typeof import('./workspace').useWorkspace>['client'], organizationId: string, assetId: string, signal?: AbortSignal) {
  const rpc = client.rpc('get_asset_history', { organization_id: organizationId, asset_id: assetId, cursor: null });
  const result = signal ? await rpc.abortSignal(signal) : await rpc;
  return parsedRpc(result.data, result.error, assetHistoryResult);
}
