import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessOperations, assertRecoveryObjectives } from './operational-controls.mjs';

const now = Date.parse('2026-10-26T00:00:00Z');
const hour = 3600000;
const healthy = () => ({ backup_at: new Date(now - hour).toISOString(), backup_verified: true,
  scheduler_at: new Date(now - hour).toISOString(), required_dependencies_healthy: true,
  recovery_headroom_percent: 50, quota_used_percent: { database: 20, storage: 20, egress: 20, email: 20, functions: 20, ai: 20 } });
test('operational decisions enforce backup age, quota and recovery boundaries', () => {
  assert.deepEqual(assessOperations(healthy(), now), { decision: 'normal', reasons: [] });
  for (const [age, decision] of [[23, 'reduce'], [24, 'pause']]) {
    assert.equal(assessOperations({ ...healthy(), backup_at: new Date(now - age * hour).toISOString() }, now).decision, decision);
  }
  for (const key of Object.keys(healthy().quota_used_percent)) {
    for (const [used, decision] of [[79.99, 'normal'], [80, 'reduce'], [94.99, 'reduce'], [95, 'pause']]) {
      const sample = healthy(); sample.quota_used_percent[key] = used;
      assert.equal(assessOperations(sample, now).decision, decision);
    }
  }
  assert.equal(assessOperations({ ...healthy(), recovery_headroom_percent: 29.99 }, now).decision, 'reduce');
  assert.equal(assessOperations({ ...healthy(), recovery_headroom_percent: 30 }, now).decision, 'normal');
  for (const patch of [{ backup_verified: false }, { required_dependencies_healthy: false }, { scheduler_at: new Date(now - 26 * hour - 1).toISOString() }]) {
    assert.equal(assessOperations({ ...healthy(), ...patch }, now).decision, 'pause');
  }
});
test('unknown, invalid and future measurements cannot authorize intake', () => {
  for (const patch of [{ backup_at: null }, { backup_at: 'bad' }, { backup_at: new Date(now + 1).toISOString() },
    { quota_used_percent: {} }, { recovery_headroom_percent: NaN }, { required_dependencies_healthy: null }, { backup_verified: 'yes' }]) {
    assert.throws(() => assessOperations({ ...healthy(), ...patch }, now), /Invalid operational measurements/);
  }
  assert.throws(() => assessOperations(healthy(), NaN));
});
test('measured recovery objectives reject missing, negative and exceeded observations', () => {
  assert.doesNotThrow(() => assertRecoveryObjectives(24 * hour, 4 * hour));
  for (const [rpo, rto] of [[24 * hour + 1, 1], [1, 4 * hour + 1], [-1, 1], [1, NaN], [undefined, 1]]) {
    assert.throws(() => assertRecoveryObjectives(rpo, rto));
  }
});
