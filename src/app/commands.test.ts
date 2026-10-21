import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { commandResult } from './commands';

const item = z.strictObject({ id: z.uuid(), name: z.string() });
const requestId = 'e0de249a-e9f0-4bed-932e-4c15bc14b7da';

describe('command response boundary', () => {
  it('parses a typed payload only from the canonical command envelope', () => {
    expect(commandResult({
      data: { id: '7af015af-aadc-44cb-bca9-ffafbd0897d4', name: 'Pump' },
      version: 1,
      request_id: requestId,
    }, item, requestId)).toEqual({ id: '7af015af-aadc-44cb-bca9-ffafbd0897d4', name: 'Pump' });
  });

  it('rejects malformed or mismatched envelopes without leaking response data', () => {
    expect(() => commandResult({ data: { id: 'not-an-id', name: 'Pump' }, version: 1, request_id: requestId }, item, requestId))
      .toThrow('DEPENDENCY_UNAVAILABLE');
    expect(() => commandResult({ data: { id: '7af015af-aadc-44cb-bca9-ffafbd0897d4', name: 'Pump' }, version: 1, request_id: 'f29bbd1c-7fb0-46cb-9e60-e4c67ceba5af' }, item, requestId))
      .toThrow('DEPENDENCY_UNAVAILABLE');
  });
});
