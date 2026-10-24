import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';

const schema = z.object({
  label: z.string().trim().min(1, 'Enter a label'),
  amount: z.string().transform(Number).pipe(z.number().positive('Use a positive amount')),
  priority: z.enum(['normal', 'high']).default('normal'),
});
const resolver: Resolver<z.input<typeof schema>, unknown, z.output<typeof schema>> = zodResolver(schema);
const options = { fields: {}, shouldUseNativeValidation: false };

describe('approved Zod4 resolver compatibility', () => {
  it('returns transformed output and defaults with separately typed input', async () => {
    const input: z.input<typeof schema> = { label: ' Pump ', amount: '12.5' };
    const result = await resolver(input, undefined, options);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ label: 'Pump', amount: 12.5, priority: 'normal' });
    if ('amount' in result.values) {
      const amount: number = result.values.amount;
      expect(amount).toBe(12.5);
    }
  });
  it('returns field errors without successful values', async () => {
    const result = await resolver({ label: ' ', amount: '-1' }, undefined, options);
    expect(result.values).toEqual({});
    expect(result.errors.label?.message).toBe('Enter a label');
    expect(result.errors.amount?.message).toBe('Use a positive amount');
  });
});
