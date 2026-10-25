import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { attachmentRecord, operationalWorkOrder, teamResult, workOrderEvent, workOrderReview, workOrderTask, performerDeclaration, submissionAttestation } from '../contracts/operational';
import { domainError } from '../lib/domain-errors';
import type { Json } from '../lib/database.types';
import { addWorkOrderTask, assignWorkOrder, createWorkOrder, declareWorkOrderPerformers, reviewWorkOrder, scheduleWorkOrder, submitWorkOrder, transitionWorkOrder, updateWorkOrder } from './commands';
import { readBoundedRows, recordFilter, recordPageSize, splitRecordPage, type RecordCursor } from './record-query';
import { PrivilegedArea } from './auth/security';
import { PrivateImage, reserveWorkOrderImage, uploadPrivateImage } from './private-attachments';
import { getJobParts, listRequestableJobParts, requestParts } from './inventory-client';
import type { RequestPartsFields } from '../contracts/inventory';
import { useWorkspace } from './workspace';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, SuccessNotice, TextAreaField } from './ui';

const assignmentRows = z.array(z.strictObject({ user_id: z.uuid(), unassigned_at: z.string().nullable() })).max(30);
const boardAssignmentRow = z.strictObject({ id: z.uuid(), work_order_id: z.uuid(), user_id: z.uuid() });
const boardReadPageSize = 100;
const boardAssignmentLimit = 2500;
const participantRows = z.array(z.strictObject({ user_id: z.uuid(), source: z.string(), recorded_at: z.string() })).max(1000);
const taskRows = z.array(workOrderTask).max(100);
const eventRows = z.array(workOrderEvent).max(500);
const reviewRows = z.array(workOrderReview).max(100);
const declarationRows = z.array(performerDeclaration).max(100);
const attestationRows = z.array(submissionAttestation).max(100);
const readyAttachments = z.array(attachmentRecord).max(10);
const assetSummary = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string(), availability: z.enum(['operational', 'under_maintenance', 'out_of_service', 'pending_release']), archived_at: z.string().nullable() });
const createAssetRows = z.array(z.strictObject({ id: z.uuid(), code: z.string(), name: z.string(), created_at: z.string(), archived_at: z.string().nullable() })).max(recordPageSize + 1);
const evidenceSettings = z.strictObject({ evidence_required: z.boolean() });
const stockQuantityPattern = '(?:0|[1-9][0-9]{0,10})(?:\\.[0-9]{1,3})?';
const workOrderLanes = [
  { id: 'open', label: 'Open', statuses: ['draft', 'open', 'scheduled'] },
  { id: 'in-progress', label: 'In progress', statuses: ['in_progress'] },
  { id: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { id: 'review', label: 'Awaiting review', statuses: ['awaiting_review'] },
] as const;

function parseRpc<T extends z.ZodType>(data: Json | null, error: { message: string } | null, schema: T): z.output<T> {
  if (error) throw new Error(domainError(error).code);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}

function isAmbiguous(code: string) { return code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED'; }
function workOrderLabel(number: number) { return `WO-${String(number).padStart(4, '0')}`; }
function pageDate() {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}
function displayPlannedDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}
function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function decimalMilli(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

type Intent = { id: string; execute: (id: string) => Promise<unknown>; success: string };
type UploadIntent = { id: string; file: File; attachment: z.output<typeof attachmentRecord> | null };

export function OperationalWorkOrderPage() {
  const { client, user, organization, role } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const isCoordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assetFilter, setAssetFilter] = useState('all');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [performerSelection, setPerformerSelection] = useState<{ key: string; ids: string[] } | null>(null);
  const [assignmentSelection, setAssignmentSelection] = useState<{ workOrderId: string; ids: string[] } | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [notices, setNotices] = useState<Record<string, { error?: string; success?: string }>>({});
  const [resolvedIntent, setResolvedIntent] = useState<{ key: string; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('create') === '1');
  const [createAssetSearch, setCreateAssetSearch] = useState('');
  const [createFields, setCreateFields] = useState({ assetId: '', title: '', description: '', category: '', priority: 'normal' as 'low' | 'normal' | 'high' | 'critical', criticalReason: '' });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createIntent, setCreateIntent] = useState<{ id: string; values: typeof createFields } | null>(null);
  const [partsDraft, setPartsDraft] = useState<{ workOrderId: string; partId: string; quantity: string } | null>(null);
  const intents = useRef(new Map<string, Intent>());
  const uploadIntents = useRef(new Map<string, UploadIntent>());
  const [, redrawUploads] = useState(0);
  const workOrdersKey = ['work-orders', user.id, organization.id] as const;
  const queryKey = [...workOrdersKey, search.trim(), statusFilter] as const;
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      const numberSearch = search.trim().match(/^(?:WO[-\s]?)?0*(\d{1,10})$/i);
      const exact = numberSearch ? [`number.eq.${Number(numberSearch[1])}`] : [];
      const filter = recordFilter(['title', 'category'], search.trim(), pageParam, exact);
      let workOrderQuery = client.from('work_orders').select('*').eq('organization_id', organization.id);
      if (statusFilter !== 'all') workOrderQuery = workOrderQuery.eq('status', statusFilter);
      const result = await workOrderQuery.or(filter ?? 'id.not.is.null').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(recordPageSize + 1).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return splitRecordPage(z.array(operationalWorkOrder).max(recordPageSize + 1).parse(result.data ?? []));
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
  const linkedId = searchParams.get('workOrder');
  const listTarget = list.data?.pages.flatMap((page) => page.rows).find((workOrder) => workOrder.id === linkedId);
  const linkedTarget = useQuery({
    queryKey: ['work-order-target', user.id, organization.id, linkedId],
    enabled: Boolean(linkedId && !listTarget),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_orders').select('*').eq('organization_id', organization.id).eq('id', linkedId!).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ? operationalWorkOrder.parse(result.data) : null;
    },
  });
  const createAssets = useInfiniteQuery({
    queryKey: ['work-order-create-assets', user.id, organization.id, createAssetSearch.trim()], enabled: isCoordinator && createOpen,
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      const filter = recordFilter(['code', 'name'], createAssetSearch.trim(), pageParam);
      const result = await client.from('assets').select('id,code,name,created_at,archived_at').eq('organization_id', organization.id).is('archived_at', null)
        .or(filter ?? 'id.not.is.null').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(recordPageSize + 1).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return splitRecordPage(createAssetRows.parse((result.data ?? []).slice(0, recordPageSize + 1)));
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
  const workOrderRows = list.data?.pages.flatMap((page) => page.rows) ?? [];
  const createAssetRowsList = createAssets.data?.pages.flatMap((page) => page.rows) ?? [];
  const boardAssetIds = [...new Set(workOrderRows.map((workOrder) => workOrder.asset_id))];
  const boardAssets = useQuery({
    queryKey: ['work-order-board-assets', user.id, organization.id, boardAssetIds], enabled: boardAssetIds.length > 0,
    queryFn: async ({ signal }) => {
      const rows: z.output<typeof assetSummary>[] = [];
      for (let offset = 0; offset < boardAssetIds.length; offset += boardReadPageSize) {
        const ids = boardAssetIds.slice(offset, offset + boardReadPageSize);
        const result = await client.from('assets').select('id,code,name,availability,archived_at').eq('organization_id', organization.id).in('id', ids).abortSignal(signal);
        if (result.error) throw new Error(domainError(result.error).code);
        const page = z.array(assetSummary).max(ids.length).safeParse(result.data ?? []);
        if (!page.success) throw new Error('DEPENDENCY_UNAVAILABLE');
        rows.push(...page.data);
      }
      return rows;
    },
  });
  const boardAssetsById = new Map((boardAssets.data ?? []).map((asset) => [asset.id, asset]));
  const boardAssignments = useQuery({
    queryKey: ['work-order-board-assignments', user.id, organization.id, workOrderRows.map((workOrder) => workOrder.id)],
    enabled: workOrderRows.length > 0,
    queryFn: async ({ signal }) => readBoundedRows(async (cursor) => {
      let query = client.from('work_order_assignments').select('id,work_order_id,user_id')
        .eq('organization_id', organization.id).in('work_order_id', workOrderRows.map((workOrder) => workOrder.id))
        .is('unassigned_at', null).order('id', { ascending: true }).limit(boardReadPageSize);
      if (cursor) query = query.gt('id', cursor);
      const result = await query.abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const page = z.array(boardAssignmentRow).max(boardReadPageSize).safeParse(result.data ?? []);
      if (!page.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return page.data;
    }, boardReadPageSize, boardAssignmentLimit),
  });
  const assigneesByWorkOrder = new Map<string, Set<string>>();
  for (const assignment of boardAssignments.data ?? []) {
    const ids = assigneesByWorkOrder.get(assignment.work_order_id) ?? new Set<string>();
    ids.add(assignment.user_id);
    assigneesByWorkOrder.set(assignment.work_order_id, ids);
  }
  const assigneeIdsForOrder = (workOrderId: string) => [...(assigneesByWorkOrder.get(workOrderId) ?? [])].sort();
  const assigneeIds = [...new Set((boardAssignments.data ?? []).map((assignment) => assignment.user_id))].sort();
  const assigneeLabel = (id: string) => {
    if (id === user.id) return 'You';
    const member = team.data?.find((item) => item.user_id === id);
    return `${member?.role ? member.role.replaceAll('_', ' ') : 'Account'} · ${id.slice(0, 8)}`;
  };
  const visible = workOrderRows.filter((workOrder) =>
    (priorityFilter === 'all' || workOrder.priority === priorityFilter)
    && (assetFilter === 'all' || workOrder.asset_id === assetFilter)
    && (assigneeFilter === 'all' || assigneesByWorkOrder.get(workOrder.id)?.has(assigneeFilter) === true));
  const boardFiltersActive = assigneeFilter !== 'all' || priorityFilter !== 'all' || assetFilter !== 'all';
  const selected = linkedId ? listTarget ?? linkedTarget.data ?? undefined : visible[0];
  const selectedId = selected?.id ?? null;
  const select = (id: string) => { setDetailsOpen(true); setSearchParams({ workOrder: id }); };
  const selectedDetailsOpen = detailsOpen || Boolean(linkedId);
  const closeDetails = () => {
    setDetailsOpen(false);
    if (linkedId) {
      const next = new URLSearchParams(searchParams);
      next.delete('workOrder');
      setSearchParams(next, { replace: true });
    }
  };
  const detailsKey = ['work-order-detail', user.id, organization.id, selectedId] as const;
  const asset = useQuery({
    queryKey: ['work-order-asset', user.id, organization.id, selected?.asset_id ?? null], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('id,code,name,availability,archived_at').eq('organization_id', organization.id).eq('id', selected!.asset_id).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ? assetSummary.parse(result.data) : null;
    },
  });
  const assignments = useQuery({
    queryKey: ['work-order-assignments', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_assignments').select('user_id,unassigned_at').eq('organization_id', organization.id).eq('work_order_id', selected!.id).is('unassigned_at', null).order('id', { ascending: true }).limit(30).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return assignmentRows.parse(result.data ?? []);
    },
  });
  const canReadSelectedParts = Boolean(selected && (isCoordinator || role === 'technician' && assignments.data?.some((assignment) => assignment.user_id === user.id && assignment.unassigned_at === null)));
  const jobParts = useQuery({
    queryKey: ['work-order-parts', user.id, organization.id, selectedId],
    enabled: canReadSelectedParts,
    queryFn: ({ signal }) => getJobParts(client, organization.id, selected!.id, signal),
  });
  const canRequestParts = Boolean(selected && role === 'technician' && selected.status === 'in_progress' && assignments.data?.some((assignment) => assignment.user_id === user.id && assignment.unassigned_at === null));
  const requestableParts = useInfiniteQuery({
    queryKey: ['work-order-requestable-parts', user.id, organization.id, selectedId],
    enabled: canRequestParts,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => listRequestableJobParts(client, organization.id, selected!.id, { cursor: pageParam ?? undefined, page_size: 25 }, signal),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
  const team = useQuery({
    queryKey: ['work-order-team', user.id, organization.id], enabled: isCoordinator,
    queryFn: async ({ signal }) => {
      const result = await client.rpc('get_team', { organization_id: organization.id }).abortSignal(signal);
      return parseRpc(result.data, result.error, teamResult);
    },
  });
  const tasks = useQuery({
    queryKey: ['work-order-tasks', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_tasks').select('*').eq('organization_id', organization.id).eq('work_order_id', selected!.id).order('id').abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return taskRows.parse(result.data ?? []);
    },
  });
  const events = useQuery({
    queryKey: ['work-order-events', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_events').select('*').eq('organization_id', organization.id).eq('work_order_id', selected!.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return eventRows.parse(result.data ?? []);
    },
  });
  const reviews = useQuery({
    queryKey: ['work-order-reviews', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_reviews').select('*').eq('organization_id', organization.id).eq('work_order_id', selected!.id).order('created_at', { ascending: false }).limit(50).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return reviewRows.parse(result.data ?? []);
    },
  });
  const participants = useQuery({
    queryKey: ['work-order-participants', user.id, organization.id, selectedId], enabled: Boolean(selected && isCoordinator && selected.status === 'awaiting_review'),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_participants').select('user_id,source,recorded_at').eq('organization_id', organization.id).eq('work_order_id', selected!.id).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return participantRows.parse(result.data ?? []);
    },
  });
  const declarations = useQuery({
    queryKey: ['work-order-performers', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_performer_declarations').select('*').eq('organization_id', organization.id).eq('work_order_id', selected!.id).order('created_at').abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return declarationRows.parse(result.data ?? []);
    },
  });
  const attestations = useQuery({
    queryKey: ['work-order-attestations', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_submission_attestations').select('*').eq('organization_id', organization.id).eq('work_order_id', selected!.id).order('created_at', { ascending: false }).limit(50).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return attestationRows.parse(result.data ?? []);
    },
  });
  const attachments = useQuery({
    queryKey: ['work-order-attachments', user.id, organization.id, selectedId], enabled: Boolean(selected),
    queryFn: async ({ signal }) => {
      const result = await client.from('attachments').select('*').eq('organization_id', organization.id).eq('work_order_id', selected!.id).eq('status', 'ready').order('created_at').abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return readyAttachments.parse(result.data ?? []);
    },
  });
  const settings = useQuery({
    queryKey: ['repair-evidence-policy', user.id, organization.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('organization_settings').select('evidence_required').eq('organization_id', organization.id).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ? evidenceSettings.parse(result.data) : null;
    },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workOrdersKey }), queryClient.invalidateQueries({ queryKey: detailsKey }),
      ...(linkedId ? [queryClient.invalidateQueries({ queryKey: ['work-order-target', user.id, organization.id, linkedId] })] : []),
      queryClient.invalidateQueries({ queryKey: ['work-order-assignments', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-tasks', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-parts', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-requestable-parts', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-events', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-reviews', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-participants', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-performers', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-attestations', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['work-order-attachments', user.id, organization.id, selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['assets', user.id, organization.id] }),
      queryClient.invalidateQueries({ queryKey: ['operational-dashboard', user.id, organization.id] }),
    ]);
  };
  const run = async (key: string, execute: (requestId: string) => Promise<unknown>, success: string) => {
    const existing = intents.current.get(key);
    const otherPending = selected && [...intents.current.keys()].find((other) => other !== key && other.split(':')[1] === selected.id);
    if (otherPending) return;
    const intent = existing ?? { id: crypto.randomUUID(), execute, success };
    if (!existing) intents.current.set(key, intent);
    setResolvedIntent(null);
    setBusyKey(key); setNotices((current) => ({ ...current, [key]: {} }));
    try {
      await intent.execute(intent.id);
      intents.current.delete(key);
      setNotices((current) => ({ ...current, [key]: { success: intent.success } }));
      setResolvedIntent({ key, message: intent.success });
      await invalidate();
    } catch (cause) {
      const code = domainError(cause).code;
      setNotices((current) => ({ ...current, [key]: { error: `${domainError(cause).message}${code === 'CONFLICT' ? ' The current record was refreshed; review its new version before trying again.' : isAmbiguous(code) ? ' Retry repeats the exact same request and values.' : ''}` } }));
      if (!isAmbiguous(code)) intents.current.delete(key);
      if (code === 'CONFLICT') await invalidate();
    } finally { setBusyKey(''); }
  };
  const runTransition = (target: Parameters<typeof transitionWorkOrder>[4], reason?: string) => {
    if (!selected) return;
    const key = `transition:${selected.id}:${target}`;
    const success = selected.status === 'completed' && target === 'in_progress'
      ? 'Work order reopened. Its repair revision advanced and must be submitted for independent review again.'
      : `Work order ${target.replaceAll('_', ' ')} recorded.`;
    void run(key, (requestId) => transitionWorkOrder(client, organization.id, selected.id, selected.version, target, reason, requestId), success);
  };
  const submitPartsRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !selectedRequestablePart || !currentPartsDraft?.quantity.trim()) return;
    const fields: RequestPartsFields = { work_order_id: selected.id, lines: [{ part_id: selectedRequestablePart.id, quantity: currentPartsDraft.quantity.trim(), unit: selectedRequestablePart.unit }] };
    const workOrder = selected;
    void run(partsRequestKey, (requestId) => requestParts(client, organization.id, fields, requestId, workOrder.version), 'Parts request recorded. Review the latest shortage before resuming work.');
  };
  const fieldOr = (key: string, fallback: string) => Object.hasOwn(formValues, `${selectedId}:${key}`) ? field(key) : fallback;
  const runSchedule = () => {
    if (!selected) return;
    const plannedOn = fieldOr('planned-on', selected.planned_on ?? '').trim();
    const reason = field('transition-reason').trim();
    const key = `schedule:${selected.id}`;
    if (!plannedOn || selected.status === 'blocked' && !reason) {
      setNotices((current) => ({ ...current, [key]: { error: selected.status === 'blocked' && !reason ? 'Enter a reason before rescheduling blocked work.' : 'Choose a planned date before scheduling.' } }));
      return;
    }
    void run(key, (requestId) => scheduleWorkOrder(client, organization.id, selected.id, selected.version, plannedOn, reason || undefined, requestId), 'Planned work date and scheduled status recorded.');
  };
  const saveAdministrativeEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const title = fieldOr('admin-title', selected.title);
    const description = fieldOr('admin-description', selected.description);
    const category = fieldOr('admin-category', selected.category);
    const priority = fieldOr('admin-priority', selected.priority) as typeof selected.priority;
    const priorityReason = fieldOr('admin-priority-reason', selected.priority_reason ?? '').trim();
    const supervisorId = fieldOr('admin-supervisor', selected.supervisor_id);
    const dueDateTime = fieldOr('admin-due-at', localDateTime(selected.due_at));
    const fields: { title?: string; description?: string; category?: string; priority?: typeof selected.priority; priority_reason?: string; due_at?: string | null; supervisor_id?: string } = {};
    if (['draft', 'open', 'scheduled', 'in_progress'].includes(selected.status)) {
      if (title !== selected.title) fields.title = title.trim();
      if (description !== selected.description) fields.description = description.trim();
    }
    if (category !== selected.category) fields.category = category.trim();
    if (priority !== selected.priority) fields.priority = priority;
    if (priority === 'critical' && (priority !== selected.priority || priorityReason !== (selected.priority_reason ?? ''))) {
      fields.priority = 'critical';
      fields.priority_reason = priorityReason;
    }
    if (supervisorId !== selected.supervisor_id) fields.supervisor_id = supervisorId;
    let dueAt: string | null = null;
    try { dueAt = dueDateTime ? new Date(dueDateTime).toISOString() : null; }
    catch { setNotices((current) => ({ ...current, [`admin:${selected.id}`]: { error: 'Enter a valid due date and time.' } })); return; }
    if (dueAt !== selected.due_at) fields.due_at = dueAt;
    if (!Object.keys(fields).length) {
      setNotices((current) => ({ ...current, [`admin:${selected.id}`]: { error: 'No administrative fields have changed.' } }));
      return;
    }
    if (priority === 'critical' && (fields.priority === 'critical' || fields.priority_reason !== undefined) && !priorityReason) {
      setNotices((current) => ({ ...current, [`admin:${selected.id}`]: { error: 'Enter the required reason for critical priority.' } }));
      return;
    }
    const key = `admin:${selected.id}`;
    void run(key, (requestId) => updateWorkOrder(client, organization.id, selected.id, selected.version, fields, requestId), 'Administrative work order changes recorded.');
  };
  const runRepairUpdate = (fields: { note?: string; labor_minutes?: number; task_id?: string; task_completed?: boolean; title?: string; description?: string }) => {
    if (!selected) return;
    const key = fields.task_id ? `task:${selected.id}:${fields.task_id}` : `repair:${selected.id}`;
    void run(key, (requestId) => updateWorkOrder(client, organization.id, selected.id, selected.version, fields, requestId), fields.task_id ? 'Checklist updated.' : 'Repair update recorded.');
  };
  const field = (key: string) => formValues[`${selectedId}:${key}`] ?? '';
  const setField = (key: string, value: string) => setFormValues((current) => ({ ...current, [`${selectedId}:${key}`]: value }));
  const selectedActiveAssignments = (assignments.data ?? []).filter((row) => row.unassigned_at === null).map((row) => row.user_id);
  const selectedAssignments = assignmentSelection?.workOrderId === selectedId ? assignmentSelection.ids : selectedActiveAssignments;
  const currentPerformerKey = selected ? `${selected.id}:${selected.repair_revision}` : '';
  const selectedPerformers = performerSelection?.key === currentPerformerKey ? performerSelection.ids : [];
  const canWork = Boolean(selected && selected.status === 'in_progress' && (isCoordinator || selectedActiveAssignments.includes(user.id)));
  const requestableRows = requestableParts.data?.pages.flatMap((page) => page.items) ?? [];
  const requestableById = new Map(requestableRows.map((part) => [part.id, part]));
  const currentPartsDraft = selected && partsDraft?.workOrderId === selected.id ? partsDraft : null;
  const selectedRequestableId = currentPartsDraft?.partId || requestableRows[0]?.id || '';
  const selectedRequestablePart = requestableById.get(selectedRequestableId);
  const partsRequestKey = selected ? `parts-request:${selected.id}` : '';
  const selectedJobParts = jobParts.data;
  const materialsReadyForResume = Boolean(selected && selectedJobParts
    && selectedJobParts.id === selected.id && selectedJobParts.version === selected.version
    && selectedJobParts.reconciliation_state === 'consistent'
    && selectedJobParts.parts.every((part) => decimalMilli(part.shortage) === 0n));
  const resumeBlockedByParts = Boolean(selected?.status === 'blocked' && (jobParts.isPending || jobParts.isError || !materialsReadyForResume));
  const uploadIntent = selectedId ? uploadIntents.current.get(selectedId) : undefined;
  const currentRevisionDeclaration = selected && (events.data ?? []).find((event) => event.action === 'declare_work_order_performers' && event.repair_revision === selected.repair_revision);
  const declaredAtCurrentRevision = Boolean(currentRevisionDeclaration?.changes.performer_ids?.includes(user.id));
  const selectedIntentEntry = selected ? [...intents.current.entries()].find(([key]) => key.split(':')[1] === selected.id) : undefined;
  const intentLocked = Boolean(selectedIntentEntry);
  const partsRequestPending = Boolean(partsRequestKey && intents.current.has(partsRequestKey));
  const partsRequestOtherIntentLocked = intentLocked && !partsRequestPending;
  const pendingTransition = selected && ['open', 'scheduled', 'in_progress', 'blocked'].some((target) => intents.current.has(`transition:${selected.id}:${target}`));
  const transitionLocked = (target: string) => intentLocked || Boolean(selected && busyKey !== '' && busyKey !== `transition:${selected.id}:${target}`)
    || Boolean(selected && ['open', 'scheduled', 'in_progress', 'blocked'].some((other) => other !== target && intents.current.has(`transition:${selected.id}:${other}`)));
  const pendingReviewApproval = Boolean(selected && intents.current.has(`review:${selected.id}:approved`));
  const pendingReviewReturn = Boolean(selected && intents.current.has(`review:${selected.id}:returned`));
  const requiredTasksDone = (tasks.data ?? []).every((task) => !task.required || task.completed);
  const evidencePresent = !settings.data?.evidence_required || (attachments.data?.length ?? 0) > 0;
  const reviewIneligible = (participants.data ?? []).some((participant) => participant.user_id === user.id);
  const uploadFile = (file: File | undefined) => {
    if (!selected || !file) return;
    try {
      const existing = uploadIntents.current.get(selected.id);
      if (existing) return;
      uploadIntents.current.set(selected.id, { id: crypto.randomUUID(), file, attachment: null });
      redrawUploads((n) => n + 1);
      setNotices((current) => ({ ...current, upload: {} }));
    } catch (cause) { setNotices((current) => ({ ...current, upload: { error: domainError(cause).message } })); }
  };
  const performUpload = async () => {
    if (!selected || !uploadIntent) return;
    setBusyKey('upload'); setNotices((current) => ({ ...current, upload: {} }));
    try {
      if (!uploadIntent.attachment) {
        const attachment = await reserveWorkOrderImage(client, organization.id, selected.id, uploadIntent.file, uploadIntent.id);
        uploadIntent.attachment = attachment;
        redrawUploads((n) => n + 1);
      }
      await uploadPrivateImage(client, organization.id, uploadIntent.attachment.id, uploadIntent.file);
      uploadIntents.current.delete(selected.id); redrawUploads((n) => n + 1);
      setNotices((current) => ({ ...current, upload: { success: 'Private image uploaded and validated.' } }));
      await invalidate();
    } catch (cause) {
      const code = domainError(cause).code;
      setNotices((current) => ({ ...current, upload: { error: `${domainError(cause).message}${isAmbiguous(code) ? ' Retry keeps the reservation request and attachment ID.' : ''}` } }));
      if (!isAmbiguous(code) && !uploadIntent.attachment) uploadIntents.current.delete(selected.id);
      redrawUploads((n) => n + 1);
    } finally { setBusyKey(''); }
  };
  const submitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const value = field('note').trim();
    const labor = field('labor').trim();
    const minutes = labor ? Number(labor) : undefined;
    if (!value && minutes === undefined) { setNotices((current) => ({ ...current, repair: { error: 'Enter a repair note, labor minutes, or both.' } })); return; }
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) { setNotices((current) => ({ ...current, repair: { error: 'Labor must be a whole number from 0 to 1,440 minutes.' } })); return; }
    runRepairUpdate({ ...(value ? { note: value } : {}), ...(minutes === undefined ? {} : { labor_minutes: minutes }) });
  };
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const label = field('new-task').trim();
    const key = `add-task:${selected.id}`;
    void run(key, (requestId) => addWorkOrderTask(client, organization.id, selected.id, selected.version, label, true, requestId), 'Required task added to the repair record.');
  };
  const assign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const key = `assign:${selected.id}`;
    const ids = [...new Set(selectedAssignments)];
    void run(key, (requestId) => assignWorkOrder(client, organization.id, selected.id, selected.version, ids, requestId), 'Assignments recorded.');
  };
  const declarePerformers = () => {
    if (!selected) return;
    const ids = [...new Set(selectedPerformers)];
    const key = `performers:${selected.id}`;
    void run(key, (requestId) => declareWorkOrderPerformers(client, organization.id, selected.id, selected.version, ids, requestId), 'Performer declaration recorded for this repair revision.');
  };
  const submitRepair = () => {
    if (!selected) return;
    const acknowledgment = field('acknowledgment').trim();
    const key = `submit:${selected.id}`;
    void run(key, (requestId) => submitWorkOrder(client, organization.id, selected.id, selected.version, acknowledgment, requestId), 'Repair submitted for independent review.');
  };
  const review = (decision: 'approved' | 'returned') => {
    if (!selected) return;
    const reason = field('review-reason').trim();
    const key = `review:${selected.id}:${decision}`;
    void run(key, (requestId) => reviewWorkOrder(client, organization.id, selected.id, selected.version, decision, reason, requestId), decision === 'approved' ? 'Repair approved. Asset release remains a separate recorded action.' : 'Repair returned for correction.');
  };
  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const existing = createIntent;
    const values = existing?.values ?? createFields;
    const intent = existing ?? { id: crypto.randomUUID(), values };
    setCreateIntent(intent); setCreateBusy(true); setCreateError('');
    try {
      if (values.priority === 'critical' && !values.criticalReason.trim()) throw new Error('VALIDATION');
      const created = await createWorkOrder(client, organization.id, values.assetId, {
        title: values.title, description: values.description, category: values.category, priority: values.priority,
        ...(values.priority === 'critical' ? { critical_reason: values.criticalReason.trim() } : {}), supervisor_id: user.id,
      }, intent.id);
      setCreateIntent(null); setCreateOpen(false);
      setCreateFields({ assetId: '', title: '', description: '', category: '', priority: 'normal', criticalReason: '' });
      await queryClient.invalidateQueries({ queryKey: workOrdersKey });
      setSearchParams({ workOrder: created.id });
      await queryClient.fetchQuery({
        queryKey: ['work-order-target', user.id, organization.id, created.id],
        queryFn: async ({ signal }) => {
          const result = await client.from('work_orders').select('*').eq('organization_id', organization.id).eq('id', created.id).abortSignal(signal).maybeSingle();
          if (result.error) throw new Error(domainError(result.error).code);
          if (!result.data) throw new Error('NOT_FOUND');
          return operationalWorkOrder.parse(result.data);
        },
      });
    } catch (cause) {
      const code = domainError(cause).code;
      setCreateError(`${code === 'VALIDATION' ? 'Enter a reason before creating a critical-priority work order.' : domainError(cause).message}${isAmbiguous(code) ? ' Retry repeats this exact request and values.' : ''}`);
      if (!isAmbiguous(code)) setCreateIntent(null);
    } finally { setCreateBusy(false); }
  };

  return <>
    <PageHeader eyebrow="Maintenance planning" title="Work orders" description={pageDate()} action={isCoordinator && <AppButton disabled={Boolean(createIntent)} onClick={() => { setCreateOpen((open) => !open); if (!createIntent) setCreateError(''); }}>{createOpen ? createIntent ? 'Pending create · retry below' : 'Close create form' : 'Create work order'}</AppButton>} />
    {createOpen && isCoordinator && <section className="panel" aria-label="Create a work order"><h2>Create a work order</h2><p className="field-hint">Creates a draft only. Assignment and repair progress are separate recorded actions.</p>{createError && <ErrorNotice>{createError}</ErrorNotice>}<form className="form-stack" onSubmit={(event) => void createDraft(event)}>
      <Field id="create-work-order-asset-search" label="Find active assets" type="search" placeholder="Code or name" disabled={createBusy || Boolean(createIntent)} value={createAssetSearch} onChange={(event) => setCreateAssetSearch(event.target.value)} />
      <SelectField id="create-work-order-asset" label="Asset" required disabled={createBusy || Boolean(createIntent) || createAssets.isPending || createAssets.isError} value={createFields.assetId} onChange={(event) => setCreateFields((current) => ({ ...current, assetId: event.target.value }))}><option value="">Choose an active asset</option>{createAssetRowsList.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField>
      {createAssets.isPending && <LoadingNotice label="Loading active assets…" />}{createAssets.isError && <ErrorNotice>Active assets could not be confirmed. Retry after checking your workspace access.</ErrorNotice>}{createAssetRowsList.length === 0 && !createAssets.isPending && <p className="field-hint">No active assets match this search.</p>}{createAssets.hasNextPage && <AppButton type="button" variant="secondary" disabled={createAssets.isFetchingNextPage || Boolean(createIntent)} onClick={() => void createAssets.fetchNextPage()}>{createAssets.isFetchingNextPage ? 'Loading more active assets…' : 'Load more active assets'}</AppButton>}
      <Field id="create-work-order-title" label="Title" required maxLength={200} disabled={createBusy || Boolean(createIntent)} value={createFields.title} onChange={(event) => setCreateFields((current) => ({ ...current, title: event.target.value }))} />
      <TextAreaField id="create-work-order-description" label="Description" required maxLength={4000} disabled={createBusy || Boolean(createIntent)} value={createFields.description} onChange={(event) => setCreateFields((current) => ({ ...current, description: event.target.value }))} />
      <div className="form-row"><Field id="create-work-order-category" label="Category" required maxLength={100} disabled={createBusy || Boolean(createIntent)} value={createFields.category} onChange={(event) => setCreateFields((current) => ({ ...current, category: event.target.value }))} /><SelectField id="create-work-order-priority" label="Priority" disabled={createBusy || Boolean(createIntent)} value={createFields.priority} onChange={(event) => setCreateFields((current) => ({ ...current, priority: event.target.value as typeof createFields.priority }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></SelectField></div>
      {createFields.priority === 'critical' && <TextAreaField id="create-work-order-critical-reason" label="Critical priority reason" required maxLength={2000} disabled={createBusy || Boolean(createIntent)} value={createFields.criticalReason} onChange={(event) => setCreateFields((current) => ({ ...current, criticalReason: event.target.value }))} hint="This reason is recorded with the critical priority. It does not change asset availability." />}
      <div className="compact-actions"><AppButton type="submit" disabled={createBusy || !createFields.assetId}>{createBusy ? 'Creating…' : createIntent ? 'Retry exact create' : 'Create work order'}</AppButton><AppButton type="button" variant="secondary" disabled={createBusy || Boolean(createIntent)} onClick={() => { setCreateOpen(false); setCreateFields({ assetId: '', title: '', description: '', category: '', priority: 'normal', criticalReason: '' }); setCreateError(''); }}>Cancel</AppButton></div>
    </form></section>}
    {list.isPending ? <LoadingNotice label="Loading authorized work orders…" /> : list.isError ? <div className="empty-state"><ErrorNotice>Work orders are unavailable for this workspace or account.</ErrorNotice><AppButton variant="secondary" onClick={() => void list.refetch()}>Retry</AppButton></div> : workOrderRows.length === 0 && !linkedId && !search.trim() && statusFilter === 'all' ? <div className="empty-state"><h2>No work orders are visible</h2><p>Create a work order or accept a maintenance request for the operations team.</p><Link className="button button--secondary" to="/requests">Open requests</Link></div> : <>
      <div className="work-order-toolbar">
        <div className={`work-order-filters${view === 'table' ? ' work-order-filters--table' : ''}`}>
        <Field id="work-order-search" label="Search work orders" type="search" placeholder="Number, title or category" value={search} onChange={(event) => setSearch(event.target.value)} />
        {view === 'table' && <SelectField id="work-order-status" label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All visible statuses</option>{operationalWorkOrder.shape.status.options.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</SelectField>}
        <SelectField id="work-order-assignee-filter" label="Assignee" value={assigneeFilter} disabled={boardAssignments.isPending || boardAssignments.isError} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="all">All assignees</option>{assigneeIds.map((id) => <option key={id} value={id}>{id === user.id ? 'You' : `${team.data?.find((member) => member.user_id === id)?.role ?? 'Account'} · ${id}`}</option>)}</SelectField>
        <SelectField id="work-order-priority-filter" label="Priority filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{operationalWorkOrder.shape.priority.options.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</SelectField>
        <SelectField id="work-order-asset-filter" label="Asset filter" value={assetFilter} disabled={boardAssets.isPending || boardAssets.isError} onChange={(event) => setAssetFilter(event.target.value)}><option value="all">All assets</option>{(boardAssets.data ?? []).map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</SelectField>
        </div>
        <div className="view-toggle" role="group" aria-label="Work order view">
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
        </div>
      </div>
      {boardAssignments.isError && <ErrorNotice>Assignee filters are unavailable because authorized assignment records could not be read completely.</ErrorNotice>}
      {boardFiltersActive && list.hasNextPage && <p className="field-hint">Assignee, priority and asset filters apply to the currently loaded authorized work orders. Load more records to include older results.</p>}
      {view === 'board' ? <><p id="work-order-board-help" className="sr-only">Lane counts cover the currently loaded authorized records. Completed and canceled work remains available in Table view and the status filter.</p><div className="work-order-board" role="group" aria-label="Work orders by status" aria-describedby="work-order-board-help">
        {workOrderLanes.map((lane) => {
          const rows = visible.filter((workOrder) => lane.statuses.some((status) => status === workOrder.status));
          return <section className={`board-lane board-lane--${lane.id}`} key={lane.id} aria-label={`${lane.label} work orders`}>
            <h2>{lane.label} <span className="state-badge" aria-label={`${rows.length} loaded work orders`}>{rows.length}</span></h2>
            {rows.length ? <ol className="record-picker-list">{rows.map((workOrder) => {
              const boardAsset = boardAssetsById.get(workOrder.asset_id);
              const cardDate = workOrder.planned_on ? `Planned ${displayPlannedDate(workOrder.planned_on)}` : workOrder.due_at ? `Due ${new Date(workOrder.due_at).toLocaleDateString('en-GB')}` : 'Date not recorded';
              return <li key={workOrder.id}><button className="board-card" type="button" aria-current={selected?.id === workOrder.id ? 'true' : undefined} onClick={() => select(workOrder.id)}>
                <span className="record-picker-title work-order-card-id">{workOrderLabel(workOrder.number)}</span><span className={`work-order-priority work-order-priority--${workOrder.priority}`}>{workOrder.priority}</span>
                <span className="work-order-card-title">{workOrder.title}</span>
                <span className="work-order-card-meta" title={boardAsset ? `${boardAsset.code} · ${boardAsset.name}` : undefined}>{boardAssets.isPending ? 'Loading authorized asset…' : boardAsset ? `${boardAsset.code} · ${boardAsset.name}` : 'Asset details unavailable'}</span>
                <span className="work-order-card-footer"><span className="work-order-card-meta" title={assigneeIdsForOrder(workOrder.id).join(', ')}>{boardAssignments.isPending ? 'Loading assignees…' : boardAssignments.isError ? 'Assignees unavailable' : assigneeIdsForOrder(workOrder.id).length ? `Assigned to · ${assigneeIdsForOrder(workOrder.id).map(assigneeLabel).join(', ')}` : 'Unassigned'}</span><span className="work-order-card-meta work-order-card-date">{cardDate}</span></span>
              </button></li>;
            })}</ol> : <p className="field-hint">No matching work orders.</p>}
          </section>;
        })}
      </div></> : <div className="record-picker table-picker work-order-table">
        <table aria-label="Authorized work orders"><thead><tr><th scope="col">Work order</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Due</th><th scope="col">Revision</th><th scope="col">Action</th></tr></thead>
          <tbody>{visible.map((workOrder) => <tr key={workOrder.id} aria-selected={selected?.id === workOrder.id}>
            <td>{workOrderLabel(workOrder.number)}</td><td>{workOrder.title}</td><td><span className={`state-badge state-badge--${workOrder.status}`}>{workOrder.status.replaceAll('_', ' ')}</span></td><td>{workOrder.priority}</td><td>{workOrder.due_at ? new Date(workOrder.due_at).toLocaleDateString() : 'Not recorded'}</td><td>{workOrder.repair_revision}</td><td><button className="table-select" type="button" onClick={() => select(workOrder.id)}>{selected?.id === workOrder.id ? 'Selected' : 'Open details'}</button></td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className="field-hint">No work orders match this filter.</p>}
      </div>}
      {!workOrderRows.length && <p className="field-hint">No work orders match these filters.</p>}
      {list.hasNextPage && <AppButton variant="secondary" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? 'Loading more work orders…' : 'Load more work orders'}</AppButton>}
      {selectedDetailsOpen && <section className="record-preview work-order-detail" aria-label="Selected work order details" aria-live="polite">
          <div className="work-order-detail-actions"><h2>Selected work order</h2><AppButton variant="secondary" onClick={closeDetails}>Close details</AppButton></div>
          {linkedId && !listTarget && linkedTarget.isPending ? <LoadingNotice label="Checking the exact linked work order under your current access…" /> : linkedId && !listTarget && linkedTarget.isError ? <div className="empty-state"><h2>Work order unavailable</h2><p>This target could not be confirmed under your current workspace access.</p><AppButton variant="secondary" onClick={() => void linkedTarget.refetch()}>Retry target lookup</AppButton></div> : !selected ? <div className="empty-state"><h2>{linkedId ? 'Work order unavailable' : 'No work orders match'}</h2><p>{linkedId ? 'This target is not visible under your current workspace access.' : 'Change the search or status filter to find another work order.'}</p></div> : <>
            <div className="record-header"><div><p className="page-kicker">{workOrderLabel(selected.number)} · repair revision {selected.repair_revision}</p><h2>{selected.title}</h2></div><div className="compact-actions"><span className={`state-badge state-badge--${selected.status}`}>{selected.status.replaceAll('_', ' ')}</span><AppButton variant="secondary" onClick={() => void invalidate()}>Refresh record</AppButton></div></div>
            {selectedIntentEntry && <div className="info-callout" role="alert"><p>The outcome of a previous action is uncertain. The current record may have advanced; retry preserves the original request identity and values.</p>{notices[selectedIntentEntry[0]]?.error && <ErrorNotice>{notices[selectedIntentEntry[0]].error}</ErrorNotice>}<AppButton disabled={busyKey === selectedIntentEntry[0]} onClick={() => void run(selectedIntentEntry[0], selectedIntentEntry[1].execute, selectedIntentEntry[1].success)}>{busyKey === selectedIntentEntry[0] ? 'Retrying exact action…' : 'Retry pending action'}</AppButton></div>}
            {!selectedIntentEntry && resolvedIntent?.key.split(':')[1] === selected.id && <SuccessNotice>{resolvedIntent.message}</SuccessNotice>}
            <dl className="detail-grid"><div><dt>Asset</dt><dd>{asset.isPending ? 'Loading authorized asset…' : asset.data ? <>{asset.data.code} · {asset.data.name}<br /><span className="state-badge">{asset.data.availability.replaceAll('_', ' ')}</span></> : 'Asset details unavailable'}</dd></div><div><dt>Priority</dt><dd>{selected.priority}{selected.priority_reason ? ` · ${selected.priority_reason}` : ''}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Due date</dt><dd>{selected.due_at ? new Date(selected.due_at).toLocaleString() : 'Not recorded'}</dd></div><div><dt>Planned date</dt><dd>{selected.planned_on ?? 'Not scheduled'}</dd></div><div><dt>Responsible supervisor</dt><dd className="monospace">{selected.supervisor_id}</dd></div><div><dt>Record version</dt><dd>{selected.version}</dd></div><div><dt>Material revision</dt><dd>{selected.repair_revision}{selected.submitted_revision ? ` · submitted ${selected.submitted_revision}` : ''}</dd></div></dl>
            {selected.source_request_id && <p className="field-hint">Source request: <Link to={`/requests?request=${selected.source_request_id}`}>Open the linked request</Link></p>}
            <p className="record-description">{selected.description}</p>
            {selected.status === 'draft' && <p className="info-callout">Assignment and repair progress have not been recorded.</p>}

            {isCoordinator && selected.status !== 'canceled' && <section className="operation-section" aria-labelledby="admin-edit-title">
              <h3 id="admin-edit-title">Administrative work order details</h3>
              <p className="field-hint">Changes are version-checked and recorded in work history. Due date and planned schedule date are separate.</p>
              {notices[`admin:${selected.id}`]?.error && <ErrorNotice>{notices[`admin:${selected.id}`].error}</ErrorNotice>}{notices[`admin:${selected.id}`]?.success && <SuccessNotice>{notices[`admin:${selected.id}`].success}</SuccessNotice>}
              <form className="form-stack" onSubmit={saveAdministrativeEdit}>
                <Field id={`admin-title-${selected.id}`} label="Title" required maxLength={200} disabled={intentLocked || busyKey !== '' || !['draft', 'open', 'scheduled', 'in_progress'].includes(selected.status)} value={fieldOr('admin-title', selected.title)} onChange={(event) => setField('admin-title', event.target.value)} />
                <TextAreaField id={`admin-description-${selected.id}`} label="Description" required maxLength={4000} disabled={intentLocked || busyKey !== '' || !['draft', 'open', 'scheduled', 'in_progress'].includes(selected.status)} value={fieldOr('admin-description', selected.description)} onChange={(event) => setField('admin-description', event.target.value)} />
                <div className="form-row"><Field id={`admin-category-${selected.id}`} label="Category" required maxLength={100} disabled={intentLocked || busyKey !== ''} value={fieldOr('admin-category', selected.category)} onChange={(event) => setField('admin-category', event.target.value)} /><SelectField id={`admin-priority-${selected.id}`} label="Priority" disabled={intentLocked || busyKey !== ''} value={fieldOr('admin-priority', selected.priority)} onChange={(event) => setField('admin-priority', event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></SelectField></div>
                {fieldOr('admin-priority', selected.priority) === 'critical' && <TextAreaField id={`admin-priority-reason-${selected.id}`} label="Critical priority reason" required maxLength={2000} disabled={intentLocked || busyKey !== ''} value={fieldOr('admin-priority-reason', selected.priority_reason ?? '')} onChange={(event) => setField('admin-priority-reason', event.target.value)} />}
                <div className="form-row"><Field id={`admin-due-${selected.id}`} label="Due date and time (optional)" type="datetime-local" disabled={intentLocked || busyKey !== ''} value={fieldOr('admin-due-at', localDateTime(selected.due_at))} onChange={(event) => setField('admin-due-at', event.target.value)} /><label className="field" htmlFor={`admin-supervisor-${selected.id}`}><span>Responsible supervisor</span><select id={`admin-supervisor-${selected.id}`} disabled={intentLocked || busyKey !== '' || team.isPending || team.isError} value={fieldOr('admin-supervisor', selected.supervisor_id)} onChange={(event) => setField('admin-supervisor', event.target.value)}>{team.data?.some((member) => member.active && member.user_id === selected.supervisor_id) ? null : <option value={selected.supervisor_id}>Current account · {selected.supervisor_id}</option>}{team.data?.filter((member) => member.active && ['owner', 'manager', 'supervisor'].includes(member.role)).map((member) => <option key={member.user_id} value={member.user_id}>{member.role} · {member.user_id}</option>)}</select></label></div>
                {team.isError && <p className="field-hint">Current team roles could not be confirmed. Responsible supervisor editing is unavailable.</p>}
                <AppButton type="submit" disabled={intentLocked || busyKey !== '' || team.isPending || team.isError}>{busyKey === `admin:${selected.id}` ? 'Saving…' : intents.current.has(`admin:${selected.id}`) ? 'Retry exact edit' : 'Save administrative changes'}</AppButton>
              </form>
            </section>}

            {notices[`transition:${selected.id}:open`]?.error && <ErrorNotice>{notices[`transition:${selected.id}:open`].error}</ErrorNotice>}
              {selected.status === 'blocked' && jobParts.isPending && <LoadingNotice label="Confirming parts and stock before resume…" />}
              {selected.status === 'blocked' && jobParts.isError && <ErrorNotice>Parts and stock status is unavailable. Refresh it before resuming this work order.</ErrorNotice>}
              {selected.status === 'blocked' && !jobParts.isPending && !jobParts.isError && jobParts.data && !materialsReadyForResume && <p className="info-callout">Resume is unavailable until the latest work-order version has no parts shortage and stock reconciliation is consistent.</p>}
            <section className="operation-section" aria-labelledby="assignment-title">
              <h3 id="assignment-title">Assignment</h3>
              {assignments.isPending ? <LoadingNotice label="Checking assignments…" /> : assignments.isError ? <ErrorNotice>Assignment details are unavailable. Retry before assigning work.</ErrorNotice> : selectedActiveAssignments.length ? <ul className="assigned-list">{selectedActiveAssignments.map((id) => <li key={id}>{id === user.id ? 'You · ' : 'Assigned account · '}<span className="monospace">{id}</span></li>)}</ul> : <p className="field-hint">No active technicians are assigned.</p>}
              {isCoordinator && selected.status !== 'completed' && selected.status !== 'canceled' && <form className="form-stack" onSubmit={(event) => void assign(event)}>
                {team.isPending ? <LoadingNotice label="Loading active team roles…" /> : team.isError ? <ErrorNotice>Team roles could not be confirmed; assignment is unavailable.</ErrorNotice> : <fieldset className="choice-fieldset" disabled={intentLocked || assignments.isPending || assignments.isError || busyKey === `assign:${selected.id}` || intents.current.has(`assign:${selected.id}`)}><legend>Assign technicians</legend>{team.data.filter((member) => member.active && member.role === 'technician').length ? team.data.filter((member) => member.active && member.role === 'technician').map((member) => <label className="choice-row" key={member.user_id}><input type="checkbox" checked={selectedAssignments.includes(member.user_id)} onChange={(event) => setAssignmentSelection({ workOrderId: selected.id, ids: event.target.checked ? [...new Set([...selectedAssignments, member.user_id])] : selectedAssignments.filter((id) => id !== member.user_id) })} /><span>{member.user_id === user.id ? 'You' : 'Technician'} <span className="monospace">{member.user_id}</span></span></label>) : <p className="field-hint">No active technician accounts are available.</p>}</fieldset>}
                {notices[`assign:${selected.id}`]?.error && <ErrorNotice>{notices[`assign:${selected.id}`].error}</ErrorNotice>}{notices[`assign:${selected.id}`]?.success && <SuccessNotice>{notices[`assign:${selected.id}`].success}</SuccessNotice>}
                <AppButton type="submit" disabled={intentLocked || !team.data?.some((member) => member.active && member.role === 'technician') || busyKey === `assign:${selected.id}`}>{busyKey === `assign:${selected.id}` ? 'Saving assignments…' : intents.current.has(`assign:${selected.id}`) ? 'Retry exact assignment' : 'Save assignment'}</AppButton>
              </form>}
            </section>

            {canReadSelectedParts && <section className="operation-section" aria-labelledby="work-order-parts-title">
              <h3 id="work-order-parts-title">Parts for this work order</h3>
              {jobParts.isPending ? <LoadingNotice label="Loading requested, reserved, consumed and returned parts…" /> : jobParts.isError ? <><ErrorNotice>Work-order parts and stock status could not be confirmed. Retry before making a parts decision or resuming blocked work.</ErrorNotice><AppButton variant="secondary" onClick={() => void jobParts.refetch()}>Retry parts status</AppButton></> : jobParts.data && <>
                {jobParts.data.reconciliation_state === 'discrepancy' && <ErrorNotice>Stock records disagree with the work-order ledger. Reconcile the movement history before issuing stock or resuming work.</ErrorNotice>}
                {jobParts.data.parts.some((part) => decimalMilli(part.shortage) > 0n) && <p className="info-callout">A parts shortage remains. Receiving or issuing stock does not resume blocked work. An authorized coordinator must resume it after stock and reconciliation are clear.</p>}
                {jobParts.data.parts.length ? <div className="record-table-wrap"><table className="record-table"><caption>Exact work-order part quantities</caption><thead><tr><th scope="col">Part</th><th scope="col">Unit</th><th scope="col">Requested</th><th scope="col">Short</th><th scope="col">Reserved</th><th scope="col">Consumed</th><th scope="col">Returned</th></tr></thead><tbody>{jobParts.data.parts.map((part) => {
                  const catalogPart = requestableById.get(part.part_id);
                  return <tr key={part.part_id}><th scope="row">{catalogPart ? `${catalogPart.code} · ${catalogPart.name}` : `Part ${part.part_id.slice(0, 8)}`}</th><td>{part.unit}</td><td>{part.requested}</td><td>{part.shortage}</td><td>{part.reserved}</td><td>{part.issued}</td><td>{part.returned}</td></tr>;
                })}</tbody></table></div> : <p className="field-hint">No parts have been requested for this work order.</p>}
                {canRequestParts && <>
                  {requestableParts.isPending ? <LoadingNotice label="Loading parts available for this assigned job…" /> : requestableParts.isError ? <><ErrorNotice>Requestable parts could not be confirmed for this assignment.</ErrorNotice><AppButton variant="secondary" onClick={() => void requestableParts.refetch()}>Retry requestable parts</AppButton></> : requestableRows.length ? <form className="form-stack" onSubmit={submitPartsRequest}>
                    <h4>Request parts</h4>
                    <p className="field-hint">Only active catalog parts assigned to this job are available here.</p>
                    <fieldset disabled={partsRequestOtherIntentLocked || busyKey !== '' || partsRequestPending}>
                      <label className="field" htmlFor={`requested-part-${selected.id}`}><span>Requested part</span><select id={`requested-part-${selected.id}`} required value={selectedRequestableId} onChange={(event) => setPartsDraft({ workOrderId: selected.id, partId: event.target.value, quantity: currentPartsDraft?.quantity ?? '' })}><option value="" disabled>Select an assigned-job part</option>{requestableRows.map((part) => <option key={part.id} value={part.id}>{part.code} · {part.name} ({part.unit})</option>)}</select></label>
                      <Field id={`requested-quantity-${selected.id}`} label="Requested quantity" required inputMode="decimal" pattern={stockQuantityPattern} value={currentPartsDraft?.quantity ?? ''} onChange={(event) => setPartsDraft({ workOrderId: selected.id, partId: selectedRequestableId, quantity: event.target.value })} hint={`Unit: ${selectedRequestablePart?.unit ?? 'select a part'}`} />
                    </fieldset>
                    {notices[partsRequestKey]?.error && <ErrorNotice>{notices[partsRequestKey].error}</ErrorNotice>}{notices[partsRequestKey]?.success && <SuccessNotice>{notices[partsRequestKey].success}</SuccessNotice>}
                    <div className="compact-actions"><AppButton type="submit" disabled={partsRequestOtherIntentLocked || busyKey !== '' || !selectedRequestablePart || !currentPartsDraft?.quantity.trim()}>{busyKey === partsRequestKey ? 'Requesting…' : partsRequestPending ? 'Retry exact parts request' : 'Request parts'}</AppButton>{requestableParts.hasNextPage && <AppButton type="button" variant="secondary" disabled={requestableParts.isFetchingNextPage || partsRequestPending || intentLocked} onClick={() => void requestableParts.fetchNextPage()}>{requestableParts.isFetchingNextPage ? 'Loading…' : 'Load more parts'}</AppButton>}</div>
                  </form> : <p className="field-hint">No active parts are available for this assignment.</p>}
                </>}
              </>}
              {isCoordinator && selected.status === 'blocked' && <p className="field-hint"><Link to={`/inventory?workOrder=${encodeURIComponent(selected.id)}`}>Review linked stock and reservations in Inventory</Link></p>}
            </section>}

            <section className="operation-section" aria-labelledby="progress-title">
              <h3 id="progress-title">Work and repair record</h3>
              {['open', 'blocked'].includes(selected.status) && isCoordinator && <Field id={`planned-on-${selected.id}`} label="Planned work date" type="date" required disabled={intentLocked || busyKey !== '' || Boolean(pendingTransition)} value={fieldOr('planned-on', selected.planned_on ?? '')} onChange={(event) => setField('planned-on', event.target.value)} hint="Scheduling records this date separately from the optional due date." />}
              <div className="compact-actions">
                {isCoordinator && selected.status === 'draft' && <AppButton disabled={transitionLocked('open')} onClick={() => runTransition('open')}>{intents.current.has(`transition:${selected.id}:open`) ? 'Retry publish' : 'Publish work order'}</AppButton>}
                {['open', 'scheduled'].includes(selected.status) && (isCoordinator || selectedActiveAssignments.includes(user.id)) && <AppButton disabled={transitionLocked('in_progress') || assignments.isPending || assignments.isError || selectedActiveAssignments.length === 0} onClick={() => runTransition('in_progress')}>{intents.current.has(`transition:${selected.id}:in_progress`) ? 'Retry start work' : 'Start work'}</AppButton>}
                {isCoordinator && selected.status === 'open' && <AppButton variant="secondary" disabled={transitionLocked('scheduled') || !fieldOr('planned-on', selected.planned_on ?? '').trim()} onClick={runSchedule}>{intents.current.has(`schedule:${selected.id}`) ? 'Retry scheduling' : 'Schedule with planned date'}</AppButton>}
                {isCoordinator && selected.status === 'blocked' && <AppButton disabled={resumeBlockedByParts || transitionLocked('in_progress') || assignments.isPending || assignments.isError || selectedActiveAssignments.length === 0 || !field('transition-reason').trim()} onClick={() => runTransition('in_progress', field('transition-reason'))}>{intents.current.has(`transition:${selected.id}:in_progress`) ? 'Retry resume' : 'Resume work'}</AppButton>}
                {isCoordinator && selected.status === 'blocked' && <AppButton variant="secondary" disabled={resumeBlockedByParts || transitionLocked('scheduled') || !field('transition-reason').trim() || !fieldOr('planned-on', selected.planned_on ?? '').trim()} onClick={runSchedule}>{intents.current.has(`schedule:${selected.id}`) ? 'Retry scheduled resume' : 'Resume as scheduled'}</AppButton>}
                {canWork && <AppButton variant="secondary" disabled={transitionLocked('blocked') || !field('transition-reason').trim()} onClick={() => runTransition('blocked', field('transition-reason'))}>{intents.current.has(`transition:${selected.id}:blocked`) ? 'Retry block' : 'Block work with reason'}</AppButton>}
                {isCoordinator && selected.status === 'completed' && <AppButton disabled={transitionLocked('in_progress') || assignments.isPending || assignments.isError || selectedActiveAssignments.length === 0 || !field('transition-reason').trim()} onClick={() => runTransition('in_progress', field('transition-reason'))}>{intents.current.has(`transition:${selected.id}:in_progress`) ? 'Retry reopen' : 'Reopen for correction'}</AppButton>}
                {isCoordinator && ['draft', 'open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'].includes(selected.status) && <AppButton variant="danger" disabled={transitionLocked('canceled') || !field('transition-reason').trim()} onClick={() => runTransition('canceled', field('transition-reason'))}>{intents.current.has(`transition:${selected.id}:canceled`) ? 'Retry cancellation' : 'Cancel work order'}</AppButton>}
              </div>
              {notices[`transition:${selected.id}:in_progress`]?.error && <ErrorNotice>{notices[`transition:${selected.id}:in_progress`].error}</ErrorNotice>}
              {notices[`transition:${selected.id}:scheduled`]?.error && <ErrorNotice>{notices[`transition:${selected.id}:scheduled`].error}</ErrorNotice>}
              {notices[`transition:${selected.id}:blocked`]?.error && <ErrorNotice>{notices[`transition:${selected.id}:blocked`].error}</ErrorNotice>}
              {selected.status !== 'canceled' && <Field id={`transition-reason-${selected.id}`} label="Block or resume reason" required maxLength={2000} disabled={intentLocked || busyKey !== '' || Boolean(pendingTransition)} value={field('transition-reason')} onChange={(event) => setField('transition-reason', event.target.value)} hint="A reason is required for blocking, resuming blocked work, reopening completed work or cancellation." />}
              {notices[`schedule:${selected.id}`]?.error && <ErrorNotice>{notices[`schedule:${selected.id}`].error}</ErrorNotice>}{notices[`schedule:${selected.id}`]?.success && <SuccessNotice>{notices[`schedule:${selected.id}`].success}</SuccessNotice>}
              {isCoordinator && ['open', 'blocked'].includes(selected.status) && !selectedActiveAssignments.length && <p className="info-callout">An active same-workspace assignment is required before work can start or resume. Assign eligible work before continuing.</p>}
              {selected.status === 'in_progress' && <>
                <form className="form-stack" onSubmit={(event) => void submitNote(event)}>
                  <TextAreaField id={`repair-note-${selected.id}`} label="Repair note or correction" maxLength={4000} disabled={intentLocked || !canWork || busyKey === `repair:${selected.id}` || intents.current.has(`repair:${selected.id}`)} value={field('note')} onChange={(event) => setField('note', event.target.value)} hint="After a returned review, add a correction here. Notes are append-only work events." />
                  <Field id={`repair-labor-${selected.id}`} label="Labor minutes" type="number" min={0} max={1440} step={1} disabled={intentLocked || !canWork || busyKey === `repair:${selected.id}` || intents.current.has(`repair:${selected.id}`)} value={field('labor')} onChange={(event) => setField('labor', event.target.value)} />
                  {notices[`repair:${selected.id}`]?.error && <ErrorNotice>{notices[`repair:${selected.id}`].error}</ErrorNotice>}{notices[`repair:${selected.id}`]?.success && <SuccessNotice>{notices[`repair:${selected.id}`].success}</SuccessNotice>}
                  <AppButton type="submit" disabled={intentLocked || !canWork || busyKey === `repair:${selected.id}`}>{busyKey === `repair:${selected.id}` ? 'Recording…' : intents.current.has(`repair:${selected.id}`) ? 'Retry exact repair update' : 'Record repair update'}</AppButton>
                </form>
                <ul className="task-list" aria-label="Repair checklist">{tasks.isPending ? <li>Loading checklist…</li> : tasks.isError ? <li><ErrorNotice>Checklist is unavailable; retry before submission.</ErrorNotice></li> : tasks.data.map((task) => <li key={task.id}><label className="choice-row"><input type="checkbox" checked={task.completed} disabled={intentLocked || !canWork || busyKey === `task:${selected.id}:${task.id}` || intents.current.has(`task:${selected.id}:${task.id}`)} onChange={(event) => runRepairUpdate({ task_id: task.id, task_completed: event.target.checked })} /><span>{task.label}{task.required ? ' · required' : ' · optional'}</span></label>{notices[`task:${selected.id}:${task.id}`]?.error && <ErrorNotice>{notices[`task:${selected.id}:${task.id}`].error}</ErrorNotice>}</li>)}</ul>
                {isCoordinator && <form className="form-stack" onSubmit={(event) => void addTask(event)}><Field id={`new-task-${selected.id}`} label="Add required task" required maxLength={500} disabled={intentLocked || busyKey === `add-task:${selected.id}` || intents.current.has(`add-task:${selected.id}`)} value={field('new-task')} onChange={(event) => setField('new-task', event.target.value)} /><AppButton type="submit" disabled={intentLocked || busyKey !== ''}>{intents.current.has(`add-task:${selected.id}`) ? 'Retry add task' : 'Add task'}</AppButton>{notices[`add-task:${selected.id}`]?.error && <ErrorNotice>{notices[`add-task:${selected.id}`].error}</ErrorNotice>}</form>}
              </>}
            </section>

            {selected.status === 'in_progress' && <section className="operation-section" aria-labelledby="evidence-title">
              <h3 id="evidence-title">Private repair evidence</h3>
              <p className="field-hint">Files are sent through the current signed-in session to private storage. They are checked and become read-only after acceptance.</p>
              {attachments.isPending ? <LoadingNotice label="Loading authorized evidence…" /> : attachments.isError ? <ErrorNotice>Evidence records could not be confirmed.</ErrorNotice> : attachments.data.map((attachment) => <PrivateImage key={attachment.id} client={client} organizationId={organization.id} userId={user.id} attachment={attachment} />)}
              {canWork && <div className="form-stack"><label className="field" htmlFor={`evidence-file-${selected.id}`}><span>Choose a repair image</span><input id={`evidence-file-${selected.id}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={intentLocked || busyKey === 'upload' || Boolean(uploadIntent)} onChange={(event) => uploadFile(event.currentTarget.files?.[0])} /><span className="field-hint">JPEG, PNG or WebP, up to 5 MB. Evidence cannot be changed while a reservation has an uncertain outcome.</span></label>
                {uploadIntent && <div className="record-card"><p><strong>{uploadIntent.file.name}</strong>{uploadIntent.attachment ? ` · reservation ${uploadIntent.attachment.status}` : ' · ready to reserve'}</p>{uploadIntent.attachment?.status === 'pending' && <p className="field-hint">Reservation is recorded. Retry the same upload if the result was unclear.</p>}{notices.upload?.error && <ErrorNotice>{notices.upload.error}</ErrorNotice>}{notices.upload?.success && <SuccessNotice>{notices.upload.success}</SuccessNotice>}<AppButton disabled={intentLocked || busyKey === 'upload'} onClick={() => void performUpload()}>{busyKey === 'upload' ? 'Uploading…' : uploadIntent.attachment ? 'Retry same private upload' : 'Upload private image'}</AppButton></div>}
                {!uploadIntent && notices.upload?.error && <ErrorNotice>{notices.upload.error}</ErrorNotice>}
              </div>}
            </section>}

            {selected.status === 'in_progress' && <section className="operation-section" aria-labelledby="performers-title">
              <h3 id="performers-title">Performers and submission</h3>
              {(declarations.isError || events.isError || attestations.isError) && <ErrorNotice>Declaration history is unavailable. Reload it before submitting; previous performer facts remain immutable.</ErrorNotice>}
              <p className="field-hint">Every declared performer becomes ineligible to review this work order, even if later removed from the assignment.</p>
              {isCoordinator && team.data && <fieldset className="choice-fieldset" disabled={intentLocked || busyKey.startsWith('performers:') || intents.current.has(`performers:${selected.id}`)}><legend>People who performed this repair</legend>{team.data.filter((member) => member.active).map((member) => <label className="choice-row" key={member.user_id}><input type="checkbox" checked={selectedPerformers.includes(member.user_id)} onChange={(event) => setPerformerSelection({ key: currentPerformerKey, ids: event.target.checked ? [...new Set([...selectedPerformers, member.user_id])] : selectedPerformers.filter((id) => id !== member.user_id) })} /><span>{member.user_id === user.id ? 'You' : member.role} <span className="monospace">{member.user_id}</span></span></label>)}</fieldset>}
              {!isCoordinator && <label className="choice-row"><input type="checkbox" disabled={intentLocked} checked={selectedPerformers.includes(user.id)} onChange={(event) => setPerformerSelection({ key: currentPerformerKey, ids: event.target.checked ? [user.id] : [] })} /><span>I performed this repair. Co-performers not visible to my role must be declared by an operations lead.</span></label>}
              {declarations.data?.length ? <p className="field-hint">Immutable declaration facts: {declarations.data.length}. Current-revision declaration: {declaredAtCurrentRevision ? 'you are recorded' : 'not yet recorded for your account'}.</p> : <p className="field-hint">No performer declarations have been recorded.</p>}
              {notices[`performers:${selected.id}`]?.error && <ErrorNotice>{notices[`performers:${selected.id}`].error}</ErrorNotice>}{notices[`performers:${selected.id}`]?.success && <SuccessNotice>{notices[`performers:${selected.id}`].success}</SuccessNotice>}
              <div className="compact-actions"><AppButton variant="secondary" disabled={intentLocked || !canWork || busyKey !== '' || selectedPerformers.length === 0} onClick={declarePerformers}>{intents.current.has(`performers:${selected.id}`) ? 'Retry exact declaration' : 'Declare performers'}</AppButton></div>
              {!requiredTasksDone && <p className="info-callout">Complete every required task before sending for review.</p>}
              {settings.data?.evidence_required && !evidencePresent && <p className="info-callout">Workspace policy requires at least one validated private image before submission.</p>}
              {settings.isError && <p className="info-callout">Evidence policy could not be confirmed. Submission is disabled until the policy reloads.</p>}
              <TextAreaField id={`submission-ack-${selected.id}`} label="Submission attestation" required maxLength={2000} disabled={intentLocked || !canWork || busyKey === `submit:${selected.id}` || intents.current.has(`submit:${selected.id}`)} value={field('acknowledgment')} onChange={(event) => setField('acknowledgment', event.target.value)} hint="Confirm the declared performers and that this repair record is ready for review." />
              {notices[`submit:${selected.id}`]?.error && <ErrorNotice>{notices[`submit:${selected.id}`].error}</ErrorNotice>}{notices[`submit:${selected.id}`]?.success && <SuccessNotice>{notices[`submit:${selected.id}`].success}</SuccessNotice>}
              <AppButton disabled={intentLocked || !canWork || !declaredAtCurrentRevision || !requiredTasksDone || !evidencePresent || settings.isError || busyKey !== ''} onClick={submitRepair}>{intents.current.has(`submit:${selected.id}`) ? 'Retry exact submission' : 'Submit repair for review'}</AppButton>
            </section>}

            {selected.status === 'awaiting_review' && <section className="operation-section" aria-labelledby="review-title"><h3 id="review-title">Independent review</h3>
              {isCoordinator && <PrivilegedArea label="reviewing a completed repair">
                {participants.isPending ? <LoadingNotice label="Checking immutable performer history…" /> : participants.isError ? <ErrorNotice>Review eligibility could not be confirmed. Retry before taking action.</ErrorNotice> : reviewIneligible ? <div className="info-callout">Your account participated in this work order and cannot review it, even if your assignment has since changed.</div> : <>
                  <TextAreaField id={`review-reason-${selected.id}`} label="Review reason" required maxLength={2000} disabled={intentLocked || busyKey !== '' || pendingReviewApproval || pendingReviewReturn} value={field('review-reason')} onChange={(event) => setField('review-reason', event.target.value)} hint="A reason is required for approval and return." />
                  {notices[`review:${selected.id}:approved`]?.error && <ErrorNotice>{notices[`review:${selected.id}:approved`].error}</ErrorNotice>}{notices[`review:${selected.id}:returned`]?.error && <ErrorNotice>{notices[`review:${selected.id}:returned`].error}</ErrorNotice>}
                  <div className="compact-actions"><AppButton disabled={intentLocked || busyKey !== '' || pendingReviewReturn || !field('review-reason').trim()} onClick={() => review('approved')}>{pendingReviewApproval ? 'Retry approval' : 'Approve repair'}</AppButton><AppButton variant="secondary" disabled={intentLocked || busyKey !== '' || pendingReviewApproval || !field('review-reason').trim()} onClick={() => review('returned')}>{pendingReviewReturn ? 'Retry return' : 'Return for correction'}</AppButton></div>
                </>}
              </PrivilegedArea>}
              {!isCoordinator && <p className="field-hint">This repair is awaiting an independent operations review.</p>}
            </section>}

            {reviews.data?.length ? <section className="operation-section" aria-labelledby="reviews-history"><h3 id="reviews-history">Review history</h3><ol className="timeline">{reviews.data.map((entry) => <li key={entry.id}><strong>{entry.decision === 'approved' ? 'Approved' : 'Returned'} · revision {entry.repair_revision}</strong><span>{entry.reason}</span><small>{new Date(entry.created_at).toLocaleString()}</small></li>)}</ol></section> : null}
            {attestations.data?.length ? <section className="operation-section" aria-labelledby="attestations-history"><h3 id="attestations-history">Submission attestations</h3><ol className="timeline">{attestations.data.map((entry) => <li key={entry.id}><strong>Revision {entry.repair_revision} · {entry.performer_ids.length} declared performer(s)</strong><span>{entry.acknowledgment}</span><small>{new Date(entry.created_at).toLocaleString()}</small></li>)}</ol></section> : null}
            <section className="operation-section" aria-labelledby="history-title"><h3 id="history-title">Work history</h3>{events.isPending ? <LoadingNotice label="Loading immutable work history…" /> : events.isError ? <ErrorNotice>Work history could not be loaded.</ErrorNotice> : events.data.length ? <ol className="timeline">{events.data.map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll('_', ' ')} · {entry.status.replaceAll('_', ' ')} · revision {entry.repair_revision}</strong>{entry.note && <span>{entry.note}</span>}{entry.labor_minutes !== null && <span>Labor recorded: {entry.labor_minutes} min</span>}<small>{new Date(entry.created_at).toLocaleString()}</small></li>)}</ol> : <p className="field-hint">No work events have been recorded.</p>}</section>
          </>}
        </section>}
    </>}
  </>;
}
