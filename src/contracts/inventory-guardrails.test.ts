import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8').replaceAll('\r\n', '\n');
const file = 'supabase/migrations/20261025000100_inventory_guardrails.sql';
const guardrails = existsSync(file) ? readFileSync(file, 'utf8') : '';
it('guards new stock mutations while preserving durable replay and frozen errors', () => {
  expect(guardrails).toContain('create function private.stock_consistent');
  let inventory = read('20261024000500_inventory');
  let jobs = read('20261024000600_job_parts');
  for (const [, old, replacement] of guardrails.matchAll(/array\[\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\]/g)) {
    if (inventory.includes(old)) inventory = inventory.replace(old, () => replacement);
    if (jobs.includes(old)) jobs = jobs.replace(old, () => replacement);
  }
  const guard = inventory.indexOf('perform private.require_consistent_stock');
  expect(guard).toBeGreaterThan(inventory.indexOf('if replayed is not null then return replayed'));
  expect(guard).toBeLessThan(inventory.indexOf('insert into public.inventory_balances'));
  const jobGuard = jobs.indexOf('perform private.require_consistent_stock');
  expect(jobGuard).toBeGreaterThan(jobs.indexOf('if replayed is not null then return replayed'));
  expect(jobGuard).toBeLessThan(jobs.indexOf('insert into public.stock_reservations'));
  expect(guardrails).toContain("raise exception using message='CONFLICT'");
});
it('reconciles ledger and linked issues/returns and persists independent notice cycles', () => {
  for (const source of ['sum(case when m.direction=', 'r.issued<>', 'r.returned<>', 'b.id is null', 'private.stock_low_state', 'b.available<=p.reorder_threshold', "'low_stock',b.id", "'blocked_parts',new.work_order_id", "'parts_shortages'"]) expect(guardrails).toContain(source);
});

it('finds every guarded patch once in its accepted predecessor and keeps the public projection frozen', () => {
  const inventory = read('20261024000500_inventory');
  const jobs = read('20261024000600_job_parts');
  for (const [, old] of guardrails.matchAll(/array\[\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\]/g)) {
    const predecessor = inventory.includes(old) ? inventory : jobs.includes(old) ? jobs : jobs.replaceAll("''", "'");
    expect(predecessor.split(old), old).toHaveLength(2);
  }
  const readBefore = jobs.split('create function private.job_parts_data')[1].split('create function public.get_job_parts')[0];
  const readAfter = readBefore.replace(/'reconciliation_state',case when exists\([\s\S]*?then 'discrepancy' else 'consistent' end\)/, "'reconciliation_state',case when exists(select 1 from public.work_order_parts p where p.organization_id=org and p.work_order_id=job and not private.stock_consistent(org,p.part_id)) then 'discrepancy' else 'consistent' end)");
  expect(readAfter).not.toBe(readBefore);
  expect(readAfter.split("'reconciliation_state'")[0]).toBe(readBefore.split("'reconciliation_state'")[0]);
  expect(readAfter).toContain('from public.work_orders w where w.organization_id=org and w.id=job');
});
