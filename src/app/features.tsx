import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { Tables } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { useWorkspace } from './workspace';
import { AssetImagePreview, AssetOperationsPanel } from './asset-operations';
import { RequestEvidence } from './request-evidence';
import { MemberIdentifier, TeamWorkload } from './team-workload';
import { readBoundedRows, recordFilter, recordPageSize, splitRecordPage, type RecordCursor } from './record-query';
import { assetRecordQr } from './asset-qr';
import {
  convertRequest, inviteMember, revokeInvitation, reviseRequest, saveAsset, saveRequest,
  setMember, submitRequest, triageRequest, withdrawRequest,
} from './commands';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, SuccessNotice, TextAreaField } from './ui';

type MaintenanceRequest = Tables<'maintenance_requests'>;
type Membership = Tables<'organization_members'>;
type Invitation = Tables<'organization_invitations'>;
type AssetTarget = Tables<'assets'>;
const teamReadPageSize = 100;
const teamReadBound = 2000;

const requestTargetSchema = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), asset_id: z.uuid(), reporter_id: z.uuid(), description: z.string(), category: z.string(),
  status: z.string(), transition_reason: z.string().nullable(), converted_work_order_id: z.uuid().nullable(), created_at: z.string(), version: z.number().int(),
});
const assetTargetSchema = z.strictObject({
  id: z.uuid(), organization_id: z.uuid(), code: z.string(), name: z.string(), category: z.string(), site_id: z.uuid().nullable(),
  serial_number: z.string().nullable(), registration: z.string().nullable(), archived_at: z.string().nullable(), created_by: z.uuid(),
  created_at: z.string(), version: z.number().int(), availability: z.enum(['operational', 'under_maintenance', 'out_of_service', 'pending_release']),
});
const requestEventSchema = z.strictObject({
  id: z.uuid(), actor_id: z.uuid(), action: z.string(), status: z.string(), reason: z.string().nullable(), created_at: z.string(),
});
const requestEventRows = z.array(requestEventSchema).max(100);
const siteRowsSchema = z.array(z.strictObject({ id: z.uuid(), name: z.string() })).max(200);

function requestEventLabel(action: string) {
  switch (action) {
    case 'submit_request': return 'Submitted for workspace review';
    case 'triage_request': return 'Reviewed by the operations team';
    case 'convert_request': return 'Converted to a draft work order';
    case 'withdraw_request': return 'Withdrawn by the reporter';
    case 'save_request': return 'Request details saved';
    default: return `Recorded request event: ${action}`;
  }
}

function errorCode(error: unknown) {
  return domainError(error).code;
}

function errorMessage(error: unknown) {
  return domainError(error).message;
}

function pageDate() {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function QueryFailure({ retry }: { retry: () => void }) {
  return <div className="empty-state"><ErrorNotice>We could not load these records. Your current permissions remain authoritative; retry before continuing.</ErrorNotice><AppButton variant="secondary" onClick={retry}>Retry</AppButton></div>;
}

export function AssetPage() {
  const { client, user, organization, role } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [serial, setSerial] = useState('');
  const [registration, setRegistration] = useState('');
  const [editingAsset, setEditingAsset] = useState<AssetTarget | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pendingAssetAction, setPendingAssetAction] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const assetEditIntents = useRef(new Map<string, { id: string; scope: string; asset: AssetTarget | null; assetId: string | null; version: number | null; fields: Parameters<typeof saveAsset>[2] }>());
  const assetActionIntents = useRef(new Map<string, { action: 'archive' | 'reactivate'; id: string; scope: string; assetId: string; version: number; fields: Parameters<typeof saveAsset>[2] }>());
  const contextKey = `${user.id}:${organization.id}`;
  const queryKey = ['assets', user.id, organization.id, search.trim()] as const;
  const assetQueryPrefix = ['assets', user.id, organization.id] as const;
  const assets = useInfiniteQuery({
    queryKey,
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      const filter = recordFilter(['name', 'code', 'category'], search.trim(), pageParam);
      const result = await client.from('assets').select('*').eq('organization_id', organization.id).or(filter ?? 'id.not.is.null')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(recordPageSize + 1).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return splitRecordPage(result.data ?? []);
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
  const sites = useQuery({
    queryKey: ['authorized-sites', user.id, organization.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('sites').select('id,name').eq('organization_id', organization.id).order('name', { ascending: true }).order('id', { ascending: true }).limit(200).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return siteRowsSchema.parse(result.data ?? []);
    },
  });
  const mayRegister = ['owner', 'manager', 'supervisor'].includes(role);
  const isCoordinator = mayRegister;
  const assetRows = assets.data?.pages.flatMap((page) => page.rows) ?? [];
  const siteNames = new Map((sites.data ?? []).map((site) => [site.id, site.name]));
  const visibleAssets = assetRows.filter((asset) => (siteFilter === 'all' || (siteFilter === 'none' ? asset.site_id === null : asset.site_id === siteFilter))
    && (availabilityFilter === 'all' || asset.availability === availabilityFilter));
  const siteLabel = (siteId: string | null) => siteId === null ? 'Not assigned' : sites.isPending ? 'Loading site…' : sites.isError ? 'Site details unavailable' : siteNames.get(siteId) ?? 'Site details unavailable';
  const linkedAssetId = searchParams.get('asset');
  const listedLinkedAsset = assetRows.find((asset) => asset.id === linkedAssetId);
  const linkedAsset = useQuery({
    queryKey: ['asset-target', user.id, organization.id, linkedAssetId], enabled: Boolean(linkedAssetId && !listedLinkedAsset),
    queryFn: async ({ signal }) => {
      const result = await client.from('assets').select('*').eq('organization_id', organization.id).eq('id', linkedAssetId!).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ? assetTargetSchema.parse(result.data) : null;
    },
  });
  const selectedAsset = linkedAssetId ? listedLinkedAsset ?? linkedAsset.data ?? undefined : visibleAssets.find((asset) => asset.id === selectedId) ?? visibleAssets[0];
  const assetMetrics = visibleAssets.reduce<Record<AssetTarget['availability'], number>>((counts, asset) => {
    counts[asset.availability] += 1;
    return counts;
  }, { operational: 0, under_maintenance: 0, out_of_service: 0, pending_release: 0 });
  const selectAsset = (id: string) => linkedAssetId ? setSearchParams({ asset: id }) : setSelectedId(id);
  const refreshAssetQueries = async (assetId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: assetQueryPrefix }),
      ...(assetId ? [queryClient.invalidateQueries({ queryKey: ['asset-target', user.id, organization.id, assetId] })] : []),
    ]);
  };
  useEffect(() => {
    setFormOpen(false); setEditingAsset(null); setCode(''); setName(''); setCategory(''); setSerial(''); setRegistration(''); setError(''); setSuccess(''); setUncertain(false);
    const savedEdit = assetEditIntents.current.get(contextKey);
    if (savedEdit) {
      setEditingAsset(savedEdit.asset); setCode(String(savedEdit.fields.code ?? '')); setName(String(savedEdit.fields.name ?? '')); setCategory(String(savedEdit.fields.category ?? ''));
      setSerial(String(savedEdit.fields.serial_number ?? '')); setRegistration(String(savedEdit.fields.registration ?? '')); setFormOpen(savedEdit.assetId === null); setUncertain(true);
    }
    setPendingAssetAction(assetActionIntents.current.get(contextKey)?.action ?? null);
    requestId.current = crypto.randomUUID();
  }, [contextKey]);
  const clearAssetForm = () => {
    setFormOpen(false); setEditingAsset(null); setCode(''); setName(''); setCategory(''); setSerial(''); setRegistration(''); setUncertain(false);
    assetEditIntents.current.delete(contextKey); requestId.current = crypto.randomUUID();
  };
  const startAssetEdit = (asset: AssetTarget) => {
    if (pendingAssetAction || uncertain) return;
    setEditingAsset(asset); setCode(asset.code); setName(asset.name); setCategory(asset.category); setSerial(asset.serial_number ?? ''); setRegistration(asset.registration ?? ''); setError(''); setSuccess('');
  };
  const submitAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const editing = editingAsset;
    const intent = assetEditIntents.current.get(contextKey) ?? {
      id: requestId.current,
      scope: contextKey,
      asset: editing,
      assetId: editing?.id ?? null,
      version: editing?.version ?? null,
      fields: { code: code.trim(), name: name.trim(), category: category.trim(), serial_number: serial.trim() || null, registration: registration.trim() || null },
    };
    assetEditIntents.current.set(contextKey, intent);
    setBusy(true); setError(''); setSuccess('');
    try {
      await saveAsset(client, organization.id, intent.fields, intent.id, intent.assetId && intent.version !== null ? { id: intent.assetId, version: intent.version } : undefined);
      const editedId = intent.assetId;
      assetEditIntents.current.delete(contextKey);
      setSuccess(editedId ? 'Asset changes saved.' : 'Asset registered. Availability is not recorded.');
      clearAssetForm();
      await refreshAssetQueries(editedId ?? undefined);
    } catch (caught) {
      const status = errorCode(caught);
      setError(status === 'CONFLICT' ? 'This asset changed elsewhere. The current record was refreshed; reopen it before editing again.' : errorMessage(caught));
      setUncertain(status === 'DEPENDENCY_UNAVAILABLE' || status === 'RATE_LIMITED');
      if (status === 'CONFLICT') {
        assetEditIntents.current.delete(contextKey);
        clearAssetForm();
        await refreshAssetQueries(intent.assetId ?? undefined);
      } else if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        assetEditIntents.current.delete(contextKey);
        requestId.current = crypto.randomUUID();
      }
    } finally {
      setBusy(false);
    }
  };
  const runAssetAction = async (action?: 'archive' | 'reactivate') => {
    const pending = assetActionIntents.current.get(contextKey);
    const target = pending ? { id: pending.assetId, version: pending.version } : selectedAsset ? { id: selectedAsset.id, version: selectedAsset.version } : null;
    if (!target || !isCoordinator || (!pending && !selectedAsset)) return;
    if (!pending && !action) return;
    const intent = pending ?? {
      action: action!, id: crypto.randomUUID(), scope: contextKey, assetId: target.id, version: target.version,
      fields: { archived: action === 'archive' },
    };
    if (pending && action && pending.action !== action) return;
    assetActionIntents.current.set(contextKey, intent);
    setPendingAssetAction(intent.action); setError(''); setSuccess(''); setBusy(true);
    try {
      await saveAsset(client, organization.id, intent.fields, intent.id, { id: intent.assetId, version: intent.version });
      assetActionIntents.current.delete(contextKey); setPendingAssetAction(null);
      setSuccess(intent.action === 'archive' ? 'Asset archived. Its history remains available.' : 'Asset reactivated. Availability still follows recorded holds and release state.');
      await refreshAssetQueries(intent.assetId);
    } catch (caught) {
      const status = errorCode(caught);
      setError(status === 'CONFLICT' ? 'This asset changed elsewhere. Current records were refreshed; review its state before trying again.' : `${errorMessage(caught)}${status === 'DEPENDENCY_UNAVAILABLE' || status === 'RATE_LIMITED' ? ' Retry keeps the same request and version.' : ''}`);
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        assetActionIntents.current.delete(contextKey); setPendingAssetAction(null);
      }
      if (status === 'CONFLICT') await refreshAssetQueries(intent.assetId);
    } finally { setBusy(false); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    await submitAsset(event);
  };
  const currentEdit = assetEditIntents.current.get(contextKey);
  const currentAction = assetActionIntents.current.get(contextKey);
  const qrLabel = selectedAsset ? assetRecordQr(selectedAsset.id, window.location.origin) : null;

  return <>
    <PageHeader eyebrow="Registry" title="Assets" description="Find the equipment and vehicles registered in this workspace." action={mayRegister && !editingAsset ? <AppButton disabled={busy || Boolean(currentEdit) || Boolean(currentAction)} onClick={() => setFormOpen(!formOpen)}>{formOpen ? 'Close form' : 'Register asset'}</AppButton> : undefined} />
    {error && !formOpen && !editingAsset && <div style={{ marginTop: 16 }}><ErrorNotice>{error}</ErrorNotice></div>}
    {success && <div style={{ marginTop: 16 }}><SuccessNotice>{success}</SuccessNotice></div>}
    {assets.isSuccess && <section className="dashboard-counts asset-counts" aria-label="Asset status in the loaded records"><article className="dashboard-count"><strong>{visibleAssets.length}</strong><span>Assets shown</span><small>Authorized rows loaded</small></article><article className="dashboard-count"><strong>{assetMetrics.operational}</strong><span>Operational</span><small>In loaded rows</small></article><article className="dashboard-count"><strong>{assetMetrics.under_maintenance}</strong><span>Under maintenance</span><small>In loaded rows</small></article><article className="dashboard-count"><strong>{assetMetrics.out_of_service + assetMetrics.pending_release}</strong><span>Other statuses</span><small>Out of service or pending release</small></article></section>}
    {formOpen && mayRegister && <section className="panel" aria-labelledby="asset-form-title" style={{ marginTop: 16 }}>
      <h2 id="asset-form-title">Register an asset</h2>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <div className="form-row"><Field id="asset-code" label="Asset code" required maxLength={100} disabled={busy || uncertain} value={code} onChange={(event) => setCode(event.target.value)} /><Field id="asset-name" label="Name" required maxLength={200} disabled={busy || uncertain} value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="form-row"><Field id="asset-category" label="Category" required maxLength={100} disabled={busy || uncertain} value={category} onChange={(event) => setCategory(event.target.value)} /><Field id="asset-serial" label="Serial number (optional)" maxLength={200} disabled={busy || uncertain} value={serial} onChange={(event) => setSerial(event.target.value)} /></div>
        <Field id="asset-registration" label="Registration (optional)" maxLength={200} disabled={busy || uncertain} value={registration} onChange={(event) => setRegistration(event.target.value)} />
      <div className="button-row"><AppButton type="submit" disabled={busy}>{busy ? 'Saving…' : uncertain ? 'Retry with the same request' : 'Save asset'}</AppButton><AppButton type="button" variant="secondary" onClick={() => { clearAssetForm(); setError(''); }} disabled={busy || uncertain}>Cancel</AppButton></div>
      </form>
    </section>}
    {assets.isPending ? <LoadingNotice label="Loading assets…" /> : <div className="record-workspace asset-workspace" aria-label="Assets in this workspace">
      <section className="record-picker" aria-label="Asset registry">
        <div className="asset-registry-toolbar">
          <div className="asset-search-control"><label className="sr-only" htmlFor="asset-search">Search assets</label><input className="record-search" id="asset-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets…" /></div>
          <div className="asset-registry-filters"><label className="field-label" htmlFor="asset-site-filter">Site<select id="asset-site-filter" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="all">All authorized sites</option><option value="none">Not assigned</option>{(sites.data ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label className="field-label" htmlFor="asset-status-filter">Availability<select id="asset-status-filter" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option value="all">All statuses</option><option value="operational">Operational</option><option value="under_maintenance">Under maintenance</option><option value="out_of_service">Out of service</option><option value="pending_release">Pending release</option></select></label></div>
        </div>
        {assets.isError ? <><QueryFailure retry={() => void assets.refetch()} />{search.trim() && <AppButton variant="quiet" onClick={() => setSearch('')}>Clear search</AppButton>}</> : visibleAssets.length ? <>
          <div className="record-table-scroll"><table className="responsive-record-table" aria-label="Asset registry results"><thead><tr><th scope="col">Asset</th><th scope="col">Type</th><th scope="col">Site</th><th scope="col">Availability</th></tr></thead><tbody>{visibleAssets.map((asset) => <tr key={asset.id} aria-selected={selectedAsset?.id === asset.id}>
            <td><button className="table-select asset-table-select" type="button" aria-pressed={selectedAsset?.id === asset.id} onClick={() => selectAsset(asset.id)}><strong>{asset.name}</strong><small>{asset.code}</small></button></td><td>{asset.category}</td><td>{siteLabel(asset.site_id)}</td><td><span className={`state-badge state-badge--${asset.availability}`}>{asset.availability.replaceAll('_', ' ')}</span></td>
          </tr>)}</tbody></table></div>
          <ol className="record-picker-list mobile-record-list">{visibleAssets.map((asset) => <li key={asset.id}><button className="record-picker-option" type="button" aria-pressed={selectedAsset?.id === asset.id} onClick={() => selectAsset(asset.id)}>
          <span className="record-picker-title">{asset.name}</span><span className="record-picker-meta">{asset.code} · {asset.category} · {siteLabel(asset.site_id)}</span><span className={`state-badge state-badge--${asset.availability}`}>{asset.availability.replaceAll('_', ' ')}</span>
          </button></li>)}</ol>
        </> : assetRows.length ? <div className="empty-state"><h2>No assets match these filters.</h2><p>Change the authorized site or availability filters to see another asset.</p><AppButton variant="secondary" onClick={() => { setSiteFilter('all'); setAvailabilityFilter('all'); }}>Clear filters</AppButton></div> : search.trim() ? <div className="empty-state"><h2>No assets match your search.</h2><p>Search checks authorized asset names, codes and categories in the current workspace.</p><AppButton variant="secondary" onClick={() => setSearch('')}>Clear search</AppButton></div> : <div className="empty-state"><h2>No assets are visible</h2><p>{mayRegister ? 'Register the first asset before submitting a maintenance request.' : 'Ask a workspace owner or supervisor to register an asset.'}</p>{mayRegister && <AppButton onClick={() => setFormOpen(true)}>Register asset</AppButton>}</div>}
        {!assets.isError && assets.hasNextPage && <AppButton variant="secondary" disabled={assets.isFetchingNextPage} onClick={() => void assets.fetchNextPage()}>{assets.isFetchingNextPage ? 'Loading more assets…' : 'Load more assets'}</AppButton>}
      </section>
      <section className="record-preview" aria-label="Selected asset details" aria-live="polite" tabIndex={0}>
        {linkedAssetId && !listedLinkedAsset && linkedAsset.isPending ? <LoadingNotice label="Checking the exact asset target under your current access…" /> : linkedAssetId && !listedLinkedAsset && (linkedAsset.isError || !linkedAsset.data) ? <div className="empty-state"><h2>Asset unavailable</h2><p>This target is not visible under your current workspace access.</p><AppButton variant="secondary" onClick={() => void linkedAsset.refetch()}>Retry target lookup</AppButton></div> : selectedAsset ? <>
          {currentAction && <div className="inline-error" role="alert"><p>The {currentAction.action} result is uncertain. Retry keeps the original request ID, asset version and fields.</p><div className="compact-actions"><AppButton disabled={busy} onClick={() => void runAssetAction()}>{busy ? 'Retrying…' : 'Retry pending asset action'}</AppButton><AppButton variant="secondary" disabled={busy} onClick={() => void refreshAssetQueries(currentAction.assetId)}>Refresh current asset records</AppButton></div></div>}
          <div className="asset-record-hero">
            <AssetImagePreview asset={selectedAsset} client={client} userId={user.id} organizationId={organization.id} />
            <div className="asset-record-heading"><div className="record-header"><div><p className="page-kicker">Asset</p><h2>{selectedAsset.name}</h2><p className="asset-record-code">{selectedAsset.code}</p></div><span className={`state-badge state-badge--${selectedAsset.availability}`}>{selectedAsset.availability.replaceAll('_', ' ')}</span></div></div>
          </div>
          <dl className="detail-grid asset-detail-facts"><div><dt>Category</dt><dd>{selectedAsset.category}</dd></div><div><dt>Site</dt><dd>{siteLabel(selectedAsset.site_id)}</dd></div>{selectedAsset.serial_number && <div><dt>Serial number</dt><dd>{selectedAsset.serial_number}</dd></div>}{selectedAsset.registration && <div><dt>Registration</dt><dd>{selectedAsset.registration}</dd></div>}<div><dt>Record</dt><dd>{selectedAsset.archived_at ? 'Archived' : 'Registered'}</dd></div></dl>
          {mayRegister && <div className="compact-actions asset-record-actions"><AppButton variant="secondary" disabled={busy || Boolean(currentEdit) || Boolean(currentAction)} onClick={() => startAssetEdit(selectedAsset)}>Edit asset</AppButton><AppButton variant={selectedAsset.archived_at ? 'secondary' : 'danger'} disabled={busy || Boolean(currentEdit) || Boolean(currentAction)} onClick={() => void runAssetAction(selectedAsset.archived_at ? 'reactivate' : 'archive')}>{currentAction ? 'Pending asset update' : selectedAsset.archived_at ? 'Reactivate asset' : 'Archive asset'}</AppButton></div>}
          {editingAsset?.id === selectedAsset.id && mayRegister && <section className="panel form-stack" aria-labelledby="edit-asset-title"><h3 id="edit-asset-title">Edit asset</h3>{error && <ErrorNotice>{error}</ErrorNotice>}<form className="form-stack" onSubmit={(event) => void submitAsset(event)}><div className="form-row"><Field id="edit-asset-code" label="Asset code" required maxLength={100} disabled={busy || uncertain} value={code} onChange={(event) => setCode(event.target.value)} /><Field id="edit-asset-name" label="Asset name" required maxLength={200} disabled={busy || uncertain} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="form-row"><Field id="edit-asset-category" label="Category" required maxLength={100} disabled={busy || uncertain} value={category} onChange={(event) => setCategory(event.target.value)} /><Field id="edit-asset-serial" label="Serial number (optional)" maxLength={200} disabled={busy || uncertain} value={serial} onChange={(event) => setSerial(event.target.value)} /></div><Field id="edit-asset-registration" label="Registration (optional)" maxLength={200} disabled={busy || uncertain} value={registration} onChange={(event) => setRegistration(event.target.value)} /><div className="button-row"><AppButton type="submit" disabled={busy}>{busy ? 'Saving…' : uncertain ? 'Retry same asset update' : 'Save asset changes'}</AppButton><AppButton type="button" variant="secondary" disabled={busy || uncertain} onClick={() => { clearAssetForm(); setError(''); }}>Cancel</AppButton></div></form></section>}
          {qrLabel && <details className="asset-identity"><summary>QR identity and print label</summary><section className="asset-print-label" aria-label="Printable asset identity"><div><p className="page-kicker">Asset identity</p><strong>{selectedAsset.name}</strong><span>{selectedAsset.code}</span><a href={qrLabel.href} aria-label="Open asset route">{qrLabel.href}</a></div><img src={qrLabel.src} alt={`QR code for ${selectedAsset.name}`} /><AppButton variant="secondary" onClick={() => window.print()}>Print asset label</AppButton></section></details>}
          <AssetOperationsPanel asset={selectedAsset} client={client} userId={user.id} organizationId={organization.id} role={role} siteName={siteLabel(selectedAsset.site_id)} />
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [requestPane, setRequestPane] = useState<{ requestId: string; tab: 'details' | 'activity' | 'ai' } | null>(null);
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
  const [criticalReasons, setCriticalReasons] = useState<Record<string, string>>({});
  const commandIds = useRef(new Map<string, string>());
  const newRequestId = useRef(crypto.randomUUID());
  const submitCommandId = useRef('');
  const savedRequestId = useRef<string | null>(null);
  const savedRequest = useRef<MaintenanceRequest | null>(null);
  const awaitingSubmit = useRef(false);
  const reviseCommandId = useRef('');
  const queryKey = ['requests', user.id, organization.id, search.trim(), categoryFilter.trim(), statusFilter, sortOrder] as const;
  const requests = useInfiniteQuery({
    queryKey,
    initialPageParam: null as RecordCursor | null,
    queryFn: async ({ signal, pageParam }) => {
      const filter = recordFilter(['category', 'description'], search.trim(), pageParam, [], sortOrder);
      let requestQuery = client.from('maintenance_requests').select('*').eq('organization_id', organization.id);
      if (categoryFilter.trim()) requestQuery = requestQuery.eq('category', categoryFilter.trim());
      if (statusFilter === 'submitted') requestQuery = requestQuery.in('status', ['draft', 'submitted', 'returned']);
      else if (statusFilter === 'closed') requestQuery = requestQuery.in('status', ['rejected', 'withdrawn']);
      else if (statusFilter !== 'all') requestQuery = requestQuery.eq('status', statusFilter);
      const result = await requestQuery.or(filter ?? 'id.not.is.null').order('created_at', { ascending: sortOrder === 'asc' }).order('id', { ascending: sortOrder === 'asc' }).limit(recordPageSize + 1).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return splitRecordPage(result.data ?? []);
    },
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
  const isCoordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const requestRows = requests.data?.pages.flatMap((page) => page.rows) ?? [];
  const visibleRequests = requestRows;
  const linkedRequestId = searchParams.get('request');
  const listedLinkedRequest = requestRows.find((request) => request.id === linkedRequestId);
  const linkedRequest = useQuery({
    queryKey: ['request-target', user.id, organization.id, linkedRequestId], enabled: Boolean(linkedRequestId && !listedLinkedRequest),
    queryFn: async ({ signal }) => {
      const result = await client.from('maintenance_requests').select('*').eq('organization_id', organization.id).eq('id', linkedRequestId!).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error(domainError(result.error).code);
      return result.data ? requestTargetSchema.parse(result.data) : null;
    },
  });
  const selectedRequest = linkedRequestId ? listedLinkedRequest ?? linkedRequest.data ?? undefined : visibleRequests.find((request) => request.id === selectedId) ?? visibleRequests[0];
  const selectedRequestTab = requestPane && requestPane.requestId === selectedRequest?.id ? requestPane.tab : 'details';
  const setRequestTab = (tab: 'details' | 'activity' | 'ai') => {
    if (selectedRequest) setRequestPane({ requestId: selectedRequest.id, tab });
  };
  const requestCounts = useQuery({
    queryKey: ['request-status-counts', user.id, organization.id],
    queryFn: async ({ signal }) => {
      const count = async (statuses?: string[]) => {
        let countQuery = client.from('maintenance_requests').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id);
        if (statuses?.length === 1) countQuery = countQuery.eq('status', statuses[0]!);
        else if (statuses?.length) countQuery = countQuery.in('status', statuses);
        const result = await countQuery.abortSignal(signal);
        if (result.error) throw new Error(domainError(result.error).code);
        if (result.count === null) throw new Error('DEPENDENCY_UNAVAILABLE');
        return result.count;
      };
      const [all, submitted, converted, closed] = await Promise.all([
        count(), count(['draft', 'submitted', 'returned']), count(['converted']), count(['rejected', 'withdrawn']),
      ]);
      return { all, submitted, converted, closed };
    },
  });
  const selectRequest = (id: string) => linkedRequestId ? setSearchParams({ request: id }) : setSelectedId(id);
  const selectedAsset = useQuery({
    queryKey: ['request-asset', user.id, organization.id, selectedRequest?.asset_id ?? null],
    enabled: Boolean(selectedRequest),
    queryFn: ({ signal }) => lookupAsset(client, organization.id, { id: selectedRequest!.asset_id }, signal),
  });
  const selectedRequestEvents = useQuery({
    queryKey: ['request-events', user.id, organization.id, selectedRequest?.id],
    enabled: Boolean(selectedRequest && selectedRequestTab === 'activity'),
    queryFn: async ({ signal }) => {
      const result = await client.from('request_events').select('id,actor_id,action,status,reason,created_at')
        .eq('organization_id', organization.id).eq('request_id', selectedRequest!.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(101).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      const parsed = requestEventRows.safeParse(result.data ?? []);
      if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
      return parsed.data;
    },
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
        const priority = priorities[request.id] ?? 'normal';
        const criticalReason = criticalReasons[request.id]?.trim() ?? '';
        if (priority === 'critical' && !criticalReason) throw new Error('VALIDATION');
        await convertRequest(client, organization.id, request.id, { title, priority, ...(priority === 'critical' ? { critical_reason: criticalReason } : {}) }, commandId);
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
      setRowErrors((previous) => ({ ...previous, [commandKey]: status === 'VALIDATION' ? action === 'convert' && (priorities[request.id] ?? 'normal') === 'critical' && !(criticalReasons[request.id]?.trim()) ? 'Enter the required critical priority reason and work order title.' : 'Enter the required reason or title before continuing.' : errorMessage(caught) }));
      if (status !== 'DEPENDENCY_UNAVAILABLE' && status !== 'RATE_LIMITED') {
        commandIds.current.delete(commandKey);
        setPendingActions((previous) => { const next = { ...previous }; delete next[request.id]; return next; });
      } else setPendingActions((previous) => ({ ...previous, [request.id]: action }));
    } finally {
      setRunningActions((previous) => { const next = { ...previous }; delete next[request.id]; return next; });
    }
  };

  return <>
    <PageHeader eyebrow="Maintenance intake" title="Maintenance requests" description={pageDate()} action={<AppButton disabled={busy || locked} onClick={() => { if (formOpen) resetForm(); else { resetForm(); setFormOpen(true); } }}>＋&nbsp; New request</AppButton>} />
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
    {requests.isPending ? <LoadingNotice label="Loading requests…" /> : requests.isError ? <QueryFailure retry={() => void requests.refetch()} /> : <div className="record-workspace request-workspace" aria-label="Maintenance requests">
      <div className="request-controls">
        <div className="request-tabs" role="group" aria-label="Request status">
          <button type="button" aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All requests {requestCounts.data?.all ?? '—'}</button>
          <button type="button" aria-pressed={statusFilter === 'submitted'} onClick={() => setStatusFilter('submitted')}>Submitted {requestCounts.data?.submitted ?? '—'}</button>
          <button type="button" aria-pressed={statusFilter === 'converted'} onClick={() => setStatusFilter('converted')}>Converted {requestCounts.data?.converted ?? '—'}</button>
          <button type="button" aria-pressed={statusFilter === 'closed'} onClick={() => setStatusFilter('closed')}>Closed {requestCounts.data?.closed ?? '—'}</button>
        </div>
        <div className="request-tools">
          <div className="request-toolbar"><label className="sr-only" htmlFor="request-search">Search requests</label><input className="record-search" id="request-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests…" />
            <AppButton type="button" variant="secondary" aria-expanded={categoryFilterOpen} aria-controls="request-category-filter" onClick={() => setCategoryFilterOpen((open) => !open)}>Filter</AppButton>
            <label className="sr-only" htmlFor="request-sort">Sort requests</label><select id="request-sort" aria-label="Sort requests" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'asc' | 'desc')}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
            {requestCounts.isError && <span className="field-hint" role="status">Request counts are unavailable. <button className="inline-button" type="button" onClick={() => void requestCounts.refetch()}>Retry</button></span>}
          </div>
          {categoryFilterOpen && <div className="request-filter-panel"><label htmlFor="request-category-filter">Filter by category</label><div className="request-filter-controls"><input id="request-category-filter" type="text" maxLength={100} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} placeholder="Any category" /><AppButton type="button" variant="secondary" onClick={() => { setCategoryFilter(''); setCategoryFilterOpen(false); }}>Clear filter</AppButton></div></div>}
        </div>
      </div>
      <section className="record-picker request-inbox" aria-label="Request inbox">
        {visibleRequests.length ? <>
          <div className="record-table-scroll"><table className="responsive-record-table request-table" aria-label="Request inbox results"><thead><tr><th scope="col">ID</th><th scope="col">Reported symptom</th><th scope="col">Asset ID</th><th scope="col">Reported by</th><th scope="col">Date</th><th scope="col">Status</th></tr></thead><tbody>{visibleRequests.map((request) => <tr key={request.id} aria-selected={selectedRequest?.id === request.id}>
            <td><button className="table-select request-id" type="button" title={request.id} aria-label={`Request ${request.id}`} aria-pressed={selectedRequest?.id === request.id} onClick={() => selectRequest(request.id)}>{request.id}</button></td><td><strong>{request.category}</strong><span className="table-description">{request.description}</span></td><td><span className="monospace request-identifier" title={request.asset_id}>{request.asset_id}</span></td><td><span className="monospace request-identifier" title={request.reporter_id}>{request.reporter_id}</span></td><td>{new Date(request.created_at).toLocaleDateString()}</td><td><span className={`state-badge state-badge--${request.status}`}>{request.status.replaceAll('_', ' ')}</span></td>
          </tr>)}</tbody></table></div>
          <ol className="record-picker-list mobile-record-list">{visibleRequests.map((request) => <li key={request.id}><button className="record-picker-option" type="button" aria-pressed={selectedRequest?.id === request.id} onClick={() => selectRequest(request.id)}>
          <span className="record-picker-title">{request.category} request</span><span className={`state-badge state-badge--${request.status}`}>{request.status}</span><span className="record-picker-meta">{request.description}</span><span className="field-hint">{new Date(request.created_at).toLocaleDateString()}</span>
          </button></li>)}</ol>
        </> : <div className="empty-state"><h2>{requestRows.length === 0 && !linkedRequestId && !search.trim() && statusFilter === 'all' ? 'No requests yet' : 'No requests match these filters.'}</h2><p>{requestRows.length === 0 && !linkedRequestId && !search.trim() && statusFilter === 'all' ? 'Start with a registered asset and describe the issue for your workspace team.' : 'Change the search or status to find another request.'}</p>{requestRows.length === 0 && !linkedRequestId && !search.trim() && statusFilter === 'all' && <AppButton onClick={() => setFormOpen(true)}>Create request</AppButton>}</div>}
        {requests.hasNextPage && <AppButton variant="secondary" disabled={requests.isFetchingNextPage} onClick={() => void requests.fetchNextPage()}>{requests.isFetchingNextPage ? 'Loading more requests…' : 'Load more requests'}</AppButton>}
      </section>
      <section className="record-preview" aria-label="Selected request details" aria-live="polite">
        {linkedRequestId && !listedLinkedRequest && linkedRequest.isPending ? <LoadingNotice label="Checking the exact request target under your current access…" /> : linkedRequestId && !listedLinkedRequest && (linkedRequest.isError || !linkedRequest.data) ? <div className="empty-state"><h2>Request unavailable</h2><p>This target is not visible under your current workspace access.</p><AppButton variant="secondary" onClick={() => void linkedRequest.refetch()}>Retry target lookup</AppButton></div> : selectedRequest ? <>
          {(() => {
            const request = selectedRequest;
            const mayEdit = request.reporter_id === user.id && ['draft', 'returned'].includes(request.status);
            const mayWithdraw = request.reporter_id === user.id && ['draft', 'submitted', 'returned'].includes(request.status);
            const mayTriage = isCoordinator && request.status === 'submitted';
            return <>
              <div className="record-header request-detail-heading"><div><p className="page-kicker">{request.category} request</p><h2 className="request-symptom">{request.description}</h2></div><span className={`state-badge state-badge--${request.status}`}>{request.status.replaceAll('_', ' ')}</span></div>
              <div className="request-detail-tabs" role="group" aria-label="Request detail views">
                <button type="button" aria-pressed={selectedRequestTab === 'details'} onClick={() => setRequestTab('details')}>Details</button>
                <button type="button" aria-pressed={selectedRequestTab === 'ai'} disabled title="AI features are disabled by workspace policy." onClick={() => setRequestTab('ai')}>AI draft</button>
                <button type="button" aria-pressed={selectedRequestTab === 'activity'} onClick={() => setRequestTab('activity')}>Activity</button>
              </div>
              {selectedRequestTab === 'activity' ? <section className="request-activity" aria-label="Request activity" aria-live="polite">
                {selectedRequestEvents.isPending ? <LoadingNotice label="Loading request activity…" /> : selectedRequestEvents.isError ? <div><ErrorNotice>Request activity could not be confirmed for this record.</ErrorNotice><AppButton variant="secondary" onClick={() => void selectedRequestEvents.refetch()}>Retry activity</AppButton></div> : selectedRequestEvents.data.length ? <ol className="request-activity-list">{selectedRequestEvents.data.map((event) => <li key={event.id}>
                  <div className="request-activity-heading"><strong>{requestEventLabel(event.action)}</strong><time dateTime={event.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: organization.timezone }).format(new Date(event.created_at))}</time></div>
                  <p className="field-hint">{event.actor_id === user.id ? 'You' : `Account ${event.actor_id}`} · Status: {event.status.replaceAll('_', ' ')}</p>
                  {event.reason && <p className="request-activity-reason"><strong>Reason</strong><span>{event.reason}</span></p>}
                </li>)}</ol> : <p className="field-hint">No activity is recorded for this request.</p>}
              </section> : selectedRequestTab === 'ai' ? <p className="info-callout" role="status">AI draft is unavailable because AI features are disabled by workspace policy.</p> : <>
              <dl className="detail-grid"><div><dt>Asset</dt><dd>{selectedAsset.isPending ? 'Loading asset details…' : selectedAsset.data?.code ?? 'Asset details unavailable'}</dd></div><div><dt>Created</dt><dd>{new Date(request.created_at).toLocaleDateString()}</dd></div></dl>
              {request.transition_reason && <p className="field-hint">Latest reason: {request.transition_reason}</p>}
              {request.converted_work_order_id && <p className="field-hint">Draft work order created: <Link to={`/work-orders?workOrder=${encodeURIComponent(request.converted_work_order_id)}`}>open the linked work order</Link></p>}
              <RequestEvidence client={client} organizationId={organization.id} userId={user.id} requestId={request.id} enabled={['draft', 'returned'].includes(request.status) && (request.reporter_id === user.id || isCoordinator)} />
              {(mayEdit || mayWithdraw || mayTriage) && <details className="request-actions"><summary>{mayTriage ? 'Review and route request' : 'Request actions'}</summary><div className="record-actions">
                {mayEdit && <div className="compact-actions"><AppButton variant="secondary" onClick={() => void beginEdit(request)}>Edit and resubmit</AppButton></div>}
                {mayTriage && <>
                  <div className="form-row"><Field id={`triage-title-${request.id}`} label="Draft work order title" required maxLength={200} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={titles[request.id] ?? request.description.slice(0, 200)} onChange={(event) => setTitles((previous) => ({ ...previous, [request.id]: event.target.value }))} /><SelectField id={`triage-priority-${request.id}`} label="Priority" disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={priorities[request.id] ?? 'normal'} onChange={(event) => setPriorities((previous) => ({ ...previous, [request.id]: event.target.value as 'low' | 'normal' | 'high' | 'critical' }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></SelectField></div>
                  {priorities[request.id] === 'critical' && <TextAreaField id={`triage-critical-reason-${request.id}`} label="Critical priority reason" required maxLength={2000} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={criticalReasons[request.id] ?? ''} onChange={(event) => setCriticalReasons((previous) => ({ ...previous, [request.id]: event.target.value }))} hint="The reason is retained with the critical priority; conversion does not change asset availability." />}
                  <Field id={`triage-reason-${request.id}`} label="Reason for return or rejection" maxLength={4000} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={reasons[request.id] ?? ''} onChange={(event) => setReasons((previous) => ({ ...previous, [request.id]: event.target.value }))} hint="Required when returning or rejecting. Not needed for conversion." />
                  {rowErrors[`${request.id}:convert`] && <ErrorNotice>{rowErrors[`${request.id}:convert`]}</ErrorNotice>}
                  {rowErrors[`${request.id}:return`] && <ErrorNotice>{rowErrors[`${request.id}:return`]}</ErrorNotice>}
                  {rowErrors[`${request.id}:reject`] && <ErrorNotice>{rowErrors[`${request.id}:reject`]}</ErrorNotice>}
                  <div className="compact-actions"><AppButton disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'convert')} onClick={() => void runRowAction(request, 'convert')}>{pendingActions[request.id] === 'convert' ? 'Retry conversion' : 'Convert to draft work order'}</AppButton><AppButton variant="secondary" disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'return')} onClick={() => void runRowAction(request, 'return')}>{pendingActions[request.id] === 'return' ? 'Retry return' : 'Return with reason'}</AppButton><AppButton variant="danger" disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'reject')} onClick={() => void runRowAction(request, 'reject')}>{pendingActions[request.id] === 'reject' ? 'Retry rejection' : 'Reject with reason'}</AppButton></div>
                </>}
                {mayWithdraw && <><Field id={`withdraw-reason-${request.id}`} label="Withdrawal reason" required maxLength={4000} disabled={Boolean(pendingActions[request.id] || runningActions[request.id])} value={reasons[request.id] ?? ''} onChange={(event) => setReasons((previous) => ({ ...previous, [request.id]: event.target.value }))} />{rowErrors[`${request.id}:withdraw`] && <ErrorNotice>{rowErrors[`${request.id}:withdraw`]}</ErrorNotice>}<div className="compact-actions"><AppButton variant="secondary" disabled={Boolean(runningActions[request.id] || pendingActions[request.id] && pendingActions[request.id] !== 'withdraw')} onClick={() => void runRowAction(request, 'withdraw')}>{pendingActions[request.id] === 'withdraw' ? 'Retry withdrawal' : 'Withdraw request'}</AppButton></div></>}
              </div></details>}
              </>}
              <span className="sr-only">Request reference {request.id}</span>
            </>;
          })()}
        </> : <p className="field-hint">{linkedRequestId ? 'This request is not visible under your current workspace access.' : 'Select a request to review its details.'}</p>}
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
  const [teamTab, setTeamTab] = useState<'workload' | 'members'>('workload');
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
      const readMemberships = (active: boolean, maxRows: number) => readBoundedRows(async (cursor) => {
        let query = client.from('organization_members').select('*').eq('organization_id', organization.id).eq('active', active).order('user_id', { ascending: true }).limit(teamReadPageSize);
        if (cursor) query = query.gt('user_id', cursor);
        const result = await query.abortSignal(signal);
        if (result.error) throw new Error(domainError(result.error).code);
        return (result.data ?? []).map((member) => ({ id: member.user_id, member }));
      }, teamReadPageSize, maxRows);
      const activeMembers = await readMemberships(true, teamReadBound);
      const inactiveMembers = await readMemberships(false, teamReadBound - activeMembers.length);
      return [...activeMembers, ...inactiveMembers].map(({ member }) => member);
    },
  });
  const invitations = useQuery({
    queryKey: invitationsKey,
    queryFn: async ({ signal }) => {
      return readBoundedRows(async (cursor) => {
        let query = client.from('organization_invitations').select('*').eq('organization_id', organization.id).is('accepted_at', null).is('revoked_at', null).order('id', { ascending: true }).limit(teamReadPageSize);
        if (cursor) query = query.gt('id', cursor);
        const result = await query.abortSignal(signal);
        if (result.error) throw new Error(domainError(result.error).code);
        return result.data ?? [];
      }, teamReadPageSize, teamReadBound);
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

  const pendingInvitations = invitations.isSuccess ? invitations.data.filter((invitation) => !invitation.accepted_at && !invitation.revoked_at && Date.parse(invitation.expires_at) > Date.now()).length : null;
  const memberTable = (editable: boolean) => <section className="panel table-panel" aria-labelledby={editable ? 'editable-members-title' : 'members-title'}>
    <h2 id={editable ? 'editable-members-title' : 'members-title'}>Workspace members</h2>
    {members.isPending ? <LoadingNotice label="Loading workspace members…" /> : members.isError ? <QueryFailure retry={() => void members.refetch()} /> : members.data.length === 0 ? <p className="field-hint">No workspace members are visible.</p> : <div className="compact-table-scroll"><table className="compact-table"><thead><tr><th scope="col">Member ID</th><th scope="col">Role</th><th scope="col">Status</th>{editable && <th scope="col">Access</th>}</tr></thead><tbody>{members.data.map((member) => {
      const owner = member.role === 'owner';
      const selectedRole = memberRoles[member.user_id] ?? (member.role as MemberRole);
      const disabled = memberLocked === member.user_id || memberBusy === member.user_id;
      return <tr key={member.user_id}>
        <td><MemberIdentifier userId={member.user_id} isSelf={member.user_id === user.id} />{memberErrors[member.user_id] && <ErrorNotice>{memberErrors[member.user_id]}</ErrorNotice>}</td>
        <td>{editable && !owner ? <><label className="sr-only" htmlFor={`member-role-${member.user_id}`}>Role for {member.user_id}</label><select id={`member-role-${member.user_id}`} value={selectedRole} disabled={disabled} onChange={(event) => setMemberRoles((previous) => ({ ...previous, [member.user_id]: event.target.value as MemberRole }))}><option value="manager">Manager</option><option value="supervisor">Supervisor</option><option value="technician">Technician</option><option value="inventory">Inventory</option></select></> : owner ? 'Owner' : member.role}</td>
        <td><span className="status-line"><i className={`status-dot status-dot--${member.active ? 'operational' : 'inactive'}`} aria-hidden="true" />{member.active ? 'Active' : 'Inactive'}</span></td>
        {editable && <td>{owner ? <span className="field-hint">Owner access cannot be changed here.</span> : <div className="compact-actions"><AppButton variant={member.active ? 'danger' : 'secondary'} disabled={memberBusy === member.user_id || memberLocked === member.user_id && memberIntent.current?.active !== !member.active} onClick={() => void changeMember(member, !member.active)}>{memberLocked === member.user_id && memberIntent.current?.active === !member.active ? 'Retry access change' : member.active ? 'Deactivate' : 'Reactivate'}</AppButton><AppButton variant="secondary" disabled={memberBusy === member.user_id || memberLocked === member.user_id && memberIntent.current?.active !== member.active} onClick={() => void changeMember(member, member.active)}>{memberLocked === member.user_id && memberIntent.current?.active === member.active ? 'Retry role save' : 'Save role'}</AppButton></div>}</td>}
      </tr>;
    })}</tbody></table></div>}
  </section>;
  const invitationTable = <section className="panel table-panel" aria-labelledby="invitations-title">
    <h2 id="invitations-title">Invitations</h2>
    {invitations.isPending ? <LoadingNotice label="Loading invitations…" /> : invitations.isError ? <QueryFailure retry={() => void invitations.refetch()} /> : invitations.data.length === 0 ? <p className="field-hint">No invitations are visible in this workspace.</p> : <div className="compact-table-scroll"><table className="compact-table"><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{invitations.data.map((invitation) => {
      const status = invitation.accepted_at ? 'Accepted' : invitation.revoked_at ? 'Revoked' : Date.parse(invitation.expires_at) <= Date.now() ? 'Expired' : 'Pending';
      const canRevoke = !invitation.accepted_at && !invitation.revoked_at;
      return <tr key={invitation.id}><td>{invitation.email}{invitationErrors[invitation.id] && <ErrorNotice>{invitationErrors[invitation.id]}</ErrorNotice>}</td><td>{invitation.role}</td><td>{new Date(invitation.expires_at).toLocaleDateString()}</td><td><span className="status-line"><i className={`status-dot status-dot--${status === 'Pending' ? 'open' : status === 'Accepted' ? 'operational' : 'inactive'}`} aria-hidden="true" />{status}</span></td><td>{canRevoke && <AppButton variant="secondary" disabled={invitationBusy === invitation.id} onClick={() => void revoke(invitation)}>{invitationLocked === invitation.id ? 'Retry revocation' : 'Revoke'}</AppButton>}</td></tr>;
    })}</tbody></table></div>}
  </section>;
  return <>
    <PageHeader eyebrow="Workspace access" title="Team and workload" description="Active assignments and workspace access from authorized records." action={<AppButton onClick={() => setTeamTab('members')}>＋&nbsp; Invite member</AppButton>} />
    {inviteSuccess && <SuccessNotice>{inviteSuccess}</SuccessNotice>}
    <div className="team-tablist" role="tablist" aria-label="Team sections"><button type="button" role="tab" aria-selected={teamTab === 'workload'} onClick={() => setTeamTab('workload')}>Workload</button><button type="button" role="tab" aria-selected={teamTab === 'members'} onClick={() => setTeamTab('members')}>Members</button></div>
    {teamTab === 'workload' ? <>
      {members.isSuccess ? <TeamWorkload client={client} userId={user.id} organizationId={organization.id} members={members.data.map(({ user_id, role, active }) => ({ user_id, role, active }))} pendingInvitations={pendingInvitations} /> : members.isPending ? <LoadingNotice label="Loading workspace members…" /> : <QueryFailure retry={() => void members.refetch()} />}
      {memberTable(false)}
    </> : <div className="settings-layout">
      <div className="settings-side">
        <section className="panel" aria-labelledby="invite-title"><h2 id="invite-title">Invite a teammate</h2><p className="field-hint">The recipient must sign in with the verified email address that receives the invitation and explicitly accept it.</p>{inviteError && <ErrorNotice>{inviteError}</ErrorNotice>}<form className="form-stack" onSubmit={(event) => void invite(event)}><div className="form-row"><Field id="invite-email" label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} disabled={inviteBusy || inviteLocked} value={email} onChange={(event) => setEmail(event.target.value)} /><SelectField id="invite-role" label="Workspace role" value={inviteRole} disabled={inviteBusy || inviteLocked} onChange={(event) => setInviteRole(event.target.value as MemberRole)}><option value="manager">Manager</option><option value="supervisor">Supervisor</option><option value="technician">Technician</option><option value="inventory">Inventory</option></SelectField></div><div className="button-row"><AppButton type="submit" disabled={inviteBusy}>{inviteBusy ? 'Requesting invitation…' : inviteLocked ? 'Retry with the same invitation' : 'Request invitation'}</AppButton></div></form></section>
        {invitationTable}
      </div>
      {memberTable(true)}
    </div>}
  </>;
}
