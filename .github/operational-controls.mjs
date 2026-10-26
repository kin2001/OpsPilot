import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const hour = 3600000;
const percent = (value) => Number.isFinite(value) && value >= 0 && value <= 100;
export function assessOperations(sample, now = Date.now()) {
  const invalid = 'Invalid operational measurements';
  assert(sample && Number.isFinite(now), invalid);
  const age = (value) => {
    assert(typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now, invalid);
    return now - Date.parse(value);
  };
  const backupAge = age(sample.backup_at); const schedulerAge = age(sample.scheduler_at);
  assert(typeof sample.backup_verified === 'boolean' && typeof sample.required_dependencies_healthy === 'boolean', invalid);
  assert(percent(sample.recovery_headroom_percent), invalid);
  const quotas = ['database', 'storage', 'egress', 'email', 'functions', 'ai'];
  assert(quotas.every((key) => percent(sample.quota_used_percent?.[key])), invalid);
  const reasons = []; let decision = 'normal';
  function record(condition, severity, reason) {
    if (!condition) return;
    reasons.push(reason);
    if (severity === 'pause' || decision === 'normal') decision = severity;
  }
  record(!sample.backup_verified, 'pause', 'backup_unverified');
  record(backupAge >= 24 * hour, 'pause', 'backup_expired');
  record(backupAge >= 23 * hour && backupAge < 24 * hour, 'reduce', 'backup_due');
  record(!sample.required_dependencies_healthy, 'pause', 'required_dependency_failed');
  record(schedulerAge > 26 * hour, 'pause', 'scheduler_overdue');
  record(sample.recovery_headroom_percent < 30, 'reduce', 'recovery_headroom_low');
  for (const key of quotas) {
    const used = sample.quota_used_percent[key];
    record(used >= 80, used >= 95 ? 'pause' : 'reduce', `${key}_quota`);
  }
  return { decision, reasons };
}

export function assertRecoveryObjectives(rpoMs, rtoMs) {
  assert(Number.isFinite(rpoMs) && rpoMs >= 0 && rpoMs <= 24 * hour, 'Measured lab RPO exceeds 24 hours or is unavailable');
  assert(Number.isFinite(rtoMs) && rtoMs >= 0 && rtoMs <= 4 * hour, 'Measured lab RTO exceeds 4 hours or is unavailable');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 3);
    const bytes = readFileSync(process.argv[2]); assert(bytes.length <= 16384);
    const result = assessOperations(JSON.parse(bytes));
    console.log(JSON.stringify(result)); process.exitCode = result.decision === 'normal' ? 0 : 1;
  } catch { console.error('Operational assessment unavailable; pause intake and obtain verified measurements.'); process.exitCode = 2; }
}
