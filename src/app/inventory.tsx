import { useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { PrivilegedArea } from './auth/security';
import { useWorkspace } from './workspace';
import { domainError } from '../lib/domain-errors';
import type { AdjustStockFields, PartFields, ReceiveStockFields, ReservationPartsFields, ReservePartsFields, StockLocationFields } from '../contracts/inventory';
import { adjustStock, getJobParts, issueReservedStock, listInventoryBalances, listInventoryMovements, listInventoryParts, listStockLocations, receiveStock, releaseReservation, reserveParts, returnStock, savePart, saveStockLocation } from './inventory-client';
import { AppButton, ErrorNotice, Field, LoadingNotice, PageHeader, SelectField, SuccessNotice } from './ui';
import '../styles/inventory.css';

const pageSize = 25;
const decimalPattern = '(?:0|[1-9][0-9]{0,10})(?:\\.[0-9]{1,3})?';
type InventoryForm = 'part' | 'location' | 'receipt' | 'adjustment' | null;
type Intent = { key: string; requestId: string; fields: unknown };
type Part = Awaited<ReturnType<typeof listInventoryParts>>['items'][number];
type StockLocation = Awaited<ReturnType<typeof listStockLocations>>['items'][number];
type Balance = Awaited<ReturnType<typeof listInventoryBalances>>['items'][number];
type Movement = Awaited<ReturnType<typeof listInventoryMovements>>['items'][number];

function decimalMilli(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

function stockStatus(available: string, threshold: string | null) {
  if (decimalMilli(available) === 0n) return 'Out of stock';
  if (threshold !== null && decimalMilli(available) <= decimalMilli(threshold)) return 'Low stock';
  return 'In stock';
}

function ambiguous(code: string) { return code === 'DEPENDENCY_UNAVAILABLE' || code === 'RATE_LIMITED'; }

export function InventoryUnavailablePage() {
  return <PageHeader eyebrow="Access" title="Inventory is unavailable" description="Your current workspace role cannot view inventory records." />;
}

export function InventoryPage() {
  const { client, user, organization, role } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const workOrderId = searchParams.get('workOrder') ?? '';
  const canWriteStock = role === 'owner' || role === 'inventory';
  const canReserve = ['owner', 'manager', 'supervisor', 'inventory'].includes(role);
  const canHandleJobStock = role === 'owner' || role === 'inventory';
  const [form, setForm] = useState<InventoryForm>(null);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [partDraft, setPartDraft] = useState<PartFields>({ code: '', name: '', unit: 'each', reorder_threshold: null });
  const [locationDraft, setLocationDraft] = useState<StockLocationFields>({ code: '', name: '' });
  const [stockDraft, setStockDraft] = useState({ part_id: '', location_id: '', quantity: '', source: '' });
  const [adjustDraft, setAdjustDraft] = useState({ part_id: '', location_id: '', quantity: '', direction: 'out' as 'in' | 'out', reason: '', correction_of: '' });
  const [jobDraft, setJobDraft] = useState({ part_id: '', location_id: '', quantity: '', reservation_id: '' });
  const [jobQuantity, setJobQuantity] = useState('');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const partsQuery = useInfiniteQuery({
    queryKey: ['inventory-parts', user.id, organization.id],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => listInventoryParts(client, organization.id, { cursor: pageParam ?? undefined, page_size: pageSize }, signal),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
  const locationsQuery = useInfiniteQuery({
    queryKey: ['inventory-locations', user.id, organization.id],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => listStockLocations(client, organization.id, { cursor: pageParam ?? undefined, page_size: pageSize }, signal),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
  const balancesQuery = useInfiniteQuery({
    queryKey: ['inventory-balances', user.id, organization.id, locationFilter],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => listInventoryBalances(client, organization.id, { cursor: pageParam ?? undefined, page_size: pageSize, ...(locationFilter ? { location_id: locationFilter } : {}) }, signal),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
  const movementsQuery = useInfiniteQuery({
    queryKey: ['inventory-movements', user.id, organization.id, locationFilter],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => listInventoryMovements(client, organization.id, { cursor: pageParam ?? undefined, page_size: pageSize, ...(locationFilter ? { location_id: locationFilter } : {}) }, signal),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
  const jobPartsQuery = useQuery({
    queryKey: ['work-order-parts', user.id, organization.id, workOrderId],
    enabled: Boolean(workOrderId),
    queryFn: ({ signal }) => getJobParts(client, organization.id, workOrderId, signal),
  });

  const parts = partsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const activeParts = parts.filter((part) => !part.archived_at);
  const locations = locationsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const balances = balancesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const movements = movementsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const filteredParts = activeParts.filter((part) => `${part.code} ${part.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const partById = new Map(parts.map((part) => [part.id, part]));
  const balancesByPart = new Map<string, Balance[]>();
  for (const balance of balances) balancesByPart.set(balance.part_id, [...(balancesByPart.get(balance.part_id) ?? []), balance]);
  const recentMovements = movements.map((movement) => ({ movement, part: partById.get(movement.part_id), location: locationById.get(movement.location_id) }));
  const lowStockCount = balances.filter((balance) => {
    const part = partById.get(balance.part_id);
    return part && stockStatus(balance.available, part.reorder_threshold) === 'Low stock';
  }).length;
  const outOfStockCount = balances.filter((balance) => decimalMilli(balance.available) === 0n).length;

  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['inventory-parts', user.id, organization.id] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-locations', user.id, organization.id] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-balances', user.id, organization.id] }),
    queryClient.invalidateQueries({ queryKey: ['inventory-movements', user.id, organization.id] }),
    queryClient.invalidateQueries({ queryKey: ['work-order-parts', user.id, organization.id, workOrderId] }),
  ]);

  const run = async (key: string, fields: unknown, execute: (fields: unknown, requestId: string) => Promise<unknown>, recorded: string) => {
    const existing = intent?.key === key ? intent : null;
    if (intent && !existing) return;
    const current = existing ?? { key, requestId: crypto.randomUUID(), fields };
    if (!existing) setIntent(current);
    setBusyKey(key); setError(''); setSuccess('');
    try {
      await execute(current.fields, current.requestId);
      setIntent(null); setSuccess(recorded); setForm(null);
      await invalidate();
    } catch (cause) {
      const code = domainError(cause).code;
      setError(`${domainError(cause).message}${ambiguous(code) ? ' Confirmation is uncertain. Retry the exact command; its request identity and values are preserved.' : code === 'CONFLICT' ? ' Stock changed or needs reconciliation. Refresh the inventory and review before making a new attempt.' : ''}`);
      if (!ambiguous(code)) setIntent(null);
      if (code === 'CONFLICT') await invalidate();
    } finally { setBusyKey(''); }
  };

  const submitPart = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run('part', partDraft, (fields, requestId) => savePart(client, organization.id, fields as PartFields, requestId), 'Part saved.');
  };
  const submitLocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run('location', locationDraft, (fields, requestId) => saveStockLocation(client, organization.id, fields as StockLocationFields, requestId), 'Location saved.');
  };
  const submitReceipt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const partId = stockDraft.part_id || activeParts[0]?.id || '';
    const locationId = stockDraft.location_id || locations[0]?.id || '';
    const fields: ReceiveStockFields = { part_id: partId, location_id: locationId, quantity: stockDraft.quantity, unit: partById.get(partId)?.unit ?? '', ...(stockDraft.source.trim() ? { source: stockDraft.source.trim() } : {}) };
    void run('receipt', fields, (input, requestId) => receiveStock(client, organization.id, input as ReceiveStockFields, requestId), 'Stock receipt recorded.');
  };
  const correctionCandidates = movements.filter((movement) => ['receipt', 'adjustment'].includes(movement.kind) && !movements.some((other) => other.correction_of === movement.id));
  const correction = correctionCandidates.find((movement) => movement.id === adjustDraft.correction_of);
  const submitAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const original = correctionCandidates.find((movement) => movement.id === adjustDraft.correction_of);
    const fields: AdjustStockFields = {
      part_id: original?.part_id ?? (adjustDraft.part_id || activeParts[0]?.id || ''),
      location_id: original?.location_id ?? (adjustDraft.location_id || locations[0]?.id || ''),
      quantity: original?.quantity ?? adjustDraft.quantity,
      unit: original?.unit ?? partById.get(adjustDraft.part_id || activeParts[0]?.id || '')?.unit ?? '',
      direction: original ? original.direction === 'in' ? 'out' : 'in' : adjustDraft.direction,
      reason: adjustDraft.reason,
      ...(original ? { correction_of: original.id } : {}),
    };
    void run('adjustment', fields, (input, requestId) => adjustStock(client, organization.id, input as AdjustStockFields, requestId), 'Stock adjustment recorded.');
  };

  const jobParts = jobPartsQuery.data;
  const selectedJobPartId = jobDraft.part_id || jobParts?.parts[0]?.part_id || '';
  const requestablePart = jobParts?.parts.find((part) => part.part_id === selectedJobPartId);
  const selectedLocation = jobDraft.location_id || locations[0]?.id || '';
  const selectedReservation = jobParts?.reservations.find((reservation) => reservation.id === jobDraft.reservation_id) ?? jobParts?.reservations[0];
  const submitReservation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!jobParts || !requestablePart) return;
    const fields: ReservePartsFields = { work_order_id: workOrderId, lines: [{ part_id: requestablePart.part_id, location_id: selectedLocation, quantity: jobDraft.quantity, unit: requestablePart.unit }] };
    void run('reserve', fields, (input, requestId) => reserveParts(client, organization.id, input as ReservePartsFields, requestId, jobParts.version), 'Parts reserved. Work order status was not changed.');
  };
  const runReservationAction = (action: 'release' | 'issue' | 'return') => {
    if (!jobParts || !selectedReservation) return;
    const fields: ReservationPartsFields = { work_order_id: workOrderId, lines: [{ reservation_id: selectedReservation.id, quantity: jobQuantity, unit: selectedReservation.unit }] };
    const execute = action === 'release' ? releaseReservation : action === 'issue' ? issueReservedStock : returnStock;
    const recorded = action === 'release' ? 'Reservation released.' : action === 'issue' ? 'Stock issued to the work order.' : 'Returned stock recorded.';
    void run(action, fields, (input, requestId) => execute(client, organization.id, input as ReservationPartsFields, requestId, jobParts.version), recorded);
  };
  const clickReservationAction = (event: MouseEvent<HTMLButtonElement>, action: 'release' | 'return') => {
    if (event.currentTarget.form?.reportValidity()) runReservationAction(action);
  };
  const submitReservationAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runReservationAction('issue');
  };

  const toggleForm = (next: InventoryForm) => { if (!intent && !busyKey) { setForm(form === next ? null : next); setError(''); setSuccess(''); } };
  const actions = canWriteStock ? <div className="inventory-actions">
    <AppButton variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => toggleForm('part')}>Add part</AppButton>
    <AppButton variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => toggleForm('location')}>Add location</AppButton>
    <AppButton variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => toggleForm('adjustment')}>Adjust stock</AppButton>
    <AppButton disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => toggleForm('receipt')}>Receive stock</AppButton>
  </div> : null;

  return <div className="inventory-page">
    <PageHeader eyebrow="Inventory" title="Spare parts inventory" description="Track exact stock by location and review every recorded movement." action={actions} />
    {error && <ErrorNotice>{error}</ErrorNotice>}{success && <SuccessNotice>{success}</SuccessNotice>}
    <section className="inventory-summary" aria-label="Inventory summary">
      <div><strong>{parts.length}</strong><span>Parts loaded</span></div>
      <div><strong>{lowStockCount}</strong><span>Low stock locations</span></div>
      <div><strong>{outOfStockCount}</strong><span>Out of stock locations</span></div>
    </section>
    <p className="field-hint inventory-summary-note">Counts reflect the loaded catalog and balance pages.</p>

    {form === 'part' && <form className="panel inventory-form" onSubmit={submitPart}>
      <h2>Add part</h2>
      <fieldset disabled={Boolean(busyKey) || intent?.key === 'part'}>
        <div className="form-row"><Field id="part-code" label="SKU" required maxLength={80} value={partDraft.code} onChange={(event) => setPartDraft((current) => ({ ...current, code: event.target.value }))} /><Field id="part-name" label="Part name" required maxLength={200} value={partDraft.name} onChange={(event) => setPartDraft((current) => ({ ...current, name: event.target.value }))} /></div>
        <div className="form-row"><Field id="part-unit" label="Unit" required maxLength={40} value={partDraft.unit} onChange={(event) => setPartDraft((current) => ({ ...current, unit: event.target.value }))} /><Field id="part-threshold" label="Reorder at" inputMode="decimal" pattern={decimalPattern} value={partDraft.reorder_threshold ?? ''} onChange={(event) => setPartDraft((current) => ({ ...current, reorder_threshold: event.target.value || null }))} hint="Leave blank if this part has no low-stock threshold." /></div>
      </fieldset>
      <div className="button-row"><AppButton type="submit" disabled={Boolean(busyKey)}>{busyKey === 'part' ? 'Saving…' : intent?.key === 'part' ? 'Retry exact save' : 'Save part'}</AppButton><AppButton type="button" variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => setForm(null)}>Close</AppButton></div>
    </form>}

    {form === 'location' && <form className="panel inventory-form" onSubmit={submitLocation}>
      <h2>Add stock location</h2>
      <fieldset disabled={Boolean(busyKey) || intent?.key === 'location'}>
        <div className="form-row"><Field id="location-code" label="Location code" required maxLength={80} value={locationDraft.code} onChange={(event) => setLocationDraft((current) => ({ ...current, code: event.target.value }))} /><Field id="location-name" label="Location name" required maxLength={200} value={locationDraft.name} onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))} /></div>
      </fieldset>
      <div className="button-row"><AppButton type="submit" disabled={Boolean(busyKey)}>{busyKey === 'location' ? 'Saving…' : intent?.key === 'location' ? 'Retry exact save' : 'Save location'}</AppButton><AppButton type="button" variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => setForm(null)}>Close</AppButton></div>
    </form>}

    {form === 'receipt' && <form className="panel inventory-form" onSubmit={submitReceipt}>
      <h2>Receive stock</h2>
      <fieldset disabled={Boolean(busyKey) || intent?.key === 'receipt'}>
        <div className="form-row">
          <SelectField id="receive-part" label="Part" required value={stockDraft.part_id || activeParts[0]?.id || ''} onChange={(event) => setStockDraft((current) => ({ ...current, part_id: event.target.value }))}><option value="" disabled>Select a part</option>{activeParts.map((part) => <option key={part.id} value={part.id}>{part.code} · {part.name}</option>)}</SelectField>
          <SelectField id="receive-location" label="Location" required value={stockDraft.location_id || locations[0]?.id || ''} onChange={(event) => setStockDraft((current) => ({ ...current, location_id: event.target.value }))}><option value="" disabled>Select a location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</SelectField>
        </div>
        <div className="form-row"><Field id="receive-quantity" label="Quantity" required inputMode="decimal" pattern={decimalPattern} value={stockDraft.quantity} onChange={(event) => setStockDraft((current) => ({ ...current, quantity: event.target.value }))} hint={`Unit: ${partById.get(stockDraft.part_id || activeParts[0]?.id || '')?.unit ?? 'select a part'}`} /><Field id="receive-source" label="Source" maxLength={2000} value={stockDraft.source} onChange={(event) => setStockDraft((current) => ({ ...current, source: event.target.value }))} hint="Optional purchase or receipt reference." /></div>
      </fieldset>
      <div className="button-row"><AppButton type="submit" disabled={Boolean(busyKey) || !activeParts.length || !locations.length}>{busyKey === 'receipt' ? 'Recording…' : intent?.key === 'receipt' ? 'Retry exact receipt' : 'Record receipt'}</AppButton><AppButton type="button" variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => setForm(null)}>Close</AppButton></div>
    </form>}

    {form === 'adjustment' && <PrivilegedArea label="adjusting inventory stock"><form className="panel inventory-form" onSubmit={submitAdjustment}>
      <h2>Adjust stock</h2>
      <p className="field-hint">Corrections create a new movement and keep the original history.</p>
      <fieldset disabled={Boolean(busyKey) || intent?.key === 'adjustment'}>
        <SelectField id="adjust-correction" label="Correct an earlier movement (optional)" value={adjustDraft.correction_of} onChange={(event) => { const movement = correctionCandidates.find((item) => item.id === event.target.value); setAdjustDraft((current) => ({ ...current, correction_of: event.target.value, ...(movement ? { part_id: movement.part_id, location_id: movement.location_id, quantity: movement.quantity, direction: movement.direction === 'in' ? 'out' : 'in' } : {}) })); }}><option value="">Manual adjustment</option>{correctionCandidates.map((movement) => <option key={movement.id} value={movement.id}>{movement.kind} · {movement.direction === 'in' ? '+' : '−'}{movement.quantity} {movement.unit}</option>)}</SelectField>
        <div className="form-row"><SelectField id="adjust-part" label="Part" required disabled={Boolean(correction)} value={adjustDraft.part_id || activeParts[0]?.id || ''} onChange={(event) => setAdjustDraft((current) => ({ ...current, part_id: event.target.value }))}><option value="" disabled>Select a part</option>{activeParts.map((part) => <option key={part.id} value={part.id}>{part.code} · {part.name}</option>)}</SelectField><SelectField id="adjust-location" label="Location" required disabled={Boolean(correction)} value={adjustDraft.location_id || locations[0]?.id || ''} onChange={(event) => setAdjustDraft((current) => ({ ...current, location_id: event.target.value }))}><option value="" disabled>Select a location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</SelectField></div>
        <div className="form-row"><Field id="adjust-quantity" label="Quantity" required inputMode="decimal" pattern={decimalPattern} disabled={Boolean(correction)} value={adjustDraft.quantity || correction?.quantity || ''} onChange={(event) => setAdjustDraft((current) => ({ ...current, quantity: event.target.value }))} /><SelectField id="adjust-direction" label="Direction" value={correction ? correction.direction === 'in' ? 'out' : 'in' : adjustDraft.direction} disabled={Boolean(correction)} onChange={(event) => setAdjustDraft((current) => ({ ...current, direction: event.target.value as 'in' | 'out' }))}><option value="in">Increase</option><option value="out">Decrease</option></SelectField></div>
        <Field id="adjust-reason" label="Reason" required maxLength={2000} value={adjustDraft.reason} onChange={(event) => setAdjustDraft((current) => ({ ...current, reason: event.target.value }))} />
      </fieldset>
      <div className="button-row"><AppButton type="submit" disabled={Boolean(busyKey) || !activeParts.length || !locations.length}>{busyKey === 'adjustment' ? 'Recording…' : intent?.key === 'adjustment' ? 'Retry exact adjustment' : 'Record adjustment'}</AppButton><AppButton type="button" variant="secondary" disabled={Boolean(intent) || Boolean(busyKey)} onClick={() => setForm(null)}>Close</AppButton></div>
    </form></PrivilegedArea>}

    {workOrderId && <section className="panel inventory-job" aria-labelledby="inventory-job-title">
      {jobPartsQuery.isPending ? <LoadingNotice label="Loading linked work order parts…" /> : jobPartsQuery.isError ? <><h2 id="inventory-job-title">Linked work order parts</h2><ErrorNotice>Work order parts could not be confirmed in this workspace. Check the link and current access, then retry.</ErrorNotice><AppButton variant="secondary" onClick={() => void jobPartsQuery.refetch()}>Retry job parts</AppButton></> : jobParts && <>
        <div className="inventory-panel-head"><div><p className="page-kicker">Linked work order</p><h2 id="inventory-job-title">WO-{String(jobParts.number).padStart(4, '0')} parts</h2><p>Status: {jobParts.status.replaceAll('_', ' ')}</p></div>{['owner', 'manager', 'supervisor'].includes(role) && <Link className="button button--secondary" to={`/work-orders?workOrder=${encodeURIComponent(workOrderId)}`}>Open authorized work order</Link>}</div>
        {jobParts.reconciliation_state === 'discrepancy' && <ErrorNotice>Stock records disagree for this work order. Reconcile the movement history before changing reservations, issuing or returning stock, or resuming work.</ErrorNotice>}
        {jobParts.parts.some((part) => decimalMilli(part.shortage) > 0n) && <p className="info-callout">A parts shortage remains. Receiving or issuing stock does not resume this work order; an authorized coordinator must resume it through Work orders after the shortage and reconciliation are clear.</p>}
        {jobParts.parts.length ? <div className="inventory-table-wrap"><table className="inventory-table"><caption>Requested, reserved, consumed, returned, and short quantities</caption><thead><tr><th scope="col">Part ID</th><th scope="col">Unit</th><th scope="col">Requested</th><th scope="col">Short</th><th scope="col">Reserved</th><th scope="col">Consumed</th><th scope="col">Returned</th></tr></thead><tbody>{jobParts.parts.map((part) => <tr key={part.part_id}><th scope="row" data-label="Part ID"><span className="monospace">{part.part_id}</span></th><td data-label="Unit">{part.unit}</td><td data-label="Requested">{part.requested}</td><td data-label="Short">{part.shortage}</td><td data-label="Reserved">{part.reserved}</td><td data-label="Consumed">{part.issued}</td><td data-label="Returned">{part.returned}</td></tr>)}</tbody></table></div> : <p className="empty-state">No parts have been requested for this work order.</p>}
        {canReserve && jobParts.parts.length > 0 && <form className="inventory-job-form" onSubmit={submitReservation}>
          <h3>Reserve requested parts</h3>
          <fieldset disabled={Boolean(busyKey) || intent?.key === 'reserve'}>
            <div className="form-row"><SelectField id="reserve-part" label="Part" required value={jobDraft.part_id || jobParts.parts[0]?.part_id || ''} onChange={(event) => setJobDraft((current) => ({ ...current, part_id: event.target.value }))}>{jobParts.parts.map((part) => <option key={part.part_id} value={part.part_id}>{part.part_id.slice(0, 8)} · shortage {part.shortage} {part.unit}</option>)}</SelectField><SelectField id="reserve-location" label="Location" required value={selectedLocation} onChange={(event) => setJobDraft((current) => ({ ...current, location_id: event.target.value }))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</SelectField></div>
            <Field id="reserve-quantity" label="Quantity" required inputMode="decimal" pattern={decimalPattern} value={jobDraft.quantity} onChange={(event) => setJobDraft((current) => ({ ...current, quantity: event.target.value }))} hint={`Unit: ${requestablePart?.unit ?? 'select a part'}`} />
          </fieldset>
          {locationsQuery.isError && <ErrorNotice>Stock locations could not be confirmed. Retry before reserving.</ErrorNotice>}
          <div className="button-row"><AppButton type="submit" disabled={Boolean(busyKey) || Boolean(intent && intent.key !== 'reserve') || jobParts.reconciliation_state === 'discrepancy' || locationsQuery.isPending || locationsQuery.isError || !locations.length}>{intent?.key === 'reserve' ? 'Retry exact reservation' : 'Reserve parts'}</AppButton></div>
        </form>}
        {jobParts.reservations.length > 0 && <div className="inventory-reservations"><h3>Reservation history</h3>{jobParts.reservations.map((reservation) => <form className="inventory-reservation" key={reservation.id} onSubmit={submitReservationAction}>
          <p><strong>{partById.get(reservation.part_id)?.name ?? reservation.part_id}</strong> · {locationById.get(reservation.location_id)?.name ?? 'Location'} · {reservation.unit}</p>
          <dl><div><dt>Reserved</dt><dd>{reservation.reserved}</dd></div><div><dt>Consumed</dt><dd>{reservation.issued}</dd></div><div><dt>Returned</dt><dd>{reservation.returned}</dd></div><div><dt>Released</dt><dd>{reservation.released}</dd></div></dl>
          <Field id={`job-quantity-${reservation.id}`} label="Quantity" required inputMode="decimal" pattern={decimalPattern} disabled={Boolean(busyKey) || Boolean(intent)} value={jobDraft.reservation_id === reservation.id ? jobQuantity : ''} onChange={(event) => { setJobDraft((current) => ({ ...current, reservation_id: reservation.id })); setJobQuantity(event.target.value); }} />
          <div className="button-row">
            {canReserve && <AppButton type="button" variant="secondary" disabled={Boolean(busyKey) || Boolean(intent && intent.key !== 'release') || jobParts.reconciliation_state === 'discrepancy'} onClick={(event) => clickReservationAction(event, 'release')}>{intent?.key === 'release' ? 'Retry exact release' : 'Release reserved'}</AppButton>}
            {canHandleJobStock && <><AppButton type="submit" disabled={Boolean(busyKey) || Boolean(intent && intent.key !== 'issue') || jobParts.reconciliation_state === 'discrepancy'}>{intent?.key === 'issue' ? 'Retry exact issue' : 'Issue stock'}</AppButton><AppButton type="button" variant="secondary" disabled={Boolean(busyKey) || Boolean(intent && intent.key !== 'return') || jobParts.reconciliation_state === 'discrepancy'} onClick={(event) => clickReservationAction(event, 'return')}>{intent?.key === 'return' ? 'Retry exact return' : 'Return stock'}</AppButton></>}
          </div>
        </form>)}</div>}
      </>}
    </section>}

    <section className="panel inventory-catalog" aria-labelledby="inventory-catalog-title">
      <div className="inventory-panel-head"><div><h2 id="inventory-catalog-title">Spare parts</h2><p>Exact available stock and reorder thresholds by location.</p></div><div className="inventory-toolbar"><Field id="inventory-search" label="Search parts" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /><SelectField id="inventory-location-filter" label="Filter by location" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</SelectField></div></div>
      {partsQuery.isPending || balancesQuery.isPending || locationsQuery.isPending ? <LoadingNotice label="Loading inventory balances…" /> : partsQuery.isError || balancesQuery.isError || locationsQuery.isError ? <><ErrorNotice>Inventory is unavailable for this workspace. Retry the affected read before acting on stock.</ErrorNotice><div className="button-row"><AppButton variant="secondary" onClick={() => void partsQuery.refetch()}>Retry parts</AppButton><AppButton variant="secondary" onClick={() => void balancesQuery.refetch()}>Retry balances</AppButton></div></> : filteredParts.length ? <>
        <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th scope="col">Part</th><th scope="col">SKU</th><th scope="col">Location</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Available</th><th scope="col">Reorder at</th><th scope="col">Status</th></tr></thead><tbody>{filteredParts.flatMap((part) => {
          const partBalances = balancesByPart.get(part.id) ?? [];
          return (partBalances.length ? partBalances : [null]).map((balance) => {
            const status = balance ? stockStatus(balance.available, part.reorder_threshold) : 'No balance';
            return <tr key={`${part.id}:${balance?.location_id ?? 'none'}`}><th scope="row" data-label="Part">{part.name}{part.archived_at && <span className="inventory-archived">Archived</span>}</th><td data-label="SKU">{part.code}</td><td data-label="Location">{balance ? locationById.get(balance.location_id)?.name ?? 'Location unavailable' : 'No balance'}</td><td data-label="On hand">{balance?.on_hand ?? '—'} {balance ? part.unit : ''}</td><td data-label="Reserved">{balance?.reserved ?? '—'} {balance ? part.unit : ''}</td><td data-label="Available">{balance?.available ?? '—'} {balance ? part.unit : ''}</td><td data-label="Reorder at">{part.reorder_threshold ?? '—'} {part.reorder_threshold ? part.unit : ''}</td><td data-label="Status"><span className={`inventory-status inventory-status--${status.toLowerCase().replaceAll(' ', '-')}`}><span aria-hidden="true" />{status}</span></td></tr>;
          });
        })}</tbody></table></div>
        {(partsQuery.hasNextPage || balancesQuery.hasNextPage) && <div className="button-row">{partsQuery.hasNextPage && <AppButton variant="secondary" disabled={partsQuery.isFetchingNextPage} onClick={() => void partsQuery.fetchNextPage()}>{partsQuery.isFetchingNextPage ? 'Loading…' : 'Load more parts'}</AppButton>}{balancesQuery.hasNextPage && <AppButton variant="secondary" disabled={balancesQuery.isFetchingNextPage} onClick={() => void balancesQuery.fetchNextPage()}>{balancesQuery.isFetchingNextPage ? 'Loading…' : 'Load more balances'}</AppButton>}</div>}
      </> : <p className="empty-state">No matching parts are in the loaded catalog. Clear search or load more parts.</p>}
    </section>

    <section className="panel inventory-locations" aria-labelledby="inventory-locations-title">
      <div className="inventory-panel-head"><div><h2 id="inventory-locations-title">Stock locations</h2><p>Locations organize separate balances; stock never moves between them implicitly.</p></div>{locationsQuery.hasNextPage && <AppButton variant="secondary" disabled={locationsQuery.isFetchingNextPage} onClick={() => void locationsQuery.fetchNextPage()}>{locationsQuery.isFetchingNextPage ? 'Loading…' : 'Load more locations'}</AppButton>}</div>
      {locationsQuery.isError ? <ErrorNotice>Stock locations could not be loaded.</ErrorNotice> : locations.length ? <ul className="inventory-location-list">{locations.map((location: StockLocation) => <li key={location.id}><span className="inventory-location-code">{location.code}</span><strong>{location.name}</strong></li>)}</ul> : <p className="empty-state">No stock locations are configured.</p>}
    </section>

    <section className="panel inventory-history" aria-labelledby="inventory-history-title">
      <div className="inventory-panel-head"><div><h2 id="inventory-history-title">Recent stock movements</h2><p>Receipts, adjustments, issues and returns remain in the ledger.</p></div>{movementsQuery.hasNextPage && <AppButton variant="secondary" disabled={movementsQuery.isFetchingNextPage} onClick={() => void movementsQuery.fetchNextPage()}>{movementsQuery.isFetchingNextPage ? 'Loading…' : 'View more movements'}</AppButton>}</div>
      {movementsQuery.isPending ? <LoadingNotice label="Loading stock history…" /> : movementsQuery.isError ? <ErrorNotice>Stock history could not be confirmed. Retry before correcting a movement.</ErrorNotice> : recentMovements.length ? <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th scope="col">Date</th><th scope="col">Part</th><th scope="col">SKU</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Location</th><th scope="col">Reference</th><th scope="col">Reason</th></tr></thead><tbody>{recentMovements.map(({ movement, part, location }: { movement: Movement; part: Part | undefined; location: StockLocation | undefined }) => <tr key={movement.id}><th scope="row" data-label="Date">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: organization.timezone }).format(new Date(movement.created_at))}</th><td data-label="Part">{part?.name ?? movement.part_id}</td><td data-label="SKU">{part?.code ?? '—'}</td><td data-label="Type">{movement.kind.replaceAll('_', ' ')}</td><td data-label="Quantity">{movement.direction === 'in' ? '+' : '−'}{movement.quantity} {movement.unit}</td><td data-label="Location">{location?.name ?? 'Location unavailable'}</td><td data-label="Reference">{movement.source ?? '—'}</td><td data-label="Reason">{movement.reason ?? (movement.correction_of ? 'Correction' : '—')}</td></tr>)}</tbody></table></div> : <p className="empty-state">No stock movements have been recorded.</p>}
    </section>
  </div>;
}
