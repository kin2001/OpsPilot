import { expect, it } from 'vitest';
import { stockQuantity, stockDecimal, adjustStockFields, stockBalancePage } from './inventory';

it('rejects imprecise, signed, exponent, padded and numeric stock quantities instead of rounding', () => {
  for (const value of ['0', '-1', '+1', '1.0001', '1e2', '01', ' 1 ', '100000000000', 0.1, null]) {
    expect(stockQuantity.safeParse(value).success, String(value)).toBe(false);
  }
});
it('preserves exact strings at numeric(14,3) boundaries, including zero thresholds', () => {
  for (const value of ['0.001', '0.1', '1', '99999999999.999']) expect(stockQuantity.parse(value)).toBe(value);
  expect(stockDecimal.parse('0.000')).toBe('0.000');
  expect(stockQuantity.safeParse('0.000').success).toBe(false);
});
it('requires adjustment reasons and rejects extra authority or unbounded pages', () => {
  const id = '00000035-0000-4000-8000-000000000001';
  const fields = { part_id: id, location_id: id, quantity: '0.001', unit: 'kg', direction: 'out', reason: 'Count correction' };
  expect(adjustStockFields.safeParse(fields).success).toBe(true);
  expect(adjustStockFields.safeParse({ ...fields, reason: '\t\n\u00a0\ufeff' }).success).toBe(false);
  expect(adjustStockFields.safeParse({ ...fields, actor_id: id }).success).toBe(false);
  expect(stockBalancePage.safeParse({ items: [], next_cursor: null, total: 0 }).success).toBe(false);
});
