import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { domainError } from '../lib/domain-errors';
import { reportRequest, reportResult, type ReportKind } from '../contracts/reporting';

export async function getReport(client: SupabaseClient<Database>, organizationId: string, kind: ReportKind,
  range: { from: string; to: string }, cursor: { after?: string; page_size?: number } = {}, signal?: AbortSignal) {
  const args = reportRequest.parse({ ctx: { organization_id: organizationId }, kind, range, cursor });
  const response = client.rpc('get_report', args);
  const result = await (signal ? response.abortSignal(signal) : response);
  if (result.error?.code === '57014') throw new Error('REPORT_TIMEOUT');
  if (result.error) throw new Error(domainError(result.error).code);
  const parsed = reportResult.safeParse(result.data);
  if (!parsed.success || parsed.data.kind !== kind || parsed.data.range.from !== range.from || parsed.data.range.to !== range.to) throw new Error('DEPENDENCY_UNAVAILABLE');
  return parsed.data;
}
