import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { domainError } from '../lib/domain-errors';
import { maintenanceFields, type MaintenanceFields } from '../contracts/maintenance';
import { operationalWorkOrder, teamResult } from '../contracts/operational';
import { listMaintenanceAgenda, listMaintenanceBacklog, listMaintenancePlans, listMaintenanceRevisions, previewMaintenancePlan, saveMaintenancePlan } from './maintenance-client';
import { recordFilter, recordPageSize, splitRecordPage, type RecordCursor } from './record-query';
import { transitionWorkOrder } from './commands';
import { useWorkspace } from './workspace';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, TextAreaField } from './ui';
import '../styles/maintenance.css';

const maintenanceAsset = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string(), created_at: z.string() });
const maintenanceAssets = z.array(maintenanceAsset).max(recordPageSize + 1);
type SaveIntent = { requestId: string; fields: MaintenanceFields; expectedVersion?: number };

function emptyFields(anchorOn: string): MaintenanceFields {
  return { asset_id: '', title: '', instructions: '', category: 'Preventive', cadence: 'month', frequency: 1,
    anchor_on: anchorOn, supervisor_id: '', assignee_ids: [], checklist: ['Inspect equipment'], status: 'active' };
}

const activeAssignment = z.strictObject({ id: z.uuid(), work_order_id: z.uuid(), user_id: z.uuid() });
const activeAssignments = z.array(activeAssignment).max(3000);

function isoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function monthBounds(date: Date) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { from: isoDate(first), to: isoDate(last) };
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function dateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatInstant(value: string, timeZone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'time unavailable' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }).format(date);
}

async function currentRevision(client: ReturnType<typeof useWorkspace>['client'], organizationId: string, planId: string, revisionId: string, version: number, signal: AbortSignal) {
  let cursor: number | undefined = version > 100 ? version - 100 : undefined;
  while (true) {
    const page = await listMaintenanceRevisions(client, organizationId, planId, { cursor, page_size: 100 }, signal);
    const current = page.items.find((item) => item.revision.id === revisionId)?.revision;
    if (current) return current;
    if (page.next_cursor === null) break;
    cursor = page.next_cursor;
  }
  throw new Error('DEPENDENCY_UNAVAILABLE');
}

export function MaintenancePage() {
  const { client, user, organization, role } = useWorkspace();
  const cache = useQueryClient();
  const [tab, setTab] = useState<'calendar' | 'plans'>('calendar');
  const [month, setMonth] = useState(() => {
    const today = dateInZone(new Date(), organization.timezone);
    return new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1));
  });
  const [selectedDate, setSelectedDate] = useState(() => dateInZone(new Date(), organization.timezone));
  const [editor, setEditor] = useState<{ planId?: string; version?: number } | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [fields, setFields] = useState<MaintenanceFields>(() => emptyFields(isoDate(new Date())));
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewMaintenancePlan>> | null>(null);
  const [previewFor, setPreviewFor] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveIntent, setSaveIntent] = useState<SaveIntent | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [backlogPlanId, setBacklogPlanId] = useState<string | null>(null);
  const startIntents = useRef(new Map<string, { requestId: string; expectedVersion: number }>());
  const startingRef = useRef(false);
  const saveIntentRef = useRef<SaveIntent | null>(null);
  const savingRef = useRef(false);
  const [startingId, setStartingId] = useState('');
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  const isCoordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const readAllowed = ['owner', 'manager', 'supervisor', 'technician'].includes(role);
  const bounds = monthBounds(month);
  const plans = useInfiniteQuery({
    queryKey: ['maintenance-plans', user.id, organization.id, role],
    enabled: readAllowed,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => listMaintenancePlans(client, organization.id, { cursor: pageParam, page_size: 100 }, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const agenda = useInfiniteQuery({
    queryKey: ['maintenance-agenda', user.id, organization.id, role, bounds.from, bounds.to],
    enabled: readAllowed,
    initialPageParam: undefined as { date: string; id: string } | undefined,
    queryFn: ({ signal, pageParam }) => listMaintenanceAgenda(client, organization.id, {
      from_on: bounds.from, to_on: bounds.to, cursor: pageParam, page_size: 100,
    }, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const planRows = plans.data?.pages.flatMap((page) => page.items) ?? [];
  const assets = useInfiniteQuery({
    queryKey: ['maintenance-assets', user.id, organization.id, role, assetSearch.trim()], enabled: isCoordinator && Boolean(editor),
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      const filter = recordFilter(['name', 'code'], assetSearch.trim(), pageParam);
      const result = await client.from('assets').select('id,code,name,created_at').eq('organization_id', organization.id).is('archived_at', null)
        .or(filter ?? 'id.not.is.null').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(recordPageSize + 1).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = maintenanceAssets.safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return splitRecordPage(parsed.data);
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const assetRows = assets.data?.pages.flatMap((page) => page.rows) ?? [];
  const currentAsset = useQuery({
    queryKey: ['maintenance-current-asset', user.id, organization.id, role, fields.asset_id],
    enabled: isCoordinator && Boolean(editor && fields.asset_id) && assets.isSuccess && !assetRows.some((asset) => asset.id === fields.asset_id),
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('id,code,name,created_at').eq('organization_id', organization.id)
        .eq('id', fields.asset_id).is('archived_at', null).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      if (!result.data) return null;
      const parsed = maintenanceAsset.safeParse(result.data);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const activeAssetSelected = assetRows.some((asset) => asset.id === fields.asset_id) || currentAsset.data?.id === fields.asset_id;
  const team = useQuery({
    queryKey: ['maintenance-team', user.id, organization.id, role], enabled: isCoordinator && Boolean(editor),
    queryFn: async ({ signal }) => {
      const result = await client.rpc('get_team', { organization_id: organization.id }).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = teamResult.safeParse(result.data);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const revisions = useQueries({ queries: planRows.map((plan) => ({
    queryKey: ['maintenance-revisions', user.id, organization.id, role, plan.id, plan.version],
    enabled: readAllowed,
    queryFn: ({ signal }: { signal: AbortSignal }) => currentRevision(client, organization.id, plan.id, plan.current_revision_id, plan.version, signal),
    staleTime: 30_000,
  })) });
  const revisionByPlan = new Map(planRows.map((plan, index) => [plan.id, revisions[index]?.data]));
  const backlog = useInfiniteQuery({
    queryKey: ['maintenance-backlog', user.id, organization.id, role, backlogPlanId], enabled: readAllowed && Boolean(backlogPlanId),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ signal, pageParam }) => listMaintenanceBacklog(client, organization.id, backlogPlanId!, { cursor: pageParam, page_size: 25 }, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const items = agenda.data?.pages.flatMap((page) => page.items) ?? [];
  const today = dateInZone(new Date(), organization.timezone);
  const dayItems = items.filter((item) => item.scheduled_local_date === selectedDate);
  const activeWorkStatuses = ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'];
  const overdueItems = items.filter((item) => activeWorkStatuses.includes(item.work_status) && Date.parse(item.due_at) < Date.now())
    .sort((left, right) => left.due_at.localeCompare(right.due_at));
  const upcomingItems = items.filter((item) => item.scheduled_local_date >= today && activeWorkStatuses.includes(item.work_status))
    .sort((left, right) => left.scheduled_local_date.localeCompare(right.scheduled_local_date)).slice(0, 5);
  const selectedWorkOrderIds = [...new Set(dayItems.map((item) => item.work_order_id))];
  const liveWorkOrders = useQuery({
    queryKey: ['maintenance-calendar-work-orders', user.id, organization.id, role, selectedDate, selectedWorkOrderIds], enabled: selectedWorkOrderIds.length > 0,
    queryFn: async ({ signal }) => {
      const result = await client.from('work_orders').select('*').eq('organization_id', organization.id).in('id', selectedWorkOrderIds).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = z.array(operationalWorkOrder).max(100).safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const liveAssignments = useQuery({
    queryKey: ['maintenance-calendar-assignments', user.id, organization.id, role, selectedDate, selectedWorkOrderIds], enabled: selectedWorkOrderIds.length > 0,
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_assignments').select('id,work_order_id,user_id').eq('organization_id', organization.id)
        .in('work_order_id', selectedWorkOrderIds).is('unassigned_at', null).order('id').limit(3000).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return activeAssignments.parse(result.data ?? []);
    },
  });
  const liveWorkOrdersById = new Map((liveWorkOrders.data ?? []).map((workOrder) => [workOrder.id, workOrder]));
  const currentAssignees = (id: string) => (liveAssignments.data ?? []).filter((row) => row.work_order_id === id).map((row) => row.user_id).sort();
  const canStart = (item: (typeof dayItems)[number]) => {
    const order = liveWorkOrdersById.get(item.work_order_id);
    const assigned = currentAssignees(item.work_order_id);
    return Boolean(order && order.organization_id === organization.id && order.status === item.work_status
      && ['open', 'scheduled'].includes(order.status) && !item.blocks_operation && !order.blocks_operation && assigned.length > 0
      && (isCoordinator || assigned.includes(user.id)));
  };
  const runStart = async (item: (typeof dayItems)[number]) => {
    const order = liveWorkOrdersById.get(item.work_order_id);
    if (!order || !canStart(item) || startingRef.current) return;
    const intent = startIntents.current.get(order.id) ?? { requestId: crypto.randomUUID(), expectedVersion: order.version };
    startIntents.current.set(order.id, intent);
    startingRef.current = true; setStartingId(order.id); setStartErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      await transitionWorkOrder(client, organization.id, order.id, intent.expectedVersion, 'in_progress', undefined, intent.requestId);
      startIntents.current.delete(order.id);
      await cache.invalidateQueries({ queryKey: ['maintenance-agenda', user.id, organization.id] });
      await cache.invalidateQueries({ queryKey: ['work-orders', user.id, organization.id] });
    } catch (error) {
      const code = domainError(error).code;
      setStartErrors((current) => ({ ...current, [order.id]: `Start failed: ${domainError(error).message}` }));
      if (!['DEPENDENCY_UNAVAILABLE', 'RATE_LIMITED'].includes(code)) startIntents.current.delete(order.id);
      if (code === 'CONFLICT') {
        await Promise.all([liveWorkOrders.refetch(), liveAssignments.refetch(), agenda.refetch()]);
      }
    } finally { startingRef.current = false; setStartingId(''); }
  };
  const cells = useMemo(() => {
    const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + index);
      return { date: isoDate(day), inMonth: day.getUTCMonth() === month.getUTCMonth() };
    });
  }, [month]);
  const invalidate = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['maintenance-plans', user.id, organization.id] }),
      cache.invalidateQueries({ queryKey: ['maintenance-agenda', user.id, organization.id] }),
    ]);
  };
  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1));
    setMonth(next);
    setSelectedDate(isoDate(next));
  };
  const openCreate = () => {
    if (saveIntentRef.current || savingRef.current) return;
    setFields(emptyFields(selectedDate)); setEditor({}); setAssetSearch(''); setPreview(null); setPreviewFor('');
    setPreviewError(''); setSaveError(''); setConflict(false);
  };
  const openEdit = (planId: string) => {
    if (saveIntentRef.current || savingRef.current) return;
    const plan = planRows.find((item) => item.id === planId);
    const revision = revisionByPlan.get(planId);
    if (!plan || !revision) return;
    setFields({ id: plan.id, asset_id: plan.asset_id, title: revision.title, instructions: revision.instructions, category: revision.category,
      cadence: revision.cadence, frequency: revision.frequency, anchor_on: revision.anchor_on, supervisor_id: revision.supervisor_id,
      assignee_ids: [...revision.assignee_ids], checklist: [...revision.checklist], status: plan.status });
    setEditor({ planId, version: plan.version }); setAssetSearch(''); setPreview(null); setPreviewFor('');
    setPreviewError(''); setSaveError(''); setConflict(false);
  };
  const updateFields = (next: MaintenanceFields) => { setFields(next); setPreview(null); setPreviewFor(''); setPreviewError(''); };
  const runPreview = async () => {
    setPreviewError(''); setPreview(null); setPreviewFor('');
    const parsed = maintenanceFields.safeParse(fields);
    if (!parsed.success) { setPreviewError('Complete the required fields and assignments before previewing this plan.'); return; }
    setPreviewBusy(true);
    try {
      const result = await previewMaintenancePlan(client, organization.id, parsed.data);
      setPreview(result); setPreviewFor(JSON.stringify(parsed.data));
    } catch (error) { setPreviewError(`Preview unavailable: ${domainError(error).message}`); }
    finally { setPreviewBusy(false); }
  };
  const runSave = async () => {
    const parsed = maintenanceFields.safeParse(fields);
    if (savingRef.current || !parsed.success || !preview || !preview.personnel_eligible || previewFor !== JSON.stringify(parsed.data)) return;
    const previousIntent = saveIntentRef.current;
    if (previousIntent && JSON.stringify(previousIntent.fields) !== JSON.stringify(parsed.data)) return;
    const intent = previousIntent ?? { requestId: crypto.randomUUID(), fields: structuredClone(parsed.data), expectedVersion: editor?.version };
    savingRef.current = true; saveIntentRef.current = intent; setSaveIntent(intent); setSaveBusy(true); setSaveError('');
    try {
      await saveMaintenancePlan(client, organization.id, intent.fields, intent.requestId, intent.expectedVersion);
      saveIntentRef.current = null; setSaveIntent(null); setEditor(null); setPreview(null); setPreviewFor('');
      await invalidate();
    } catch (error) {
      const code = domainError(error).code;
      setSaveError(`Save failed: ${domainError(error).message}`);
      if (code === 'CONFLICT') { setConflict(true); saveIntentRef.current = null; setSaveIntent(null); setPreview(null); setPreviewFor(''); }
      else if (!['DEPENDENCY_UNAVAILABLE', 'RATE_LIMITED'].includes(code)) { saveIntentRef.current = null; setSaveIntent(null); }
    } finally { savingRef.current = false; setSaveBusy(false); }
  };
  const retryConflictWithDraft = async () => {
    if (!editor?.planId) return;
    const refreshed = await plans.refetch();
    const current = refreshed.data?.pages.flatMap((page) => page.items).find((item) => item.id === editor.planId);
    if (!current) { setSaveError('The plan is no longer visible. Refresh the plans list before continuing.'); return; }
    setEditor({ planId: current.id, version: current.version }); setConflict(false); setSaveError('');
  };
  const discardConflictDraft = async () => {
    await plans.refetch();
    if (editor?.planId) await cache.invalidateQueries({ queryKey: ['maintenance-revisions', user.id, organization.id, role, editor.planId] });
    setEditor(null); setConflict(false); setSaveIntent(null); setSaveError(''); setPreview(null); setPreviewFor('');
  };
  const moveCalendarFocus = (date: string, days: number) => {
    const nextDate = addCalendarDays(date, days);
    setSelectedDate(nextDate);
    const next = new Date(`${nextDate}T00:00:00.000Z`);
    setMonth(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1)));
    requestAnimationFrame(() => document.getElementById(`maintenance-day-${nextDate}`)?.focus());
  };

  if (!readAllowed) return <PageHeader eyebrow="Access" title="Maintenance unavailable" description="This workspace role does not have access to maintenance plans or their schedule." />;

  return <section className="maintenance-page">
    <PageHeader eyebrow="Preventive care" title="Maintenance plans" description={`Calendar and recurring plans for ${organization.name}. Dates follow each plan’s local calendar.`} action={isCoordinator && <AppButton disabled={Boolean(saveIntent) || saveBusy} onClick={() => { setTab('plans'); openCreate(); }}>Create plan</AppButton>} />
    <div className="maintenance-tabs" role="tablist" aria-label="Maintenance views">
      <button role="tab" aria-selected={tab === 'calendar'} id="maintenance-tab-calendar" aria-controls="maintenance-panel-calendar" onClick={() => setTab('calendar')}>Calendar</button>
      <button role="tab" aria-selected={tab === 'plans'} id="maintenance-tab-plans" aria-controls="maintenance-panel-plans" onClick={() => setTab('plans')}>Plans</button>
    </div>
    {tab === 'calendar' ? <div role="tabpanel" id="maintenance-panel-calendar" aria-labelledby="maintenance-tab-calendar" className="maintenance-layout">
      <section className="maintenance-calendar" aria-label="Maintenance calendar">
        <header className="maintenance-month"><AppButton variant="secondary" aria-label="Previous month" onClick={() => shiftMonth(-1)}>←</AppButton><h2>{formatDate(bounds.from, { month: 'long', year: 'numeric' })}</h2><AppButton variant="secondary" aria-label="Next month" onClick={() => shiftMonth(1)}>→</AppButton></header>
        <div className="maintenance-grid" role="grid" aria-label={`Maintenance dates for ${formatDate(bounds.from, { month: 'long', year: 'numeric' })}`}>
          <div className="maintenance-grid-row" role="row">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span role="columnheader" className="maintenance-weekday" key={day}>{day}</span>)}</div>
          {Array.from({ length: 6 }, (_, week) => <div className="maintenance-grid-row" role="row" key={`week-${week}`}>
          {cells.slice(week * 7, week * 7 + 7).map((cell) => {
            const count = items.filter((item) => item.scheduled_local_date === cell.date).length;
            return <button id={`maintenance-day-${cell.date}`} key={cell.date} type="button" role="gridcell" tabIndex={selectedDate === cell.date ? 0 : -1} aria-label={`${formatDate(cell.date)}${count ? ', maintenance scheduled' : ''}`} aria-selected={selectedDate === cell.date} className={`maintenance-day${cell.inMonth ? '' : ' is-outside'}`} onClick={() => { setSelectedDate(cell.date); if (!cell.inMonth) { const outside = new Date(`${cell.date}T00:00:00.000Z`); setMonth(new Date(Date.UTC(outside.getUTCFullYear(), outside.getUTCMonth(), 1))); } }} onKeyDown={(event) => {
              const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
              if (event.key in moves) { event.preventDefault(); moveCalendarFocus(cell.date, moves[event.key]!); }
              if (event.key === 'Home') { event.preventDefault(); moveCalendarFocus(cell.date, -((new Date(`${cell.date}T00:00:00.000Z`).getUTCDay() + 6) % 7)); }
              if (event.key === 'End') { event.preventDefault(); moveCalendarFocus(cell.date, 6 - ((new Date(`${cell.date}T00:00:00.000Z`).getUTCDay() + 6) % 7)); }
            }}>
              <span>{Number(cell.date.slice(-2))}</span>{count > 0 && <span className="maintenance-day-mark" aria-hidden="true">•</span>}
            </button>;
          })}
          </div>)}
        </div>
        {agenda.isPending ? <LoadingNotice label="Loading authorized maintenance dates…" /> : agenda.isError ? <div><ErrorNotice>Maintenance calendar is unavailable for this workspace.</ErrorNotice><AppButton variant="secondary" onClick={() => void agenda.refetch()}>Retry</AppButton></div> : agenda.hasNextPage && <AppButton variant="secondary" disabled={agenda.isFetchingNextPage} onClick={() => void agenda.fetchNextPage()}>Load more dates</AppButton>}
      </section>
      <aside className="maintenance-agenda" aria-labelledby="maintenance-agenda-title">
        <h2 id="maintenance-agenda-title">{formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        {agenda.isPending ? <LoadingNotice label="Loading selected date and schedule summaries…" /> : agenda.isError
          ? <p role="status">Selected-date, overdue and upcoming maintenance could not be confirmed. Retry from the calendar.</p>
          : <>
        {dayItems.length ? <ul>{dayItems.map((item) => <li key={item.id}>
          <strong>{item.title}</strong><span>{item.work_status.replaceAll('_', ' ')} · {liveAssignments.isError ? 'Current assignments unavailable' : liveAssignments.data ? `${currentAssignees(item.work_order_id).length} current assignments` : 'Current assignments are being confirmed'}</span>
          <span>Due by end of {formatDate(item.scheduled_local_date)} ({item.timezone}); exclusive cutoff {formatInstant(item.due_at, item.timezone)} ({item.timezone})</span>
          {item.blocks_operation && <span className="maintenance-warning">This item blocks an operation</span>}
          <Link to={`/work-orders?workOrder=${encodeURIComponent(item.work_order_id)}`}>Open work order</Link>
          {liveWorkOrders.isError || liveAssignments.isError ? <ErrorNotice>Current work order and assignments could not be confirmed. Starting is unavailable.</ErrorNotice> : liveWorkOrders.isPending || liveAssignments.isPending ? <span role="status">Confirming current assignments…</span> : canStart(item) && <AppButton disabled={startingId === item.work_order_id} onClick={() => void runStart(item)}>{startingId === item.work_order_id ? 'Starting…' : startIntents.current.has(item.work_order_id) ? 'Retry exact Start work' : 'Start work'}</AppButton>}
          {startErrors[item.work_order_id] && <ErrorNotice>{startErrors[item.work_order_id]}</ErrorNotice>}
        </li>)}</ul> : agenda.hasNextPage ? <p className="maintenance-empty">More authorized dates remain. Load more dates to confirm this day.</p> : <p className="maintenance-empty">No maintenance is scheduled for this date.</p>}
        <section aria-labelledby="maintenance-overdue-title"><h3 id="maintenance-overdue-title">Overdue</h3>
          {overdueItems.length ? <ul>{overdueItems.slice(0, 5).map((item) => <li key={`overdue:${item.id}`}><strong>{item.title}</strong><span>Due {formatDate(item.scheduled_local_date)} · {item.work_status.replaceAll('_', ' ')}</span><button type="button" className="maintenance-date-link" onClick={() => setSelectedDate(item.scheduled_local_date)}>Review date</button></li>)}</ul> : agenda.hasNextPage ? <p className="maintenance-empty">Load more dates to check for overdue maintenance this month.</p> : <p className="maintenance-empty">No overdue maintenance in this month.</p>}
        </section>
        <section aria-labelledby="maintenance-upcoming-title"><h3 id="maintenance-upcoming-title">Upcoming</h3>
          {upcomingItems.length ? <ul>{upcomingItems.map((item) => <li key={`upcoming:${item.id}`}><strong>{item.title}</strong><span>{formatDate(item.scheduled_local_date)} · {item.work_status.replaceAll('_', ' ')}</span><button type="button" className="maintenance-date-link" onClick={() => setSelectedDate(item.scheduled_local_date)}>Review date</button></li>)}</ul> : agenda.hasNextPage ? <p className="maintenance-empty">Load more dates before confirming there is no upcoming maintenance.</p> : <p className="maintenance-empty">No upcoming maintenance is listed this month.</p>}
        </section>
        </>}
      </aside>
    </div> : <section role="tabpanel" id="maintenance-panel-plans" aria-labelledby="maintenance-tab-plans" className="maintenance-plan-list">
      {editor && <form className="maintenance-editor" onSubmit={(event) => { event.preventDefault(); void runSave(); }}>
        <div className="maintenance-editor-heading"><div><p className="page-kicker">{editor.planId ? 'Revise plan' : 'New plan'}</p><h2>{editor.planId ? 'Review the next plan revision' : 'Create a maintenance plan'}</h2></div><AppButton type="button" variant="secondary" disabled={Boolean(saveIntent) || saveBusy} onClick={() => setEditor(null)}>Close</AppButton></div>
        {(assets.isError || team.isError) && <ErrorNotice>Active assets or team roles could not be confirmed; retry before editing the plan.</ErrorNotice>}
        {currentAsset.isError && <ErrorNotice>The current plan asset could not be confirmed. Select a visible active asset before previewing.</ErrorNotice>}
        {currentAsset.isSuccess && !currentAsset.data && fields.asset_id && <p role="status">The current plan asset is no longer active or visible. Select another active asset to continue.</p>}
        {(assets.isPending || team.isPending || currentAsset.isFetching) && <LoadingNotice label="Confirming active assets and team roles…" />}
        {assets.isError && <AppButton type="button" variant="secondary" onClick={() => void assets.refetch()}>Retry active assets</AppButton>}
        {team.isError && <AppButton type="button" variant="secondary" onClick={() => void team.refetch()}>Retry active team roles</AppButton>}
        {currentAsset.isError && <AppButton type="button" variant="secondary" onClick={() => void currentAsset.refetch()}>Retry current asset</AppButton>}
        <label className="maintenance-asset-search" htmlFor="maintenance-asset-search">Search active assets<input id="maintenance-asset-search" type="search" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search by name or code" /></label>
        <fieldset disabled={Boolean(saveIntent) || saveBusy || !isCoordinator || assets.isPending || assets.isError || team.isPending || team.isError || currentAsset.isFetching}>
          <SelectField id="maintenance-asset" label="Asset" required value={fields.asset_id} onChange={(event) => updateFields({ ...fields, asset_id: event.target.value })}>
            <option value="">Choose an active asset</option>
            {fields.asset_id && !assetRows.some((asset) => asset.id === fields.asset_id) && (currentAsset.data?.id === fields.asset_id
              ? <option value={currentAsset.data.id}>{currentAsset.data.code} · {currentAsset.data.name} (current plan asset)</option>
              : <option value={fields.asset_id} disabled>{currentAsset.isFetching ? 'Loading current plan asset…' : 'Current asset unavailable · select an active asset'}</option>)}
            {assetRows.map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}
          </SelectField>
          {assets.isSuccess && assetRows.length === 0 && <p role="status">No active assets match this search.</p>}
          {assets.hasNextPage && <AppButton type="button" variant="secondary" disabled={assets.isFetchingNextPage} onClick={() => void assets.fetchNextPage()}>{assets.isFetchingNextPage ? 'Loading more assets…' : 'Load more assets'}</AppButton>}
          <Field id="maintenance-title" label="Plan title" required maxLength={200} value={fields.title} onChange={(event) => updateFields({ ...fields, title: event.target.value })} />
          <div className="form-row">
            <Field id="maintenance-category" label="Category" required maxLength={100} value={fields.category} onChange={(event) => updateFields({ ...fields, category: event.target.value })} />
            <SelectField id="maintenance-cadence" label="Repeat" value={fields.cadence} onChange={(event) => updateFields({ ...fields, cadence: event.target.value as MaintenanceFields['cadence'] })}><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option></SelectField>
            <Field id="maintenance-frequency" label="Every" type="number" min={1} max={365} required value={fields.frequency} onChange={(event) => updateFields({ ...fields, frequency: Number(event.target.value) })} />
          </div>
          <Field id="maintenance-anchor" label="First scheduled date" type="date" required value={fields.anchor_on} onChange={(event) => updateFields({ ...fields, anchor_on: event.target.value })} />
          <SelectField id="maintenance-supervisor" label="Responsible supervisor" required value={fields.supervisor_id} onChange={(event) => updateFields({ ...fields, supervisor_id: event.target.value })}>
            <option value="">Choose an active supervisor</option>{fields.supervisor_id && !team.data?.some((member) => member.active && ['owner', 'manager', 'supervisor'].includes(member.role) && member.user_id === fields.supervisor_id) && <option value={fields.supervisor_id}>Current selection is no longer eligible · {fields.supervisor_id.slice(0, 8)}</option>}{team.data?.filter((member) => member.active && ['owner', 'manager', 'supervisor'].includes(member.role)).map((member) => <option key={member.user_id} value={member.user_id}>{member.role} · {member.user_id.slice(0, 8)}</option>)}
          </SelectField>
          <fieldset className="choice-fieldset"><legend>Assigned team</legend>{fields.assignee_ids.filter((id) => !team.data?.some((member) => member.active && ['owner', 'manager', 'supervisor', 'technician'].includes(member.role) && member.user_id === id)).map((id) => <label className="choice-row" key={`previous:${id}`}><input type="checkbox" checked onChange={() => updateFields({ ...fields, assignee_ids: fields.assignee_ids.filter((assignee) => assignee !== id) })} /><span>Current assignee is no longer eligible · {id.slice(0, 8)}</span></label>)}{team.data?.filter((member) => member.active && ['owner', 'manager', 'supervisor', 'technician'].includes(member.role)).map((member) => <label className="choice-row" key={member.user_id}><input type="checkbox" checked={fields.assignee_ids.includes(member.user_id)} onChange={(event) => updateFields({ ...fields, assignee_ids: event.target.checked ? [...new Set([...fields.assignee_ids, member.user_id])] : fields.assignee_ids.filter((id) => id !== member.user_id) })} /><span>{member.role} · {member.user_id.slice(0, 8)}</span></label>)}</fieldset>
          <TextAreaField id="maintenance-instructions" label="Instructions" required maxLength={4000} value={fields.instructions} onChange={(event) => updateFields({ ...fields, instructions: event.target.value })} />
          <TextAreaField id="maintenance-checklist" label="Checklist (one item per line)" required value={fields.checklist.join('\n')} onChange={(event) => updateFields({ ...fields, checklist: event.target.value.split('\n').slice(0, 100) })} />
          <SelectField id="maintenance-status" label="Plan status" value={fields.status} onChange={(event) => updateFields({ ...fields, status: event.target.value as MaintenanceFields['status'] })}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></SelectField>
        </fieldset>
        {saveIntent && <div className="maintenance-pending" role="alert"><p>The save result is uncertain. The form is locked to its original payload and request identity.</p><AppButton type="button" disabled={saveBusy} onClick={() => void runSave()}>{saveBusy ? 'Retrying exact save…' : 'Retry exact save'}</AppButton></div>}
        {previewError && <ErrorNotice>{previewError}</ErrorNotice>}{saveError && <ErrorNotice>{saveError}</ErrorNotice>}
        {conflict && <div className="maintenance-pending" role="alert"><p>This plan changed after your draft was loaded. Review the latest version before saving.</p><div className="button-row"><AppButton type="button" onClick={() => void retryConflictWithDraft()}>Use latest version and keep my draft</AppButton><AppButton type="button" variant="secondary" onClick={() => void discardConflictDraft()}>Discard draft and load latest saved values</AppButton></div></div>}
        {preview && previewFor === JSON.stringify(maintenanceFields.safeParse(fields).success ? maintenanceFields.parse(fields) : null) && <div className="maintenance-preview" aria-live="polite"><h3>Preview</h3><p>Evaluated {formatInstant(preview.evaluated_at, preview.timezone)} ({preview.timezone}).</p><p>First new occurrence: {formatDate(preview.first_new.scheduled_local_date)}. Due by end of {formatDate(preview.first_new.scheduled_local_date)} ({preview.first_new.timezone}); exclusive cutoff {formatInstant(preview.first_new.due_at, preview.first_new.timezone)} ({preview.first_new.timezone}).</p>{preview.protected_through && <p>Existing due dates are pinned through {formatDate(preview.protected_through)} ({preview.timezone}).</p>}{preview.retained_backlog.length > 0 && <><p>Retained backlog</p><ul>{preview.retained_backlog.map((item) => <li key={`${item.revision_id}:${item.next_ordinal}`}>{formatDate(item.next_on)} due by local day end ({item.timezone}) · exclusive cutoff {formatInstant(item.due_at, item.timezone)} ({item.timezone}) · protected through {formatDate(item.protected_through)} ({item.timezone})</li>)}</ul></>}{preview.backlog_has_more && <p>More retained backlog exists beyond this preview.</p>}{!preview.personnel_eligible && <ErrorNotice>The selected people are no longer eligible. Update assignments before saving.</ErrorNotice>}</div>}
        <div className="button-row"><AppButton type="button" variant="secondary" disabled={Boolean(saveIntent) || saveBusy || previewBusy || assets.isPending || team.isPending || currentAsset.isFetching} onClick={() => void runPreview()}>{previewBusy ? 'Checking preview…' : 'Preview changes'}</AppButton><AppButton type="submit" disabled={saveBusy || Boolean(saveIntent) || !activeAssetSelected || !preview || !preview.personnel_eligible || previewFor !== JSON.stringify(maintenanceFields.safeParse(fields).success ? maintenanceFields.parse(fields) : null)}>{saveBusy ? 'Saving…' : editor.planId ? 'Save revision' : 'Create plan'}</AppButton></div>
      </form>}
      {plans.isPending ? <LoadingNotice label="Loading authorized maintenance plans…" /> : plans.isError ? <div><ErrorNotice>Maintenance plans are unavailable for this workspace.</ErrorNotice><AppButton variant="secondary" onClick={() => void plans.refetch()}>Retry</AppButton></div> : planRows.length ? <ul>{planRows.map((plan, index) => {
        const revision = revisionByPlan.get(plan.id);
        const revisionQuery = revisions[index];
        const showBacklog = backlogPlanId === plan.id;
        return <li key={plan.id}>
          <div><h2>{revision?.title ?? `Plan ${plan.id.slice(0, 8)}`}</h2><p>{revision ? `${revision.cadence} · every ${revision.frequency} · next from ${formatDate(revision.anchor_on)}` : 'Current revision details are loading.'}</p></div>
          <span className={`maintenance-state maintenance-state--${plan.status}`}>{plan.status}</span>
          {plan.generation_blocked && <span className="maintenance-warning">Last recorded generation blocker: {plan.generation_blocked.replaceAll('_', ' ')} · checked {plan.last_checked_at ? `${formatInstant(plan.last_checked_at, revision?.timezone ?? organization.timezone)} (${revision?.timezone ?? organization.timezone})` : 'check time unavailable'}</span>}
          {revisionQuery?.isError && <div role="alert"><ErrorNotice>Current revision could not be loaded through the bounded revision history.</ErrorNotice><AppButton variant="secondary" onClick={() => void revisionQuery.refetch()}>Retry current revision</AppButton></div>}
          <div className="button-row">{isCoordinator && <AppButton variant="secondary" disabled={!revision || revisionQuery?.isFetching || Boolean(saveIntent) || saveBusy} onClick={() => openEdit(plan.id)}>Edit plan</AppButton>}<AppButton variant="secondary" onClick={() => setBacklogPlanId(showBacklog ? null : plan.id)}>{showBacklog ? 'Hide retained backlog' : 'View retained backlog'}</AppButton></div>
          {showBacklog && <section className="maintenance-backlog" aria-label="Retained maintenance backlog">
            {backlog.isPending ? <LoadingNotice label="Loading retained backlog…" /> : backlog.isError ? <><ErrorNotice>Retained backlog is unavailable.</ErrorNotice><AppButton variant="secondary" onClick={() => void backlog.refetch()}>Retry backlog</AppButton></> : <>
              {backlog.data?.pages[0] && <p>Backlog evaluated {formatInstant(backlog.data.pages[0].evaluated_at, organization.timezone)} ({organization.timezone}). Persisted plan status: {backlog.data.pages[0].status}. {backlog.data.pages[0].last_checked_at ? `Last generation check: ${formatInstant(backlog.data.pages[0].last_checked_at, organization.timezone)} (${organization.timezone}).` : 'No generation check time is recorded.'}{backlog.data.pages[0].generation_blocked ? ` Last recorded blocker: ${backlog.data.pages[0].generation_blocked.replaceAll('_', ' ')}.` : ' No blocker was recorded at the last check.'}</p>}
              {backlog.data?.pages.flatMap((page) => page.items).length ? <ul>{backlog.data.pages.flatMap((page) => page.items).map((item) => <li key={`${item.revision_id}:${item.next_ordinal}`}>{formatDate(item.next_on)} due by local day end ({item.timezone}) · exclusive cutoff {formatInstant(item.due_at, item.timezone)} ({item.timezone}) · protected through {item.protected_through ? `${formatDate(item.protected_through)} (${item.timezone})` : 'not pinned'}</li>)}</ul> : <p className="maintenance-empty">No retained backlog is available.</p>}
              {backlog.hasNextPage && <AppButton variant="secondary" disabled={backlog.isFetchingNextPage} onClick={() => void backlog.fetchNextPage()}>Load more backlog</AppButton>}
            </>}
          </section>}
        </li>;
      })}</ul> : <p className="maintenance-empty">No maintenance plans are visible in this workspace.</p>}
      {plans.hasNextPage && <AppButton variant="secondary" disabled={plans.isFetchingNextPage} onClick={() => void plans.fetchNextPage()}>Load more plans</AppButton>}
      <AppButton variant="secondary" onClick={() => void invalidate()}>Refresh maintenance</AppButton>
    </section>}
  </section>;
}
