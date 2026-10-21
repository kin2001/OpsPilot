# OpsPilot development operations

This is the POR-23 synthetic T1 source setup. Local toolchain checks have passed; the first backend migration, real API/Edge/mail flow and generated contract are awaiting isolated CI. Nothing here authorizes hosted migrations, private pilot data, deployment or paid provisioning.

## Reproduce the client toolchain

Use Node 24.15.0 and npm 11.12.1, the committed lock, and a separate dependency directory per checkout. On the assigned Windows worktree, set process-only `npm_config_cache`, `PLAYWRIGHT_BROWSERS_PATH`, `TEMP` and `TMP` to that checkout's ignored D: `.cache/npm`, `.cache/ms-playwright` and `.cache/tmp`. Create the temp directory first. The approved initial preparation floor is 8 GiB free; remeasure before a new preparation or large download. Do not use the constrained C: drive as a fallback.

Run `npm ci --ignore-scripts`, `npm ls --depth=0`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then explicit `npm exec --no -- playwright install chromium` and `npm run test:e2e`. Locked install removes existing dependencies; do not run it as a presence check or delete the lock to repair a mismatch. No install hook is enabled. The pinned Supabase CLI ships native optional binaries and needs no postinstall. ESLint parses TS/TSX with Babel; TypeScript 7 checks types and unused symbols.

The shadcn development chain currently has seven high audit entries rooted in unpatched braces stack exhaustion (GHSA-vfj7-8cjw-p6xm). Do not execute the CLI with untrusted glob patterns or generate components until the affected action is reviewed. The client does not import the CLI. Do not run an automatic audit fix, override, downgrade or peer/TLS bypass.

## Isolated backend checks

The reviewed GitHub workflow uses one standard Ubuntu 24.04 runner, a 35-minute cap and a unique job-owned loopback Docker network. Relay verifies free quota and zero paid overage authority before each authorized push/run. No wildcard branch, paid runner, cloud target or global Docker install is implied. CLI startup, reset and pgTAP receive the same network ID; type generation is in-process and rejects that flag. The job asserts loopback ports after reset and verifies successful container/network inventories at teardown.

Startup/status/reset/Edge logs and generated local keys remain ephemeral and suppressed. Failure diagnostics are bounded and scrubbed. Only the native generated TypeScript schema file may be retained as the explicitly scoped one-day artifact; no `.cache` directory, logs, environment, fixtures or backups may be uploaded. `db:test` checks real PostgreSQL; integration tests create synthetic users through real local Auth and exercise RPC/RLS/Storage/Edge. Missing configuration fails rather than substituting mocks.

The integration suite is destructive only to its job-owned synthetic fixtures. It rejects hosted/non-loopback URLs. No local Windows Docker is available. Backend source is not accepted until the actual isolated checks pass; an initial eight-test absent-schema failure established the test harness, not product readiness.

## Identity and invitation email

Bootstrap requires a verified Auth user and an independently authorized entry in `private.pilot_onboarding_allowlist`. The browser cannot write the allowlist, choose an owner ID or create unrestricted organizations. Do not add real users through synthetic seed SQL. Hosted account/project/environment/permissions and human onboarding authority must be verified before an operator adds an allowlist entry.

`organization-invite` verifies its bearer through Auth and invokes the current owner's database command. `INVITATION_EMAIL_ENABLED` defaults false: disabled delivery returns 503 before creating an invitation. `APP_ORIGIN` is a fixed server setting, never caller input. The existing Supabase Auth email sign-in transport creates/verifies a new recipient or signs in an existing recipient; membership still requires explicit `accept_organization_invitation`. No Auth password reset or automatic membership is performed. The response says delivery **requested**, not inbox delivery proven, and contains metadata only. A transport failure leaves a pending invitation; a deliberate retry reuses the original request identity, without automatic blind retries.

Only isolated CI enables the flag after checking the local Mailpit endpoint. Hosted SMTP sender/domain, redirect allowlist, signup/recovery/invitation delivery and rate limits remain unverified. Keep hosted sending disabled until those identities and actual email journeys are verified. No SMTP provider or secret is invented by this setup.

Pixel's `/invite` route must capture the opaque `invitation` query and Auth session fragment, then immediately replace browser history with a clean URL before rendering or starting any third-party resource. Use no analytics, service-worker caching or referrer-bearing external navigation for this route; enforce no-referrer and private response caching controls. Sign in with the intended verified email, then explicitly accept. Wrong email, expired/revoked invite or inactive inviter is denied. Never display/log the opaque grant, email link, access token or refresh token.

The token hash alone is stored. A random database-private HMAC key lets the same authorized command reproduce its own pending token without retaining raw grants in receipts or audit. Key rotation must revoke outstanding invitations and issue new request identities; old command replay fails safely if it cannot reproduce the recorded hash. Rotating a key alone does not revoke already issued links. No client or API role can read this key, receipts or the onboarding allowlist.

## T1 contracts and recovery

Named commands take `{organization_id, request_id, expected_version?}`; derive the actor from Auth and check current active membership after the tenant lock. Edits/assignment require the observed version; retries keep the original request identity and payload. A changed payload conflicts. Request return/rejection/withdrawal history and previous assignment intervals are retained. Conversion returns one draft work order even under concurrent calls. Drafts do not establish operational availability; T2 owns accepted work, holds, review and release.

Technicians/inventory do not receive an organization-wide asset selector. `lookup_request_asset(organization_id, asset_code?, asset_id?)` requires exactly one exact code or UUID, returns at most one `{id,code,name}` for an active same-tenant asset, and returns the same NOT_FOUND for unknown, inactive and foreign identifiers. Full asset RLS remains scoped to operations or a technician's own/assigned context. Clear user/tenant query caches and subscriptions on workspace switch, membership loss or logout.

The migration is additive and has not been applied to a hosted target. Correct defects with a reviewed forward migration once shared; do not edit an applied migration or reset a hosted database. The disposable CI stack may be reset to test reproducibility and is stopped without backup after the run. Preserve committed command identities, events and audit in any later real recovery. No private database+Storage restore drill or operational RPO/RTO has been verified by this delivery. Pilot recovery needs separately verified provider configuration, files, current access decisions and named human owners.

Before publication, inspect exact ignored/untracked secret paths, build/archive exclusions and the public bundle. Client variable names may include only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Server credentials never use a VITE prefix. Reuse native sessions and secure provider settings; never copy token/session files between worktrees. The private GitHub enforced merge gate is currently unavailable on the observed account plan; preserve feature work without bypassing that gate.


The native `src/lib/database.types.ts` was generated by the isolated run39617925869 from migration at1c95e7e, not authored by hand. `createSupabaseClient` uses this Database type and disables automatic URL-session detection so the invitation route can capture and clear sensitive URL material before explicitly setting its session. Generated Insert/Update types describe schema; SQL grants/RLS still deny direct critical writes. Regenerate/diff after schema changes through the same scoped artifact workflow.

Current access checks additionally require a confirmed, nondeleted Auth user with no active ban. The private shared helper is not granted to API roles; membership, command actor and pending inviter checks call it inside existing definer boundaries. This candidate's retained-token negative cases await isolated execution. Supabase sign-out revokes refresh credentials; already issued access JWTs may remain valid until expiry. Do not promise immediate global sign-out/session revocation. Organization membership revocation remains immediate at the next authorized database operation.
