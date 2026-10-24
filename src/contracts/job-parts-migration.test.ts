import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8').replaceAll('\r\n', '\n');
const jobParts = migration('20261024000600_job_parts');

it('patches the accepted scheduling and maintenance function without losing its guards or planned date', () => {
  let definition = migration('20261022000100_operations').split('create function private.operational_command(')[1].split('end $$;')[0];
  for (const name of ['20261023000200_planned_scheduling', '20261024000200_maintenance_generation']) {
    for (const [, old, replacement] of migration(name).matchAll(/array\[\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\]/g)) {
      expect(definition.split(old)).toHaveLength(2);
      definition = definition.replace(old, () => replacement);
    }
  }
  const anchor = jobParts.match(/anchor text:='(  update public\.work_orders set status=next_status,[^']*)'/)![1];
  const hook = jobParts.match(/execute replace\(definition,anchor,E'((?:''|[^'])*)'\|\|anchor\)/)![1].replaceAll("''", "'").replaceAll('\\n', '\n');
  expect(definition.split(anchor)).toHaveLength(2);
  definition = definition.replace(anchor, hook + anchor);
  expect(definition).toContain("status=next_status,planned_on=case when next_status='scheduled'");
  expect(definition).toContain("if wo.pm_occurrence_id is not null and next_status='in_progress'");
  const cancellation = definition.indexOf("if next_status='canceled' then perform private.cancel_job_reservations");
  expect(cancellation).toBeGreaterThan(definition.indexOf('result:=private.replay'));
  expect(cancellation).toBeGreaterThan(definition.indexOf('wo.version<>expected'));
  expect(cancellation).toBeLessThan(definition.indexOf(anchor));
});

it('guards legacy linked compensation before stock writes while retaining replay and legacy checks', () => {
  let definition = migration('20261024000500_inventory');
  const block = jobParts.slice(jobParts.indexOf('-- Job consumption'));
  const anchor = block.match(/anchor text:='((?:''|[^'])*)'/)![1].replaceAll("''", "'");
  const guard = block.match(/execute replace\(definition,anchor,anchor\|\|E'((?:''|[^'])*)'\)/)![1].replaceAll("''", "'").replaceAll('\\n', '\n');
  expect(definition.split(anchor)).toHaveLength(2);
  definition = definition.replace(anchor, anchor + guard);
  const rejection = definition.indexOf("if original.kind in ('issue','return') then raise exception using message='INVALID_TRANSITION'");
  expect(rejection).toBeGreaterThan(definition.indexOf('if replayed is not null then return replayed'));
  expect(rejection).toBeLessThan(definition.indexOf('update public.inventory_balances set on_hand='));
  expect(definition).toContain('original.quantity<>qty or original.direction=direction');
  expect(definition).toContain('and correction_of=correction) then raise exception');
});
