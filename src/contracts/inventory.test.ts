import { expect, it } from 'vitest';
import { stockQuantity, stockDecimal, adjustStockFields, stockBalancePage, partFields, inventoryPart } from './inventory';

it('rejects imprecise, signed, exponent, padded and numeric stock quantities instead of rounding', () => {
  for (const value of ['0', '-1', '+1', '1.0001', '1e2', '01', ' 1 ', '100000000000', 0.1, null]) {
    expect(stockQuantity.safeParse(value).success, String(value)).toBe(false);
  }
});
it('accepts only an explicit boolean archive intent and returns nullable archival history', () => {
  const fields = { code: 'KG', name: 'Lubricant', unit: 'kg', reorder_threshold: null, archived: true };
  expect(partFields.safeParse(fields).success).toBe(true);
  expect(partFields.safeParse({ ...fields, archived: 'true' }).success).toBe(false);
  const id = '00000035-0000-4000-8000-000000000001';
  const row = { id, organization_id: id, code: fields.code, name: fields.name, unit: fields.unit, reorder_threshold: null, created_by: id, created_at: '2026-10-24T00:00:00Z', version: 2, archived_at: '2026-10-24T01:00:00Z' };
  expect(inventoryPart.safeParse(row).success).toBe(true);
  expect(inventoryPart.safeParse({ ...row, archived_at: null }).success).toBe(true);
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
