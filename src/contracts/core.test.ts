import { describe, expect, it } from 'vitest';
import { commandContext, invitationRole } from './core';
import { domainError } from '../lib/domain-errors';

const id = 'a9be90aa-204c-48c9-9655-9dbe91c6e911';
describe('core trust boundaries', () => {
  it('rejects forged context fields, malformed IDs and invalid versions', () => {
    expect(commandContext.safeParse({ organization_id: id, request_id: id }).success).toBe(true);
    expect(commandContext.safeParse({ organization_id: id, request_id: id, user_id: id }).success).toBe(false);
    expect(commandContext.safeParse({ organization_id: 'other', request_id: id }).success).toBe(false);
    expect(commandContext.safeParse({ organization_id: id, request_id: id, expected_version: 0 }).success).toBe(false);
  });
  it('never accepts an owner role through an invitation', () => {
    expect(invitationRole.safeParse('technician').success).toBe(true);
    expect(invitationRole.safeParse('owner').success).toBe(false);
  });
  it('preserves allowlisted errors without exposing SQL details', () => {
    expect(domainError({ message: 'FORBIDDEN', details: 'secret table name' }, id)).toEqual({
      code: 'FORBIDDEN', message: 'You do not have permission for this action.', retryable: false, request_id: id,
    });
    expect(domainError({ message: 'relation private.internal does not exist', code: '42P01' }, id).message).toBe('This action is temporarily unavailable.');
    expect(domainError({ message: 'CONFLICT' }).retryable).toBe(false);
  });
});
