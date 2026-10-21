# POR-23 preparation and backend handoff

Approved source base: ab5f13172df448f88f367083af8ca1f84af83721. Worktree: D:/Projects/OpsPilot/.worktrees/p1-core-maintenance. Branch: spec-team/p1-core-maintenance. Forge owns the shared dependency directory until explicit Pixel handoff.

## Execution plan

1. Prepare exact approved versions and script-free lock/install with D-owned caches, then smoke-check tooling/build/browser.
2. Write tenant and invitation integration assertions first; implement minimal T1 relational/RLS/RPC contracts and shared validation/errors.
3. Add isolated Linux CI using pinned actions, withhold triggers until actual free-cost authority is verified by Relay.
4. Run focused checks; record unavailable Auth/RLS/Storage/SMTP evidence honestly and hand shared files/contracts to Pixel.

No T2 workflow, stock, file-upload or release implementation. No source PNG changes. No production target, deployment, migration, paid resources or controller/Linear writes.

## Initial observations

2026-10-21 18:02 +08:00: D free 9,609,428,992 bytes; C free 2,381,504,512. Clean assigned branch at approved source base. Both approved document hashes match live POR-23. Node24.15/npm11.12.1; HTTPS official npm registry and strict SSL true. No manifest/lock/dependencies existed.

Current typescript-eslint8.72.0 excludes TypeScript7 in its peer range. Compatible Babel8.0.7 parser plus syntax plugins preserve approved TS7.0.2; tsc enforces types/unused symbols and ESLint enforces supported syntax rules. No forced peers, global upgrades or disabled integrity.

## Dependency constraint checkpoint

Two script-free attempts failed before a lock or node_modules existed:

- `npm install --ignore-scripts`: ERESOLVE.
- `npm install --ignore-scripts --omit=peer`: same ERESOLVE; omission does not prevent peer resolution.

Both use only `.cache/npm` in this D: worktree. No lifecycle scripts executed. Official exact resolver6.0.0 metadata declares optional `effect ^4.0.0` and `@typeschema/main >=0.13.7`; npm resolves @typeschema/main0.14.1 -> @typeschema/effect0.14.0 -> effect3.22.3 / @effect/schema0.71.4 (effect^3), causing the conflict. The published 6.x set contains only6.0.0. Candidate5.4.0 has sole peer react-hook-form^7.55.0; its use would change an approved direct major and was escalated to Relay before modification. No forced or relaxed peer resolution, registry rewriting, overrides, arbitrary upgrades or lock deletion were attempted. Preparation and dependent backend work remain gated on a supported approved resolution and actual smoke checks.

On resume, approved saved hashes and base remain unchanged; D free9,539,424,256 bytes, C free1,275,912,192 bytes. All future process TMP/TEMP, npm cache and Playwright outputs must use ignored D-owned `.cache` paths; no C fallback. Model/effort remains unavailable in actual telemetry.

## R2 preparation execution

Owner-approved R2 exact bytes copied to docs/proposals/technical-plan-r2.md (SHA256284c0a3a0cecb4a2eed4bd3bb7e5838b47ff5292df006b014dcb2f4db2cbda06) with a -text Git attribute. Original approved specification and technical plan remain unchanged. Original POR-23 was independently read back with R2, In Progress, Kin/artkin. Resolver5.4.0 now replaces6.0.0 as the sole approved direct candidate correction.

`npm install --ignore-scripts` passed:539 packages. `npm ls --depth=0` passed with all exact direct pins. Vite8.3.5, SupabaseCLI2.121.0 and Playwright1.64.1 version executions passed. The CLI native executable is shipped by exact optional @supabase/cli-windows-x64; no setup/postinstall exception needed. No lifecycle hook was executed. Lockfile has only optional Darwin fsevents marked hasInstallScript; it is absent on Windows. Typecheck, lint, two meaningful Zod4 resolver transform/default/field-error tests, and Vite production build passed. Representative TS/TSX is linted using Babel parser; TypeScript7 separately enforces types and unused symbols.

`playwright install chromium` passed after the tool's built-in DNS mirror fallback. All downloads/temp paths are under ignored D: .cache; no manual retry or C fallback. `npm run test:e2e` passed one baseline check: React renders in Chromium without page errors. It is a toolchain smoke, not the planned product journey. Final browser download consumed the working allowance; D free7,914,905,600 bytes after prep (initial pre-install floor had passed). Locked reinstall is in progress; no blanket reinstall beyond this required reproducibility check.

`npm audit --json` returns7 high entries, all dev-only shadcn4.22.1 -> fast-glob/micromatch/braces3.0.3. Official GHSA-vfj7-8cjw-p6xm describes stack exhaustion on deeply nested attacker-supplied glob patterns; advisory first_patched_version is null and npm registry latest is3.0.3. No compatible patch exists. No audit fix, override, downgrade or vulnerable pattern execution occurred. Withhold shadcn generation and untrusted glob inputs; browser runtime does not import these CLI modules. This is a known dev-tool risk, not a clean audit.

Draft .github/workflows/ci.yml uses only manual workflow_dispatch, one ubuntu-24.04 job/35min, exact checkout/setup-node commits, pinned Node24.15/npm11.12.1 check, scripts-disabled locked install, no cache/artifact upload, per-run loopback Docker network and owned teardown. Startup/status/reset outputs stay ephemeral and suppressed; local generated keys are masked before environment export. Actual loopback binding/config/status shapes, Linux native binaries and backend tests remain unverified until authorized CI. No remote trigger/push/commit occurred. Actual required PR/push wiring and enforced protection remain later gates.

### Locked reinstall and initial CI candidate

`npm ci --ignore-scripts` passed539 packages (4min), preserving exact direct pins and lock SHA25661ef0e064893b667581fe27a082a196bb09b8e681a8e73a035cfbc4837d4d595. Every lock resolved URL is the official HTTPS npm registry. Repeated typecheck/lint/build passed; all5 unit tests passed after3 genuine failing trust-boundary assertions were observed against interface stubs, then strict context/nonowner-role/error allowlist implementations were added. Earlier missing-module collection failure was diagnosed separately and is not counted as assertion-red evidence. R2 resolver2 tests and these3 checks are separate from backend permissions.

Initial CI test candidate: pgTAP8 schema/RPC contract assertions, plus real isolated Auth/RPC fixture tests for controlled verified bootstrap, no direct critical writes, tenant denial, owner-only nonowner invitation, current confirmed matching email, seven-day/expiry/revocation/current inviter, retry identity, cross-tenant asset references, request conversion identity, revoked membership and last-owner protection. No production SQL exists yet. The expected initial database red is absent contract, not security acceptance. Real fixture operations use only job-owned loopback Supabase and synthetic users; tests reject hosted/non-loopback configuration, suppress secret-bearing results and never print passwords/tokens. Integration test execution is pending the authorized isolated job.

Workflow trigger amended only after Relay source/cost review: push branchspec-team/p1-core-maintenance plus manualdispatch; no wildcard/default/PR trigger. Relay authorized one bounded initial run following its observed included-minutes/$0-overage controls, subject to concrete candidate review before commit/push. No automatic remote retry. Root retains remote ownership; no worker push occurred.

Repeat Chromium baseline after locked reinstall passed1 test in16.5s. Latest quiescent observation2026-10-21 18:53+08:00: D free7,917,006,848 bytes; C free1,196,056,576 bytes. Locked reinstall exited0 after4min and all subsequent checks completed; no stalled process or retry.

## Initial isolated CI and diagnosed repair

Initial run39588250670 at exact6b6372bc4e0fb756e1750845ebfab9abdcaa73f7: Linux pinned-runtime/dependency/type/lint/unit/build/browser-download step passed; actual Supabase startup passed including all published-port loopback assertions and required masked status-value checks. Database verification failed at redirected `supabase db reset --local`, before any pgTAP or integration test output. Therefore NO schema-red, RLS/permission, migration or recovery result is claimed. The always-teardown step returned success but suppressed errors, so actual resource removal was unverified. URL:https://github.com/kin2001/OpsPilot/actions/runs/39588250670.

The exact reset cause was not retained; raw ephemeral credential-capable logs were discarded. Official v2.121.0 reset-local-database.ts lines268–312 reads NetworkIdFlag for each invocation and passes its freshly built networkId into PG15+ recreation; recreate-local-database.ts documents network/container/volume recreation then satellite restart. Start had a custom network flag while reset omitted it. This is a source-supported mismatch hypothesis, not a recovered exact error. Sources:https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/command-internal/db-bootstrap/reset-local-database.ts and https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/command-internal/db-bootstrap/recreate-local-database.ts.

Narrow repair passes the same per-run network to reset, asserts loopback again after recreation, adds bounded diagnostics with known status secrets/URLs/JWTs/key patterns/credential assignments/long tokens redacted before output, and verifies project-owned container and job-network absence. Cleanup now fails its own step if stop/absence checks fail, preserving any prior failed test step. Only the disposable job's configured project label and unique run network are inspected/stopped. No blanket Docker cleanup. Redactor selfcheck includes known secret/URL/JWT masking and intact nonsecret diagnostic text. No rerun or production SQL yet; Relay reviews and pushes one repaired candidate under the same free-only run bounds.
