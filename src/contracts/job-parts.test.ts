import { expect, it } from 'vitest';
import * as inventory from './inventory';

const id = '00000036-0000-4000-8000-000000000001';
it('accepts exact job quantities and rejects duplicate or excessive atomic lines', () => {
  const schemas = inventory as unknown as Record<string, { safeParse: (input: unknown) => { success: boolean } }>;
  expect(schemas.requestPartsFields).toBeDefined();
  const line = { part_id: id, quantity: '0.001', unit: 'kg' };
  expect(schemas.requestPartsFields.safeParse({ work_order_id: id, lines: [line] }).success).toBe(true);
  for (const lines of [[], [line, line], Array.from({ length: 101 }, () => line), [{ ...line, quantity: '0.0001' }], [{ ...line, actor_id: id }]]) {
    expect(schemas.requestPartsFields.safeParse({ work_order_id: id, lines }).success).toBe(false);
  }
});

it('rejects UUID case variants of the same request, allocation, or reservation identity', () => {
  const lower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const upper = lower.toUpperCase();
  const line = { part_id: lower, quantity: '0.001', unit: 'kg' };
  expect(inventory.requestPartsFields.safeParse({ work_order_id: id, lines: [line, { ...line, part_id: upper }] }).success).toBe(false);
  const allocation = { ...line, location_id: lower };
  for (const variant of [{ ...allocation, part_id: upper }, { ...allocation, location_id: upper }]) {
    expect(inventory.reservePartsFields.safeParse({ work_order_id: id, lines: [allocation, variant] }).success).toBe(false);
  }
  const reservation = { reservation_id: lower, quantity: '0.001', unit: 'kg' };
  expect(inventory.reservationPartsFields.safeParse({ work_order_id: id, lines: [reservation, { ...reservation, reservation_id: upper }] }).success).toBe(false);
  expect(inventory.requestPartsFields.safeParse({ work_order_id: id, lines: [{ ...line, part_id: upper }] }).success).toBe(true);
});
