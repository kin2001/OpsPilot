import { z } from 'zod';
export const commandContext = z.strictObject({
  organization_id: z.uuid(),
  request_id: z.uuid(),
  expected_version: z.int().positive().optional(),
});
export const invitationRole = z.enum(['manager', 'supervisor', 'technician', 'inventory']);
export type CommandContext = z.infer<typeof commandContext>;
export type CommandSuccess<T> = { data: T; version: number; request_id: string };
