import { z } from 'zod';
import { reportKind, reportRange } from './reporting.ts';

export const reportExportRequest = z.strictObject({
  ctx: z.strictObject({ organization_id: z.uuid() }),
  kind: reportKind,
  range: reportRange,
});

export type ReportExportRequest = z.infer<typeof reportExportRequest>;
