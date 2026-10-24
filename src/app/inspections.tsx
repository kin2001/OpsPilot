import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { inspectionResults, inspectionTemplateFields, type InspectionResults, type InspectionTemplateFields } from '../contracts/inspections';
import { attachmentRecord, teamResult } from '../contracts/operational';
import { domainError } from '../lib/domain-errors';
import { assignInspection, correctInspection, getInspection, listInspectionAssignments, listInspectionRevisions, listInspectionTemplates, publishInspectionTemplate, reserveInspectionAttachment, submitInspection } from './inspection-client';
import { useWorkspace } from './workspace';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, SuccessNotice, TextAreaField, failureCode, failureMessage } from './ui';
import { recordFilter, recordPageSize, splitRecordPage, type RecordCursor } from './record-query';
import { imageMetadataFor, PrivateImage, uploadPrivateImage } from './private-attachments';
import '../styles/inspections.css';

const pageSize = 8;
const inspectionAsset = z.strictObject({ id: z.uuid(), code: z.string(), name: z.string(), created_at: z.string() });
const inspectionAssets = z.array(inspectionAsset).max(recordPageSize + 1);
const attachmentRows = z.array(attachmentRecord).max(10);
type Template = z.output<typeof import('../contracts/inspections').inspectionTemplate>;
type Revision = z.output<typeof import('../contracts/inspections').inspectionRevision>;
type InspectionDetail = z.output<typeof import('../contracts/inspections').inspectionDetail>;
type AssignmentFields = { asset_id: string; template_revision_id: string; inspector_id: string; due_on: string };
type AssignmentIntent = { requestId: string; fields: Omit<AssignmentFields, 'due_on'> & { due_on?: string } };
type TemplateIntent = { requestId: string; fields: InspectionTemplateFields; expectedVersion?: number };
type SaveIntent = { requestId: string; assignmentId: string; revisionId: string; results: InspectionResults; supersedesId?: string; expectedVersion?: number; correctionReason?: string };
type ResultDraft = { outcome: '' | 'pass' | 'fail' | 'not_applicable'; reason: string; remarks: string; evidenceIds: string[] };
type EvidenceIntent = { requestId: string; file: File; attachment: z.output<typeof attachmentRecord> | null };
type PendingEvidence = { key: string; intent: EvidenceIntent };

function emptyTemplate(): InspectionTemplateFields {
  return { title: '', items: [{ id: crypto.randomUUID(), label: '', required: true, safety_relevant: false, evidence_required: false }] };
}

function newDraft(revision: Revision, submission?: InspectionDetail['submission']): Record<string, ResultDraft> {
  const saved = new Map(submission?.results.map((result) => [result.item_id, result]) ?? []);
  return Object.fromEntries(revision.items.map((item) => {
    const result = saved.get(item.id);
    return [item.id, { outcome: result?.outcome ?? '', reason: result?.reason ?? '', remarks: result?.remarks ?? '', evidenceIds: result?.evidence_ids ?? [] }];
  }));
}

function displayDate(value: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function displayInstant(value: string, timeZone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
}

function outcomeFor(detail?: InspectionDetail) {
  if (!detail) return 'Unverified';
  if (!detail?.submission) return 'In progress';
  if (!detail.submission.results.length) return 'Unverified';
  return detail.submission.results.some((result) => result.outcome === 'fail') ? 'Failed' : 'Passed';
}

async function currentInspectionRevision(client: ReturnType<typeof useWorkspace>['client'], organizationId: string, template: Template, signal: AbortSignal) {
  let cursor: number | undefined = template.version > 100 ? template.version - 100 : undefined;
  while (true) {
    const page = await listInspectionRevisions(client, organizationId, template.id, { cursor, page_size: 100 }, signal);
    const revision = page.items.find((item) => item.id === template.current_revision_id);
    if (revision) return revision;
    if (page.next_cursor === null) break;
    cursor = page.next_cursor;
  }
  throw new Error('DEPENDENCY_UNAVAILABLE');
}

function EvidenceUpload({ client, organizationId, assignmentId, itemId, intent, pendingElsewhere, disabled, onIntentChange, onReady, onBusyChange }: {
  client: ReturnType<typeof useWorkspace>['client']; organizationId: string; assignmentId: string; itemId: string; intent: EvidenceIntent | null; pendingElsewhere: boolean; disabled: boolean;
  onIntentChange: (intent: EvidenceIntent | null) => void; onReady: (attachment: z.output<typeof attachmentRecord>) => void; onBusyChange: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectedFile = intent?.file ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const chooseFile = (file?: File) => {
    if (!file || intent || pendingElsewhere || disabled) return;
    try {
      imageMetadataFor(file);
      onIntentChange({ requestId: crypto.randomUUID(), file, attachment: null });
      setError(''); setSuccess('');
    } catch (cause) {
      setError(failureMessage(cause));
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const upload = async () => {
    let current = intent;
    if (!current) return;
    setBusy(true); onBusyChange(true); setError(''); setSuccess('');
    try {
      let reservedAttachment = current.attachment;
      if (!reservedAttachment) {
        reservedAttachment = await reserveInspectionAttachment(client, organizationId, assignmentId, imageMetadataFor(current.file), current.requestId);
        current = { ...current, attachment: reservedAttachment };
        onIntentChange(current);
      }
      const attachment = await uploadPrivateImage(client, organizationId, reservedAttachment.id, current.file);
      onIntentChange(null); onReady(attachment); setSuccess('Private evidence uploaded and ready.');
    } catch (cause) {
      const code = failureCode(cause);
      setError(`${failureMessage(cause)}${code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' ? ' Retry keeps the same request and attachment.' : ''}`);
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED') {
        onIntentChange(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    } finally { setBusy(false); onBusyChange(false); }
  };
  const removeSelection = () => {
    if (!intent || intent.attachment || busy) return;
    onIntentChange(null); setError(''); setSuccess('');
    if (inputRef.current) inputRef.current.value = '';
  };
  return <div className="inspection-evidence-upload">
    <label className="field" htmlFor={`inspection-file-${assignmentId}-${itemId}`}><span>Private evidence</span><input ref={inputRef} id={`inspection-file-${assignmentId}-${itemId}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy || Boolean(intent) || pendingElsewhere} onChange={(event) => chooseFile(event.currentTarget.files?.[0])} /><span className="field-hint">JPEG, PNG or WebP, up to 5 MB. Evidence is stored privately and checked with your current workspace access.</span></label>
    {pendingElsewhere && <p className="field-hint" role="status">Finish the selected evidence upload on its inspection before choosing another image.</p>}
    {selectedFile && <div className="inspection-evidence-pending"><strong>{selectedFile.name}</strong><AppButton type="button" variant="secondary" disabled={disabled || busy} onClick={() => void upload()}>{busy ? 'Uploading…' : intent?.attachment ? 'Retry same evidence upload' : 'Upload private evidence'}</AppButton>{intent && !intent.attachment && <AppButton type="button" variant="quiet" disabled={busy} onClick={removeSelection}>Remove selected file</AppButton>}</div>}
    {error && <ErrorNotice>{error}</ErrorNotice>}{success && <SuccessNotice>{success}</SuccessNotice>}
  </div>;
}

export function InspectionsPage() {
  const { client, user, organization, role } = useWorkspace();
  const cache = useQueryClient();
  const readAllowed = ['owner', 'manager', 'supervisor', 'technician'].includes(role);
  const isCoordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [view, setView] = useState<'inspections' | 'templates'>('inspections');
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('assignment'));
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [assignmentFields, setAssignmentFields] = useState<AssignmentFields>({ asset_id: '', template_revision_id: '', inspector_id: '', due_on: '' });
  const [assignmentIntent, setAssignmentIntent] = useState<AssignmentIntent | null>(null);
  const assignmentIntentRef = useRef<AssignmentIntent | null>(null);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [templateEditor, setTemplateEditor] = useState<{ id?: string; expectedVersion?: number } | null>(null);
  const [templateFields, setTemplateFields] = useState<InspectionTemplateFields>(() => emptyTemplate());
  const [templateIntent, setTemplateIntent] = useState<TemplateIntent | null>(null);
  const templateIntentRef = useRef<TemplateIntent | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateConflict, setTemplateConflict] = useState(false);
  const [draft, setDraft] = useState<Record<string, ResultDraft>>({});
  const [correcting, setCorrecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [saveIntent, setSaveIntent] = useState<SaveIntent | null>(null);
  const saveIntentRef = useRef<SaveIntent | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidence | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const assignmentCursor = cursorStack.at(-1);
  const assignments = useQuery({
    queryKey: ['inspection-assignments', user.id, organization.id, role, assignmentCursor], enabled: readAllowed,
    queryFn: ({ signal }) => listInspectionAssignments(client, organization.id, { cursor: assignmentCursor, page_size: pageSize }, signal),
  });
  const templates = useInfiniteQuery({
    queryKey: ['inspection-templates', user.id, organization.id, role], enabled: readAllowed,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => listInspectionTemplates(client, organization.id, { cursor: pageParam, page_size: pageSize }, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const assignmentRows = assignments.data?.items ?? [];
  const templateRows = templates.data?.pages.flatMap((page) => page.items) ?? [];
  const inspectionDetails = useQueries({ queries: assignmentRows.map((assignment) => ({
    queryKey: ['inspection-detail', user.id, organization.id, role, assignment.id], enabled: readAllowed,
    queryFn: ({ signal }: { signal: AbortSignal }) => getInspection(client, organization.id, assignment.id, signal), staleTime: 15_000,
  })) });
  const templateRevisions = useQueries({ queries: templateRows.map((template) => ({
    queryKey: ['inspection-revision', user.id, organization.id, role, template.id, template.current_revision_id], enabled: readAllowed,
    queryFn: ({ signal }: { signal: AbortSignal }) => currentInspectionRevision(client, organization.id, template, signal), staleTime: 30_000,
  })) });
  const revisionByTemplate = new Map(templateRows.map((template, index) => [template.id, templateRevisions[index]?.data]));
  const selectedDetailQuery = inspectionDetails[assignmentRows.findIndex((item) => item.id === selectedId)];
  const selectedDetail = useQuery({
    queryKey: ['inspection-detail', user.id, organization.id, role, selectedId], enabled: readAllowed && Boolean(selectedId) && !assignmentRows.some((item) => item.id === selectedId),
    queryFn: ({ signal }) => selectedId ? getInspection(client, organization.id, selectedId, signal) : Promise.reject(new Error('NOT_FOUND')), staleTime: 15_000,
  });
  const activeDetail = selectedDetailQuery ?? selectedDetail;
  const selected = activeDetail?.data;
  const maySubmitChecklist = selected?.assignment.inspector_id === user.id;
  const selectedEvidencePrefix = selected ? `${selected.assignment.id}:` : '';
  const evidencePendingForSelected = Boolean(selectedEvidencePrefix && pendingEvidence?.key.startsWith(selectedEvidencePrefix));
  const evidencePendingElsewhere = Boolean(pendingEvidence && !pendingEvidence.key.startsWith(selectedEvidencePrefix));
  const attachments = useQuery({
    queryKey: ['inspection-attachments', user.id, organization.id, role, selectedId], enabled: Boolean(selectedId && activeDetail?.data),
    queryFn: async ({ signal }) => {
      const result = await client.from('attachments').select('*').eq('organization_id', organization.id).eq('inspection_assignment_id', selectedId!).eq('status', 'ready').order('created_at').limit(10).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = attachmentRows.safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const assignmentsPending = assignments.isPending;
  const detailsPending = inspectionDetails.some((query) => query.isPending && !query.data);
  const unknownOutcomes = inspectionDetails.filter((query) => query.isError || (query.data?.submission && !query.data.submission.results.length)).length;
  const outcomesKnown = assignments.isSuccess && !detailsPending;
  const outcomes = useMemo(() => inspectionDetails.map((query) => query.isError ? 'Unverified' : outcomeFor(query.data)), [inspectionDetails]);
  const passedCount = outcomes.filter((outcome) => outcome === 'Passed').length;
  const failedCount = outcomes.filter((outcome) => outcome === 'Failed').length;
  const inProgressCount = outcomes.filter((outcome) => outcome === 'In progress').length;
  const assetQuery = useInfiniteQuery({
    queryKey: ['inspection-assets', user.id, organization.id, role, assetSearch.trim()], enabled: isCoordinator && showAssignmentForm,
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      const filter = recordFilter(['name', 'code'], assetSearch.trim(), pageParam);
      const result = await client.from('assets').select('id,code,name,created_at').eq('organization_id', organization.id).is('archived_at', null)
        .or(filter ?? 'id.not.is.null').order('name').order('id').limit(recordPageSize + 1).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = inspectionAssets.safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return splitRecordPage(parsed.data);
    }, getNextPageParam: (page) => page.next ?? undefined,
  });
  const assetRows = assetQuery.data?.pages.flatMap((page) => page.rows) ?? [];
  const team = useQuery({
    queryKey: ['inspection-team', user.id, organization.id, role], enabled: isCoordinator && showAssignmentForm,
    queryFn: async ({ signal }) => {
      const result = await client.rpc('get_team', { organization_id: organization.id }).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = teamResult.safeParse(result.data);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
  });
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

  useEffect(() => {
    if (!selected) return;
    setDraft(newDraft(selected.revision, selected.submission ?? undefined));
    setCorrecting(false); setCorrectionReason(''); setSaveIntent(null); saveIntentRef.current = null; setSaveError(''); setSaveConflict(false);
  }, [selected?.assignment.id, selected?.submission?.id, selected?.revision.id]);

  const openNewAssignment = () => {
    if (assignmentIntentRef.current || assignmentBusy) return;
    setShowAssignmentForm(true); setAssignmentFields({ asset_id: '', template_revision_id: '', inspector_id: '', due_on: '' });
    setAssignmentError(''); setAssignmentIntent(null); assignmentIntentRef.current = null;
  };
  const openNewTemplate = () => {
    if (templateIntentRef.current || templateBusy) return;
    setView('templates'); setShowTemplateForm(true); setTemplateEditor({}); setTemplateFields(emptyTemplate());
    setTemplateError(''); setTemplateConflict(false); setTemplateIntent(null); templateIntentRef.current = null;
  };
  const openTemplateRevision = (template: Template) => {
    if (templateIntentRef.current || templateBusy) return;
    const revision = revisionByTemplate.get(template.id);
    if (!revision) return;
    setShowTemplateForm(true); setTemplateEditor({ id: template.id, expectedVersion: template.version });
    setTemplateFields({ id: template.id, title: revision.title, items: revision.items.map((item) => ({ ...item })) });
    setTemplateError(''); setTemplateConflict(false); setTemplateIntent(null); templateIntentRef.current = null;
  };

  const runAssignment = async () => {
    const intent = assignmentIntentRef.current;
    if (!intent) return;
    setAssignmentBusy(true); setAssignmentError('');
    try {
      const saved = await assignInspection(client, organization.id, intent.fields, intent.requestId);
      setAssignmentIntent(null); assignmentIntentRef.current = null; setShowAssignmentForm(false); setSelectedId(saved.id);
      await cache.invalidateQueries({ queryKey: ['inspection-assignments', user.id, organization.id, role] });
      await cache.invalidateQueries({ queryKey: ['inspection-detail', user.id, organization.id, role, saved.id] });
    } catch (cause) {
      const code = failureCode(cause);
      setAssignmentError(`${failureMessage(cause)}${code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' ? ' Retry uses the same request and assignment details.' : ''}`);
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED') { setAssignmentIntent(null); assignmentIntentRef.current = null; }
    } finally { setAssignmentBusy(false); }
  };
  const createAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (assignmentIntentRef.current) return;
    const parsed = z.strictObject({ asset_id: z.uuid(), template_revision_id: z.uuid(), inspector_id: z.uuid(), due_on: z.iso.date().optional() })
      .safeParse({ ...assignmentFields, due_on: assignmentFields.due_on || undefined });
    if (!parsed.success) { setAssignmentError('Choose an active asset, a pinned template revision, and an inspector.'); return; }
    const intent = { requestId: crypto.randomUUID(), fields: parsed.data };
    assignmentIntentRef.current = intent; setAssignmentIntent(intent); void runAssignment();
  };

  const runTemplateSave = async () => {
    const intent = templateIntentRef.current;
    if (!intent) return;
    setTemplateBusy(true); setTemplateError(''); setTemplateConflict(false);
    try {
      await publishInspectionTemplate(client, organization.id, intent.fields, intent.requestId, intent.expectedVersion);
      setTemplateIntent(null); templateIntentRef.current = null; setShowTemplateForm(false); setTemplateEditor(null);
      await cache.invalidateQueries({ queryKey: ['inspection-templates', user.id, organization.id, role] });
    } catch (cause) {
      const code = failureCode(cause);
      setTemplateError(failureMessage(cause));
      if (code === 'CONFLICT') setTemplateConflict(true);
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED' && code !== 'CONFLICT') { setTemplateIntent(null); templateIntentRef.current = null; }
    } finally { setTemplateBusy(false); }
  };
  const saveTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (templateIntentRef.current) return;
    const parsed = inspectionTemplateFields.safeParse(templateFields);
    if (!parsed.success) { setTemplateError('Add a title and a label for every checklist item.'); return; }
    const intent = { requestId: crypto.randomUUID(), fields: parsed.data, expectedVersion: templateEditor?.expectedVersion };
    templateIntentRef.current = intent; setTemplateIntent(intent); void runTemplateSave();
  };

  const setItemDraft = (itemId: string, next: Partial<ResultDraft>) => setDraft((current) => ({
    ...current, [itemId]: { ...(current[itemId] ?? { outcome: '', reason: '', remarks: '', evidenceIds: [] }), ...next },
  }));
  const setEvidenceIntent = (key: string, intent: EvidenceIntent | null) => setPendingEvidence((current) => {
    if (intent) return { key, intent };
    return current?.key === key ? null : current;
  });
  const handleChecklistSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !selectedId || saveIntentRef.current) return;
    const errors = selected.revision.items.flatMap((item) => {
      const result = draft[item.id];
      if (item.required && !result?.outcome) return [`${item.label}: choose Pass, Fail, or Not applicable.`];
      if (!result?.outcome) return [];
      if (result.outcome === 'not_applicable' && !result.reason.trim()) return [`${item.label}: explain why this item does not apply.`];
      if (result.outcome !== 'pass' && !result.remarks.trim()) return [`${item.label}: add remarks for this result.`];
      if (item.evidence_required && result.evidenceIds.length === 0) return [`${item.label}: attach the required private evidence.`];
      return [];
    });
    if (errors.length) { setSaveError(errors.join(' ')); return; }
    const results = selected.revision.items.flatMap((item) => {
      const value = draft[item.id];
      return !value?.outcome ? [] : [{ item_id: item.id, outcome: value.outcome, ...(value.reason.trim() ? { reason: value.reason } : {}), ...(value.remarks.trim() ? { remarks: value.remarks } : {}), evidence_ids: value.evidenceIds }];
    });
    const parsed = inspectionResults.safeParse(results);
    if (!parsed.success) { setSaveError('Review the checklist fields before saving.'); return; }
    const intent: SaveIntent = {
      requestId: crypto.randomUUID(), assignmentId: selectedId, revisionId: selected.revision.id, results: parsed.data,
      ...(correcting && selected.submission ? { supersedesId: selected.submission.id, expectedVersion: selected.submission.version, correctionReason: correctionReason.trim() } : {}),
    };
    if (correcting && !intent.correctionReason) { setSaveError('Enter a correction reason before saving.'); return; }
    saveIntentRef.current = intent; setSaveIntent(intent); void runChecklistSave(intent);
  };
  const runChecklistSave = async (retry = saveIntentRef.current) => {
    if (!retry || !selectedId) return;
    setSaveBusy(true); setSaveError(''); setSaveConflict(false);
    try {
      if (retry.supersedesId) await correctInspection(client, organization.id, {
        assignment_id: retry.assignmentId, template_revision_id: retry.revisionId, supersedes_id: retry.supersedesId,
        correction_reason: retry.correctionReason!, results: retry.results,
      }, retry.requestId, retry.expectedVersion!);
      else await submitInspection(client, organization.id, retry.assignmentId, retry.revisionId, retry.results, retry.requestId);
      saveIntentRef.current = null; setSaveIntent(null); setCorrecting(false); setCorrectionReason('');
      await cache.invalidateQueries({ queryKey: ['inspection-detail', user.id, organization.id, role, retry.assignmentId] });
      await cache.invalidateQueries({ queryKey: ['inspection-assignments', user.id, organization.id, role] });
    } catch (cause) {
      const code = failureCode(cause);
      setSaveError(`${failureMessage(cause)}${code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED' ? ' Retry uses the same request and checklist payload.' : ''}`);
      if (code === 'CONFLICT') setSaveConflict(true);
      if (code !== 'DEPENDENCY_UNAVAILABLE' && code !== 'RATE_LIMITED' && code !== 'CONFLICT') { saveIntentRef.current = null; setSaveIntent(null); }
    } finally { setSaveBusy(false); }
  };
  const reloadAfterConflict = async () => {
    await activeDetail?.refetch();
    saveIntentRef.current = null; setSaveIntent(null); setCorrecting(false); setCorrectionReason(''); setSaveError(''); setSaveConflict(false);
  };

  if (!readAllowed) return <PageHeader eyebrow="Access" title="Inspections unavailable" description="Your current workspace role does not have access to inspection records." />;
  const pageLabel = assignmentsPending ? 'Loading inspections…' : assignments.isError ? 'Inspections unavailable' : `${assignmentRows.length} inspections on this page`;
  const formLocked = Boolean(assignmentIntent) || assignmentBusy;
  const checklistLocked = Boolean(saveIntent) || saveBusy;
  const checklistBlocked = checklistLocked || evidencePendingForSelected;

  return <section className="inspections-page">
    <PageHeader eyebrow="Operational checks" title="Inspections" description={`Versioned checklists and inspection history for ${organization.name}.`} action={isCoordinator && <AppButton disabled={formLocked || uploadBusy} onClick={openNewAssignment}>New inspection</AppButton>} />
    <p className="inspection-scope-note">Counts and outcome summary describe the currently loaded assignment page only. Use the page controls to move through the bounded record list.</p>
    <section className="inspection-counts" aria-label="Inspection counts">
      <div className="inspection-count" role="group" aria-label={`Inspections on this page: ${assignmentsPending || assignments.isError ? '—' : assignmentRows.length}`}><strong>{assignmentsPending || assignments.isError ? '—' : assignmentRows.length}</strong><span>Inspections on this page</span></div>
      <div className="inspection-count" role="group" aria-label={`Passed: ${!outcomesKnown ? '—' : passedCount}`}><strong>{!outcomesKnown ? '—' : passedCount}</strong><span>Passed</span></div>
      <div className="inspection-count" role="group" aria-label={`Failed: ${!outcomesKnown ? '—' : failedCount}`}><strong>{!outcomesKnown ? '—' : failedCount}</strong><span>Failed</span></div>
      <div className="inspection-count" role="group" aria-label={`In progress: ${!outcomesKnown ? '—' : inProgressCount}`}><strong>{!outcomesKnown ? '—' : inProgressCount}</strong><span>In progress</span></div>
    </section>
    {unknownOutcomes > 0 && <p className="inspection-outcome-warning" role="status">{unknownOutcomes} outcome {unknownOutcomes === 1 ? 'could' : 'could'} not be verified; unknown records are excluded from Passed, Failed, and In progress.</p>}
    <div className="inspection-tabs" role="tablist" aria-label="Inspection views">
      <button type="button" role="tab" id="inspection-list-tab" aria-selected={view === 'inspections'} aria-controls="inspection-list-panel" onClick={() => setView('inspections')}>Inspections</button>
      <button type="button" role="tab" id="inspection-template-tab" aria-selected={view === 'templates'} aria-controls="inspection-template-panel" onClick={() => setView('templates')}>Templates</button>
    </div>
    {view === 'inspections' ? <div id="inspection-list-panel" role="tabpanel" aria-labelledby="inspection-list-tab" className="inspection-layout">
      <section className="inspection-panel inspection-results-panel" aria-labelledby="inspection-results-title">
        <div className="inspection-panel-heading"><div><h2 id="inspection-results-title">Inspection results</h2><p>{pageLabel}</p></div></div>
        {assignments.isPending ? <LoadingNotice label="Loading authorized inspection assignments…" /> : assignments.isError ? <div><ErrorNotice>Inspection assignments are unavailable for this workspace.</ErrorNotice><AppButton variant="secondary" onClick={() => void assignments.refetch()}>Retry assignments</AppButton></div> : assignmentRows.length ? <div className="inspection-table-wrap"><table className="inspection-table"><thead><tr><th scope="col">Assignment</th><th scope="col">Template</th><th scope="col">Asset</th><th scope="col">Inspector</th><th scope="col">Due</th><th scope="col">Outcome</th></tr></thead><tbody>
          {assignmentRows.map((assignment, index) => {
            const query = inspectionDetails[index]; const detail = query?.data; const outcome = query?.isError ? 'Unverified' : query?.isPending ? 'Checking…' : outcomeFor(detail);
            const outcomeKey = query?.isError ? 'unverified' : query?.isPending ? 'checking' : outcome.toLowerCase().replaceAll(' ', '-');
            const asset = assetById.get(assignment.asset_id);
            return <tr key={assignment.id} data-selected={selectedId === assignment.id}>
              <td data-label="Assignment"><button type="button" className="inspection-row-select" aria-pressed={selectedId === assignment.id} disabled={Boolean(saveIntent) || saveBusy || uploadBusy} onClick={() => setSelectedId(assignment.id)}>Assignment {assignment.id.slice(0, 8)}</button></td>
              <td data-label="Template">{detail?.revision.title ?? 'Pinned checklist'}</td><td data-label="Asset">{asset ? `${asset.code} · ${asset.name}` : `Asset ${assignment.asset_id.slice(0, 8)}`}</td>
              <td data-label="Inspector">{assignment.inspector_id === user.id ? 'You' : `Member · ${assignment.inspector_id.slice(0, 8)}`}</td><td data-label="Due">{displayDate(assignment.due_on)}</td>
              <td data-label="Outcome"><span className={`inspection-status inspection-status--${outcomeKey}`}>{outcome}</span>{query?.isError && <button className="inspection-inline-link" type="button" onClick={() => void query.refetch()}>Retry outcome</button>}</td>
            </tr>;
          })}
        </tbody></table></div> : <p className="inspection-empty" role="status">No inspections are assigned in this workspace yet.</p>}
        <div className="inspection-pagination"><AppButton type="button" variant="secondary" disabled={Boolean(saveIntent) || saveBusy || cursorStack.length <= 1 || assignments.isFetching} onClick={() => setCursorStack((current) => current.slice(0, -1))}>Previous page</AppButton><span>{assignments.data?.next_cursor ? 'More assignments are available.' : 'End of assignments.'}</span><AppButton type="button" variant="secondary" disabled={Boolean(saveIntent) || saveBusy || !assignments.data?.next_cursor || assignments.isFetching} onClick={() => { if (assignments.data?.next_cursor) setCursorStack((current) => [...current, assignments.data!.next_cursor!]); }}>Next page</AppButton></div>
      </section>
      <aside className="inspection-side-column">
        <section className="inspection-panel" aria-labelledby="inspection-template-summary-title"><div className="inspection-panel-heading"><h2 id="inspection-template-summary-title">Inspection templates</h2><button type="button" className="inspection-inline-link" onClick={() => setView('templates')}>View all templates</button></div>
          {templates.isPending ? <LoadingNotice label="Loading authorized templates…" /> : templates.isError ? <div><ErrorNotice>Templates are unavailable.</ErrorNotice><AppButton variant="secondary" onClick={() => void templates.refetch()}>Retry templates</AppButton></div> : templateRows.length ? <ul className="inspection-template-list">{templateRows.slice(0, 5).map((template) => {
            const revision = revisionByTemplate.get(template.id); const query = templateRevisions[templateRows.indexOf(template)];
            return <li key={template.id}><div><strong>{template.title}</strong><span>{query?.isError ? 'Revision unavailable' : revision ? `Revision ${revision.revision}` : 'Loading revision…'}</span></div><span>{revision ? `${revision.items.length} items` : '—'}</span></li>;
          })}</ul> : <p className="inspection-empty">No checklist templates are available.</p>}
          {isCoordinator && <AppButton type="button" variant="secondary" disabled={Boolean(templateIntent) || templateBusy} onClick={openNewTemplate}>Create template</AppButton>}
        </section>
        <OutcomeSummary total={assignmentRows.length} passed={passedCount} failed={failedCount} inProgress={inProgressCount} pending={!outcomesKnown} />
      </aside>
    </div> : <section id="inspection-template-panel" role="tabpanel" aria-labelledby="inspection-template-tab" className="inspection-panel inspection-template-panel">
      <div className="inspection-panel-heading"><div><h2>Templates</h2><p>Published revisions stay pinned to existing assignments.</p></div>{isCoordinator && <AppButton disabled={Boolean(templateIntent) || templateBusy} onClick={openNewTemplate}>New template</AppButton>}</div>
      {templates.isPending ? <LoadingNotice label="Loading authorized templates…" /> : templates.isError ? <div><ErrorNotice>Templates are unavailable.</ErrorNotice><AppButton variant="secondary" onClick={() => void templates.refetch()}>Retry templates</AppButton></div> : templateRows.length ? <ul className="inspection-template-list inspection-template-list--full">{templateRows.map((template, index) => {
        const query = templateRevisions[index]; const revision = query?.data;
        return <li key={template.id}><div><strong>{template.title}</strong><span>{query?.isError ? 'Current revision unavailable' : revision ? `Revision ${revision.revision} · published ${displayInstant(revision.published_at, organization.timezone)}` : 'Loading current revision…'}</span></div><span>{revision ? `${revision.items.length} items` : '—'}</span>{isCoordinator && <AppButton type="button" variant="secondary" disabled={!revision || Boolean(templateIntent)} onClick={() => openTemplateRevision(template)}>Revise</AppButton>}</li>;
      })}</ul> : <p className="inspection-empty">No checklist templates are available.</p>}
      {templates.hasNextPage && <AppButton type="button" variant="secondary" disabled={templates.isFetchingNextPage} onClick={() => void templates.fetchNextPage()}>{templates.isFetchingNextPage ? 'Loading…' : 'Load more templates'}</AppButton>}
    </section>}

    {showAssignmentForm && isCoordinator && <section className="inspection-panel inspection-form-panel" aria-labelledby="new-inspection-title"><div className="inspection-panel-heading"><div><h2 id="new-inspection-title">New inspection</h2><p>The saved assignment pins the selected checklist revision.</p></div><AppButton type="button" variant="quiet" disabled={formLocked} onClick={() => setShowAssignmentForm(false)}>Close</AppButton></div>
      <form onSubmit={createAssignment} className="inspection-form">
        <label className="field" htmlFor="inspection-asset-search"><span>Find an active asset</span><input id="inspection-asset-search" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} disabled={formLocked} placeholder="Search by name or code" /></label>
        {assetQuery.isPending ? <LoadingNotice label="Loading authorized assets…" /> : assetQuery.isError ? <div><ErrorNotice>Assets are unavailable.</ErrorNotice><AppButton type="button" variant="secondary" onClick={() => void assetQuery.refetch()}>Retry assets</AppButton></div> : <SelectField id="inspection-asset" label="Asset" required value={assignmentFields.asset_id} disabled={formLocked} onChange={(event) => setAssignmentFields({ ...assignmentFields, asset_id: event.target.value })}><option value="">Choose an active asset</option>{assetRows.map((asset) => <option key={asset.id} value={asset.id}>{asset.code} · {asset.name}</option>)}</SelectField>}
        {assetQuery.hasNextPage && <AppButton type="button" variant="secondary" disabled={assetQuery.isFetchingNextPage || formLocked} onClick={() => void assetQuery.fetchNextPage()}>{assetQuery.isFetchingNextPage ? 'Loading assets…' : 'Load more assets'}</AppButton>}
        <SelectField id="inspection-template-revision" label="Pinned checklist revision" required value={assignmentFields.template_revision_id} disabled={formLocked} onChange={(event) => setAssignmentFields({ ...assignmentFields, template_revision_id: event.target.value })}><option value="">Choose a published revision</option>{templateRows.map((template) => <option key={template.id} value={template.current_revision_id}>{template.title} · revision {revisionByTemplate.get(template.id)?.revision ?? 'current'}</option>)}</SelectField>
        {templates.hasNextPage && <AppButton type="button" variant="secondary" disabled={templates.isFetchingNextPage || formLocked} onClick={() => void templates.fetchNextPage()}>Load more templates</AppButton>}
        {team.isPending ? <LoadingNotice label="Loading eligible inspectors…" /> : team.isError ? <div><ErrorNotice>Eligible inspectors are unavailable.</ErrorNotice><AppButton type="button" variant="secondary" onClick={() => void team.refetch()}>Retry team</AppButton></div> : <SelectField id="inspection-inspector" label="Inspector" required value={assignmentFields.inspector_id} disabled={formLocked} onChange={(event) => setAssignmentFields({ ...assignmentFields, inspector_id: event.target.value })}><option value="">Choose an active inspector</option>{team.data?.filter((member) => member.active && ['owner', 'manager', 'supervisor', 'technician'].includes(member.role)).map((member) => <option key={member.user_id} value={member.user_id}>{member.user_id === user.id ? 'You · ' : ''}{member.role} · {member.user_id.slice(0, 8)}</option>)}</SelectField>}
        <Field id="inspection-due-on" label="Due date" type="date" value={assignmentFields.due_on} disabled={formLocked} onChange={(event) => setAssignmentFields({ ...assignmentFields, due_on: event.target.value })} />
        {assignmentError && <ErrorNotice>{assignmentError}</ErrorNotice>}
        {assignmentIntent && <div className="inspection-pending" role="alert"><p>The save result is uncertain. The assignment details and request identity are locked for retry.</p><AppButton type="button" disabled={assignmentBusy} onClick={() => void runAssignment()}>{assignmentBusy ? 'Retrying exact save…' : 'Retry exact assignment'}</AppButton></div>}
        <AppButton type="submit" disabled={formLocked || assetQuery.isPending || team.isPending || templates.isPending}>{assignmentBusy ? 'Saving…' : assignmentIntent ? 'Retry exact assignment' : 'Assign inspection'}</AppButton>
      </form>
    </section>}

    {showTemplateForm && isCoordinator && <section className="inspection-panel inspection-form-panel" aria-labelledby="template-editor-title"><div className="inspection-panel-heading"><div><h2 id="template-editor-title">{templateEditor?.id ? 'Revise checklist template' : 'New checklist template'}</h2><p>Publishing creates a version. Assigned inspections keep their pinned revision.</p></div><AppButton type="button" variant="quiet" disabled={Boolean(templateIntent) || templateBusy} onClick={() => { setShowTemplateForm(false); setTemplateEditor(null); setTemplateIntent(null); templateIntentRef.current = null; }}>Close</AppButton></div>
      <form className="inspection-form" onSubmit={saveTemplate}>
        <Field id="inspection-template-title" label="Template name" required maxLength={200} value={templateFields.title} disabled={Boolean(templateIntent) || templateBusy} onChange={(event) => setTemplateFields({ ...templateFields, title: event.target.value })} />
        <fieldset className="inspection-checklist-editor"><legend>Checklist items</legend>{templateFields.items.map((item, index) => <div className="inspection-template-item" key={item.id}>
          <Field id={`inspection-item-label-${item.id}`} label={`Item ${index + 1}`} required maxLength={500} value={item.label} disabled={Boolean(templateIntent) || templateBusy} onChange={(event) => setTemplateFields({ ...templateFields, items: templateFields.items.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row) })} />
          <label className="inspection-toggle"><input type="checkbox" checked={item.required} disabled={Boolean(templateIntent) || templateBusy} onChange={(event) => setTemplateFields({ ...templateFields, items: templateFields.items.map((row) => row.id === item.id ? { ...row, required: event.target.checked } : row) })} /> Required</label>
          <label className="inspection-toggle"><input type="checkbox" checked={item.safety_relevant} disabled={Boolean(templateIntent) || templateBusy} onChange={(event) => setTemplateFields({ ...templateFields, items: templateFields.items.map((row) => row.id === item.id ? { ...row, safety_relevant: event.target.checked } : row) })} /> Safety relevant</label>
          <label className="inspection-toggle"><input type="checkbox" checked={item.evidence_required} disabled={Boolean(templateIntent) || templateBusy} onChange={(event) => setTemplateFields({ ...templateFields, items: templateFields.items.map((row) => row.id === item.id ? { ...row, evidence_required: event.target.checked } : row) })} /> Private evidence required</label>
          <AppButton type="button" variant="quiet" disabled={templateFields.items.length <= 1 || Boolean(templateIntent) || templateBusy} onClick={() => setTemplateFields({ ...templateFields, items: templateFields.items.filter((row) => row.id !== item.id) })}>Remove item</AppButton>
        </div>)}
        <AppButton type="button" variant="secondary" disabled={templateFields.items.length >= 100 || Boolean(templateIntent) || templateBusy} onClick={() => setTemplateFields({ ...templateFields, items: [...templateFields.items, { id: crypto.randomUUID(), label: '', required: true, safety_relevant: false, evidence_required: false }] })}>Add checklist item</AppButton></fieldset>
        {templateError && <ErrorNotice>{templateError}</ErrorNotice>}
        {templateConflict && <div className="inspection-pending" role="alert"><p>This template changed after your draft was loaded. Reload its latest revision before publishing again.</p><AppButton type="button" variant="secondary" onClick={() => { setTemplateIntent(null); templateIntentRef.current = null; setTemplateConflict(false); setTemplateEditor(null); setShowTemplateForm(false); void templates.refetch(); }}>Discard draft and load latest template list</AppButton></div>}
        {templateIntent && <div className="inspection-pending" role="alert"><p>The save result is uncertain. The template and request identity are locked for retry.</p><AppButton type="button" disabled={templateBusy} onClick={() => void runTemplateSave()}>{templateBusy ? 'Retrying exact save…' : 'Retry exact template save'}</AppButton></div>}
        <AppButton type="submit" disabled={Boolean(templateIntent) || templateBusy}>{templateBusy ? 'Publishing…' : templateEditor?.id ? 'Publish revision' : 'Publish template'}</AppButton>
      </form>
    </section>}

    {selectedId && <section className="inspection-panel inspection-detail-panel" aria-label="Selected inspection detail">
      {activeDetail?.isPending ? <LoadingNotice label="Loading authorized inspection history…" /> : activeDetail?.isError || !selected ? <div><ErrorNotice>This inspection or its history is unavailable with your current workspace access.</ErrorNotice><AppButton type="button" variant="secondary" onClick={() => void activeDetail?.refetch()}>Retry inspection detail</AppButton></div> : <>
        <div className="inspection-panel-heading"><div><p className="inspection-overline">Assignment {selected.assignment.id.slice(0, 8)} · pinned revision {selected.revision.revision}</p><h2>{selected.revision.title}</h2><p>{assetById.get(selected.assignment.asset_id)?.name ?? `Asset ${selected.assignment.asset_id.slice(0, 8)}`} · due {displayDate(selected.assignment.due_on)}</p></div><AppButton type="button" variant="quiet" disabled={Boolean(saveIntent) || saveBusy || uploadBusy} onClick={() => setSelectedId(null)}>Close details</AppButton></div>
        {selected.submission && !correcting && <ResultList detail={selected} attachments={attachments.data ?? []} evidenceState={attachments.isError ? 'failed' : attachments.isPending ? 'loading' : 'loaded'} client={client} organizationId={organization.id} userId={user.id} timeZone={organization.timezone} />}
        {(correcting || !selected.submission) && maySubmitChecklist ? <form className="inspection-checklist" onSubmit={handleChecklistSave}>
          <fieldset disabled={checklistLocked}>
            <legend>{correcting ? 'Correct the latest inspection' : 'Pinned checklist'}</legend>
            {correcting && <TextAreaField id="inspection-correction-reason" label="Correction reason" required maxLength={2000} disabled={checklistLocked} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} />}
            {selected.revision.items.map((item) => {
              const result = draft[item.id] ?? { outcome: '', reason: '', remarks: '', evidenceIds: [] };
              const invalid = item.required && !result.outcome || result.outcome === 'not_applicable' && !result.reason.trim() || result.outcome !== '' && result.outcome !== 'pass' && !result.remarks.trim() || Boolean(item.evidence_required && result.outcome && !result.evidenceIds.length);
              const evidence = (attachments.data ?? []).filter((attachment) => result.evidenceIds.includes(attachment.id));
              const evidenceKey = `${selected.assignment.id}:${item.id}`;
              return <article className="inspection-checklist-item" key={item.id}>
                <div className="inspection-item-heading"><h3>{item.label}</h3><div className="inspection-item-tags">{item.required && <span>Required</span>}{item.safety_relevant && <span>Safety relevant</span>}{item.evidence_required && <span>Evidence required</span>}</div></div>
                <SelectField id={`inspection-outcome-${item.id}`} label="Outcome" required={item.required} value={result.outcome} error={invalid && item.required && !result.outcome ? 'Choose an outcome.' : undefined} onChange={(event) => setItemDraft(item.id, { outcome: event.target.value as ResultDraft['outcome'] })}><option value="">Choose an outcome</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="not_applicable">Not applicable</option></SelectField>
                {result.outcome === 'not_applicable' && <TextAreaField id={`inspection-reason-${item.id}`} label="Why this item does not apply" required maxLength={2000} value={result.reason} error={!result.reason.trim() ? 'Explain why this item does not apply.' : undefined} onChange={(event) => setItemDraft(item.id, { reason: event.target.value })} />}
                <TextAreaField id={`inspection-remarks-${item.id}`} label={result.outcome === 'fail' ? 'Failure remarks' : 'Remarks'} required={result.outcome !== '' && result.outcome !== 'pass'} maxLength={4000} value={result.remarks} error={result.outcome !== '' && result.outcome !== 'pass' && !result.remarks.trim() ? 'Add remarks for this result.' : undefined} onChange={(event) => setItemDraft(item.id, { remarks: event.target.value })} />
                {evidence.length > 0 && <ul className="inspection-private-images">{evidence.map((attachment) => <li key={attachment.id}><PrivateImage client={client} organizationId={organization.id} userId={user.id} attachment={attachment} /></li>)}</ul>}
                {attachments.isError && <ErrorNotice>Private evidence could not be listed for this assignment.</ErrorNotice>}
                <EvidenceUpload client={client} organizationId={organization.id} assignmentId={selected.assignment.id} itemId={item.id} intent={pendingEvidence?.key === evidenceKey ? pendingEvidence.intent : null} pendingElsewhere={evidencePendingElsewhere} disabled={checklistLocked} onIntentChange={(intent) => setEvidenceIntent(evidenceKey, intent)} onBusyChange={setUploadBusy} onReady={(attachment) => {
                    setDraft((current) => {
                      const currentResult = current[item.id] ?? { outcome: '', reason: '', remarks: '', evidenceIds: [] };
                      return { ...current, [item.id]: { ...currentResult, evidenceIds: [...new Set([...currentResult.evidenceIds, attachment.id])] } };
                    });
                    cache.setQueryData<z.output<typeof attachmentRows>>(['inspection-attachments', user.id, organization.id, role, selected.assignment.id], (current) => current ? [...current.filter((row) => row.id !== attachment.id), attachment].slice(-10) : [attachment]);
                  }} />
              </article>;
            })}
          </fieldset>
          {saveError && <ErrorNotice>{saveError}</ErrorNotice>}
          {saveConflict && <div className="inspection-pending" role="alert"><p>This inspection changed after your draft was loaded. Reloading discards the local draft; the saved history remains intact.</p><AppButton type="button" variant="secondary" onClick={() => void reloadAfterConflict()}>Discard draft and reload inspection</AppButton></div>}
          {saveIntent && <div className="inspection-pending" role="alert"><p>The save result is uncertain. The checklist and request identity are locked for retry.</p><AppButton type="button" disabled={saveBusy || evidencePendingForSelected} onClick={() => void runChecklistSave()}>{saveBusy ? 'Retrying exact save…' : 'Retry exact checklist save'}</AppButton></div>}
          {evidencePendingForSelected && <p className="field-hint" role="status">Finish or retry private evidence uploads before saving this inspection.</p>}
          <AppButton type="submit" disabled={checklistBlocked || attachments.isError}>{saveBusy ? 'Saving…' : correcting ? 'Save correction' : 'Submit inspection'}</AppButton>
        </form> : selected.submission ? <div className="inspection-correction-action">{maySubmitChecklist ? <AppButton type="button" variant="secondary" onClick={() => { setDraft(newDraft(selected.revision, selected.submission ?? undefined)); setCorrecting(true); setCorrectionReason(''); setSaveError(''); }}>Record a correction</AppButton> : <p role="status">Only the assigned inspector can submit or correct this checklist.</p>}<p>Corrections preserve submitted results and may create a new corrective request and hold when a failure returns after its prior remedy closes.</p></div> : <p className="field-hint" role="status">Only the assigned inspector can submit this checklist.</p>}
        <InspectionHistory detail={selected} attachments={attachments.data ?? []} evidenceState={attachments.isError ? 'failed' : attachments.isPending ? 'loading' : 'loaded'} client={client} organizationId={organization.id} userId={user.id} timeZone={organization.timezone} />
      </>}
    </section>}
  </section>;
}

function OutcomeSummary({ total, passed, failed, inProgress, pending }: { total: number; passed: number; failed: number; inProgress: number; pending: boolean }) {
  const resolved = passed + failed + inProgress;
  const passedShare = resolved ? Math.round(passed / resolved * 100) : 0;
  const failedShare = resolved ? Math.round(failed / resolved * 100) : 0;
  const inProgressShare = Math.max(0, 100 - passedShare - failedShare);
  return <section className="inspection-panel inspection-outcomes" aria-labelledby="inspection-outcomes-title">
    <div className="inspection-panel-heading"><h2 id="inspection-outcomes-title">Inspection outcomes</h2></div>
    {pending ? <p role="status">Loading outcomes for this assignment page…</p> : <div className="inspection-outcome-summary"><div className="inspection-donut" aria-hidden="true" style={{ background: `conic-gradient(var(--success) 0 ${passedShare}%, var(--danger) ${passedShare}% ${passedShare + failedShare}%, var(--muted) ${passedShare + failedShare}% ${passedShare + failedShare + inProgressShare}%)` }}><span>{resolved}<small>known</small></span></div><ul><li><span>Passed</span><strong>{passed}</strong></li><li><span>Failed</span><strong>{failed}</strong></li><li><span>In progress</span><strong>{inProgress}</strong></li><li><span>Total assignments on this page</span><strong>{total}</strong></li></ul></div>}
  </section>;
}

type EvidenceReadState = 'loading' | 'failed' | 'loaded';
type SubmissionResultsProps = {
  detail: InspectionDetail; submission: NonNullable<InspectionDetail['submission']>; attachments: z.output<typeof attachmentRecord>[];
  evidenceState: EvidenceReadState; client: ReturnType<typeof useWorkspace>['client']; organizationId: string; userId: string; timeZone: string;
};

function ResultList({ detail, attachments, evidenceState, client, organizationId, userId, timeZone }: Omit<SubmissionResultsProps, 'submission'>) {
  const submission = detail.submission;
  if (!submission) return null;
  return <section className="inspection-submitted" aria-label="Latest saved results"><h3>Latest saved results · version {submission.version}</h3>
    <SubmissionResults detail={detail} submission={submission} attachments={attachments} evidenceState={evidenceState} client={client} organizationId={organizationId} userId={userId} timeZone={timeZone} />
  </section>;
}

function SubmissionResults({ detail, submission, attachments, evidenceState, client, organizationId, userId, timeZone }: SubmissionResultsProps) {
  return <div className="inspection-submission-results"><p>Submitted {displayInstant(submission.submitted_at, timeZone)} · Submitted by inspector {submission.inspector_id}{submission.correction_reason ? ` · Correction: ${submission.correction_reason}` : ''}</p><ul>{submission.results.map((result) => {
    const item = detail.revision.items.find((candidate) => candidate.id === result.item_id);
    const images = attachments.filter((attachment) => result.evidence_ids.includes(attachment.id));
    const missingEvidenceCount = result.evidence_ids.length - images.length;
    return <li key={result.item_id}><div><strong>{item?.label ?? `Checklist item ${result.item_id.slice(0, 8)}`}</strong><span className={`inspection-status inspection-status--${result.outcome === 'not_applicable' ? 'not-applicable' : result.outcome}`}>{result.outcome === 'not_applicable' ? 'Not applicable' : result.outcome === 'pass' ? 'Passed' : 'Failed'}</span></div>{result.reason && <p>Reason: {result.reason}</p>}{result.remarks && <p>Remarks: {result.remarks}</p>}{images.length > 0 && <ul className="inspection-private-images">{images.map((attachment) => <li key={attachment.id}><PrivateImage client={client} organizationId={organizationId} userId={userId} attachment={attachment} /></li>)}</ul>}{missingEvidenceCount > 0 && <p role="status">{evidenceState === 'failed' ? 'Private evidence references could not be verified.' : evidenceState === 'loading' ? 'Loading authorized private evidence…' : `${missingEvidenceCount} evidence reference${missingEvidenceCount === 1 ? ' is' : 's are'} outside the 10 most recent authorized evidence records currently loaded.`}</p>}</li>;
  })}</ul></div>;
}

function InspectionHistory({ detail, attachments, evidenceState, client, organizationId, userId, timeZone }: Omit<SubmissionResultsProps, 'submission'>) {
  if (!detail.history.length && !detail.episodes.length && !detail.holds.length) return null;
  const holdById = new Map(detail.holds.map((hold) => [hold.id, hold]));
  return <section className="inspection-history" aria-labelledby="inspection-history-title"><h3 id="inspection-history-title">Correction and hold history</h3>
    {detail.history.length > 0 && <ol className="inspection-history-list">{detail.history.map((submission) => <li key={submission.id}><div><strong>Submission version {submission.version}</strong><span>{displayInstant(submission.submitted_at, timeZone)}</span></div><p>Submitted by inspector {submission.inspector_id}</p>{submission.correction_reason && <p>Correction reason: {submission.correction_reason}</p>}{submission.supersedes_id && <p>Supersedes submission {submission.supersedes_id.slice(0, 8)}.</p>}{detail.episode_links.filter((link) => link.submission_id === submission.id).map((link) => {
      const episode = detail.episodes.find((item) => item.id === link.episode_id); const hold = episode?.hold_id ? holdById.get(episode.hold_id) : undefined;
      return <p key={`${link.submission_id}:${link.item_id}`}><span>Failure episode · </span>{episode?.predecessor_id && <span>linked to prior episode {episode.predecessor_id.slice(0, 8)} · </span>}{episode ? <Link to={`/requests?request=${encodeURIComponent(episode.corrective_request_id)}`}>Open corrective request</Link> : <span>Corrective request link unavailable</span>}{hold && <> · <span className={hold.released_at ? 'inspection-hold inspection-hold--released' : 'inspection-hold'}>{hold.released_at ? 'Released hold' : hold.resolved_at ? 'Resolved; unreleased hold' : 'Unresolved hold'}</span></>}</p>;
    })}{submission.id !== detail.submission?.id && <details className="inspection-history-results" aria-label={`Historical results for submission version ${submission.version}`}><summary>View saved results for version {submission.version}</summary><SubmissionResults detail={detail} submission={submission} attachments={attachments} evidenceState={evidenceState} client={client} organizationId={organizationId} userId={userId} timeZone={timeZone} /></details>}</li>)}</ol>}
    {detail.episodes.length > 0 && <div className="inspection-episodes"><h4>Failure episodes</h4><ul>{detail.episodes.map((episode) => {
      const hold = episode.hold_id ? holdById.get(episode.hold_id) : undefined;
      return <li key={episode.id}><span>Episode {episode.id.slice(0, 8)} · {displayInstant(episode.created_at, timeZone)}</span>{episode.predecessor_id && <span> · follows {episode.predecessor_id.slice(0, 8)}</span>}<span> · </span><Link to={`/requests?request=${encodeURIComponent(episode.corrective_request_id)}`}>Corrective request</Link>{hold && <span className={hold.released_at ? 'inspection-hold inspection-hold--released' : 'inspection-hold'}> · {hold.released_at ? 'Released' : hold.resolved_at ? 'Resolved; unreleased' : 'Unresolved hold'}</span>}</li>;
    })}</ul></div>}
    {detail.holds.length > 0 && <div className="inspection-episodes"><h4>Asset holds</h4><ul>{detail.holds.map((hold) => <li key={hold.id}><Link to={`/assets?asset=${encodeURIComponent(hold.asset_id)}`}>Asset {hold.asset_id.slice(0, 8)}</Link><span> · {hold.reason}</span><span className={hold.released_at ? 'inspection-hold inspection-hold--released' : 'inspection-hold'}> · {hold.released_at ? 'Released' : hold.resolved_at ? 'Resolved; release not recorded' : 'Unresolved'}</span></li>)}</ul></div>}
  </section>;
}
