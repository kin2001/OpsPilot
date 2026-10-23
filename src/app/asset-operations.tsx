import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { assetHistoryResult, assetHold, assetRelease, attachmentRecord, meterReading, operationalWorkOrder, workOrderReview } from '../contracts/operational';
import { domainError } from '../lib/domain-errors';
import type { Database, Json, Tables } from '../lib/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { correctMeterReading, recordMeterReading, releaseAsset, resolveAssetHold, setAssetHold } from './commands';
import { PrivilegedArea } from './auth/security';
import { PrivateImage, reserveRecordImage, uploadPrivateImage } from './private-attachments';
import { AppButton, ErrorNotice, Field, LoadingNotice, SuccessNotice, TextAreaField } from './ui';

const participantsSchema = z.array(z.strictObject({ work_order_id: z.uuid(), user_id: z.uuid() })).max(2000);

type Asset = Tables<'assets'>;
type Client = SupabaseClient<Database>;
type Intent = { id: string; execute: (id: string) => Promise<unknown>; success: string };
type UploadIntent = { id: string; file: File; attachment: z.output<typeof attachmentRecord> | null };

function isAmbiguous(code: string) { return code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED'; }
function parseArray<T extends z.ZodType>(value: unknown, schema: T) {
  const result = z.array(schema).safeParse(value);
  if (!result.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  return result.data;
}
function codeMessage(cause: unknown) { return domainError(cause).message; }

async function getAssetHistory(client: Client, organizationId: string, assetId: string, cursor: { at: string; id: string } | null, signal?: AbortSignal) {
  const request = client.rpc('get_asset_history', { organization_id: organizationId, asset_id: assetId, cursor: cursor as unknown as Json | null });
  const result = signal ? await request.abortSignal(signal) : await request;
  if (result.error) throw new Error(domainError(result.error).code);
  const parsed = assetHistoryResult.safeParse(result.data);
  if (!parsed.success) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}

export function AssetOperationsPanel({ asset, client, userId, organizationId, role }: { asset: Asset; client: Client; userId: string; organizationId: string; role: string }) {
  const queryClient = useQueryClient();
  const isCoordinator = ['owner', 'manager', 'supervisor'].includes(role);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, string>>({});
  const intents = useRef(new Map<string, Intent>());
  const uploads = useRef(new Map<string, UploadIntent>());
  const [, redraw] = useState(0);
  const [historyExtra, setHistoryExtra] = useState<{ assetId: string; items: z.output<typeof assetHistoryResult>['items']; cursor: { at: string; id: string } | null } | null>(null);
  const key = ['assets', userId, organizationId] as const;
  const holdsKey = ['asset-holds', userId, organizationId, asset.id] as const;
  const holds = useQuery({
    queryKey: holdsKey,
    queryFn: async ({ signal }) => {
      const result = await client.from('asset_holds').select('*').eq('organization_id', organizationId).eq('asset_id', asset.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], assetHold);
    },
  });
  const releases = useQuery({
    queryKey: ['asset-releases', userId, organizationId, asset.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('asset_releases').select('*').eq('organization_id', organizationId).eq('asset_id', asset.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], assetRelease);
    },
  });
  const readings = useQuery({
    queryKey: ['asset-meter-readings', userId, organizationId, asset.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('asset_meter_readings').select('*').eq('organization_id', organizationId).eq('asset_id', asset.id).order('recorded_at', { ascending: false }).limit(200).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], meterReading);
    },
  });
  const history = useQuery({
    queryKey: ['asset-history', userId, organizationId, asset.id],
    queryFn: ({ signal }) => getAssetHistory(client, organizationId, asset.id, null, signal),
  });
  const assetWorkOrders = useQuery({
    queryKey: ['asset-work-orders', userId, organizationId, asset.id], enabled: isCoordinator,
    queryFn: async ({ signal }) => {
      const result = await client.from('work_orders').select('*').eq('organization_id', organizationId).eq('asset_id', asset.id).order('created_at', { ascending: false }).limit(100).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], operationalWorkOrder);
    },
  });
  const workOrderIds = [...new Set((holds.data ?? []).filter((hold) => hold.released_at === null && hold.work_order_id !== null).map((hold) => hold.work_order_id!))];
  const relatedReviews = useQuery({
    queryKey: ['asset-hold-reviews', userId, organizationId, asset.id, workOrderIds.join(',')], enabled: isCoordinator && workOrderIds.length > 0,
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_reviews').select('*').eq('organization_id', organizationId).in('work_order_id', workOrderIds).order('created_at', { ascending: false }).limit(300).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], workOrderReview);
    },
  });
  const holdParticipants = useQuery({
    queryKey: ['asset-hold-participants', userId, organizationId, asset.id, workOrderIds.join(',')], enabled: isCoordinator && workOrderIds.length > 0,
    queryFn: async ({ signal }) => {
      const result = await client.from('work_order_participants').select('work_order_id,user_id').eq('organization_id', organizationId).in('work_order_id', workOrderIds).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], participantsSchema.element);
    },
  });
  const attachments = useQuery({
    queryKey: ['asset-attachments', userId, organizationId, asset.id],
    queryFn: async ({ signal }) => {
      const result = await client.from('attachments').select('*').eq('organization_id', organizationId).eq('asset_id', asset.id).eq('status', 'ready').order('created_at').limit(10).abortSignal(signal);
      if (result.error) throw new Error(domainError(result.error).code);
      return parseArray(result.data ?? [], attachmentRecord);
    },
  });
  const queryRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: holdsKey }),
      queryClient.invalidateQueries({ queryKey: ['asset-target', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-releases', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-meter-readings', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-history', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-work-orders', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-hold-reviews', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-hold-participants', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['asset-attachments', userId, organizationId, asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['operational-dashboard', userId, organizationId] }),
    ]);
  };
  const run = async (intentKey: string, execute: (id: string) => Promise<unknown>, successMessage: string) => {
    const existing = intents.current.get(intentKey);
    const intent = existing ?? { id: crypto.randomUUID(), execute, success: successMessage };
    if (!existing) intents.current.set(intentKey, intent);
    setBusyKey(intentKey); setErrors((current) => ({ ...current, [intentKey]: '' })); setSuccess((current) => ({ ...current, [intentKey]: '' }));
    try {
      await intent.execute(intent.id);
      intents.current.delete(intentKey);
      setSuccess((current) => ({ ...current, [intentKey]: intent.success }));
      await queryRefresh();
    } catch (cause) {
      const code = domainError(cause).code;
      setErrors((current) => ({ ...current, [intentKey]: `${codeMessage(cause)}${code === 'CONFLICT' ? ' The asset changed. Current records were refreshed; review before acting again.' : isAmbiguous(code) ? ' Retry preserves this request and its exact values.' : ''}` }));
      if (!isAmbiguous(code)) intents.current.delete(intentKey);
      if (code === 'CONFLICT') await queryRefresh();
    } finally { setBusyKey(''); }
  };
  const value = (name: string) => values[`${asset.id}:${name}`] ?? '';
  const setValue = (name: string, fieldValue: string) => setValues((current) => ({ ...current, [`${asset.id}:${name}`]: fieldValue }));
  const pendingIntents = [...intents.current.entries()];
  const activeHolds = (holds.data ?? []).filter((hold) => hold.released_at === null);
  const activeWorkBlock = (assetWorkOrders.data ?? []).some((job) => job.blocks_operation && ['open', 'scheduled', 'in_progress', 'blocked', 'awaiting_review'].includes(job.status));
  const unapprovedHold = activeHolds.some((hold) => {
    if (hold.resolved_at !== null) return false;
    if (hold.source !== 'work_order' || !hold.work_order_id) return true;
    const job = assetWorkOrders.data?.find((item) => item.id === hold.work_order_id);
    return !job || job.status !== 'completed' || !(relatedReviews.data ?? []).some((review) => review.work_order_id === job.id && review.repair_revision === job.repair_revision && review.decision === 'approved');
  });
  const mayResolveHold = (hold: z.output<typeof assetHold>) => hold.source !== 'work_order'
    || assetWorkOrders.data?.some((job) => job.id === hold.work_order_id && job.status === 'canceled') === true;
  const releaseChecksLoading = holds.isPending || holds.isError || assetWorkOrders.isPending || assetWorkOrders.isError
    || workOrderIds.length > 0 && (relatedReviews.isPending || relatedReviews.isError || holdParticipants.isPending || holdParticipants.isError);
  const releaseBlockedByUser = (holdParticipants.data ?? []).some((participant) => participant.user_id === userId && workOrderIds.includes(participant.work_order_id));
  const releaseEligible = !releaseChecksLoading && !releaseBlockedByUser && !activeWorkBlock && !unapprovedHold && asset.archived_at === null;
  const uploadIntent = uploads.current.get(asset.id);
  const meterIntentKey = `meter:${asset.id}`;
  const runMeter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const kind = value('meter-kind') as 'hours' | 'distance';
    const reading = Number(value('meter-value'));
    const observed = new Date(value('meter-observed'));
    if (!['hours', 'distance'].includes(kind) || !Number.isFinite(reading) || reading < 0 || Number.isNaN(observed.getTime())) {
      setErrors((current) => ({ ...current, meter: 'Enter a non-negative reading and a valid observation time.' })); return;
    }
    const normalizedObserved = observed.toISOString();
    void run(`meter:${asset.id}`, (requestId) => recordMeterReading(client, organizationId, asset.id, kind, reading, normalizedObserved, requestId), 'Meter reading recorded in history.');
  };
  const uploadAssetImage = async () => {
    const current = uploads.current.get(asset.id); if (!current) return;
    setBusyKey('asset-upload'); setErrors((items) => ({ ...items, upload: '' }));
    try {
      if (!current.attachment) current.attachment = await reserveRecordImage(client, organizationId, 'asset', asset.id, current.file, current.id);
      redraw((n) => n + 1);
      await uploadPrivateImage(client, organizationId, current.attachment.id, current.file);
      uploads.current.delete(asset.id); redraw((n) => n + 1); setSuccess((items) => ({ ...items, upload: 'Private image uploaded and validated.' }));
      await queryRefresh();
    } catch (cause) {
      const code = domainError(cause).code;
      setErrors((items) => ({ ...items, upload: `${codeMessage(cause)}${isAmbiguous(code) ? ' Retry keeps the same reservation and upload target.' : ''}` }));
      if (!isAmbiguous(code) && !current.attachment) uploads.current.delete(asset.id);
      redraw((n) => n + 1);
    } finally { setBusyKey(''); }
  };
  const selectUpload = (file?: File) => {
    if (!file || uploads.current.has(asset.id)) return;
    try { uploads.current.set(asset.id, { id: crypto.randomUUID(), file, attachment: null }); redraw((n) => n + 1); }
    catch (cause) { setErrors((items) => ({ ...items, upload: codeMessage(cause) })); }
  };
  const historyRows = history.data?.items ?? [];
  const loadedHistory = historyExtra?.assetId === asset.id ? [...historyRows, ...historyExtra.items] : historyRows;
  const historyCursor = historyExtra?.assetId === asset.id ? historyExtra.cursor : history.data?.next_cursor ?? null;
  const loadMoreHistory = async () => {
    if (!historyCursor) return;
    try {
      const next = await getAssetHistory(client, organizationId, asset.id, historyCursor);
      setHistoryExtra((current) => ({ assetId: asset.id, items: [...(current?.assetId === asset.id ? current.items : []), ...next.items], cursor: next.next_cursor }));
    } catch (cause) { setErrors((current) => ({ ...current, history: codeMessage(cause) })); }
  };

  return <section className="asset-operations" aria-label={`Operational details for ${asset.code}`}>
    <div className="record-header"><div><p className="page-kicker">Operational record</p><h3>Availability and controls</h3></div><span className={`state-badge state-badge--${asset.availability}`}>{asset.availability.replaceAll('_', ' ')}</span></div>
    <p className="field-hint">Availability is derived from recorded work and holds. A completed repair does not release an asset automatically.</p>
    {pendingIntents.length > 0 && <div className="info-callout" role="alert"><p>A previous asset action has an uncertain outcome. Current records may have advanced. Refresh the exact asset and retry to reconcile; retries preserve the original request and values.</p>{pendingIntents.map(([intentKey, intent]) => <div className="compact-actions" key={intentKey}><AppButton disabled={busyKey === intentKey} onClick={() => void run(intentKey, intent.execute, intent.success)}>{busyKey === intentKey ? 'Retrying exact action…' : 'Retry pending asset action'}</AppButton>{errors[intentKey] && <ErrorNotice>{errors[intentKey]}</ErrorNotice>}</div>)}<AppButton variant="secondary" disabled={busyKey !== ''} onClick={() => void queryRefresh()}>Refresh current asset records</AppButton></div>}
    <fieldset className="asset-operations-controls" disabled={pendingIntents.length > 0}>
      <legend className="sr-only">Asset operations</legend>
    <section className="operation-section" aria-labelledby={`asset-images-${asset.id}`}><h4 id={`asset-images-${asset.id}`}>Private images</h4>
      {attachments.isPending ? <LoadingNotice label="Loading authorized images…" /> : attachments.isError ? <ErrorNotice>Image records are unavailable.</ErrorNotice> : attachments.data.length ? attachments.data.map((attachment) => <PrivateImage key={attachment.id} client={client} organizationId={organizationId} userId={userId} attachment={attachment} />) : <p className="field-hint">No private images are recorded.</p>}
      {isCoordinator && asset.archived_at === null && <div className="form-stack"><label className="field" htmlFor={`asset-image-${asset.id}`}><span>Upload an asset image</span><input id={`asset-image-${asset.id}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busyKey === 'asset-upload' || Boolean(uploadIntent)} onChange={(event) => selectUpload(event.currentTarget.files?.[0])} /><span className="field-hint">JPEG, PNG or WebP, up to 5 MB. Images are private to currently authorized workspace accounts.</span></label>{uploadIntent && <div className="record-card"><strong>{uploadIntent.file.name}</strong>{uploadIntent.attachment && <p className="field-hint">Reservation {uploadIntent.attachment.status}. Retry uses its existing attachment ID.</p>}{errors.upload && <ErrorNotice>{errors.upload}</ErrorNotice>}{success.upload && <SuccessNotice>{success.upload}</SuccessNotice>}<AppButton disabled={busyKey === 'asset-upload'} onClick={() => void uploadAssetImage()}>{busyKey === 'asset-upload' ? 'Uploading…' : uploadIntent.attachment ? 'Retry same upload' : 'Upload private image'}</AppButton></div>}</div>}
    </section>

    <section className="operation-section" aria-labelledby={`asset-holds-${asset.id}`}><h4 id={`asset-holds-${asset.id}`}>Safety holds</h4>
      {holds.isPending ? <LoadingNotice label="Loading recorded holds…" /> : holds.isError ? <ErrorNotice>Hold history is unavailable. Try again before changing availability.</ErrorNotice> : activeHolds.length ? <div className="record-list">{activeHolds.map((hold) => <article className="record-card" key={hold.id}><div className="record-header"><strong>{hold.source.replaceAll('_', ' ')} hold</strong><span className={`state-badge${hold.resolved_at ? ' state-badge--converted' : ' state-badge--draft'}`}>{hold.released_at ? 'Released' : hold.resolved_at ? 'Resolved · awaiting release' : 'Active'}</span></div><p>{hold.reason}</p><p className="field-hint">Recorded {new Date(hold.created_at).toLocaleString()}{hold.work_order_id ? ` · Work order ${hold.work_order_id}` : ''}</p>
        {isCoordinator && hold.resolved_at === null && hold.released_at === null && mayResolveHold(hold) && <div className="compact-actions"><TextAreaField id={`resolve-reason-${hold.id}`} label="Resolution reason" required maxLength={2000} disabled={busyKey !== '' || intents.current.has(`resolve:${hold.id}`) || intents.current.has(`withdraw:${hold.id}`)} value={value(`resolve-${hold.id}`)} onChange={(event) => setValue(`resolve-${hold.id}`, event.target.value)} /><AppButton disabled={!value(`resolve-${hold.id}`).trim() || busyKey !== '' || intents.current.has(`withdraw:${hold.id}`)} onClick={() => { const reason = value(`resolve-${hold.id}`).trim(); const id = hold.id; void run(`resolve:${id}`, (requestId) => resolveAssetHold(client, organizationId, id, asset.version, 'repaired', reason, requestId), 'Hold resolution recorded. The asset still requires a separate release.'); }}>{intents.current.has(`resolve:${hold.id}`) ? 'Retry resolution' : 'Resolve repaired hold'}</AppButton><AppButton variant="secondary" disabled={!value(`resolve-${hold.id}`).trim() || busyKey !== '' || intents.current.has(`resolve:${hold.id}`)} onClick={() => { const reason = value(`resolve-${hold.id}`).trim(); const id = hold.id; void run(`withdraw:${id}`, (requestId) => resolveAssetHold(client, organizationId, id, asset.version, 'withdrawn_with_reason', reason, requestId), 'Hold withdrawn with reason. The asset still requires a separate release.'); }}>{intents.current.has(`withdraw:${hold.id}`) ? 'Retry withdrawal' : 'Withdraw with reason'}</AppButton>{errors[`resolve:${hold.id}`] && <ErrorNotice>{errors[`resolve:${hold.id}`]}</ErrorNotice>}{errors[`withdraw:${hold.id}`] && <ErrorNotice>{errors[`withdraw:${hold.id}`]}</ErrorNotice>}</div>}
        {isCoordinator && hold.source === 'work_order' && hold.resolved_at === null && hold.released_at === null && !mayResolveHold(hold) && <p className="field-hint">This work-order hold is not eligible for manual resolution. The linked work order must reach a canceled state or be independently approved before asset release.</p>}
      </article>)}</div> : <p className="field-hint">No unreleased holds are recorded.</p>}
      {isCoordinator && asset.archived_at === null && <div className="form-stack"><TextAreaField id={`manual-hold-${asset.id}`} label="Reason for manual safety hold" maxLength={2000} disabled={busyKey === `manual-hold:${asset.id}` || intents.current.has(`manual-hold:${asset.id}`)} value={value('manual-hold')} onChange={(event) => setValue('manual-hold', event.target.value)} />{errors[`manual-hold:${asset.id}`] && <ErrorNotice>{errors[`manual-hold:${asset.id}`]}</ErrorNotice>}{success[`manual-hold:${asset.id}`] && <SuccessNotice>{success[`manual-hold:${asset.id}`]}</SuccessNotice>}<AppButton variant="secondary" disabled={!value('manual-hold').trim() || busyKey !== ''} onClick={() => { const reason = value('manual-hold').trim(); void run(`manual-hold:${asset.id}`, (requestId) => setAssetHold(client, organizationId, asset.id, asset.version, reason, requestId), 'Safety hold recorded.'); }}>{intents.current.has(`manual-hold:${asset.id}`) ? 'Retry same hold' : 'Place safety hold'}</AppButton></div>}
    </section>

    <section className="operation-section" aria-labelledby={`asset-release-${asset.id}`}><h4 id={`asset-release-${asset.id}`}>Asset release</h4>
      {!isCoordinator ? <p className="field-hint">An owner, manager or supervisor records asset release after reviewing work and safety holds.</p> : releaseChecksLoading ? <p className="field-hint" role="status">Checking active work, holds, reviews and immutable participants…</p> : releaseBlockedByUser ? <div className="info-callout">Your account participated in work covered by an unreleased hold. You cannot release this asset.</div> : activeWorkBlock ? <div className="info-callout">A blocking work order remains open. Complete its review before considering release.</div> : unapprovedHold ? <div className="info-callout">Every active hold must be resolved, and a work-order hold must have approval for the current repair revision.</div> : <p className="field-hint">Release eligibility checks passed against the records currently visible to your role. The service rechecks all conditions when you submit.</p>}
      {(releases.data ?? []).length > 0 && <ol className="timeline">{releases.data!.map((release) => <li key={release.id}><strong>Released {new Date(release.created_at).toLocaleString()}</strong><span>{release.acknowledgment}</span><small>Recorded by account {release.actor_id} · checked asset version {release.checked_version}</small></li>)}</ol>}
      {isCoordinator && <PrivilegedArea label="releasing an asset"><TextAreaField id={`release-ack-${asset.id}`} label="Release acknowledgment" required maxLength={2000} disabled={!releaseEligible || busyKey === `release:${asset.id}` || intents.current.has(`release:${asset.id}`)} value={value('release-ack')} onChange={(event) => setValue('release-ack', event.target.value)} hint="Confirm the current asset condition and recorded checks." />{errors[`release:${asset.id}`] && <ErrorNotice>{errors[`release:${asset.id}`]}</ErrorNotice>}{success[`release:${asset.id}`] && <SuccessNotice>{success[`release:${asset.id}`]}</SuccessNotice>}<AppButton disabled={!releaseEligible || !value('release-ack').trim() || busyKey !== ''} onClick={() => { const acknowledgment = value('release-ack').trim(); void run(`release:${asset.id}`, (requestId) => releaseAsset(client, organizationId, asset.id, asset.version, acknowledgment, requestId), 'Asset release recorded.'); }}>{intents.current.has(`release:${asset.id}`) ? 'Retry exact release' : 'Record asset release'}</AppButton></PrivilegedArea>}
    </section>

    <section className="operation-section" aria-labelledby={`asset-meters-${asset.id}`}><h4 id={`asset-meters-${asset.id}`}>Meter readings</h4>
      {readings.isPending ? <LoadingNotice label="Loading meter history…" /> : readings.isError ? <ErrorNotice>Meter history is unavailable.</ErrorNotice> : readings.data.length ? <div className="record-list">{readings.data.map((reading) => { const correctionKey = `correction:${reading.id}`; const correctionPending = intents.current.has(correctionKey); return <article className="record-card" key={reading.id}><strong>{reading.value.toLocaleString()} {reading.kind}</strong><p className="field-hint">Observed {new Date(reading.observed_at).toLocaleString()} · recorded {new Date(reading.recorded_at).toLocaleString()}</p>{reading.correction_of && <p className="field-hint">Correction of {reading.correction_of}: {reading.correction_reason}</p>}{isCoordinator && !readings.data!.some((item) => item.correction_of === reading.id) && <div className="form-row"><Field id={`meter-correction-value-${reading.id}`} label="Corrected value" type="number" min={0} step="0.001" disabled={busyKey !== '' || correctionPending} value={value(`correction-${reading.id}`)} onChange={(event) => setValue(`correction-${reading.id}`, event.target.value)} /><Field id={`meter-correction-reason-${reading.id}`} label="Correction reason" maxLength={2000} disabled={busyKey !== '' || correctionPending} value={value(`correction-reason-${reading.id}`)} onChange={(event) => setValue(`correction-reason-${reading.id}`, event.target.value)} /><AppButton disabled={!value(`correction-${reading.id}`) || !value(`correction-reason-${reading.id}`).trim() || busyKey !== ''} onClick={() => { const numeric = Number(value(`correction-${reading.id}`)); const reason = value(`correction-reason-${reading.id}`).trim(); if (!Number.isFinite(numeric) || numeric < 0) return; void run(correctionKey, (requestId) => correctMeterReading(client, organizationId, reading.id, numeric, reason, requestId), 'A correcting reading was appended; the original remains unchanged.'); }}>{correctionPending ? 'Retry same correction' : 'Append correction'}</AppButton>{errors[correctionKey] && <ErrorNotice>{errors[correctionKey]}</ErrorNotice>}</div>}</article>; })}</div> : <p className="field-hint">No meter readings are recorded.</p>}
      {isCoordinator && <form className="form-stack" onSubmit={runMeter}><label className="field" htmlFor={`meter-kind-${asset.id}`}>Meter type<select id={`meter-kind-${asset.id}`} disabled={busyKey !== '' || intents.current.has(meterIntentKey)} value={value('meter-kind') || 'hours'} onChange={(event) => setValue('meter-kind', event.target.value)}><option value="hours">Hours</option><option value="distance">Distance</option></select></label><Field id={`meter-value-${asset.id}`} label="Reading" type="number" min={0} step="0.001" required disabled={busyKey !== '' || intents.current.has(meterIntentKey)} value={value('meter-value')} onChange={(event) => setValue('meter-value', event.target.value)} /><Field id={`meter-observed-${asset.id}`} label="Observed at" type="datetime-local" required disabled={busyKey !== '' || intents.current.has(meterIntentKey)} value={value('meter-observed')} onChange={(event) => setValue('meter-observed', event.target.value)} />{errors[`meter:${asset.id}`] && <ErrorNotice>{errors[`meter:${asset.id}`]}</ErrorNotice>}{success[`meter:${asset.id}`] && <SuccessNotice>{success[`meter:${asset.id}`]}</SuccessNotice>}<AppButton type="submit" disabled={busyKey !== ''}>{intents.current.has(meterIntentKey) ? 'Retry same reading' : 'Record meter reading'}</AppButton></form>}
    </section>

    <section className="operation-section" aria-labelledby={`asset-history-${asset.id}`}><h4 id={`asset-history-${asset.id}`}>Asset history</h4>
      {history.isPending ? <LoadingNotice label="Loading recorded asset history…" /> : history.isError ? <ErrorNotice>Asset history could not be loaded.</ErrorNotice> : loadedHistory.length ? <><ol className="timeline">{loadedHistory.map((item) => <li key={`${item.kind}:${item.id}`}><strong>{item.kind.replaceAll('_', ' ')} · {item.action.replaceAll('_', ' ')}</strong><span>{item.note ?? item.status ?? item.availability?.replaceAll('_', ' ') ?? 'Recorded event'}</span><small>{new Date(item.occurred_at).toLocaleString()} · account {item.actor_id}{item.work_order_id ? ` · work order ${item.work_order_id}` : ''}</small></li>)}</ol>{historyCursor && <AppButton variant="secondary" disabled={busyKey === 'history'} onClick={() => void loadMoreHistory()}>Load older history</AppButton>}{errors.history && <ErrorNotice>{errors.history}</ErrorNotice>}</> : <p className="field-hint">No authorized asset history is recorded.</p>}
    </section>
    </fieldset>
  </section>;
}
