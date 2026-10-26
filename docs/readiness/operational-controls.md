# Backup, capacity and recovery decisions

The approved operating targets are daily encrypted backups, RPO≤24 hours, RTO≤4 working hours, 7 daily and 4 weekly copies and a backup before schema changes. These targets require actual named recovery/business owners and an authorized hosted destination before private intake. No hosting, monitor, backup service, spend or private admission is configured by POR-44.

`.github/operational-controls.mjs` is a local operator decision aid. It does not collect provider metrics or enforce a deployed write barrier. Run `node .github/operational-controls.mjs <protected-measurements.json>` with current non-secret observations:

```json
{
  "backup_at": "2026-10-26T00:00:00Z",
  "backup_verified": true,
  "scheduler_at": "2026-10-26T00:00:00Z",
  "required_dependencies_healthy": true,
  "recovery_headroom_percent": 50,
  "quota_used_percent": { "database": 20, "storage": 20, "egress": 20, "email": 20, "functions": 20, "ai": 20 }
}
```

The example is synthetic, never a current readiness receipt. `backup_at` is the recoverable data checkpoint, not upload completion. Mark verified only after encrypted object existence, checksum verification, key recoverability and the required periodic isolated restore have been evidenced. Quota percentages require actual entitlement denominators; disabled AI may be recorded as zero only with its kill switch verified. Unknown entitlement/health/headroom is unknown, not zero. Protected monitoring must detect stale measurements; this one-shot command has no scheduler or automatic wake guarantee.

| Observation | Decision and required operator action |
| --- | --- |
| Backup age reaches 23h | `reduce`: alert recovery owner; obtain/verify fresh backup before 24h |
| Backup age reaches 24h, invalid/missing evidence, checksum/key failure | `pause`: close affected new operational intake until a verified checkpoint restores the target or a qualified human authorizes a recorded incident procedure |
| Any measured resource reaches 80%, or recovery/capacity headroom falls below 30% | `reduce`: notify accountable owner; stop optional exports/AI and reduce admission before exhaustion |
| Any quota reaches 95%, or required security/recovery dependency fails | `pause`: preserve existing records/receipt discovery; close affected new intake and escalate without paid upgrades |
| Successful scheduler heartbeat exceeds 26h | `pause`: investigate generation/backlog; preserve old occurrences/cursors; do not manufacture completed jobs |
| All verified measurements healthy | `normal` assessment only; separate human/hosted admission gates still apply |

Exit 0 means normal; exit 1 means reduce/pause with fixed reason codes; exit 2 means invalid/unavailable measurements and a pause instruction. Output never copies input details. No value authorizes spend or overrides permission/release checks. A newer warning cannot lower an earlier pause. The unit suite checks exact thresholds and invalid/future observations.

For the first hosted admission, POR-28D must name the person who executes a pause, verify a target-supported intake barrier and current-session/API denial, configure the protected monitor/alerts, and rehearse reopening. A UI banner or this CLI alone is insufficient. Keep private access closed meanwhile. Do not delete records, clear receipts, reset quotas, revoke all owners, or repurpose the onboarding allowlist as a write barrier. Ordinary command quotas already enforce 5000/tenant/day, 60/user/minute and 100 invitations/tenant/day server-side; AI, file and Cron bounds remain enforced by their existing modules.

During an incident the company uses its separately approved emergency recording process. Preserve actor, asset/job, time, quantities, decisions and request identities. After authorization, reconcile emergency facts explicitly against restored receipts/ledgers/holds; never silently replay notes as completed/released work or purchase capacity.

The CI recovery rehearsal positively binds only its job-owned loopback DB/Auth containers and network before destructive operations. It snapshots full database/Auth/schema, source config reference/checksum and bounded ready Storage object bytes/checksums in memory; changes a synthetic asset/removes a file; restores untouched DB content; checks all public/private row counts and fingerprints plus canonical object/default permissions; reapplies post-snapshot membership revocation, transcript deletion and expiry before restored API checks. It refreshes only the bound Auth service's stale DB sessions, verifies fresh sign-in/refresh, current-JWT object reads, revoked denials, receipt replay, inventory/inspection/PM history, one occurrence/job and deduped notices/movements. Orphan cleanup retains ready evidence.

The script asserts measured lab RTO≤4h and checkpoint-fact RPO=0≤24h. The restore clock begins at deliberate incident recovery; it does not measure outage detection/staff response. The snapshot-to-incident interval is separately reported. The source config copy/checksum and Auth settings equivalence are configuration-reference checks, not restoration of actual provider secrets, SMTP, DNS or hosted control-plane settings. Hosted recovery must separately protect/recover those references and owner-held secrets, keep access closed until revocation/session reconciliation completes, then verify representative workflows before resuming Cron and reopening. Nothing exports dumps, private object bytes, tokens or logs as CI artifacts.

Full candidate CI and independent review receipts belong in the retained delivery report. This runbook and a synthetic restore cannot establish off-site encryption, 7+4 retention, named human tolerance, hosted RPO/RTO or pilot admission.
