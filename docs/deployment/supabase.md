# OpsPilot permanent Supabase backend

## Intended environment

OpsPilot uses its own Supabase account and the Free `OpsPilot` organization, ID `woyvnmwsxtjesyvdvfkp`. The persistent project is `opspilot`, ref `lhlizmdhxjspnxadtzsm`, in Singapore (`ap-southeast-1`). PostgreSQL is 17.11. This backend is separate from disposable development/CI services and from the owner's other applications.

The app origin is `https://opspilot.artkincarreon.site`. Configuring that origin in Supabase does not establish DNS, frontend hosting, or successful email-link journeys. Frontend hosting belongs to POR-48; final human and hosted admission belongs to POR-46.

Use only the dedicated `opspilot` CLI profile through the controller's ignored `.spec-team/local/supabase-opspilot.ps1` launcher. The connected organization receipt is `.spec-team/local/supabase-opspilot-state/connected.json`. Never use the default CLI login, another project's token, an alternate account after a denial, or remote `db reset`. The launcher exposes fixed operations rather than arbitrary CLI arguments. Verify the live organization and exact project before any write.

Native credential storage holds the dedicated Supabase token, project-bound database password, B2 credential and backup recovery password. Their values do not belong in this document, Git, command arguments, screenshots, reports, frontend variables, or CI artifacts. Protected server-runtime secrets are distinct from the browser's publishable key. An ignored path alone is not credential protection.

## Deployment and current evidence

The first deployment consumed accepted commit `126122f6cee3c61de843664ab74c9d463805c37f`. Its 17 migrations were applied in order in one transaction, with matching version, name and original SQL recorded in `supabase_migrations.schema_migrations`. A rerun must inspect the complete history and require an exact immutable prefix of the accepted source. A pending or uncertain transaction blocks further writes until readback resolves it. Do not edit applied migrations or repair history merely to make an inspection pass.

Migration readback found 38 public and 8 private tables. All public tables have RLS enabled. The private `repair-evidence` bucket allows JPEG, PNG and WebP, with a 5 MiB file limit. The native `opspilot-maintenance` job runs at minute 5 hourly; `opspilot-assistant-retention` runs daily at 02:17 UTC. Active job configuration is not proof of execution, successful generation, or an acceptable heartbeat.

Four accepted functions are deployed: `organization-invite`, `attachment-upload`, `report-export` and `assistant`. Their gateway `verify_jwt=false` setting is intentional: their handlers perform authentication and authorization, including public CORS preflights. Preserve those handler checks. The shared `APP_ORIGIN` is the exact planned origin. `INVITATION_EMAIL_ENABLED=false` and `ASSISTANT_ENABLED=false`; private AI remains disabled until its separate approval gate. No AI provider key is necessary for manual operations.

Hosted Auth readback verifies one-hour JWT lifetime, password minimum 12, email confirmation, secure email changes, TOTP enrollment/verification and exact `/invite` and `/reset-password` callback paths. Custom SMTP and a verified sender are still required. Do not enable invitation delivery based solely on saved configuration; verify actual confirmation, recovery and recipient-bound invitation flows. Retained JWTs require current-membership checks; logout alone does not revoke every issued JWT immediately.

Independent Lens checks verified exact migration history, selected RLS/grant boundaries, bucket settings, Cron/function metadata, Auth settings and 16 actual unauthenticated Edge cases. Authenticated service tests remain a separate gate. Current runtime evidence and failures live in the ignored controller reports; this document does not declare POR-47 complete.

## Hosted synthetic smoke

The existing integration and browser harnesses deliberately require job-owned loopback services. Keep their guards. Never point `.github/rehearse-recovery.mjs`, `.github/rehearse-upgrade.mjs`, load scripts or reset commands at the permanent project.

`.github/hosted-smoke.mjs` is a distinct operator-run synthetic harness with a fixed project/account/connection boundary. Supply dedicated credentials only through protected child-process environment, after live account verification. It needs the project-scoped publishable/service keys, a database connection using `verify-full` TLS, and the dedicated management token. The current management token denies API-key access; reconnect the dedicated profile with API Keys Read and API Key Secrets Read before the affected tests. Never fall back to another account or disable certificate verification.

The harness creates named synthetic users and two synthetic tenants, enrolls native TOTP, and exercises command replay/conflicts, stale versions, cross-tenant and direct-write denials, invitation recipient binding, validated private image bytes and retained-JWT membership revocation. Its small SQL fixtures target only the users/tenants created in that run. It sends no SMTP messages and performs no reset or broad deletion. Synthetic records and audit history remain for the populated recovery rehearsal; reconcile a failed run before retrying. The credential-free target-guard test can run in ordinary PR CI without permanent credentials.

Hosted public-schema type generation uses a different formatter/metadata version than local CI. Preserve the accepted local-CI-generated contract. Live catalog checks confirmed that the hosted generated-column write typing and no-argument RPC representation differ from the local generator, without schema drift. Five JSON columns also differ between `Json` and the narrower accepted `NonNullable<Json>`; SQL `NOT NULL` does not itself exclude a JSON literal `null`. Do not claim byte or structural equality between those generated files. Database constraints, command validation and generated columns remain authoritative.

## Initial encrypted recovery checkpoint

Before deploying the schema, an initial checkpoint captured supported role/schema/data exports, Auth/Storage database state, hosted configuration and accepted migration/function source. It contained no user records or Storage objects. The 870,400-byte archive was encrypted client-side with restic and uploaded to the private B2 bucket `opspilot-backups-lhlizmdh`, under `opspilot/restic-v1`. Full repository read-data verification, authenticated download/decryption and every member checksum passed.

The owner keeps the recovery password in a password manager accessible from another device; the working copy is in Windows Credential Manager as `OpsPilot Restic:recovery`. The B2 key is separately stored as `OpsPilot B2:backup`, scoped to this bucket and the `opspilot/` prefix. Losing the recovery password prevents decryption. Native storage on this PC is not proof that another-device recovery has been rehearsed.

Independent Lens acceptance compared the recovered archive with both the initial source and an isolated Free Singapore Supabase restore target: 33 application/Auth/Storage tables with zero application rows, plus captured ownership, ACL, RLS, policy and function fingerprints. Documented provider migration-bookkeeping tables were excluded from the application-data comparison because Supabase recreates them. The successful SQL restore/comparison interval was 12.87 seconds; that is not an incident-wide RTO.

The new target lacks provider-owned `supabase_realtime_admin`. The rehearsal omitted only its exact parameter grant after checking the live role inventory, retaining the original SQL in the encrypted archive and the omitted statement hash in the receipt. It did not create a reserved role, broaden application grants or prove equal platform replication privileges. The first uncertain rehearsal was disposed of only after verifying its exact operator-owned identity and empty application contents, then source-only inventory; a fresh target was used for the successful restore. Uncertain provider operations must be read back rather than blindly repeated.

Plain PostgreSQL local attempts did not establish Supabase recoverability. Those local servers are stopped, but their owner-only directories remain because automatic approval review rejected recursive cleanup. They are not active recovery destinations or passing evidence.

## Remaining operational gates

The initial capture script refuses populated projects. It must not be treated as the recurring backup implementation after deployment. A complete operational backup must include private operational schemas and secrets needed for recovery, Auth-supported data, configuration/release references, migration history, and actual Storage file bytes with checksums. Establish a deliberate consistency boundary and reconcile post-checkpoint revocations before restoring access or restarting external effects.

Daily encrypted backups, seven daily plus four weekly recovery points, periodic populated isolated restores, RPO at most 24 hours and RTO at most four working hours remain required. A successful initial archive and one empty restore do not establish those controls. Preserve the last recoverable point when a backup or retention job fails. The setup B2 key expires November 2, 2026 at 23:35 Asia/Manila; a job cannot assume credentials remain valid indefinitely.

GitHub standard hosted runners are free for this public repository and can provide a trusted default-branch backup runner. Any implementation must keep permanent credentials out of pull-request jobs, restrict its secret environment to protected main, pin reviewed actions/tool versions, avoid public dumps/artifacts, verify real free-capacity/transfer headroom, observe an actual scheduled run, and handle GitHub schedule delays or inactivity suspension. A sleeping laptop does not establish daily protection.

Collect real provider and backup-age measurements. The existing operational-controls helper is an assessment tool, not deployed monitoring or an enforced write barrier. Preserve the approved reduce/pause thresholds and close affected intake if backup integrity, age, scheduler or quota gates fail. Named recovery/business decisions, actual SMTP flows, populated DB/private/Storage recovery, scheduled retention, monitoring and authenticated hosted smoke remain open. Keep private admission closed while these gates are unmet.

## References

- [Supabase backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase database connections and TLS](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Auth redirects](https://supabase.com/docs/guides/auth/redirect-urls)
- [GitHub Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
