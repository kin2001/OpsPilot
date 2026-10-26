
<!-- spec-team:start -->
Read .agents/skills/spec-team/SKILL.md for the spec-team workflow.
<!-- spec-team:end -->

## Supabase account boundary

OpsPilot has its own Supabase access under a separate account. Use only the `opspilot` CLI profile through `.spec-team/local/supabase-opspilot.ps1` and the verified OpsPilot organization in `.spec-team/local/supabase-opspilot-state/connected.json`.

Do not use bare `supabase login`, the default `supabase` profile, another project's credentials, or account fallback for this repository. If dedicated access is missing, expired, or denied, stop the affected operation and reconnect the OpsPilot profile. Verify the exact organization and project before any remote write. This instruction also applies to direct Management API calls and deployment jobs.

Keep access tokens and server credentials in native secure storage or approved protected runtime secrets. Never include them in source, commits, logs, reports, chat, browser-exposed variables, or public artifacts. Local CLI state under `.spec-team/` is ignored; do not force-add it. Do not pause, delete, upgrade, or change resources belonging to other projects.

## Backblaze B2 backup access

B2 access was set up and verified on October 26, 2026. The dedicated credential is stored in Windows Credential Manager as `OpsPilot B2:backup`; no key values belong in this file or Git. It is restricted to the private `opspilot-backups-lhlizmdh` bucket and `opspilot/` prefix. Use only this dedicated entry, never the Master Application Key or another project's credentials.

The verified setup key expires on November 2, 2026 at 23:35 Asia/Manila. Recheck live scope and expiry before use; missing, expired or denied access requires reconnection, never account fallback or automatic permission expansion. Sanitized verification metadata is in `.spec-team/reports/por47-b2-access.json`.

On October 27, 2026, the initial predeployment checkpoint was encrypted with restic, uploaded, downloaded/decrypted, and checked against the archive and every member checksum. The recovery credential is in Windows Credential Manager as `OpsPilot Restic:recovery`; the owner reports an independent copy in a password manager accessible from another device. Never print or commit its value. Checkpoint evidence is `.spec-team/reports/por47-initial-checkpoint.json`.

The initial empty-database isolated restore was subsequently verified by independent Lens tests on October 27, 2026: recovered archive/member checksums, application/Auth/Storage data and recorded security metadata match. The accepted 17 migrations, four Edge Functions and hosted Auth settings are deployed and have scoped read-only/unauthenticated verification. Full authenticated smoke is blocked by the dedicated token's API-key read denial; reconnect only that profile, without fallback. Current evidence is in `.spec-team/reports/por47-initial-recovery-acceptance.json` and `por47-hosted-partial-acceptance.json`.

The owned temporary Singapore restore project is identified in `.spec-team/reports/por47-managed-restore-target.json`. Reconcile exact journal identity before any cleanup or restore. Its successful initial restore omitted only a recorded parameter grant to a provider-owned role absent from the target; the original encrypted SQL is intact. Never recreate reserved provider roles or relax application permissions to force a restore. Failed local labs are stopped; their protected directories remain because automatic approval review rejected recursive cleanup. Daily scheduling, retention, populated/private/Storage recovery and full hosted acceptance remain pending. Do not treat this single initial checkpoint as continuous backup protection.
