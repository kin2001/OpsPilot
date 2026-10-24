import { z } from 'zod';

// Keep decimals as strings through RPC; PostgreSQL alone performs stock arithmetic.
export const stockDecimal = z.string().regex(/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/);
export const stockQuantity = stockDecimal.refine((value) => !/^0(?:\.0{1,3})?$/.test(value));
const unit = z.string().trim().min(1).max(40);
export const partFields = z.strictObject({ id: z.uuid().optional(), code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), unit, reorder_threshold: stockDecimal.nullable(), archived: z.boolean().optional() });
export const stockLocationFields = z.strictObject({ id: z.uuid().optional(), code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200) });
export const receiveStockFields = z.strictObject({ part_id: z.uuid(), location_id: z.uuid(), quantity: stockQuantity, unit, source: z.string().trim().min(1).max(2000).optional() });
export const adjustStockFields = receiveStockFields.extend({ direction: z.enum(['in', 'out']), reason: z.string().trim().min(1).max(2000), correction_of: z.uuid().optional() });
export type PartFields = z.infer<typeof partFields>;
export type StockLocationFields = z.infer<typeof stockLocationFields>;
export type ReceiveStockFields = z.infer<typeof receiveStockFields>;
export type AdjustStockFields = z.infer<typeof adjustStockFields>;
export const inventoryPart = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), code: z.string(), name: z.string(), unit, reorder_threshold: stockDecimal.nullable(), archived_at: z.string().nullable(), created_by: z.uuid(), created_at: z.string(), version: z.int().positive() });
export const stockLocation = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), code: z.string(), name: z.string(), created_by: z.uuid(), created_at: z.string(), version: z.int().positive() });
export const stockBalance = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), part_id: z.uuid(), location_id: z.uuid(), on_hand: stockDecimal, reserved: stockDecimal, available: stockDecimal });
export const stockMovement = z.strictObject({ id: z.uuid(), organization_id: z.uuid(), part_id: z.uuid(), location_id: z.uuid(), kind: z.enum(['receipt', 'adjustment']), direction: z.enum(['in', 'out']), quantity: stockQuantity, unit, actor_id: z.uuid(), request_id: z.uuid(), source: z.string().nullable(), reason: z.string().nullable(), correction_of: z.uuid().nullable(), created_at: z.string() });
export const inventoryPaging = z.strictObject({ cursor: z.uuid().optional(), page_size: z.int().min(1).max(100) });
export const inventoryPartPage = z.strictObject({ items: z.array(inventoryPart).max(100), next_cursor: z.uuid().nullable() });
export const stockLocationPage = z.strictObject({ items: z.array(stockLocation).max(100), next_cursor: z.uuid().nullable() });
export const stockBalancePage = z.strictObject({ items: z.array(stockBalance).max(100), next_cursor: z.uuid().nullable() });
export const stockMovementPage = z.strictObject({ items: z.array(stockMovement).max(100), next_cursor: z.uuid().nullable() });
