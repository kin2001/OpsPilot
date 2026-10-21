import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { Tables } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { useWorkspace } from './workspace';
import {
  convertRequest, inviteMember, revokeInvitation, reviseRequest, saveAsset, saveRequest,
  setMember, submitRequest, triageRequest, withdrawRequest,
} from './commands';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, SuccessNotice, TextAreaField } from './ui';

type MaintenanceRequest = Tables<'maintenance_requests'>;
type Membership = Tables<'organization_members'>;
type Invitation = Tables<'organization_invitations'>;

function errorCode(error: unknown) {
  return domainError(error).code;
}

function errorMessage(error: unknown) {
  return domainError(error).message;
}

function QueryFailure({ retry }: { retry: () => void }) {
  return <div className="empty-state"><ErrorNotice>We could not load these records. Your current permissions remain authoritative; retry before continuing.</ErrorNotice><AppButton variant="secondary" onClick={retry}>Retry</AppButton></div>;
}

export function AssetPage() {
  const { client, user, organization, role } = useWorkspace();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [serial, setSerial] = useState('');
  const [registration, setRegistration] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const queryKey = ['assets', user.id, organization.id] as const;
  const assets = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ?? [];
    },
  });
  const mayRegister = ['owner', 'manager', 'supervisor'].includes(role);
  const visibleAssets = (assets.data ?? []).filter((asset) => `${asset.name} ${asset.code} ${asset.category}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedAsset = visibleAssets.find((asset) => asset.id === selectedId) ?? visibleAssets[0];
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await saveAsset(client, organization.id, { code: code.trim(), name: name.trim(), category: category.trim(), serial_number: serial.trim() || null, registration: registration.trim() || null }, requestId.current);
      setSuccess('Asset registered. Availability is not recorded.');
      setCode(''); setName(''); setCategory(''); setSerial(''); setRegistration('');
      requestId.current = crypto.randomUUID();
      setUncertain(false);
      await queryClient.invalidateQueries({ queryKey });
    } catch (caught) {
      const status = errorCode(caught);
      setError(errorMessage(caught));
      setUncertain(status === 'DEPENDENCY_UNAVAILABLE' || status === 'RATE_LIMITED');
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') requestId.current = crypto.randomUUID();
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageHeader eyebrow="Registry" title="Assets" description="Find the equipment and vehicles registered in this workspace." action={mayRegister ? <AppButton onClick={() => setFormOpen(!formOpen)}>{formOpen ? 'Close form' : 'Register asset'}</AppButton> : undefined} />
    {success && <div style={{ marginTop: 16 }}><SuccessNotice>{success}</SuccessNotice></div>}
    {formOpen && mayRegister && <section className="panel" aria-labelledby="asset-form-title" style={{ marginTop: 16 }}>
      <h2 id="asset-form-title">Register an asset</h2>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <div className="form-row"><Field id="asset-code" label="Asset code" required maxLength={100} disabled={busy || uncertain} value={code} onChange={(event) => setCode(event.target.value)} /><Field id="asset-name" label="Name" required maxLength={200} disabled={busy || uncertain} value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="form-row"><Field id="asset-category" label="Category" required maxLength={100} disabled={busy || uncertain} value={category} onChange={(event) => setCategory(event.target.value)} /><Field id="asset-serial" label="Serial number (optional)" maxLength={200} disabled={busy || uncertain} value={serial} onChange={(event) => setSerial(event.target.value)} /></div>
        <Field id="asset-registration" label="Registration (optional)" maxLength={200} disabled={busy || uncertain} value={registration} onChange={(event) => setRegistration(event.target.value)} />
      <div className="button-row"><AppButton type="submit" disabled={busy}>{busy ? 'Saving…' : uncertain ? 'Retry with the same request' : 'Save asset'}</AppButton><AppButton type="button" variant="secondary" onClick={() => { setFormOpen(false); setError(''); setUncertain(false); requestId.current = crypto.randomUUID(); void queryClient.invalidateQueries({ queryKey }); }} disabled={busy}>Cancel</AppButton></div>
      </form>
    </section>}
    {assets.isPending ? <LoadingNotice label="Loading assets…" /> : assets.isError ? <QueryFailure retry={() => void assets.refetch()} /> : assets.data.length === 0 ? <div className="empty-state"><h2>No assets are visible</h2><p>{mayRegister ? 'Register the first asset before submitting a maintenance request.' : 'Ask a workspace owner or supervisor to register an asset.'}</p>{mayRegister && <AppButton onClick={() => setFormOpen(true)}>Register asset</AppButton>}</div> : <div className="record-workspace" aria-label="Assets in this workspace">
      <section className="record-picker" aria-label="Asset registry">
        <label className="field-label" htmlFor="asset-search">Search assets</label>
        <input className="record-search" id="asset-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, code or category" />
        {visibleAssets.length ? <>
          <div className="record-table-scroll"><table className="responsive-record-table" aria-label="Asset registry results"><thead><tr><th scope="col">Asset</th><th scope="col">Code</th><th scope="col">Category</th><th scope="col">Record</th></tr></thead><tbody>{visibleAssets.map((asset) => <tr key={asset.id} aria-selected={selectedAsset?.id === asset.id}>
            <td><button className="table-select" type="button" aria-pressed={selectedAsset?.id === asset.id} onClick={() => setSelectedId(asset.id)}>{asset.name}</button></td><td>{asset.code}</td><td>{asset.category}</td><td><span className="state-badge">{asset.archived_at ? 'Archived' : 'Registered'}</span></td>
          </tr>)}</tbody></table></div>
          <ol className="record-picker-list mobile-record-list">{visibleAssets.map((asset) => <li key={asset.id}><button className="record-picker-option" type="button" aria-pressed={selectedAsset?.id === asset.id} onClick={() => setSelectedId(asset.id)}>
          <span className="record-picker-title">{asset.name}</span><span className="record-picker-meta">{asset.code} · {asset.category}</span><span className="state-badge">{asset.archived_at ? 'Archived' : 'Registered'}</span>
          </button></li>)}</ol>
        </> : <p className="field-hint">No assets match your search.</p>}
      </section>
      <section className="record-preview" aria-label="Selected asset details" aria-live="polite">
        {selectedAsset ? <>
          <div className="record-header"><div><p className="page-kicker">Asset record</p><h2>{selectedAsset.name}</h2></div><span className="state-badge">{selectedAsset.archived_at ? 'Archived' : 'Registered'}</span></div>
          <dl className="detail-grid"><div><dt>Asset code</dt><dd>{selectedAsset.code}</dd></div><div><dt>Category</dt><dd>{selectedAsset.category}</dd></div>{selectedAsset.serial_number && <div><dt>Serial number</dt><dd>{selectedAsset.serial_number}</dd></div>}{selectedAsset.registration && <div><dt>Registration</dt><dd>{selectedAsset.registration}</dd></div>}<div><dt>Availability</dt><dd>Not recorded</dd></div></dl>
        </> : <p className="field-hint">Select an asset to view its recorded details.</p>}
      </section>
    </div>}
  </>;
}

async function lookupAsset(client: ReturnType<typeof useWorkspace>['client'], organizationId: string, input: { code?: string; id?: string }, signal?: AbortSignal) {
  const rpc = client.rpc('lookup_request_asset', {
    organization_id: organizationId,
    ...(input.code ? { asset_code: input.code } : {}),
    ...(input.id ? { asset_id: input.id } : {}),
  });
  const result = signal ? await rpc.abortSignal(signal) : await rpc;
  if (result.error) throw new Error(domainError(result.error).code);
  const parsed = z.array(z.strictObject({ id: z.uuid(), code: z.string(), name: z.string() })).safeParse(result.data);
  if (!parsed.success || parsed.data.length !== 1) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data[0];
}

export function RequestPage() {
  const { client, user, organization, role } = useWorkspace();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaintenanceRequest | null>(null);
  const [assetCode, setAssetCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, 'return' | 'reject' | 'convert' | 'withdraw'>>({});
  const [runningActions, setRunningActions] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [priorities, setPriorities] = useState<Record<string, 'low' | 'normal' | 'high' | 'critical'>>({});
  const commandIds = useRef(new Map<string, string>());
  const newRequestId = useRef(crypto.randomUUID());
  const submitCommandId = useRef('');
  const savedRequestId = useRef<string | null>(null);
  const savedRequest = useRef<MaintenanceRequest | null>(null);
  const awaitingSubmit = useRef(false);
  const reviseCommandId = useRef('');
  const queryKey = ['requests', user.id, organization.id] as const;
  const requests = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await client.from('maintenance_requests').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ?? [];
    },
  });
  const isCoordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const visibleRequests = (requests.data ?? []).filter((request) =>
    (statusFilter === 'all' || request.status === statusFilter)
    && `${request.category} ${request.description} ${request.status}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedRequest = visibleRequests.find((request) => request.id === selectedId) ?? visibleRequests[0];
  const selectedAsset = useQuery({
    queryKey: ['request-asset', user.id, organization.id, selectedRequest?.asset_id ?? null],
    enabled: Boolean(selectedRequest),
    queryFn: ({ signal }) => lookupAsset(client, organization.id, { id: selectedRequest!.asset_id }, signal),
  });

  const resetForm = () => {
    setFormOpen(false); setEditing(null); setAssetCode(''); setDescription(''); setCategory(''); setError(''); setLocked(false);
    savedRequestId.current = null; savedRequest.current = null; awaitingSubmit.current = false; reviseCommandId.current = '';
    submitCommandId.current = ''; newRequestId.current = crypto.randomUUID();
  };

  const beginEdit = async (request: MaintenanceRequest) => {
    setError('');
    try {
      const asset = await lookupAsset(client, organization.id, { id: request.asset_id });
      setEditing(request); savedRequest.current = null; savedRequestId.current = null; awaitingSubmit.current = false; reviseCommandId.current = '';
      setAssetCode(asset.code); setDescription(request.description); setCategory(request.category); setFormOpen(true); setLocked(false);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const saveAndSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(''); setSuccess('');
    try {
      const asset = await lookupAsset(client, organization.id, { code: assetCode.trim() });
      let requestId = savedRequestId.current;
      if (!awaitingSubmit.current && (editing || savedRequest.current)) {
        const current = savedRequest.current ?? editing!;
        if (!reviseCommandId.current) reviseCommandId.current = crypto.randomUUID();
        const updated = await reviseRequest(client, organization.id, current.id, current.version, { asset_id: asset.id, description: description.trim(), category: category.trim() }, reviseCommandId.current);
        requestId = updated.id;
        savedRequestId.current = updated.id;
        savedRequest.current = updated;
        setEditing(updated);
        awaitingSubmit.current = true;
        setLocked(true);
      } else if (!requestId) {
        const draft = await saveRequest(client, organization.id, { asset_id: asset.id, description: description.trim(), category: category.trim() }, newRequestId.current);
        requestId = draft.id;
        savedRequestId.current = requestId;
        savedRequest.current = draft;
        awaitingSubmit.current = true;
        setLocked(true);
      }
      if (!submitCommandId.current) submitCommandId.current = crypto.randomUUID();
      await submitRequest(client, organization.id, requestId!, submitCommandId.current);
      setSuccess('Request submitted for workspace review.');
      awaitingSubmit.current = false;
      resetForm();
      await queryClient.invalidateQueries({ queryKey });
    } catch (caught) {
      const status = errorCode(caught);
      setError(status === 'NOT_FOUND' ? 'That asset code is not available in this workspace.' : errorMessage(caught));
      setLocked(status === 'DEPENDENCY_UNAVAILABLE' || status === 'RATE_LIMITED');
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        if (!savedRequestId.current) newRequestId.current = crypto.randomUUID();
        if (awaitingSubmit.current) {
          awaitingSubmit.current = false;
        }
        reviseCommandId.current = '';
        submitCommandId.current = '';
        if (savedRequestId.current) void queryClient.invalidateQueries({ queryKey });
      }
    } finally {
      setBusy(false);
    }
  };

  const runRowAction = async (request: MaintenanceRequest, action: 'return' | 'reject' | 'convert' | 'withdraw') => {
    const existingAction = pendingActions[request.id];
    if (existingAction && existingAction !== action) return;
    const commandKey = `${request.id}:${action}`;
    const commandId = commandIds.current.get(commandKey) ?? crypto.randomUUID();
    commandIds.current.set(commandKey, commandId);
    setRunningActions((previous) => ({ ...previous, [request.id]: true }));
    setRowErrors((previous) => ({ ...previous, [commandKey]: '' }));
    try {
      if (action === 'return' || action === 'reject') {
        const reason = reasons[request.id]?.trim() ?? '';
        if (!reason) throw new Error('VALIDATION');
        await triageRequest(client, organization.id, request.id, action === 'return' ? 'returned' : 'rejected', reason, commandId);
      } else if (action === 'convert') {
        const title = (titles[request.id] ?? request.description.slice(0, 200)).trim();
        if (!title) throw new Error('VALIDATION');
        await convertRequest(client, organization.id, request.id, { title, priority: priorities[request.id] ?? 'normal' }, commandId);
      } else {
        const reason = reasons[request.id]?.trim() ?? '';
        if (!reason) throw new Error('VALIDATION');
        await withdrawRequest(client, organization.id, request.id, reason, commandId);
      }
      commandIds.current.delete(commandKey);
      setPendingActions((previous) => { const next = { ...previous }; delete next[request.id]; return next; });
      await queryClient.invalidateQueries({ queryKey });
    } catch (caught) {
      const status = errorCode(caught);
      setRowErrors((previous) => ({ ...previous, [commandKey]: status === 'VALIDATION' ? 'Enter the required reason or title before continuing.' : errorMessage(caught) }));
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        commandIds.current.delete(commandKey);
        setPendingActions((previous) => { const next = { ...previous }; delete next[request.id]; return next; });
      } else setPendingActions((previous) => ({ ...previous, [request.id]: action }));
    } finally {
      setRunningActions((previous) => { const next = { ...previous }; delete next[request.id]; return next; });
    }
  };

  return <>
    <PageHeader eyebrow="Maintenance intake" title="Requests" description="Report an issue against a workspace asset and follow its submitted, returned, converted or rejected state." action={<AppButton disabled={busy || locked} onClick={() => { if (formOpen) resetForm(); else { resetForm(); setFormOpen(true); } }}>{formOpen ? 'Close form' : 'New request'}</AppButton>} />
    {success && <SuccessNotice>{success}</SuccessNotice>}
    {formOpen && <section className="panel" aria-labelledby="request-form-title"><h2 id="request-form-title">{editing ? 'Edit returned request' : 'Submit a request'}</h2>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <form className="form-stack" onSubmit={(event) => void saveAndSubmit(event)}>
        <Field id="request-asset" label="Asset code" required maxLength={100} disabled={busy || locked} value={assetCode} onChange={(event) => setAssetCode(event.target.value)} hint="The code is checked within this workspace before the request is saved." />
        <TextAreaField id="request-description" label="What needs attention?" required minLength={1} maxLength={4000} disabled={busy || locked} value={description} onChange={(event) => setDescription(event.target.value)} />
        <Field id="request-category" label="Category" required maxLength={100} disabled={busy || locked} value={category} onChange={(event) => setCategory(event.target.value)} />
        <div className="button-row"><AppButton type="submit" disabled={busy}>{busy ? 'Saving…' : locked ? 'Retry with the same request IDs' : editing ? 'Save and resubmit' : 'Save and submit'}</AppButton><AppButton type="button" variant="secondary" disabled={busy || locked} onClick={resetForm}>Cancel</AppButton></div>
      </form>
    </section>}
    {requests.isPending ? <LoadingNotice label="Loading requests…" /> : requests.isError ? <QueryFailure retry={() => void requests.refetch()} /> : requests.data.length === 0 ? <div className="empty-state"><h2>No requests yet</h2><p>Start with a registered asset and describe the issue for your workspace team.</p><AppButton onClick={() => setFormOpen(true)}>Create request</AppButton></div> : <div className="record-workspace" aria-label="Maintenance requests">
      <section className="record-picker" aria-label="Request inbox">
        <div className="record-filters"><div className="field"><label htmlFor="request-search">Search requests</label><input className="record-search" id="request-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description or category" /></div><div className="field"><label htmlFor="request-status-filter">Status</label><select className="record-search" id="request-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="returned">Returned</option><option value="converted">Converted</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option></select></div></div>
        {visibleRequests.length ? <>
          <div className="record-table-scroll"><table className="responsive-record-table" aria-label="Request inbox results"><thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead><tbody>{visibleRequests.map((request) => <tr key={request.id} aria-selected={selectedRequest?.id === request.id}>
            <td><button className="table-select table-select--record" type="button" aria-label={`${request.category} request: ${request.description}`} aria-pressed={selectedRequest?.id === request.id} onClick={() => setSelectedId(request.id)}><span className="record-picker-title">{request.category} request</span><span className="table-description">{request.description}</span></button></td><td><span className={`state-badge state-badge--${request.status}`}>{request.status}</span></td><td>{new Date(request.created_at).toLocaleDateString()}</td>
          </tr>)}</tbody></table></div>
          <ol className="record-picker-list mobile-record-list">{visibleRequests.map((request) => <li key={request.id}><button className="record-picker-option" type="button" aria-pressed={selectedRequest?.id === request.id} onClick={() => setSelectedId(request.id)}>
          <span className="record-picker-title">{request.category} request</span><span className={`state-badge state-badge--${request.status}`}>{request.status}</span><span className="record-picker-meta">{request.description}</span><span className="field-hint">{new Date(request.created_at).toLocaleDateString()}</span>
          </button></li>)}</ol>
        </> : <p className="field-hint">No requests match these filters.</p>}
      </section>
      <section className="record-preview" aria-label="Selected request details" aria-live="polite">
        {selectedRequest ? <>
          {(() => {
            const request = selectedRequest;
            const mayEdit = request.reporter_id === user.id && ['draft', 'returned'].includes(request.status);
            const mayWithdraw = request.reporter_id === user.id && ['draft', 'submitted', 'returned'].includes(request.status);
            const mayTriage = isCoordinator && request.status === 'submitted';
            return <>
              <div className="record-header"><div><p className="page-kicker">Request details</p><h2>{request.category} request</h2></div><span className={`state-badge state-badge--${request.status}`}>{request.status}</span></div>
              <dl className="detail-grid"><div><dt>Asset</dt><dd>{selectedAsset.isPending ? 'Loading asset details…' : selectedAsset.data?.code ?? 'Asset details unavailable'}</dd></div><div><dt>Created</dt><dd>{new Date(request.created_at).toLocaleDateString()}</dd></div></dl>
              <p className="record-description">{request.description}</p>
              {request.transition_reason && <p className="field-hint">Latest reason: {request.transition_reason}</p>}
              {request.converted_work_order_id && <p className="field-hint">Draft work order created: <Link to="/work-orders">view work orders</Link></p>}
              {(mayEdit || mayWithdraw || mayTriage) && <div className="record-actions">
                {mayEdit && <div className="compact-actions"><AppButton variant="secondary" onClick={() => void beginEdit(request)}>Edit and resubmit</AppButton></div>}
                {mayTriage && <>
                  <div className="form-row"><Field id={`triage-title-${request.id}`} label="Draft work order title" required maxLength={200} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={titles[request.id] ?? request.description.slice(0, 200)} onChange={(event) => setTitles((previous) => ({ ...previous, [request.id]: event.target.value }))} /><SelectField id={`triage-priority-${request.id}`} label="Priority" disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={priorities[request.id] ?? 'normal'} onChange={(event) => setPriorities((previous) => ({ ...previous, [request.id]: event.target.value as 'low' | 'normal' | 'high' | 'critical' }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></SelectField></div>
                  <Field id={`triage-reason-${request.id}`} label="Reason for return or rejection" maxLength={4000} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={reasons[request.id] ?? ''} onChange={(event) => setReasons((previous) => ({ ...previous, [request.id]: event.target.value }))} hint="Required when returning or rejecting. Not needed for conversion." />
                  {rowErrors[`${request.id}:convert`] && <ErrorNotice>{rowErrors[`${request.id}:convert`]}</ErrorNotice>}
                  {rowErrors[`${request.id}:return`] && <ErrorNotice>{rowErrors[`${request.id}:return`]}</ErrorNotice>}
                  {rowErrors[`${request.id}:reject`] && <ErrorNotice>{rowErrors[`${request.id}:reject`]}</ErrorNotice>}
                  <div className="compact-actions"><AppButton disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'convert')} onClick={() => void runRowAction(request, 'convert')}>{pendingActions[request.id] === 'convert' ? 'Retry conversion' : 'Convert to draft work order'}</AppButton><AppButton variant="secondary" disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'return')} onClick={() => void runRowAction(request, 'return')}>{pendingActions[request.id] === 'return' ? 'Retry return' : 'Return with reason'}</AppButton><AppButton variant="danger" disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'reject')} onClick={() => void runRowAction(request, 'reject')}>{pendingActions[request.id] === 'reject' ? 'Retry rejection' : 'Reject with reason'}</AppButton></div>
                </>}
                {mayWithdraw && <><Field id={`withdraw-reason-${request.id}`} label="Withdrawal reason" required maxLength={4000} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={reasons[request.id] ?? ''} onChange={(event) => setReasons((previous) => ({ ...previous, [request.id]: event.target.value }))} />{rowErrors[`${request.id}:withdraw`] && <ErrorNotice>{rowErrors[`${request.id}:withdraw`]}</ErrorNotice>}<div className="compact-actions"><AppButton variant="secondary" disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'withdraw')} onClick={() => void runRowAction(request, 'withdraw')}>{pendingActions[request.id] === 'withdraw' ? 'Retry withdrawal' : 'Withdraw request'}</AppButton></div></>}
              </div>}
              <span className="sr-only">Request reference {request.id}</span>
            </>;
          })()}
        </> : <p className="field-hint">Select a request to review its details.</p>}
      </section>
    </div>}
  </>;
}

export function WorkOrderPage() {
  const { client, user, organization } = useWorkspace();
  const [view, setView] = useState<'board' | 'table'>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['work-orders', user.id, organization.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('work_orders').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ?? [];
    },
  });
  const selectedWorkOrder = (query.data ?? []).find((workOrder) => workOrder.id === selectedId) ?? query.data?.[0];
  const selectedAsset = useQuery({
    queryKey: ['work-order-asset', user.id, organization.id, selectedWorkOrder?.asset_id ?? null],
    enabled: Boolean(selectedWorkOrder),
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('id,code,name').eq('organization_id', organization.id).eq('id', selectedWorkOrder!.asset_id).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data;
    },
  });
  return <>
    <PageHeader eyebrow="Maintenance planning" title="Work orders" description="Draft work orders are created from accepted requests. Work has not started while it remains a draft." />
    <div className="info-callout">A draft is not an assigned job, completed repair or operational release. Asset availability is not recorded here.</div>
    {query.isPending ? <LoadingNotice label="Loading work orders…" /> : query.isError ? <QueryFailure retry={() => void query.refetch()} /> : query.data.length === 0 ? <div className="empty-state"><h2>No draft work orders</h2><p>Convert a submitted maintenance request to create a linked draft work order.</p><Link className="button button--secondary" to="/requests">Review requests</Link></div> : <>
      <div className="view-toggle" role="group" aria-label="Work order view"><button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button><button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button></div>
      <div className="work-order-layout">
        {view === 'board' ? <section className="board-lane" aria-label="Draft work orders"><h2>Draft <span className="state-badge state-badge--draft">{query.data.length}</span></h2><ol className="record-picker-list">{query.data.map((workOrder) => <li key={workOrder.id}><button className="board-card" type="button" aria-pressed={selectedWorkOrder?.id === workOrder.id} onClick={() => setSelectedId(workOrder.id)}><span className="record-picker-title">WO-{String(workOrder.number).padStart(4, '0')} · {workOrder.title}</span><span className="record-picker-meta">{workOrder.priority} priority</span></button></li>)}</ol></section> : <section className="record-picker table-picker" aria-label="Draft work order table"><table><thead><tr><th scope="col">Work order</th><th scope="col">Title</th><th scope="col">Priority</th></tr></thead><tbody>{query.data.map((workOrder) => <tr key={workOrder.id} aria-selected={selectedWorkOrder?.id === workOrder.id}><td><button className="table-select" type="button" aria-pressed={selectedWorkOrder?.id === workOrder.id} onClick={() => setSelectedId(workOrder.id)}>WO-{String(workOrder.number).padStart(4, '0')}</button></td><td>{workOrder.title}</td><td>{workOrder.priority}</td></tr>)}</tbody></table></section>}
        <section className="record-preview" aria-label="Selected work order details" aria-live="polite">{selectedWorkOrder ? <>
          <div className="record-header"><div><p className="page-kicker">Work order details</p><h2>WO-{String(selectedWorkOrder.number).padStart(4, '0')} · {selectedWorkOrder.title}</h2></div><span className="state-badge state-badge--draft">Draft · Not started</span></div>
          <dl className="detail-grid"><div><dt>Priority</dt><dd>{selectedWorkOrder.priority}</dd></div><div><dt>Asset</dt><dd>{selectedAsset.isPending ? 'Loading asset details…' : selectedAsset.data?.code ?? 'Asset details unavailable'}</dd></div>{selectedWorkOrder.source_request_id && <div><dt>Source</dt><dd><Link to="/requests">Submitted request</Link></dd></div>}</dl>
          <p className="record-description">{selectedWorkOrder.description}</p>
          <p className="info-callout">Assignment and repair progress have not been recorded.</p>
        </> : <p className="field-hint">Select a draft work order to view its details.</p>}</section>
      </div>
    </>}
  </>;
}

type MemberRole = 'manager' | 'supervisor' | 'technician' | 'inventory';

export function TeamPage() {
  const { client, user, organization } = useWorkspace();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('technician');
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLocked, setInviteLocked] = useState(false);
  const inviteRequestId = useRef(crypto.randomUUID());
  const [memberRoles, setMemberRoles] = useState<Record<string, MemberRole>>({});
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
  const [memberLocked, setMemberLocked] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const memberIntent = useRef<{ id: string; userId: string; role: MemberRole; active: boolean; version: number } | null>(null);
  const [invitationErrors, setInvitationErrors] = useState<Record<string, string>>({});
  const [invitationLocked, setInvitationLocked] = useState<string | null>(null);
  const [invitationBusy, setInvitationBusy] = useState<string | null>(null);
  const invitationRequests = useRef(new Map<string, string>());
  const membersKey = ['team-members', user.id, organization.id] as const;
  const invitationsKey = ['team-invitations', user.id, organization.id] as const;
  const members = useQuery({
    queryKey: membersKey,
    queryFn: async ({ signal }) => {
      const result = await client.from('organization_members').select('*').eq('organization_id', organization.id).order('created_at').limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ?? [];
    },
  });
  const invitations = useQuery({
    queryKey: invitationsKey,
    queryFn: async ({ signal }) => {
      const result = await client.from('organization_invitations').select('*').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ?? [];
    },
  });

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteBusy(true); setInviteError(''); setInviteSuccess('');
    try {
      const result = await inviteMember(client, organization.id, email, inviteRole, inviteRequestId.current);
      setInviteSuccess(`Invitation delivery was requested for ${result.email}. Ask them to use the verified email address that received the link.`);
      setEmail(''); inviteRequestId.current = crypto.randomUUID(); setInviteLocked(false);
      await queryClient.invalidateQueries({ queryKey: invitationsKey });
    } catch (caught) {
      const status = errorCode(caught);
      setInviteError(errorMessage(caught));
      setInviteLocked(status === 'DEPENDENCY_UNAVAILABLE' || status === 'RATE_LIMITED');
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') inviteRequestId.current = crypto.randomUUID();
    } finally {
      setInviteBusy(false);
    }
  };

  const changeMember = async (member: Membership, active: boolean) => {
    const existing = memberIntent.current?.userId === member.user_id ? memberIntent.current : null;
    const role = existing?.role ?? memberRoles[member.user_id] ?? (member.role as MemberRole);
    const intent = existing ?? { id: crypto.randomUUID(), userId: member.user_id, role, active, version: member.version };
    if (existing && existing.active !== active) return;
    memberIntent.current = intent;
    setMemberLocked(member.user_id);
    setMemberBusy(member.user_id);
    setMemberErrors((previous) => ({ ...previous, [member.user_id]: '' }));
    try {
      await setMember(client, organization.id, member.user_id, intent.role, intent.active, intent.version, intent.id);
      memberIntent.current = null; setMemberLocked(null); setMemberBusy(null);
      setMemberRoles((previous) => { const next = { ...previous }; delete next[member.user_id]; return next; });
      await queryClient.invalidateQueries({ queryKey: membersKey });
    } catch (caught) {
      const status = errorCode(caught);
      setMemberErrors((previous) => ({ ...previous, [member.user_id]: errorMessage(caught) }));
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        memberIntent.current = null;
        setMemberLocked(null);
      }
    } finally {
      setMemberBusy(null);
    }
  };

  const revoke = async (invitation: Invitation) => {
    const requestId = invitationRequests.current.get(invitation.id) ?? crypto.randomUUID();
    invitationRequests.current.set(invitation.id, requestId);
    setInvitationLocked(invitation.id);
    setInvitationBusy(invitation.id);
    setInvitationErrors((previous) => ({ ...previous, [invitation.id]: '' }));
    try {
      await revokeInvitation(client, organization.id, invitation.id, invitation.version, requestId);
      invitationRequests.current.delete(invitation.id); setInvitationLocked(null);
      await queryClient.invalidateQueries({ queryKey: invitationsKey });
    } catch (caught) {
      const status = errorCode(caught);
      setInvitationErrors((previous) => ({ ...previous, [invitation.id]: errorMessage(caught) }));
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        invitationRequests.current.delete(invitation.id); setInvitationLocked(null);
      }
    } finally {
      setInvitationBusy(null);
    }
  };

  return <>
    <PageHeader eyebrow="Workspace access" title="Team" description="Invite verified accounts, review membership and keep access within this workspace." />
    {inviteSuccess && <SuccessNotice>{inviteSuccess}</SuccessNotice>}
    <section className="panel" aria-labelledby="invite-title">
      <h2 id="invite-title">Invite a teammate</h2>
      <p className="field-hint">The recipient must sign in with the verified email address that receives the invitation and explicitly accept it.</p>
      {inviteError && <ErrorNotice>{inviteError}</ErrorNotice>}
      <form className="form-stack" onSubmit={(event) => void invite(event)}>
        <div className="form-row">
          <Field id="invite-email" label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} disabled={inviteBusy || inviteLocked} value={email} onChange={(event) => setEmail(event.target.value)} />
          <SelectField id="invite-role" label="Workspace role" value={inviteRole} disabled={inviteBusy || inviteLocked} onChange={(event) => setInviteRole(event.target.value as MemberRole)}><option value="manager">Manager</option><option value="supervisor">Supervisor</option><option value="technician">Technician</option><option value="inventory">Inventory</option></SelectField>
        </div>
        <div className="button-row"><AppButton type="submit" disabled={inviteBusy}>{inviteBusy ? 'Requesting invitation…' : inviteLocked ? 'Retry with the same invitation' : 'Request invitation'}</AppButton></div>
      </form>
    </section>
    <section className="panel" aria-labelledby="members-title" style={{ marginTop: 18 }}>
      <h2 id="members-title">Workspace members</h2>
      {members.isPending ? <LoadingNotice label="Loading workspace members…" /> : members.isError ? <QueryFailure retry={() => void members.refetch()} /> : members.data.length === 0 ? <p className="field-hint">No workspace members are visible.</p> : <div className="record-list">{members.data.map((member) => {
        const owner = member.role === 'owner';
        const selectedRole = memberRoles[member.user_id] ?? (member.role as MemberRole);
        return <article className="record-card" key={member.user_id}>
          <div className="record-header"><h3>{member.user_id === user.id ? 'You' : 'Workspace member'}</h3><span className={`state-badge${member.active ? ' state-badge--converted' : ''}`}>{member.active ? 'Active' : 'Inactive'}</span></div>
          <div className="record-meta"><span>User ID <span className="monospace">{member.user_id}</span></span><span>Role: {owner ? 'Owner' : member.role}</span></div>
          {memberErrors[member.user_id] && <ErrorNotice>{memberErrors[member.user_id]}</ErrorNotice>}
          {!owner && <div className="form-row">
            <SelectField id={`member-role-${member.user_id}`} label="Role" value={selectedRole} disabled={memberLocked === member.user_id || memberBusy === member.user_id} onChange={(event) => setMemberRoles((previous) => ({ ...previous, [member.user_id]: event.target.value as MemberRole }))}><option value="manager">Manager</option><option value="supervisor">Supervisor</option><option value="technician">Technician</option><option value="inventory">Inventory</option></SelectField>
            <div className="field"><span className="field-label">Access</span><div className="compact-actions"><AppButton variant={member.active ? 'danger' : 'secondary'} disabled={memberBusy === member.user_id || memberLocked === member.user_id && memberIntent.current?.active !== !member.active} onClick={() => void changeMember(member, !member.active)}>{memberLocked === member.user_id && memberIntent.current?.active === !member.active ? 'Retry membership change' : member.active ? 'Deactivate access' : 'Reactivate access'}</AppButton><AppButton variant="secondary" disabled={memberBusy === member.user_id || memberLocked === member.user_id && memberIntent.current?.active !== member.active} onClick={() => void changeMember(member, member.active)}>{memberLocked === member.user_id && memberIntent.current?.active === member.active ? 'Retry role save' : 'Save role'}</AppButton></div></div>
          </div>}
          {owner && <p className="field-hint">Owner access cannot be changed here.</p>}
        </article>;
      })}</div>}
    </section>
    <section className="panel" aria-labelledby="invitations-title" style={{ marginTop: 18 }}>
      <h2 id="invitations-title">Invitations</h2>
      {invitations.isPending ? <LoadingNotice label="Loading invitations…" /> : invitations.isError ? <QueryFailure retry={() => void invitations.refetch()} /> : invitations.data.length === 0 ? <p className="field-hint">No invitations are visible in this workspace.</p> : <div className="record-list">{invitations.data.map((invitation) => {
        const status = invitation.accepted_at ? 'Accepted' : invitation.revoked_at ? 'Revoked' : Date.parse(invitation.expires_at) <= Date.now() ? 'Expired' : 'Pending';
        const canRevoke = !invitation.accepted_at && !invitation.revoked_at;
        return <article className="record-card" key={invitation.id}>
          <div className="record-header"><h3>{invitation.email}</h3><span className="state-badge">{status}</span></div>
          <div className="record-meta"><span>Role: {invitation.role}</span><span>Expires {new Date(invitation.expires_at).toLocaleDateString()}</span></div>
          {invitationErrors[invitation.id] && <ErrorNotice>{invitationErrors[invitation.id]}</ErrorNotice>}
          {canRevoke && <AppButton variant="secondary" disabled={invitationBusy === invitation.id} onClick={() => void revoke(invitation)}>{invitationLocked === invitation.id ? 'Retry revocation' : 'Revoke invitation'}</AppButton>}
        </article>;
      })}</div>}
    </section>
  </>;
}
