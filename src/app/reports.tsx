import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { reportRange, type ReportKind } from '../contracts/reporting';
import { AppButton, ErrorNotice, PageHeader, SuccessNotice } from './ui';
import { useWorkspace } from './workspace';
import { getReport } from './report-client';
import { reportDefinitions, reportMetrics, reportTable } from './report-export';
import { reportChart } from './reports-model';
import '../styles/reports.css';

const kinds: ReportKind[] = ['work_orders', 'asset_availability', 'pm_compliance', 'technician_assignments', 'parts_consumption', 'maintenance_costs'];
const reportingRoles = ['owner', 'manager', 'supervisor'];

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

function metricValue(value: number | string | boolean | null, format: 'count' | 'seconds' | 'percent' | 'text') {
  if (value === null) return 'Not recorded';
  if (format === 'count') return new Intl.NumberFormat().format(Number(value));
  if (format === 'percent') return `${(Number(value) * 100).toFixed(1)}%`;
  if (format === 'seconds') {
    const hours = Number(value) / 3600;
    if (hours < 1) return `${Math.round(Number(value) / 60)} min`;
    if (hours < 48) return `${hours.toFixed(1)} hr`;
    return `${(hours / 24).toFixed(1)} days`;
  }
  return String(value);
}

function chartValue(value: number | null, unit: 'count' | 'seconds') {
  if (value === null) return 'Unknown';
  return unit === 'count' ? new Intl.NumberFormat().format(value) : metricValue(value, 'seconds');
}

function tableValue(value: string | number | boolean | null, column: string, timeZone: string) {
  if (value === null) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && ['opened_at', 'approved_at', 'due_at', 'occurred_at'].includes(column)) {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(time);
  }
  return String(value);
}

type ExportError = { message: string; requiresMfa: boolean };

function displayExportError(error: unknown): Promise<ExportError> {
  if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
    return error.context.clone().json().then((body: unknown) => {
      const code = body && typeof body === 'object' && 'code' in body ? body.code : undefined;
      if (code === 'EXPORT_LIMIT') return { message: 'This report contains more than 10,000 rows. Narrow the date range and retry.', requiresMfa: false };
      if (code === 'EXPORT_TIMEOUT') return { message: 'This report took too long. Narrow the date range and retry.', requiresMfa: false };
      if (code === 'MFA_REQUIRED') return { message: 'This export requires fresh authenticator verification.', requiresMfa: true };
      if (code === 'FORBIDDEN') return { message: 'Your workspace role can no longer export this report.', requiresMfa: false };
      if (code === 'UNAUTHENTICATED') return { message: 'Your session expired. Sign in again, then retry the export.', requiresMfa: false };
      return { message: 'The CSV could not be created. Please retry the export.', requiresMfa: false };
    }).catch(() => ({ message: 'The CSV could not be created. Please retry the export.', requiresMfa: false }));
  }
  return Promise.resolve({ message: 'The CSV could not be created. Check your connection and retry the export.', requiresMfa: false });
}

function downloadCsv(csv: string, response: Response | undefined, kind: ReportKind, range: { from: string; to: string }) {
  const disposition = response?.headers.get('content-disposition');
  const filename = disposition?.match(/filename="([a-z0-9-]+\.csv)"/i)?.[1] ?? `opspilot-${kind}-${range.from}-${range.to}.csv`;
  // FunctionsClient reads CSV responses as text, whose UTF-8 decoder consumes the leading BOM.
  const csvWithSingleBom = `\uFEFF${csv.replace(/^\uFEFF+/, '')}`;
  const url = URL.createObjectURL(new Blob([csvWithSingleBom], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ReportsPage() {
  const { client, user, organization, role } = useWorkspace();
  const availableKinds = reportingRoles.includes(role) ? kinds : role === 'inventory' ? ['parts_consumption' as const] : [];
  const today = dateInZone(new Date(), organization.timezone);
  const [filters, setFilters] = useState(() => ({
    kind: availableKinds.includes('work_orders') ? 'work_orders' as ReportKind : availableKinds[0] ?? 'work_orders' as ReportKind,
    from: addDays(today, -29),
    to: addDays(today, 1),
  }));
  const [applied, setApplied] = useState(filters);
  const [filterError, setFilterError] = useState('');
  const [after, setAfter] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<ExportError | null>(null);
  const [exportNotice, setExportNotice] = useState('');

  const query = useQuery({
    queryKey: ['report-page', user.id, organization.id, applied.kind, applied.from, applied.to, after],
    enabled: availableKinds.length > 0,
    retry: false,
    queryFn: ({ signal }) => getReport(client, organization.id, applied.kind, { from: applied.from, to: applied.to }, { page_size: 25, ...(after ? { after } : {}) }, signal),
  });
  const definition = reportDefinitions[applied.kind];
  const hasUnappliedFilters = filters.kind !== applied.kind || filters.from !== applied.from || filters.to !== applied.to;

  if (!availableKinds.length) return <section className="panel reports-unavailable">
    <PageHeader eyebrow="Workspace access" title="Reports unavailable" description="Your current workspace role does not have access to report data." />
  </section>;

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilterError('');
    const parsed = reportRange.safeParse({ from: filters.from, to: filters.to });
    if (!parsed.success) {
      setFilterError('Choose a valid date range. The end date is exclusive and the range can be up to 366 days.');
      return;
    }
    setApplied({ ...filters, from: parsed.data.from, to: parsed.data.to });
    setAfter(undefined);
    setPreviousCursors([]);
    setExportError(null);
    setExportNotice('');
  };

  const exportReport = async () => {
    setExportBusy(true);
    setExportError(null);
    setExportNotice('');
    try {
      const result = await client.functions.invoke<string>('report-export', {
        body: { ctx: { organization_id: organization.id }, kind: applied.kind, range: { from: applied.from, to: applied.to } },
        timeout: 35_000,
      });
      if (result.error || typeof result.data !== 'string') {
        setExportError(await displayExportError(result.error));
        return;
      }
      downloadCsv(result.data, result.response, applied.kind, { from: applied.from, to: applied.to });
      setExportNotice('CSV downloaded. It contains all rows retrieved for these filters.');
    } catch {
      setExportError({ message: 'The CSV could not be created. Check your connection and retry the export.', requiresMfa: false });
    } finally {
      setExportBusy(false);
    }
  };

  const moveNext = () => {
    if (!query.data?.next_cursor) return;
    setPreviousCursors((values) => [...values, after]);
    setAfter(query.data.next_cursor.after);
  };
  const movePrevious = () => {
    if (!previousCursors.length) return;
    const values = [...previousCursors];
    const cursor = values.pop();
    setPreviousCursors(values);
    setAfter(cursor);
  };

  const facts = query.data;
  const metrics = facts ? reportMetrics(facts) : [];
  const chart = facts ? reportChart(facts) : null;
  const table = facts ? reportTable(facts) : null;

  return <div className="reports-page">
    <PageHeader
      eyebrow="Operations"
      title="Reports"
      description="Inspect source-backed workspace facts, review how each measure is defined, and export a CSV for the selected date range."
      action={<AppButton onClick={() => void exportReport()} disabled={exportBusy || hasUnappliedFilters}>{exportBusy ? 'Preparing CSV…' : 'Download CSV'}</AppButton>}
    />

    <section className="panel reports-filters" aria-labelledby="report-filters-title">
      <h2 id="report-filters-title">Report filters</h2>
      <form className="reports-filter-form" onSubmit={applyFilters}>
        {availableKinds.length > 1 && <div className="field"><label htmlFor="report-kind">Report</label><select id="report-kind" value={filters.kind} onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value as ReportKind }))}>
          {availableKinds.map((kind) => <option key={kind} value={kind}>{reportDefinitions[kind].label}</option>)}
        </select></div>}
        <div className="field"><label htmlFor="report-from">Start date</label><input id="report-from" type="date" required aria-invalid={Boolean(filterError)} aria-describedby={filterError ? 'report-filter-error' : undefined} value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></div>
        <div className="field"><label htmlFor="report-to">End date (exclusive)</label><input id="report-to" type="date" required aria-invalid={Boolean(filterError)} aria-describedby={filterError ? 'report-filter-error' : undefined} value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></div>
        <AppButton type="submit">Apply filters</AppButton>
      </form>
      {filterError && <ErrorNotice id="report-filter-error">{filterError}</ErrorNotice>}
      <p className="field-hint">Dates use {organization.timezone}. The start date is included; the end date is excluded.</p>
    </section>

    <section className="panel reports-definition" aria-labelledby="report-definition-title">
      <div><p className="page-kicker">Definition</p><h2 id="report-definition-title">{definition.label}</h2><p>{definition.description}</p></div>
      <div className="reports-source"><span>Source</span><p>{definition.source}</p></div>
      {applied.kind === 'pm_compliance' && <p className="info-callout reports-note">Preventive-maintenance compliance covers generated occurrences only; it does not infer occurrences for missed dates.</p>}
      {applied.kind === 'maintenance_costs' && <p className="info-callout reports-note">Cost data is unavailable because this workspace does not record entered maintenance costs. No zero amount or estimate is inferred.</p>}
      {hasUnappliedFilters && <p className="field-hint reports-unapplied" role="status">Apply filters to load the selected report. The definition and data below still show the current report.</p>}
    </section>

    {query.isLoading && <div className="panel reports-loading" role="status" aria-live="polite">Loading report facts…</div>}
    {query.error && <section className="panel reports-error" aria-labelledby="report-error-title">
      <h2 id="report-error-title">Report could not be loaded</h2>
      <p>{query.error instanceof Error && query.error.message === 'REPORT_TIMEOUT'
        ? 'The report took too long. Retry, or choose a shorter date range.'
        : query.error instanceof Error && query.error.message === 'FORBIDDEN'
          ? 'Your workspace role no longer has access to this report.'
          : 'The report is temporarily unavailable. Retry, or choose a shorter date range.'}</p>
      <div className="button-row"><AppButton variant="secondary" onClick={() => void query.refetch()}>Retry report</AppButton></div>
    </section>}

    {facts && <>
      <section className="reports-metrics" aria-label={`${reportDefinitions[facts.kind].label} summary`}>
        {metrics.map((metric) => <article className="panel reports-metric" key={metric.label}>
          <p>{metric.label}</p><strong>{metricValue(metric.value, metric.format)}</strong><span>{metric.description}</span>
        </article>)}
      </section>

      <div className="reports-detail-grid">
        <section className="panel reports-chart-panel" aria-labelledby="report-chart-title">
          {chart ? <>
            <div><h2 id="report-chart-title">{chart.title}</h2><p className="field-hint">{chart.description}</p></div>
            {chart.rows.length ? <>
              <div className="reports-chart" aria-hidden="true">
                {chart.rows.map((row) => {
                  const max = Math.max(1, ...chart.rows.map((candidate) => candidate.value ?? 0));
                  const width = row.value === null ? 0 : Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100);
                  return <div className="reports-chart-row" key={row.label}>
                    <span className="reports-chart-label" title={row.label}>{row.label}</span>
                    <span className="reports-chart-track"><span className="reports-chart-bar" style={{ width: `${width}%` }} /></span>
                    <strong>{chartValue(row.value, chart.unit)}</strong>
                  </div>;
                })}
              </div>
              <table className="sr-only"><caption>{chart.title} text equivalent</caption><thead><tr><th scope="col">Category</th><th scope="col">{chart.unit === 'count' ? 'Count' : 'Duration'}</th><th scope="col">Notes</th></tr></thead><tbody>{chart.rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{chartValue(row.value, chart.unit)}</td><td>{row.note ?? ''}</td></tr>)}</tbody></table>
            </> : <p className="reports-empty-chart">No chart rows are available for this page.</p>}
          </> : <>
            <h2 id="report-chart-title">Cost chart unavailable</h2>
            <p className="field-hint">No entered cost values are recorded, so there is no cost series to chart.</p>
          </>}
        </section>
        <section className="panel reports-metadata" aria-labelledby="report-metadata-title">
          <h2 id="report-metadata-title">Report details</h2>
          <dl>
            <div><dt>Workspace time zone</dt><dd>{facts.timezone}</dd></div>
            <div><dt>Currency</dt><dd>{facts.currency}</dd></div>
            <div><dt>Range</dt><dd>{facts.range.from} to {facts.range.to} (exclusive)</dd></div>
            <div><dt>Report generated</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: facts.timezone }).format(new Date(facts.generated_at))}</dd></div>
            <div><dt>Source consistency</dt><dd>Current facts by cursor; pages are not snapshot-isolated.</dd></div>
          </dl>
        </section>
      </div>

      <section className="panel reports-table-panel" aria-labelledby="report-table-title">
        <div className="reports-table-heading"><div><h2 id="report-table-title">Source rows</h2><p className="field-hint">Showing {facts.items.length} rows on page {previousCursors.length + 1}. {facts.next_cursor ? 'More rows are available.' : 'End of results.'}</p></div>
          <div className="reports-pagination" aria-label="Report row pages">
            <AppButton variant="secondary" onClick={movePrevious} disabled={!previousCursors.length || query.isFetching}>Previous</AppButton>
            <AppButton variant="secondary" onClick={moveNext} disabled={!facts.next_cursor || query.isFetching}>Next</AppButton>
          </div>
        </div>
        {table && table.rows.length ? <div className="reports-table-scroll" role="region" aria-label={`${reportDefinitions[facts.kind].label} source rows`} tabIndex={0}>
          <table><thead><tr>{table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>
            {table.rows.map((row, index) => <tr key={String(row[0] ?? index)}>{row.map((value, cell) => <td key={`${table.columns[cell]}:${cell}`}>{tableValue(value, table.columns[cell] ?? '', facts.timezone)}</td>)}</tr>)}
          </tbody></table>
        </div> : <p className="reports-empty-table">No source rows match this date range. The report definition and summary above remain available.</p>}
      </section>
    </>}

    {exportError && <div className="reports-export-message">
      <ErrorNotice>{exportError.message}</ErrorNotice>
      {exportError.requiresMfa && <Link to="/settings/security">Open account security to verify</Link>}
    </div>}
    {exportNotice && <div className="reports-export-message"><SuccessNotice>{exportNotice}</SuccessNotice></div>}
  </div>;
}
