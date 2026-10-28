import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHostedTarget } from './hosted-smoke.mjs';

const target = { OPSPILOT_PROJECT_REF: 'lhlizmdhxjspnxadtzsm', OPSPILOT_ORGANIZATION_ID: 'woyvnmwsxtjesyvdvfkp', SUPABASE_URL: 'https://lhlizmdhxjspnxadtzsm.supabase.co', PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com', PGPORT: '5432', PGUSER: 'postgres.lhlizmdhxjspnxadtzsm', PGDATABASE: 'postgres', PGSSLMODE: 'verify-full' };
test('hosted smoke rejects another project, organization, connection or TLS mode', () => {
  assertHostedTarget(target);
  for (const [key, value] of Object.entries({ OPSPILOT_PROJECT_REF: 'another-project', OPSPILOT_ORGANIZATION_ID: 'another-organization', SUPABASE_URL: 'http://127.0.0.1:54321', PGHOST: 'db.other-project.supabase.co', PGPORT: '6543', PGUSER: 'postgres', PGDATABASE: 'another', PGSSLMODE: 'require' })) {
    assert.throws(() => assertHostedTarget({ ...target, [key]: value }));
  }
});
