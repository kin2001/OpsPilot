# Security, workload and recovery evidence map

POR-44 implements slice 28B of the approved R3 package and R1 slicing. This maps backend observations to stable cases; a source pointer is a test intention until the exact candidate's PR CI succeeds. The retained delivery report binds actual head/base/tree, CI results, independent code review and separate synthetic acceptance. No row asserts human, hosted, device or private-pilot acceptance.

The required `verify` job runs every SQL, service and browser test, populated upgrade, native schema comparison, recovery and load lab, followed by unconditional owned-resource cleanup. Missing services fail; skipped stages cannot satisfy the gate. Rehearsals reject hosted targets and require the actual CI identity plus project/network/loopback bindings.

| Case | Backend invariant / owning executable evidence | Remaining observation outside this slice |
| --- | --- | --- |
| 01 | `tests/integration/core.test.ts`: verified bootstrap, invite and tenant membership | Authorized hosted SMTP/onboarding |
| 02 | `core.test.ts`, `operations.test.ts`: asset constraints, tenant reads, append-only meter corrections | Owner walkthrough |
| 03 | `operations.test.ts`: assignment/start/submission/review and strict read models | Human maintenance process |
| 04 | `operations.test.ts`: returned repair retains revision/performer/evidence history | Human repair review |
| 05 | `job-parts.test.ts`: shortage block, reservations and explicit coordinator resume | Human stock process |
| 06 | `operations.test.ts`, `inspections.test.ts`: completion and release are separate; current blockers atomically rechecked | Qualified business/safety decision |
| 07 | `src/app/assistant-handler.test.ts`, `assistant.test.ts`: validated editable suggestion, confirmation metadata, no model write authority | POR-27 live-provider smoke remains deferred |
| 08 | `src/app/assistant-handler.test.ts`: bounded timeout/refusal/invalid output; `assistant-client.test.ts` and E2E manual continuation | Actual authorized provider outage |
| 09 | All module integration suites and SQL tests: wrong tenant/role, direct API/table/Storage denials | Qualified security assessment |
| 10 | `core.test.ts`, `maintenance.test.ts`, `reporting.test.ts`, `assistant.test.ts`: retained JWT/current membership and continuation revocation | Device/context-switch walkthrough |
| 11 | `operations.test.ts`, `inventory.test.ts`, `.github/rehearse-load.mjs`: replay, payload conflict, stale version and 20 contenders | Real network continuity |
| 12 | `operations.test.ts`, `inventory.test.ts`, `core.test.ts`: archival/deactivation preserve participants, ledgers and audit | Human disposition policy |
| 13 | Backend denies uncertain/invalid commands; responsive browser tests under `tests/e2e/` | Actual narrow touch/keyboard walkthrough deferred from POR-43 |
| 14 | `.github/rehearse-recovery.mjs`: DB/Auth/app-row fingerprints/ACLs/config reference/Storage checksums, post-snapshot revocation and replay; measured lab objectives asserted | Hosted encrypted backups, isolated private-target restore, recovery-owner tolerance |
| 15 | `core.test.ts`, `operations.test.ts`: request conversion is transactional/deduped, return history retained | Coordinator walkthrough |
| 16 | `maintenance.test.ts`, SQL `007`–`009`: local-calendar revisions/cursors, native Cron, bounded backlog/overlap | Hosted scheduler monitoring |
| 17 | `inspections.test.ts`, SQL `010`–`011`: pinned templates, immutable correction episodes, one remedy/hold | Company inspection process |
| 18 | `inventory.test.ts`, `job-parts.test.ts`, SQL `012`–`015`: exact units, 20 competing sessions, linked immutable returns/reversals | Inventory-owner acceptance |
| 19 | `inspections.test.ts`, `job-parts.test.ts`: per-recipient dedupe, current access and read ownership | Hosted delivery/monitoring |
| 20 | `reporting.test.ts`, `report-export.test.ts`, SQL `016`: six fact envelopes, date bounds/cursors, formula-safe export | Business metric acceptance |
| 21 | `assistant.test.ts`, handler tests, SQL `017`: scoped retrieval/history, hostile notes treated as data, no arbitrary tools/mutations | Actual authorized provider and privacy review |
| 22 | `core.test.ts`, `maintenance.test.ts`, `operations.test.ts`: last-owner, current team and preserved historical zone/revision | Named owner change procedure |
| 23 | `operations.test.ts`, `src/contracts/operational.test.ts`: private ready-only bytes/parent authority/revocation; magic-byte/type/size rejection | PDF remains disabled; human malware/evidence policy |
| 24 | `.github/rehearse-load.mjs`: 3 organizations ×30 members/500 assets/10k WOs/100k events, 10 concurrent readers, 20 contenders; list/detail p95≤1500ms, command p95≤2000ms | Hosted entitlements/representative field traffic |
| 25 | Admission stays closed pending actual named humans and hosted evidence | POR-28D; cannot be satisfied by backend tests |
| 26 | `core.test.ts`: recipient binding, expired/revoked/replayed invite, current inviter, intended local mail | Authorized hosted email/recovery |
| 27 | Handler tests, SQL `017`: disabled/private-data gate, failed-attempt admission and user/tenant AI caps | Real provider configuration and commercial/privacy consent |
| 28 | `operations.test.ts`, `inspections.test.ts`, `maintenance.test.ts`: immutable participants, both blocker/release lock orders | Qualified release/safety acceptance |
| 29 | Strict backend envelopes/errors plus automated E2E focus/forms/reflow | Actual NVDA/TalkBack/VoiceOver, UI zoom and device checks remain deferred |
| 30 | `maintenance.test.ts`, SQL `009`, `012`, `018`; operational-controls tests and recovery: bounded backlog, command/day/invite/AI caps, duplicate-safe resumption | Actual provider exhaustion/outage/monitoring and emergency reconciliation |

Integration filenames above are relative to `tests/integration/` unless a path is explicit. SQL files live in `supabase/tests/database/`. The load lab runs **after** recovery so the 300,000-event capacity fixture does not inflate the independent in-memory recovery snapshot. Both must pass in the same final job; cleanup destroys only that job's resources.

The load lab measures PostgREST list/detail and `save_asset` command/replay/conflict latency. It does not establish all report/export/AI latency, real-user p75 web vitals, hosted capacity or a provider SLA. Existing report/export bounds and 20-way inventory contention remain separately exercised. The synthetic members have owner roles to stress authorized reads; production role isolation is checked by the module permission suites.

The first load observation exposed a work-order list statement timeout. The existing `(organization_id,asset_id,created_at,id)` index could not provide tenant-wide date/id ordering. The additive `20261026000100_work_order_list_index.sql` supplies that actual list path without changing RLS, quotas or command behavior. The lab refreshes bulk-fixture statistics, checks the authenticated query plan uses the new index, then measures the unchanged read/command budgets. Index creation is a forward migration; hosted application still requires separate target/backup authority.
